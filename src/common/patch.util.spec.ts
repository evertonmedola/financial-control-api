import { hasNoUpdatableFields } from './patch.util';

describe('patch.util', () => {
  describe('hasNoUpdatableFields', () => {
    it('returns true for an object whose only key is undefined', () => {
      expect(hasNoUpdatableFields({ limit: undefined })).toBe(true);
    });

    it('returns true for an object with multiple undefined keys', () => {
      expect(
        hasNoUpdatableFields({ description: undefined, date: undefined }),
      ).toBe(true);
    });

    it('returns true for a plain empty object', () => {
      expect(hasNoUpdatableFields({})).toBe(true);
    });

    it('returns false when at least one key has a defined value', () => {
      expect(hasNoUpdatableFields({ limit: '100.00' })).toBe(false);
    });

    it('returns false when one of several keys has a defined value', () => {
      expect(
        hasNoUpdatableFields({ description: undefined, date: '2026-09-13' }),
      ).toBe(false);
    });

    // WR-01: this is the whole point of deriving the guard from the DTO's
    // own keys instead of a hand-enumerated field list — a `null` value
    // (as opposed to `undefined`) must NOT be treated as "no updatable
    // fields", since `null` is a real value class-validator's @ValidateIf
    // routes through to the underlying validators (CR-01).
    it('returns false when a key is explicitly null (not undefined)', () => {
      expect(hasNoUpdatableFields({ date: null })).toBe(false);
    });
  });
});
