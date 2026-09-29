import { ApiProperty } from '@nestjs/swagger';

// Computed, non-entity response shape mirroring `BudgetStatusDto`'s static-
// factory pattern exactly (06-PATTERNS.md "exact" match note). `total` is
// the raw decimal-string SUM from Postgres, never `parseFloat`'d.
export class CategorySummaryResponseDto {
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
    description:
      'Total spent in the category within the range, excluding transfers (decimal string).',
    example: '1250.40',
  })
  total!: string;

  static build(
    categoryId: string,
    categoryName: string,
    total: string,
  ): CategorySummaryResponseDto {
    const dto = new CategorySummaryResponseDto();
    dto.categoryId = categoryId;
    dto.categoryName = categoryName;
    dto.total = total;
    return dto;
  }
}
