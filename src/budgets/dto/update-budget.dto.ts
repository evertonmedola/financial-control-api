import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import {
  IsMoneyString,
  POSITIVE_MONEY_REGEX,
} from '../../common/validators/is-money-string.decorator';

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
  // `limit` column and crashing with an unhandled 500. IsMoneyString is a
  // thin wrapper over @Matches, so that null handling is unchanged.
  @ApiPropertyOptional({
    type: String,
    description:
      'New monthly spending limit as a positive decimal string (no sign, not zero, max 2 decimals, max 10 integer digits).',
    pattern: POSITIVE_MONEY_REGEX.source,
    example: '950.00',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsMoneyString(
    'positive',
    'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  )
  limit?: string;
}
