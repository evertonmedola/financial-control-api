import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

export class CreateBudgetDto {
  @ApiProperty({
    description: 'Id of the expense (despesa) category the budget applies to.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  @IsUUID()
  categoryId!: string;

  // Same regex as CreateTransactionDto.amount (05-PATTERNS.md's explicit
  // instruction to match it exactly) — no sign, no all-zero value, max 2
  // decimals, integer part capped at 10 digits (matches numeric(12,2)'s
  // maximum representable value).
  @ApiProperty({
    type: String,
    description:
      'Monthly spending limit as a positive decimal string (no sign, not zero, max 2 decimals), never a JSON number.',
    pattern: '^(?!0+(\\.0{1,2})?$)\\d{1,10}(\\.\\d{1,2})?$',
    example: '800.00',
  })
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  limit!: string;
}
