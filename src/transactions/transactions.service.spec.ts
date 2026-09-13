import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let accountsService: jest.Mocked<
    Pick<AccountsService, 'findOne' | 'adjustBalance'>
  >;
  let categoriesService: jest.Mocked<Pick<CategoriesService, 'findOne'>>;
  let dataSource: jest.Mocked<Pick<DataSource, 'createQueryRunner'>>;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { create: jest.Mock; save: jest.Mock };
  };

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn(),
        save: jest.fn(),
      },
    };

    accountsService = {
      findOne: jest.fn(),
      adjustBalance: jest.fn(),
    };
    categoriesService = {
      findOne: jest.fn(),
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: {} as Repository<Transaction>,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: AccountsService, useValue: accountsService },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('validates the ownership chain before adjustBalance, and negates the delta for an expense (happy path)', async () => {
      const userId = 'user-id';
      const dto: CreateTransactionDto = {
        type: TransactionType.EXPENSE,
        amount: '100.00',
        accountId: 'account-id',
        categoryId: 'category-id',
        description: 'Mercado',
        date: '2026-09-13',
      };
      const createdEntity = { ...dto, userId } as unknown as Transaction;
      const savedEntity = { id: 'transaction-id', ...createdEntity };

      accountsService.findOne.mockResolvedValue({ id: 'account-id' } as never);
      categoriesService.findOne.mockResolvedValue({
        id: 'category-id',
      } as never);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.create.mockReturnValue(createdEntity);
      queryRunner.manager.save.mockResolvedValue(savedEntity);

      const result = await service.create(userId, dto);

      expect(accountsService.findOne).toHaveBeenCalledWith(
        userId,
        dto.accountId,
      );
      expect(categoriesService.findOne).toHaveBeenCalledWith(
        userId,
        dto.categoryId,
      );
      expect(accountsService.adjustBalance).toHaveBeenCalledWith(
        expect.anything() as EntityManager,
        userId,
        dto.accountId,
        '-100.00',
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toBe(savedEntity);
    });

    it('passes the amount unmodified (positive delta) for an income transaction', async () => {
      const userId = 'user-id';
      const dto: CreateTransactionDto = {
        type: TransactionType.INCOME,
        amount: '500.00',
        accountId: 'account-id',
        categoryId: 'category-id',
        description: 'Salario',
        date: '2026-09-13',
      };

      accountsService.findOne.mockResolvedValue({ id: 'account-id' } as never);
      categoriesService.findOne.mockResolvedValue({
        id: 'category-id',
      } as never);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.create.mockReturnValue({});
      queryRunner.manager.save.mockResolvedValue({});

      await service.create(userId, dto);

      expect(accountsService.adjustBalance).toHaveBeenCalledWith(
        expect.anything() as EntityManager,
        userId,
        dto.accountId,
        '500.00',
      );
    });

    it('rolls back and releases the query runner when adjustBalance throws (error case)', async () => {
      const userId = 'user-id';
      const dto: CreateTransactionDto = {
        type: TransactionType.EXPENSE,
        amount: '100.00',
        accountId: 'account-id',
        categoryId: 'category-id',
        description: 'Mercado',
        date: '2026-09-13',
      };

      accountsService.findOne.mockResolvedValue({ id: 'account-id' } as never);
      categoriesService.findOne.mockResolvedValue({
        id: 'category-id',
      } as never);
      const error = new Error('boom');
      accountsService.adjustBalance.mockRejectedValue(error);

      await expect(service.create(userId, dto)).rejects.toThrow(error);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });
});
