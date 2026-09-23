import { subtractDecimalStrings } from '../../common/decimal.util';

// Computed, non-entity response DTO — mirrors BudgetStatusDto's static
// `build()` factory pattern. `deltaPercent` deliberately omitted — CONTEXT.md
// explicitly defers it (divide-by-zero convention undecided).
export class MonthComparisonResponseDto {
  categoryId!: string;
  categoryName!: string;
  currentMonthTotal!: string;
  previousMonthTotal!: string;
  delta!: string;

  static build(
    categoryId: string,
    categoryName: string,
    currentMonthTotal: string,
    previousMonthTotal: string,
  ): MonthComparisonResponseDto {
    const dto = new MonthComparisonResponseDto();
    dto.categoryId = categoryId;
    dto.categoryName = categoryName;
    dto.currentMonthTotal = currentMonthTotal;
    dto.previousMonthTotal = previousMonthTotal;
    // subtractDecimalStrings never divides, so unlike a percentage there is
    // no zero-division edge case to guard against here.
    dto.delta = subtractDecimalStrings(currentMonthTotal, previousMonthTotal);
    return dto;
  }
}
