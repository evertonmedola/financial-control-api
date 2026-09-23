import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
  let transactionsRepository: jest.Mocked<
    Pick<
      Repository<Transaction>,
      'find' | 'findOne' | 'save' | 'update' | 'createQueryBuilder'
    >
  >;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
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
        findOne: jest.fn(),
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
    transactionsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepository,
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

  describe('findOne', () => {
    it('throws NotFoundException when the repository returns null', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('user-id', 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('queries with a where clause scoped to type: In([INCOME, EXPENSE]) — a transfer row is excluded structurally', async () => {
      transactionsRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('user-id', 'transfer-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(transactionsRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: In([TransactionType.INCOME, TransactionType.EXPENSE]),
          }) as unknown,
        }),
      );
    });
  });

  describe('update', () => {
    it('returns the current transaction unchanged instead of crashing when the PATCH body is empty (regression, CR-01)', async () => {
      const currentTransaction = {
        id: 'transaction-id',
        userId: 'user-id',
        description: 'Mercado',
        date: '2026-09-13',
      } as unknown as Transaction;
      transactionsRepository.findOne.mockResolvedValue(currentTransaction);

      const result = await service.update('user-id', 'transaction-id', {});

      expect(transactionsRepository.update).not.toHaveBeenCalled();
      expect(result).toBe(currentTransaction);
    });

    it('issues a scoped conditional update, then re-reads the row when a field is provided (happy path)', async () => {
      const currentTransaction = {
        id: 'transaction-id',
        userId: 'user-id',
        description: 'Mercado',
        date: '2026-09-13',
      } as unknown as Transaction;
      const updatedTransaction = {
        ...currentTransaction,
        description: 'Feira',
      };
      transactionsRepository.findOne
        .mockResolvedValueOnce(currentTransaction)
        .mockResolvedValueOnce(updatedTransaction);
      transactionsRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.update('user-id', 'transaction-id', {
        description: 'Feira',
      });

      expect(transactionsRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'transaction-id', userId: 'user-id' }),
        { description: 'Feira' },
      );
      expect(result).toBe(updatedTransaction);
    });

    it('throws NotFoundException instead of resurrecting a concurrently soft-deleted transaction (error case)', async () => {
      const currentTransaction = {
        id: 'transaction-id',
        userId: 'user-id',
        description: 'Mercado',
        date: '2026-09-13',
      } as unknown as Transaction;
      transactionsRepository.findOne.mockResolvedValueOnce(currentTransaction);
      transactionsRepository.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(
        service.update('user-id', 'transaction-id', { description: 'Feira' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('calls accountsService.adjustBalance with a positive reversal delta for an EXPENSE transaction, and soft-deletes (never hard-deletes)', async () => {
      const userId = 'user-id';
      const transaction = {
        id: 'transaction-id',
        userId,
        type: TransactionType.EXPENSE,
        amount: '100.00',
        accountId: 'account-id',
        deletedAt: null,
      } as unknown as Transaction;

      queryRunner.manager.findOne.mockResolvedValue(transaction);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.save.mockResolvedValue(transaction);

      await service.remove(userId, 'transaction-id');

      expect(accountsService.adjustBalance).toHaveBeenCalledWith(
        expect.anything() as EntityManager,
        userId,
        'account-id',
        '100.00',
      );
      expect(transaction.deletedAt).not.toBeNull();
      expect(queryRunner.manager.save).toHaveBeenCalledWith(transaction);
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('calls accountsService.adjustBalance with a negative reversal delta for an INCOME transaction', async () => {
      const userId = 'user-id';
      const transaction = {
        id: 'transaction-id',
        userId,
        type: TransactionType.INCOME,
        amount: '500.00',
        accountId: 'account-id',
        deletedAt: null,
      } as unknown as Transaction;

      queryRunner.manager.findOne.mockResolvedValue(transaction);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.save.mockResolvedValue(transaction);

      await service.remove(userId, 'transaction-id');

      expect(accountsService.adjustBalance).toHaveBeenCalledWith(
        expect.anything() as EntityManager,
        userId,
        'account-id',
        '-500.00',
      );
    });

    it('throws NotFoundException and never calls adjustBalance when the locked transaction is not found (already deleted, foreign, or transfer type)', async () => {
      queryRunner.manager.findOne.mockResolvedValue(null);

      await expect(service.remove('user-id', 'transaction-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(accountsService.adjustBalance).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('rolls back and releases the query runner when adjustBalance throws (error case)', async () => {
      const userId = 'user-id';
      const transaction = {
        id: 'transaction-id',
        userId,
        type: TransactionType.EXPENSE,
        amount: '100.00',
        accountId: 'account-id',
        deletedAt: null,
      } as unknown as Transaction;

      queryRunner.manager.findOne.mockResolvedValue(transaction);
      const error = new Error('boom');
      accountsService.adjustBalance.mockRejectedValue(error);

      await expect(service.remove(userId, 'transaction-id')).rejects.toThrow(
        error,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('sumByCategoryExcludingTransfers', () => {
    it('resolves the raw aggregation rows into a Map keyed by categoryId (happy path)', async () => {
      const queryBuilderMock = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { categoryId: 'category-1', total: '50.00' },
          { categoryId: 'category-2', total: '75.25' },
        ]),
      };
      transactionsRepository.createQueryBuilder.mockReturnValue(
        queryBuilderMock as never,
      );

      const result = await service.sumByCategoryExcludingTransfers(
        'user-id',
        ['category-1', 'category-2'],
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual(
        new Map([
          ['category-1', '50.00'],
          ['category-2', '75.25'],
        ]),
      );
      expect(queryBuilderMock.groupBy).toHaveBeenCalledWith(
        'transaction.categoryId',
      );
    });

    // Proves the N+1/empty-IN guard: TypeORM's `IN (:...ids)` throws on an
    // empty array, so an empty categoryIds list must short-circuit WITHOUT
    // ever calling createQueryBuilder.
    it('returns an empty Map without calling createQueryBuilder when categoryIds is empty', async () => {
      const result = await service.sumByCategoryExcludingTransfers(
        'user-id',
        [],
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual(new Map());
      expect(transactionsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('sumByCategoryForDateRangeExcludingTransfers', () => {
    it('resolves the raw aggregation rows into a Map keyed by categoryId, with no categoryIds allowlist (happy path)', async () => {
      const queryBuilderMock = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { categoryId: 'category-1', total: '50.00' },
          { categoryId: 'category-2', total: '75.25' },
        ]),
      };
      transactionsRepository.createQueryBuilder.mockReturnValue(
        queryBuilderMock as never,
      );

      const result = await service.sumByCategoryForDateRangeExcludingTransfers(
        'user-id',
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual(
        new Map([
          ['category-1', '50.00'],
          ['category-2', '75.25'],
        ]),
      );
      expect(queryBuilderMock.groupBy).toHaveBeenCalledWith(
        'transaction.categoryId',
      );
    });

    // Closes the same non-blocking gap STATE.md noted for the sibling
    // sumByCategoryExcludingTransfers method (Phase 5): proves by
    // construction that the filter is `type = EXPENSE` (not merely
    // `type != TRANSFER`), so an INCOME row posted against the same
    // category as an EXPENSE row can never contribute to the sum.
    it('filters by type = EXPENSE (not merely != TRANSFER), so an INCOME row can never contribute to the sum', async () => {
      const queryBuilderMock = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ categoryId: 'category-1', total: '50.00' }]),
      };
      transactionsRepository.createQueryBuilder.mockReturnValue(
        queryBuilderMock as never,
      );

      await service.sumByCategoryForDateRangeExcludingTransfers(
        'user-id',
        '2026-09-01',
        '2026-09-30',
      );

      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'transaction.type = :expenseType',
        { expenseType: TransactionType.EXPENSE },
      );
    });
  });
});
