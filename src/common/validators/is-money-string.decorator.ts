import { Matches } from 'class-validator';

/**
 * Maximum number of integer digits accepted for a monetary input. Every
 * money column (accounts.balance, transactions.amount, budgets.limit) is
 * `numeric(12,2)`: 12 total digits, 2 after the decimal point, so the
 * representable range is +/-9999999999.99 (10 integer digits). Capping the
 * input here rejects an out-of-range value with a 400 instead of letting it
 * reach Postgres as a `numeric field overflow`.
 */
export const MONEY_MAX_INTEGER_DIGITS = 10;

/**
 * Positive amount: no sign, not all-zero ('0', '0.0', '0.00' are rejected by
 * the negative lookahead), at most 2 decimals, at most
 * MONEY_MAX_INTEGER_DIGITS integer digits.
 */
export const POSITIVE_MONEY_REGEX = new RegExp(
  `^(?!0+(\\.0{1,2})?$)\\d{1,${MONEY_MAX_INTEGER_DIGITS}}(\\.\\d{1,2})?$`,
);

/**
 * Signed amount: optional leading minus, zero allowed, at most 2 decimals,
 * at most MONEY_MAX_INTEGER_DIGITS integer digits.
 */
export const SIGNED_MONEY_REGEX = new RegExp(
  `^-?\\d{1,${MONEY_MAX_INTEGER_DIGITS}}(\\.\\d{1,2})?$`,
);

export type MoneyKind = 'positive' | 'signed';

/**
 * Validates that a DTO field is a decimal string that fits a numeric(12,2)
 * column. Thin wrapper over class-validator's `Matches`, so null/undefined
 * and non-string values fail exactly as they do with a bare `@Matches`
 * (UpdateBudgetDto relies on that for `{"limit": null}` combined with
 * `@ValidateIf`).
 *
 * - 'positive': no sign, not zero (transaction/transfer amount, budget limit).
 * - 'signed': optional leading minus, zero allowed (account balance).
 */
export function IsMoneyString(
  kind: MoneyKind,
  message: string,
): PropertyDecorator {
  const regex = kind === 'positive' ? POSITIVE_MONEY_REGEX : SIGNED_MONEY_REGEX;
  return Matches(regex, { message });
}
