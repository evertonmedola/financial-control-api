import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountsService } from '../accounts/accounts.service';
import { AccountType } from '../accounts/entities/account.entity';
import { CategoriesService } from '../categories/categories.service';
import {
  addDecimalStrings,
  subtractDecimalStrings,
} from '../common/decimal.util';
import { TransactionsService } from '../transactions/transactions.service';
import { CategorySummaryResponseDto } from './dto/category-summary-response.dto';
import { MonthComparisonResponseDto } from './dto/month-comparison-response.dto';
import { NetBalanceResponseDto } from './dto/net-balance-response.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async getCategorySummary(
    userId: string,
    from: string,
    to: string,
  ): Promise<CategorySummaryResponseDto[]> {
    // Plain string comparison is exact here because both values are
    // @IsDateString()-validated YYYY-MM-DD-shaped strings, so lexical order
    // matches chronological order — mirrors AccountsService.adjustBalance's
    // controlled-400-over-unhandled-error pattern (06-PATTERNS.md).
    if (from > to) {
      throw new BadRequestException('"from" não pode ser posterior a "to"');
    }

    const spentByCategory =
      await this.transactionsService.sumByCategoryForDateRangeExcludingTransfers(
        userId,
        from,
        to,
      );
    if (spentByCategory.size === 0) {
      return [];
    }

    // Already userId + deletedAt IS NULL scoped, the established convention
    // every prior list query follows.
    const categories = await this.categoriesService.findAll(userId);
    const categoryNamesById = new Map(
      categories.map((category) => [category.id, category.name]),
    );

    const summaries: CategorySummaryResponseDto[] = [];
    for (const [categoryId, total] of spentByCategory) {
      const categoryName = categoryNamesById.get(categoryId);
      // The category was soft-deleted after the transactions that
      // reference it still exist — an edge case CONTEXT.md leaves to
      // discretion. Skip, consistent with every other list/aggregate
      // endpoint excluding soft-deleted rows.
      if (categoryName === undefined) {
        continue;
      }
      summaries.push(
        CategorySummaryResponseDto.build(categoryId, categoryName, total),
      );
    }
    return summaries;
  }

  // REP-02: consolidated balance is a NET total — CONTEXT.md's "Balance
  // Netting" decision. accountsService.findAll(userId) is already
  // userId + deletedAt IS NULL scoped (Phase 2 convention), so a
  // soft-deleted account is excluded automatically with no extra filtering
  // here. CARTAO_CREDITO's stored `balance` is always "amount owed"
  // (Phase 2, D-01) — subtracted as debt, never summed in as an asset.
  // decimal.util.ts only — never parseFloat/Number() anywhere in this
  // method.
  async getNetBalance(userId: string): Promise<NetBalanceResponseDto> {
    const accounts = await this.accountsService.findAll(userId);
    let assets = '0.00';
    let debt = '0.00';
    for (const account of accounts) {
      if (account.type === AccountType.CARTAO_CREDITO) {
        debt = addDecimalStrings(debt, account.balance);
      } else {
        assets = addDecimalStrings(assets, account.balance);
      }
    }
    return NetBalanceResponseDto.build(subtractDecimalStrings(assets, debt));
  }

  // REP-03: month-over-month per-category comparison. Fetches current +
  // previous month's spend (both via the same aggregation method REP-01
  // added) and the user's categories concurrently. The UNION of both
  // months' categoryIds is used — deliberately not just the current
  // month's — so a category with real spend last month and none this
  // month still appears with a meaningful "dropped to zero" delta,
  // mirroring Budgets' Pitfall-4 "never null/undefined/NaN" convention
  // applied to whichever side of the comparison is missing.
  async getMonthComparison(
    userId: string,
    month: string,
  ): Promise<MonthComparisonResponseDto[]> {
    const current = this.getMonthBounds(month);
    const previous = this.getPreviousMonthBounds(month);

    const [currentSpend, previousSpend, categories] = await Promise.all([
      this.transactionsService.sumByCategoryForDateRangeExcludingTransfers(
        userId,
        current.start,
        current.end,
      ),
      this.transactionsService.sumByCategoryForDateRangeExcludingTransfers(
        userId,
        previous.start,
        previous.end,
      ),
      this.categoriesService.findAll(userId),
    ]);

    const categoryNamesById = new Map(
      categories.map((category) => [category.id, category.name]),
    );

    const categoryIds = new Set([
      ...currentSpend.keys(),
      ...previousSpend.keys(),
    ]);

    const comparisons: MonthComparisonResponseDto[] = [];
    for (const categoryId of categoryIds) {
      const categoryName = categoryNamesById.get(categoryId);
      // Same soft-delete-exclusion discretion as getCategorySummary: a
      // category soft-deleted after transactions referencing it still
      // exist has no name to show, so it is skipped.
      if (categoryName === undefined) {
        continue;
      }
      comparisons.push(
        MonthComparisonResponseDto.build(
          categoryId,
          categoryName,
          currentSpend.get(categoryId) ?? '0.00',
          previousSpend.get(categoryId) ?? '0.00',
        ),
      );
    }
    return comparisons;
  }

  // Parses `month` ("YYYY-MM") into its own first/last-day bounds. Mirrors
  // BudgetsService.getCurrentMonthBounds's UTC-date-parts computation
  // exactly, but parameterized by the requested month string instead of
  // `new Date()`.
  private getMonthBounds(month: string): { start: string; end: string } {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const pad = (value: number): string => value.toString().padStart(2, '0');
    const start = `${year}-${pad(monthIndex + 1)}-01`;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const end = `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`;
    return { start, end };
  }

  // Computes the immediately preceding calendar month's bounds from the
  // same `month` string. `new Date(Date.UTC(year, monthIndex - 1, 1))`
  // correctly rolls a monthIndex of -1 back into December of the prior
  // year, so no manual January-boundary branch is needed.
  private getPreviousMonthBounds(month: string): {
    start: string;
    end: string;
  } {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const previousDate = new Date(Date.UTC(year, monthIndex - 1, 1));
    const previousMonth = `${previousDate.getUTCFullYear()}-${(previousDate.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    return this.getMonthBounds(previousMonth);
  }
}
