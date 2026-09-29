import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'Id of the expense category the budget applies to.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  categoryId!: string;

  @ApiProperty({
    type: String,
    description:
      'Monthly spending limit (decimal string, never a JSON number).',
    example: '800.00',
  })
  limit!: string;

  @ApiProperty({
    type: String,
    description:
      'Amount spent in the category during the current calendar month (decimal string).',
    example: '650.25',
  })
  spent!: string;

  @ApiProperty({
    type: String,
    description:
      'Limit minus spent (decimal string). Never clamped: negative when over budget.',
    example: '149.75',
  })
  remaining!: string;

  @ApiProperty({
    type: Boolean,
    description: 'True when the spent amount exceeds the limit.',
    example: false,
  })
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
