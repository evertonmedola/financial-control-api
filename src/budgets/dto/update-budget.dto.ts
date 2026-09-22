import { IsOptional, Matches } from 'class-validator';

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
  @IsOptional()
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  limit?: string;
}
