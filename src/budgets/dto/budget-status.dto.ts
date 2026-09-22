import {
  isGreaterThanDecimalString,
  subtractDecimalStrings,
} from '../../common/decimal.util';

/**
 * D-08: the computed consumed/remaining shape returned by `GET /budgets`.
 * There is no entity to construct a `fromEntity` from — this is a computed
 * aggregate, not a persisted row (05-PATTERNS.md's "No Analog Found" note).
 * `remaining` is deliberately NEVER clamped — it can go negative when over
 * budget. `overBudget` is a redundant-but-explicit boolean, satisfying
 * BUD-03's "must not silently return just a negative number" requirement.
 */
export class BudgetStatusDto {
  categoryId!: string;
  limit!: string;
  spent!: string;
  remaining!: string;
  overBudget!: boolean;

  static build(
    categoryId: string,
    limit: string,
    spent: string,
  ): BudgetStatusDto {
    const dto = new BudgetStatusDto();
    dto.categoryId = categoryId;
    dto.limit = limit;
    dto.spent = spent;
    dto.remaining = subtractDecimalStrings(limit, spent);
    dto.overBudget = isGreaterThanDecimalString(spent, limit);
    return dto;
  }
}
