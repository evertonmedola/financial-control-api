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
}
