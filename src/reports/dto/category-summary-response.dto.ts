// Computed, non-entity response shape mirroring `BudgetStatusDto`'s static-
// factory pattern exactly (06-PATTERNS.md "exact" match note). `total` is
// the raw decimal-string SUM from Postgres, never `parseFloat`'d.
export class CategorySummaryResponseDto {
  categoryId!: string;
  categoryName!: string;
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
