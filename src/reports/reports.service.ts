import { BadRequestException, Injectable } from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CategorySummaryResponseDto } from './dto/category-summary-response.dto';

@Injectable()
export class ReportsService {
  // AccountsService is deliberately NOT wired yet — tracer-first: wire only
  // what THIS task's endpoint uses; 06-02-PLAN.md adds it when net-balance
  // needs it.
  constructor(
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
}
