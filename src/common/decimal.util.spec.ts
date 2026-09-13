import { addDecimalStrings, negateDecimalString } from './decimal.util';

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
});
