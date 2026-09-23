import { Test, TestingModule } from '@nestjs/testing';
import { AccountsService } from '../accounts/accounts.service';
import { AccountType } from '../accounts/entities/account.entity';
import { Account } from '../accounts/entities/account.entity';
import { CategoriesService } from '../categories/categories.service';
import { TransactionsService } from '../transactions/transactions.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let accountsService: jest.Mocked<Pick<AccountsService, 'findAll'>>;
  let categoriesService: jest.Mocked<Pick<CategoriesService, 'findAll'>>;
  let transactionsService: jest.Mocked<
    Pick<
      TransactionsService,
      | 'sumByCategoryForDateRangeExcludingTransfers'
      | 'sumByCategoryExcludingTransfers'
    >
  >;

  beforeEach(async () => {
    accountsService = {
      findAll: jest.fn(),
    };
    categoriesService = {
      findAll: jest.fn(),
    };
    transactionsService = {
      sumByCategoryForDateRangeExcludingTransfers: jest.fn(),
      sumByCategoryExcludingTransfers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: AccountsService, useValue: accountsService },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: TransactionsService, useValue: transactionsService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getNetBalance', () => {
    it('nets a mixed asset+liability list (1000.00 corrente - 300.00 cartao_credito = 700.00)', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CORRENTE, balance: '1000.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '300.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('700.00');
    });

    it('sums an all-asset-type list plainly (corrente + poupanca + carteira)', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CORRENTE, balance: '100.00' },
        { type: AccountType.POUPANCA, balance: '200.00' },
        { type: AccountType.CARTEIRA, balance: '50.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('350.00');
    });

    it('nets to a negative balance when the account list is all cartao_credito debt', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CARTAO_CREDITO, balance: '100.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '50.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('-150.00');
    });

    it('nets to 0.00 for an empty account list', async () => {
      accountsService.findAll.mockResolvedValue([]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('0.00');
    });
  });
});
