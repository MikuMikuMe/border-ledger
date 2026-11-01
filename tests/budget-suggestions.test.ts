import { describe, expect, it } from 'vitest';
import { averageMonthlySpending, suggestFundingFromHistory } from '../src/domain/budget-suggestions';

describe('history-based funding suggestions', () => {
  it('averages historical spending including zero months, rounding up to minor units', () => {
    expect(averageMonthlySpending([1000, 0, 1001])).toBe(667);
    expect(suggestFundingFromHistory([1000, 0, 1001], 250)).toBe(417);
  });
  it('returns no suggestion when history is unavailable', () => {
    expect(averageMonthlySpending([])).toBeNull();
    expect(suggestFundingFromHistory([], 250)).toBeNull();
  });
  it('rejects invalid or excessive input without overflowing', () => {
    expect(() => averageMonthlySpending([-1])).toThrow();
    expect(() => averageMonthlySpending([1.5])).toThrow();
    expect(averageMonthlySpending([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => suggestFundingFromHistory([Number.MAX_SAFE_INTEGER], -1)).toThrow();
  });
});
