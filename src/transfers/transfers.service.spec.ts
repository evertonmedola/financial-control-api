import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

describe('TransfersService', () => {
  let service: TransfersService;
  let accountsService: jest.Mocked<
    Pick<AccountsService, 'findOne' | 'adjustBalance'>
  >;
  let dataSource: jest.Mocked<Pick<DataSource, 'createQueryRunner'>>;
  let transactionsRepository: jest.Mocked<
    Pick<Repository<Transaction>, 'find' | 'findOne' | 'save'>
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
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };
    transactionsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionsRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: AccountsService, useValue: accountsService },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const baseDto: Omit<CreateTransferDto, 'fromAccountId' | 'toAccountId'> = {
      amount: '200.00',
      date: '2026-09-13',
      description: 'Transferência',
    };

    it('validates the ownership chain for BOTH accounts before adjustBalance, and locks in ascending-id order (from < to)', async () => {
      const userId = 'user-id';
      const dto: CreateTransferDto = {
        ...baseDto,
        fromAccountId: 'aaaa-account',
        toAccountId: 'bbbb-account',
      };

      accountsService.findOne.mockResolvedValue({ id: 'account' } as never);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.create.mockReturnValue({});
      queryRunner.manager.save.mockResolvedValue({ id: 'transfer-id' });

      await service.create(userId, dto);

      expect(accountsService.findOne).toHaveBeenCalledWith(
        userId,
        dto.fromAccountId,
      );
      expect(accountsService.findOne).toHaveBeenCalledWith(
        userId,
        dto.toAccountId,
      );
      // aaaa-account < bbbb-account: locked first, debited (fromAccountId).
      expect(accountsService.adjustBalance).toHaveBeenNthCalledWith(
        1,
        expect.anything() as EntityManager,
        userId,
        'aaaa-account',
        '-200.00',
      );
      expect(accountsService.adjustBalance).toHaveBeenNthCalledWith(
        2,
        expect.anything() as EntityManager,
        userId,
        'bbbb-account',
        '200.00',
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('locks the SAME two accounts in the SAME ascending-id order even when fromAccountId > toAccountId (direction-independent locking, Pitfall 2)', async () => {
      const userId = 'user-id';
      const dto: CreateTransferDto = {
        ...baseDto,
        fromAccountId: 'bbbb-account',
        toAccountId: 'aaaa-account',
      };

      accountsService.findOne.mockResolvedValue({ id: 'account' } as never);
      accountsService.adjustBalance.mockResolvedValue({} as never);
      queryRunner.manager.create.mockReturnValue({});
      queryRunner.manager.save.mockResolvedValue({ id: 'transfer-id' });

      await service.create(userId, dto);

      // Still locked ascending-id first (aaaa-account), regardless of which
      // field is from/to — but now aaaa-account is the toAccountId, so it
      // receives the positive delta.
      expect(accountsService.adjustBalance).toHaveBeenNthCalledWith(
        1,
        expect.anything() as EntityManager,
        userId,
        'aaaa-account',
        '200.00',
      );
      expect(accountsService.adjustBalance).toHaveBeenNthCalledWith(
        2,
        expect.anything() as EntityManager,
        userId,
        'bbbb-account',
        '-200.00',
      );
    });

    it('rejects fromAccountId === toAccountId with BadRequestException WITHOUT calling findOne or opening a queryRunner (fail-fast)', async () => {
      const userId = 'user-id';
      const dto: CreateTransferDto = {
        ...baseDto,
        fromAccountId: 'same-account',
        toAccountId: 'same-account',
      };

      await expect(service.create(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(accountsService.findOne).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('rolls back and releases the query runner when adjustBalance throws (error case)', async () => {
      const userId = 'user-id';
      const dto: CreateTransferDto = {
        ...baseDto,
        fromAccountId: 'aaaa-account',
        toAccountId: 'bbbb-account',
      };

      accountsService.findOne.mockResolvedValue({ id: 'account' } as never);
      const error = new Error('boom');
      accountsService.adjustBalance.mockRejectedValue(error);

      await expect(service.create(userId, dto)).rejects.toThrow(error);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });
});
