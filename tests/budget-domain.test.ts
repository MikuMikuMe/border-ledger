import { describe, expect, it } from 'vitest';
import { calculateCategoryBalance, suggestFunding } from '../src/domain/budget';

describe('budget calculations', () => {
  it('carries funded balances forward and includes overspending', () => {
    expect(calculateCategoryBalance({ openingMinor: 2500, assignedMinor: 10000, spendingMinor: 14000 })).toBe(-1500);
    expect(calculateCategoryBalance({ openingMinor: -1500, assignedMinor: 5000, spendingMinor: 1000 })).toBe(2500);
  });
  it('suggests funding only for the unmet target', () => {
    expect(suggestFunding(10000, 3500)).toBe(6500);
    expect(suggestFunding(10000, 12000)).toBe(0);
    expect(suggestFunding(10000, -1000)).toBe(11000);
  });
  it('rejects amounts outside safe integer minor units', () => {
    expect(() => calculateCategoryBalance({ openingMinor: 0, assignedMinor: 1.5, spendingMinor: 0 })).toThrow();
    expect(() => suggestFunding(Number.MAX_SAFE_INTEGER, -1)).toThrow();
  });
});
