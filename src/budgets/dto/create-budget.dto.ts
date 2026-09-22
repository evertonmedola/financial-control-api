import { IsUUID, Matches } from 'class-validator';

export class CreateBudgetDto {
  @IsUUID()
  categoryId!: string;

  // Same regex as CreateTransactionDto.amount (05-PATTERNS.md's explicit
  // instruction to match it exactly) — no sign, no all-zero value, max 2
  // decimals, integer part capped at 10 digits (matches numeric(12,2)'s
  // maximum representable value).
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  limit!: string;
}
