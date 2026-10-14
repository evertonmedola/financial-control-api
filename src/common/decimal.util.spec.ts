import {
  addDecimalStrings,
  isGreaterThanDecimalString,
  isWithinDecimalRange,
  negateDecimalString,
  NUMERIC_12_2_MAX_ABS,
  subtractDecimalStrings,
} from './decimal.util';

describe('decimal.util', () => {
  describe('addDecimalStrings', () => {
    it('adds two positive decimal strings exactly', () => {
      expect(addDecimalStrings('1000.00', '100.50')).toBe('1100.50');
    });

    it('subtracts via a negative delta — the exact shape adjustBalance uses for expenses', () => {
      expect(addDecimalStrings('100.00', '-30.00')).toBe('70.00');
    });

    it('handles differing decimal lengths correctly', () => {
      expect(addDecimalStrings('10', '0.05')).toBe('10.05');
    });

    // Pitfall 1: proves no float drift accumulates over many additions —
    // 1000 sequential additions of "0.10" must sum to exactly "100.00"
    // (TXN-05).
    it('accumulates 1000 sequential additions of 0.10 to exactly 100.00 (precision stress test)', () => {
      let total = '0.00';
      for (let i = 0; i < 1000; i++) {
        total = addDecimalStrings(total, '0.10');
      }
      expect(total).toBe('100.00');
    });
  });

  describe('negateDecimalString', () => {
    it('negates a positive decimal string', () => {
      expect(negateDecimalString('50.00')).toBe('-50.00');
    });

    it('negates a negative decimal string back to positive', () => {
      expect(negateDecimalString('-50.00')).toBe('50.00');
    });

    it('never emits "-0.00" for a zero value', () => {
      expect(negateDecimalString('0.00')).toBe('0.00');
    });
  });

  describe('subtractDecimalStrings', () => {
    it('subtracts two positive decimal strings exactly', () => {
      expect(subtractDecimalStrings('300.00', '50.00')).toBe('250.00');
    });

    // Budgets D-08: remaining is never clamped to zero — an over-budget
    // category yields a negative decimal string.
    it('yields a negative, un-clamped result when b > a', () => {
      expect(subtractDecimalStrings('100.00', '150.00')).toBe('-50.00');
    });
  });

  describe('isGreaterThanDecimalString', () => {
    it('returns true when a > b', () => {
      expect(isGreaterThanDecimalString('150.00', '100.00')).toBe(true);
    });

    it('returns false when a < b', () => {
      expect(isGreaterThanDecimalString('50.00', '100.00')).toBe(false);
    });

    // Budgets D-08: exactly-at-limit is not over-budget.
    it('returns false when a === b (exactly-at-limit is not over-budget)', () => {
      expect(isGreaterThanDecimalString('100.00', '100.00')).toBe(false);
    });
  });

  describe('isWithinDecimalRange', () => {
    it('exposes the numeric(12,2) maximum absolute value', () => {
      expect(NUMERIC_12_2_MAX_ABS).toBe('9999999999.99');
    });

    it.each([
      '0.00',
      '0',
      '-0.00',
      '9999999999.99',
      '-9999999999.99',
      '1500.50',
    ])(
      'returns true for %s (inside the range, boundaries inclusive)',
      (value) => {
        expect(isWithinDecimalRange(value, NUMERIC_12_2_MAX_ABS)).toBe(true);
      },
    );

    it.each([
      '10000000000.00',
      '-10000000000.00',
      '10000000000.01',
      '-10000000000.01',
    ])('returns false for %s (one cent or more past the boundary)', (value) => {
      expect(isWithinDecimalRange(value, NUMERIC_12_2_MAX_ABS)).toBe(false);
    });
  });
});
