import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CategoryType } from '../categories/entities/category.entity';
import { CategoriesService } from '../categories/categories.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { BudgetStatusDto } from './dto/budget-status.dto';
import { Budget } from './entities/budget.entity';

// Postgres unique-violation error code.
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    private readonly categoriesService: CategoriesService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // Ownership-chain validation (Pitfall 3) happens before any write —
  // reuses the exact pattern TransactionsService.create already
  // established. D-03: a budget can only reference a DESPESA category,
  // checked against the referenced Category's real type, never a
  // client-supplied field.
  async create(userId: string, dto: CreateBudgetDto): Promise<Budget> {
    const category = await this.categoriesService.findOne(
      userId,
      dto.categoryId,
    );
    if (category.type !== CategoryType.DESPESA) {
      throw new BadRequestException(
        'orçamento só pode ser criado para uma categoria de despesa',
      );
    }

    const budget = this.budgetsRepository.create({ ...dto, userId });
    return this.saveOrThrowConflict(budget);
  }

  // 404, never 403, when the budget doesn't exist or belongs to another
  // user — mirrors CategoriesService's ownership-check philosophy
  // (Pitfall 3, IDOR).
  async findOne(userId: string, id: string): Promise<Budget> {
    const budget = await this.budgetsRepository.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!budget) {
      throw new NotFoundException();
    }
    return budget;
  }

  // Ownership check (findOne) happens before mutation. `dto` can never
  // carry `categoryId` — the DTO layer already excludes it (D-02). Reuses
  // the same conflict-translating helper create() uses, though a
  // `limit`-only update can never actually collide with the
  // (userId, categoryId) unique index since categoryId never changes here
  // — kept for structural consistency with CategoriesService.update's
  // pattern.
  async update(
    userId: string,
    id: string,
    dto: UpdateBudgetDto,
  ): Promise<Budget> {
    const budget = await this.findOne(userId, id);
    Object.assign(budget, dto);
    return this.saveOrThrowConflict(budget);
  }

  // D-07: soft delete only. Never .delete()/.remove() on the repository —
  // frees the (userId, categoryId) pair for reuse via the partial unique
  // index.
  async remove(userId: string, id: string): Promise<void> {
    const budget = await this.findOne(userId, id);
    budget.deletedAt = new Date();
    await this.budgetsRepository.save(budget);
  }

  // D-06: this IS the `GET /budgets` listing — it only ever returns
  // categories that actually have a budget; there is no per-category 404
  // lookup anywhere in this module.
  async findAllWithStatus(userId: string): Promise<BudgetStatusDto[]> {
    const budgets = await this.budgetsRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (budgets.length === 0) {
      return [];
    }

    const { start, end } = this.getCurrentMonthBounds();
    const categoryIds = budgets.map((budget) => budget.categoryId);
    const spentByCategory =
      await this.transactionsService.sumByCategoryExcludingTransfers(
        userId,
        categoryIds,
        start,
        end,
      );

    return budgets.map((budget) =>
      // Pitfall 4: never null/undefined/NaN for a zero-transaction category.
      BudgetStatusDto.build(
        budget.categoryId,
        budget.limit,
        spentByCategory.get(budget.categoryId) ?? '0.00',
      ),
    );
  }

  // D-05: computed fresh on every call from the real current date — NOT
  // derived from any budget's createdAt — closing the "mid-month budget
  // creation" edge case structurally, since createdAt is never read here.
  // UTC date parts, consistent with Transaction.date's plain `date` column
  // (no timezone component).
  private getCurrentMonthBounds(): { start: string; end: string } {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const pad = (value: number): string => value.toString().padStart(2, '0');
    const start = `${year}-${pad(month + 1)}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const end = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
    return { start, end };
  }

  // Shared by create() and update(): both write paths hit the same
  // UQ_budgets_user_id_category_id partial unique index, so both need the
  // identical Postgres-error-to-409 translation.
  private async saveOrThrowConflict(budget: Budget): Promise<Budget> {
    try {
      return await this.budgetsRepository.save(budget);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'já existe um orçamento para esta categoria',
        );
      }
      throw error;
    }
  }

  // Checks the specific constraint name, not just the 23505 code — matching
  // on code alone would silently mis-report any future unrelated
  // unique-violation on this table as "duplicate budget for this category".
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION &&
      (error as { constraint?: string }).constraint ===
        'UQ_budgets_user_id_category_id'
    );
  }
}
