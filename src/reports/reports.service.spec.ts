import { BadRequestException } from '@nestjs/common';
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

  describe('getCategorySummary', () => {
    it('throws BadRequestException when from > to', async () => {
      await expect(
        service.getCategorySummary('user-id', '2026-09-20', '2026-09-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns [] without calling categoriesService.findAll when there is no spend in range', async () => {
      transactionsService.sumByCategoryForDateRangeExcludingTransfers.mockResolvedValue(
        new Map(),
      );

      const result = await service.getCategorySummary(
        'user-id',
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual([]);
      expect(categoriesService.findAll).not.toHaveBeenCalled();
    });

    it('skips a category with no active name (soft-deleted after transactions referencing it still exist)', async () => {
      categoriesService.findAll.mockResolvedValue([]);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers.mockResolvedValue(
        new Map([['ghost-category', '10.00']]),
      );

      const result = await service.getCategorySummary(
        'user-id',
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual([]);
    });

    it('builds a summary entry for a category with an active name', async () => {
      categoriesService.findAll.mockResolvedValue([
        { id: 'category-1', name: 'Alimentação' },
      ] as never);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers.mockResolvedValue(
        new Map([['category-1', '50.00']]),
      );

      const result = await service.getCategorySummary(
        'user-id',
        '2026-09-01',
        '2026-09-30',
      );

      expect(result).toEqual([
        {
          categoryId: 'category-1',
          categoryName: 'Alimentação',
          total: '50.00',
        },
      ]);
    });
  });

  describe('getNetBalance', () => {
    it('sums uniformly: a negative cartao_credito balance is open debt (1000.00 corrente + -300.00 cartao_credito = 700.00)', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CORRENTE, balance: '1000.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '-300.00' },
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

    it('nets to a negative balance when the account list is all cartao_credito open debt (uniform sum)', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CARTAO_CREDITO, balance: '-100.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '-50.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('-150.00');
    });

    it('adds a positive cartao_credito balance (credit/overpayment) like any other account, never subtracts it', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CORRENTE, balance: '100.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '20.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('120.00');
    });

    it('a cartao_credito at 0.00 contributes nothing to the net balance', async () => {
      accountsService.findAll.mockResolvedValue([
        { type: AccountType.CORRENTE, balance: '100.00' },
        { type: AccountType.CARTAO_CREDITO, balance: '0.00' },
      ] as Account[]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('100.00');
    });

    it('nets to 0.00 for an empty account list', async () => {
      accountsService.findAll.mockResolvedValue([]);

      const result = await service.getNetBalance('user-id');

      expect(result.balance).toBe('0.00');
    });
  });

  describe('getMonthComparison', () => {
    it('calls sumByCategoryForDateRangeExcludingTransfers twice with the correct current/previous month bounds', async () => {
      categoriesService.findAll.mockResolvedValue([
        { id: 'category-1', name: 'Alimentação' },
      ] as never);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers
        .mockResolvedValueOnce(new Map([['category-1', '100.00']]))
        .mockResolvedValueOnce(new Map([['category-1', '80.00']]));

      await service.getMonthComparison('user-id', '2026-03');

      expect(
        transactionsService.sumByCategoryForDateRangeExcludingTransfers,
      ).toHaveBeenNthCalledWith(
        1,
        'user-id',
        expect.stringMatching(/^2026-03-01$/),
        expect.stringMatching(/^2026-03-\d{2}$/),
      );
      expect(
        transactionsService.sumByCategoryForDateRangeExcludingTransfers,
      ).toHaveBeenNthCalledWith(
        2,
        'user-id',
        expect.stringMatching(/^2026-02-01$/),
        expect.stringMatching(/^2026-02-\d{2}$/),
      );
    });

    it('a category present only in the previous month appears with currentMonthTotal 0.00 and a negative delta', async () => {
      categoriesService.findAll.mockResolvedValue([
        { id: 'category-1', name: 'Alimentação' },
      ] as never);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers
        .mockResolvedValueOnce(new Map())
        .mockResolvedValueOnce(new Map([['category-1', '80.00']]));

      const result = await service.getMonthComparison('user-id', '2026-03');

      expect(result).toEqual([
        {
          categoryId: 'category-1',
          categoryName: 'Alimentação',
          currentMonthTotal: '0.00',
          previousMonthTotal: '80.00',
          delta: '-80.00',
        },
      ]);
    });

    it('a category present only in the current month appears with previousMonthTotal 0.00 and a positive delta', async () => {
      categoriesService.findAll.mockResolvedValue([
        { id: 'category-1', name: 'Alimentação' },
      ] as never);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers
        .mockResolvedValueOnce(new Map([['category-1', '100.00']]))
        .mockResolvedValueOnce(new Map());

      const result = await service.getMonthComparison('user-id', '2026-03');

      expect(result).toEqual([
        {
          categoryId: 'category-1',
          categoryName: 'Alimentação',
          currentMonthTotal: '100.00',
          previousMonthTotal: '0.00',
          delta: '100.00',
        },
      ]);
    });

    it('a January month rolls its previous-month bounds into December of the prior year', async () => {
      categoriesService.findAll.mockResolvedValue([]);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers
        .mockResolvedValueOnce(new Map())
        .mockResolvedValueOnce(new Map());

      await service.getMonthComparison('user-id', '2026-01');

      expect(
        transactionsService.sumByCategoryForDateRangeExcludingTransfers,
      ).toHaveBeenNthCalledWith(
        2,
        'user-id',
        expect.stringMatching(/^2025-12-01$/),
        expect.stringMatching(/^2025-12-31$/),
      );
    });

    it('skips a category with no active name (soft-deleted after transactions referencing it still exist)', async () => {
      categoriesService.findAll.mockResolvedValue([]);
      transactionsService.sumByCategoryForDateRangeExcludingTransfers
        .mockResolvedValueOnce(new Map([['ghost-category', '10.00']]))
        .mockResolvedValueOnce(new Map());

      const result = await service.getMonthComparison('user-id', '2026-03');

      expect(result).toEqual([]);
    });
  });
});
