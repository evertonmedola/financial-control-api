import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      const savedEntity = { id: 'account-id', ...createdEntity } as Account;

      accountsRepository.create.mockReturnValue(createdEntity);
      accountsRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(userId, dto);

      expect(accountsRepository.create).toHaveBeenCalledWith({
        ...dto,
        userId,
      });
      expect(accountsRepository.save).toHaveBeenCalledWith(createdEntity);
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
});
