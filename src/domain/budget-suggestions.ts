import { suggestFunding } from './budget';

export function averageMonthlySpending(history: readonly number[]): number | null {
  if (history.length === 0) return null;
  let total = 0n;
  for (const amount of history) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Invalid historical spending');
    total += BigInt(amount);
  }
  const count = BigInt(history.length);
  return Number((total + count - 1n) / count);
}

export function suggestFundingFromHistory(history: readonly number[], availableMinor: number): number | null {
  const average = averageMonthlySpending(history);
  return average === null ? null : suggestFunding(average, availableMinor);
}
