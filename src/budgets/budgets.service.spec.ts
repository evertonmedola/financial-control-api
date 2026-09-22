import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { CategoryType } from '../categories/entities/category.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { Budget } from './entities/budget.entity';

describe('BudgetsService', () => {
  let service: BudgetsService;
  let budgetsRepository: jest.Mocked<Repository<Budget>>;
  let categoriesService: jest.Mocked<Pick<CategoriesService, 'findOne'>>;
  let transactionsService: jest.Mocked<
    Pick<TransactionsService, 'sumByCategoryExcludingTransfers'>
  >;

  beforeEach(async () => {
    categoriesService = {
      findOne: jest.fn(),
    };
    transactionsService = {
      sumByCategoryExcludingTransfers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetsService,
        {
          provide: getRepositoryToken(Budget),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
          },
        },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: TransactionsService, useValue: transactionsService },
      ],
    }).compile();

    service = module.get<BudgetsService>(BudgetsService);
    budgetsRepository = module.get(getRepositoryToken(Budget));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('validates categoryId ownership before persisting, and merges userId into the DTO (happy path)', async () => {
      const userId = 'user-id';
      const dto: CreateBudgetDto = {
        categoryId: 'category-id',
        limit: '300.00',
      };
      categoriesService.findOne.mockResolvedValue({
        id: 'category-id',
        type: CategoryType.DESPESA,
      } as never);
      const createdEntity = { ...dto, userId } as Budget;
      const savedEntity = { id: 'budget-id', ...createdEntity };
      budgetsRepository.create.mockReturnValue(createdEntity);
      budgetsRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(userId, dto);

      expect(categoriesService.findOne).toHaveBeenCalledWith(
        userId,
        dto.categoryId,
      );
      expect(budgetsRepository.create.mock.calls[0]).toEqual([
        { ...dto, userId },
      ]);
      expect(result).toBe(savedEntity);
    });

    it('throws BadRequestException when the referenced category is RECEITA, not DESPESA (D-03, error case)', async () => {
      const userId = 'user-id';
      const dto: CreateBudgetDto = {
        categoryId: 'category-id',
        limit: '300.00',
      };
      categoriesService.findOne.mockResolvedValue({
        id: 'category-id',
        type: CategoryType.RECEITA,
      } as never);

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(budgetsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAllWithStatus', () => {
    it('calls sumByCategoryExcludingTransfers with the current month bounds and the budgeted categoryIds, computing remaining/overBudget (happy path)', async () => {
      const userId = 'user-id';
      const budgets = [
        {
          id: 'budget-1',
          userId,
          categoryId: 'category-1',
          limit: '300.00',
          deletedAt: null,
        },
      ] as Budget[];
      budgetsRepository.find.mockResolvedValue(budgets);
      transactionsService.sumByCategoryExcludingTransfers.mockResolvedValue(
        new Map([['category-1', '50.00']]),
      );

      const result = await service.findAllWithStatus(userId);

      expect(
        transactionsService.sumByCategoryExcludingTransfers,
      ).toHaveBeenCalledWith(
        userId,
        ['category-1'],
        expect.stringMatching(/^\d{4}-\d{2}-01$/) as unknown as string,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
      );
      expect(result).toEqual([
        {
          categoryId: 'category-1',
          limit: '300.00',
          spent: '50.00',
          remaining: '250.00',
          overBudget: false,
        },
      ]);
    });

    it('returns [] and never calls sumByCategoryExcludingTransfers when the user has zero budgets (empty-list short-circuit)', async () => {
      budgetsRepository.find.mockResolvedValue([]);

      const result = await service.findAllWithStatus('user-id');

      expect(result).toEqual([]);
      expect(
        transactionsService.sumByCategoryExcludingTransfers,
      ).not.toHaveBeenCalled();
    });
  });
});
