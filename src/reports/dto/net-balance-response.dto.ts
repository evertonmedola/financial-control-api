import { ApiProperty } from '@nestjs/swagger';

// Computed, non-entity response DTO — mirrors BudgetStatusDto's static
// `build()` factory pattern (06-PATTERNS.md). No `fromEntity()`: there is no
// backing entity, `balance` is a value computed by ReportsService.
export class NetBalanceResponseDto {
  @ApiProperty({
    type: String,
    description:
      'Net balance: the plain sum of all account balances (decimal string, never a JSON number). Credit-card debt is already a negative balance, so it is added like any other balance.',
    example: '4520.75',
  })
  balance!: string;

  static build(balance: string): NetBalanceResponseDto {
    const dto = new NetBalanceResponseDto();
    dto.balance = balance;
    return dto;
  }
}
