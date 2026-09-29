import { ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateIf } from 'class-validator';

/**
 * PATCH /budgets/:id — `limit` only. D-02: unlike Accounts' `balance`,
 * Categories' `type`, and Transactions' `amount` (all locked post-creation),
 * a budget's `limit` IS deliberately editable — see 05-CONTEXT.md D-02: a
 * budget is a plan/goal, not a consummated financial fact, so editing it
 * doesn't introduce the balance-drift risk that motivated those earlier
 * lock-downs. No `categoryId` field — a budget's category is locked after
 * creation; global forbidNonWhitelisted:true (APP_PIPE in AppModule)
 * rejects any request body containing it with 400 automatically — no
 * manual guard code is needed here.
 */
export class UpdateBudgetDto {
  // CR-02: @IsOptional() alone lets `{"limit": null}` through untouched —
  // class-validator's IsOptional short-circuits ALL subsequent validators
  // (including @Matches) whenever the value is `null` OR `undefined`, and
  // class-validator ANDs every CONDITIONAL_VALIDATION metadata on a
  // property together — so pairing @IsOptional() with an additional
  // @ValidateIf() would NOT help, since IsOptional's own null-check would
  // still short-circuit the AND to `false` for a null value. Instead,
  // @ValidateIf() replaces @IsOptional() entirely: it only skips validation
  // when `limit` is absent (`undefined`), leaving `null` to reach @Matches,
  // whose underlying `matches()` requires `typeof value === 'string'` and
  // therefore correctly fails (400) instead of reaching the NOT NULL
  // `limit` column and crashing with an unhandled 500.
  @ApiPropertyOptional({
    type: String,
    description:
      'New monthly spending limit as a positive decimal string (no sign, not zero, max 2 decimals).',
    pattern: '^(?!0+(\\.0{1,2})?$)\\d{1,10}(\\.\\d{1,2})?$',
    example: '950.00',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  limit?: string;
}
