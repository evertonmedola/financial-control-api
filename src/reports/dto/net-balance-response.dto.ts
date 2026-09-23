// Computed, non-entity response DTO — mirrors BudgetStatusDto's static
// `build()` factory pattern (06-PATTERNS.md). No `fromEntity()`: there is no
// backing entity, `balance` is a value computed by ReportsService.
export class NetBalanceResponseDto {
  balance!: string;

  static build(balance: string): NetBalanceResponseDto {
    const dto = new NetBalanceResponseDto();
    dto.balance = balance;
    return dto;
  }
}
