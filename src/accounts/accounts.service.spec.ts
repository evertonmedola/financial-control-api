import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
    it('throws — reserved stub not yet callable until Phase 4 (error case)', async () => {
      await expect(
        service.adjustBalance('user-id', 'account-id', '100.00'),
      ).rejects.toThrow('not implemented until Phase 4');
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
    it('sets deletedAt and calls .save() — never a hard-delete repository method (D-03)', async () => {
      const account = {
        id: 'account-id',
        userId: 'user-id',
        deletedAt: null,
      } as Account;
      accountsRepository.findOne.mockResolvedValue(account);
      accountsRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as Account),
      );

      await service.remove('user-id', 'account-id');

      expect(account.deletedAt).toBeInstanceOf(Date);
      expect(accountsRepository.save.mock.calls[0]).toEqual([account]);
      expect(accountsRepository.delete.mock.calls.length).toBe(0);
      expect(accountsRepository.remove.mock.calls.length).toBe(0);
    });
  });
});
