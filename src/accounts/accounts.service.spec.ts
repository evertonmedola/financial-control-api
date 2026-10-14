import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { Account, AccountType } from './entities/account.entity';

describe('AccountsService', () => {
  let service: AccountsService;
  let accountsRepository: jest.Mocked<Repository<Account>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: getRepositoryToken(Account),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
    accountsRepository = module.get(getRepositoryToken(Account));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('merges userId into the DTO and persists the account via the repository (happy path)', async () => {
      const userId = 'user-id';
      const dto: CreateAccountDto = {
        name: 'Conta Corrente',
        type: AccountType.CORRENTE,
        balance: '1000.00',
      };
      const createdEntity = { ...dto, userId } as Account;
      const savedEntity = { id: 'account-id', ...createdEntity };

      accountsRepository.create.mockReturnValue(createdEntity);
      accountsRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(userId, dto);

      expect(accountsRepository.create.mock.calls[0]).toEqual([
        { ...dto, userId },
      ]);
      expect(accountsRepository.save.mock.calls[0]).toEqual([createdEntity]);
      expect(result).toBe(savedEntity);
    });
  });

  describe('adjustBalance', () => {
    it('locks the account row via pessimistic_write and applies the delta (happy path)', async () => {
      const findOneMock = jest.fn();
      const saveMock = jest.fn();
      const mockManager = {
        findOne: findOneMock,
        save: saveMock,
      } as unknown as EntityManager;
      const account = {
        id: 'account-id',
        userId: 'user-id',
        balance: '1000.00',
      } as Account;
      findOneMock.mockResolvedValue(account);
      saveMock.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.adjustBalance(
        mockManager,
        'user-id',
        'account-id',
        '-100.00',
      );

      expect(findOneMock.mock.calls[0]).toEqual([
        Account,
        {
          where: { id: 'account-id', userId: 'user-id', deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        },
      ]);
      expect(result.balance).toBe('900.00');
      const [savedAccount] = saveMock.mock.calls[0] as [Account];
      expect(savedAccount.balance).toBe('900.00');
    });

    it('applies the signed delta to a CARTAO_CREDITO account with no sign flip by account type (charge -> -100.00, payment -> 0.00)', async () => {
      const findOneMock = jest.fn();
      const saveMock = jest.fn();
      const mockManager = {
        findOne: findOneMock,
        save: saveMock,
      } as unknown as EntityManager;
      const account = {
        id: 'card-id',
        userId: 'user-id',
        type: AccountType.CARTAO_CREDITO,
        balance: '0.00',
      } as Account;
      findOneMock.mockResolvedValue(account);
      saveMock.mockImplementation((entity) => Promise.resolve(entity));

      const afterCharge = await service.adjustBalance(
        mockManager,
        'user-id',
        'card-id',
        '-100.00',
      );
      expect(afterCharge.balance).toBe('-100.00');

      const afterPayment = await service.adjustBalance(
        mockManager,
        'user-id',
        'card-id',
        '100.00',
      );
      expect(afterPayment.balance).toBe('0.00');
    });

    it('throws NotFoundException when the account does not exist or is not owned by userId (error case)', async () => {
      const findOneMock = jest.fn().mockResolvedValue(null);
      const mockManager = {
        findOne: findOneMock,
        save: jest.fn(),
      } as unknown as EntityManager;

      await expect(
        service.adjustBalance(mockManager, 'user-id', 'account-id', '100.00'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Characterization of the WR-03 guard: the numeric(12,2) range
    // (+/-9999999999.99) is inclusive, and a mutation that would leave it is
    // a controlled 400 with nothing persisted.
    describe('numeric(12,2) range guard', () => {
      const overflowMessage =
        'A operação excede o limite máximo permitido para o saldo da conta';

      const run = (balance: string, delta: string) => {
        const saveMock = jest.fn();
        saveMock.mockImplementation((entity) => Promise.resolve(entity));
        const mockManager = {
          findOne: jest.fn().mockResolvedValue({
            id: 'account-id',
            userId: 'user-id',
            balance,
          }),
          save: saveMock,
        } as unknown as EntityManager;
        return {
          saveMock,
          result: service.adjustBalance(
            mockManager,
            'user-id',
            'account-id',
            delta,
          ),
        };
      };

      it.each([
        ['9999999999.99', '0.01'],
        ['-9999999999.99', '-0.01'],
      ])(
        'rejects %s + %s with BadRequestException and never calls save',
        async (balance, delta) => {
          const { saveMock, result } = run(balance, delta);

          await expect(result).rejects.toBeInstanceOf(BadRequestException);
          expect(saveMock.mock.calls.length).toBe(0);
        },
      );

      it.each([
        ['9999999998.99', '1.00', '9999999999.99'],
        ['-9999999998.99', '-1.00', '-9999999999.99'],
      ])(
        'allows %s + %s and saves exactly %s (limit inclusive)',
        async (balance, delta, expected) => {
          const { saveMock, result } = run(balance, delta);

          const account = await result;

          expect(account.balance).toBe(expected);
          const [saved] = saveMock.mock.calls[0] as [Account];
          expect(saved.balance).toBe(expected);
        },
      );

      it('uses a static message without ids or numbers', async () => {
        const { result } = run('9999999999.99', '0.01');

        await expect(result).rejects.toThrow(overflowMessage);
        await result.catch((error: BadRequestException) => {
          expect(error.message).toBe(overflowMessage);
          expect(error.message).not.toContain('account-id');
          expect(error.message).not.toMatch(/\d/);
        });
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException (not a generic error) when the repository returns null (error case)', async () => {
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('user-id', 'missing-account-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the account when the repository finds a userId-scoped match (happy path)', async () => {
      const account = { id: 'account-id', userId: 'user-id' } as Account;
      accountsRepository.findOne.mockResolvedValue(account);

      const result = await service.findOne('user-id', 'account-id');

      expect(result).toBe(account);
      expect(accountsRepository.findOne.mock.calls[0]).toEqual([
        { where: { id: 'account-id', userId: 'user-id', deletedAt: IsNull() } },
      ]);
    });
  });

  describe('remove', () => {
    it('sets deletedAt via a scoped partial update — never a hard-delete repository method (D-03), never a full-entity save (WR-02)', async () => {
      const account = {
        id: 'account-id',
        userId: 'user-id',
        deletedAt: null,
      } as Account;
      accountsRepository.findOne.mockResolvedValue(account);
      accountsRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.remove('user-id', 'account-id');

      expect(accountsRepository.update.mock.calls[0]).toEqual([
        { id: 'account-id', userId: 'user-id', deletedAt: IsNull() },
        { deletedAt: expect.any(Date) as Date },
      ]);
      expect(accountsRepository.save.mock.calls.length).toBe(0);
      expect(accountsRepository.delete.mock.calls.length).toBe(0);
      expect(accountsRepository.remove.mock.calls.length).toBe(0);
    });

    it('throws NotFoundException when the row was concurrently soft-deleted between the ownership check and the write (WR-02 race)', async () => {
      const account = {
        id: 'account-id',
        userId: 'user-id',
        deletedAt: null,
      } as Account;
      accountsRepository.findOne.mockResolvedValue(account);
      accountsRepository.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(
        service.remove('user-id', 'account-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies a scoped partial update — never a full-entity save (WR-02)', async () => {
      const account = {
        id: 'account-id',
        userId: 'user-id',
        deletedAt: null,
        name: 'Old name',
      } as Account;
      const updated = { ...account, name: 'New name' };
      accountsRepository.findOne
        .mockResolvedValueOnce(account)
        .mockResolvedValueOnce(updated);
      accountsRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.update('user-id', 'account-id', {
        name: 'New name',
      });

      expect(accountsRepository.update.mock.calls[0]).toEqual([
        { id: 'account-id', userId: 'user-id', deletedAt: IsNull() },
        { name: 'New name' },
      ]);
      expect(accountsRepository.save.mock.calls.length).toBe(0);
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the row was concurrently soft-deleted between the ownership check and the write (WR-02 race)', async () => {
      const account = {
        id: 'account-id',
        userId: 'user-id',
        deletedAt: null,
      } as Account;
      accountsRepository.findOne.mockResolvedValue(account);
      accountsRepository.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(
        service.update('user-id', 'account-id', { name: 'New name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
