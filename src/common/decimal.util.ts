// Pitfall 1: money is always a decimal string, never a JS `number`/float.
// These two functions are the only exact-decimal arithmetic this codebase
// needs (adding two decimal strings, negating one) — implemented via BigInt
// cents so there is zero risk of float drift over many additions. No
// `parseFloat`, unary `+`, or `Number()` anywhere in this file, and no
// external dependency (decimal.js/big.js) is installed to provide this —
// deliberately avoids triggering the Package Legitimacy Gate for two-decimal
// currency math this simple.

/**
 * Converts a decimal string (e.g. "1234.56", "-10", "0.1") into an exact
 * integer count of cents, preserving sign.
 */
function toCents(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const cents = fracPart.padEnd(2, '0').slice(0, 2);
  const total = BigInt(intPart || '0') * 100n + BigInt(cents || '0');
  return negative ? -total : total;
}

/**
 * Converts an integer count of cents back into a decimal string. Never
 * emits "-0.00" — a zero result is always rendered as an unsigned "0.00".
 */
function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const intPart = abs / 100n;
  const fracPart = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${intPart.toString()}.${fracPart}`;
}

/**
 * Adds two decimal strings exactly (no float drift), returning a decimal
 * string. This is the shape `AccountsService.adjustBalance` uses for both
 * income (positive delta) and expense (negative delta) mutations.
 */
export function addDecimalStrings(a: string, b: string): string {
  return fromCents(toCents(a) + toCents(b));
}

/**
 * Returns the exact negation of a decimal string, e.g. "50.00" -> "-50.00"
 * and "-50.00" -> "50.00". "0.00" negates to "0.00", never "-0.00".
 */
export function negateDecimalString(value: string): string {
  return fromCents(-toCents(value));
}

/**
 * Returns true when `value` is within `[-maxAbsolute, maxAbsolute]`
 * (inclusive), compared exactly via BigInt cents — no float drift. Intended
 * for validating a computed balance against a `numeric(p,s)` column's
 * representable range BEFORE persisting it, so an overflow surfaces as a
 * controlled 400 instead of an unhandled Postgres `numeric field overflow`
 * error (WR-03).
 */
export function isWithinDecimalRange(
  value: string,
  maxAbsolute: string,
): boolean {
  const cents = toCents(value);
  const maxCents = toCents(maxAbsolute);
  return cents <= maxCents && cents >= -maxCents;
}
