import { ApiProperty } from '@nestjs/swagger';
import { subtractDecimalStrings } from '../../common/decimal.util';

// Computed, non-entity response DTO — mirrors BudgetStatusDto's static
// `build()` factory pattern. `deltaPercent` deliberately omitted — CONTEXT.md
// explicitly defers it (divide-by-zero convention undecided).
export class MonthComparisonResponseDto {
  @ApiProperty({
    description: 'Category identifier.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  categoryId!: string;

  @ApiProperty({ description: 'Category name.', example: 'Groceries' })
  categoryName!: string;

  @ApiProperty({
    type: String,
    description: 'Total spent in the requested month (decimal string).',
    example: '1250.40',
  })
  currentMonthTotal!: string;

  @ApiProperty({
    type: String,
    description: 'Total spent in the previous month (decimal string).',
    example: '980.00',
  })
  previousMonthTotal!: string;

  @ApiProperty({
    type: String,
    description:
      'Current month minus previous month (decimal string). Negative when spending dropped.',
    example: '270.40',
  })
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
