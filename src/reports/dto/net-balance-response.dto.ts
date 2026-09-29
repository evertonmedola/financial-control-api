import { ApiProperty } from '@nestjs/swagger';

// Computed, non-entity response DTO — mirrors BudgetStatusDto's static
// `build()` factory pattern (06-PATTERNS.md). No `fromEntity()`: there is no
// backing entity, `balance` is a value computed by ReportsService.
export class NetBalanceResponseDto {
  @ApiProperty({
    type: String,
    description:
      'Net balance: assets minus credit-card debt (decimal string, never a JSON number).',
    example: '4520.75',
  })
  balance!: string;

  static build(balance: string): NetBalanceResponseDto {
    const dto = new NetBalanceResponseDto();
    dto.balance = balance;
    return dto;
  }
}
