import { addDecimalStrings, negateDecimalString } from './decimal.util';

describe('decimal.util', () => {
  describe('addDecimalStrings', () => {
    it('adds two positive decimal strings exactly', () => {
      expect(addDecimalStrings('1000.00', '100.50')).toBe('1100.50');
    });

    it('subtracts via a negative delta — the exact shape adjustBalance uses for expenses', () => {
      expect(addDecimalStrings('100.00', '-30.00')).toBe('70.00');
    });
  });

  describe('negateDecimalString', () => {
    it('negates a positive decimal string', () => {
      expect(negateDecimalString('50.00')).toBe('-50.00');
    });

    it('negates a negative decimal string back to positive', () => {
      expect(negateDecimalString('-50.00')).toBe('50.00');
    });
  });
});
