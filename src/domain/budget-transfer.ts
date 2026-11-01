import { calculateCategoryBalance } from './budget';

interface TransferInput { fromMinor: number; toMinor: number; amountMinor: number }
interface TransferResult { fromMinor: number; toMinor: number }

export function allocateTransfer(input: TransferInput): TransferResult {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new RangeError('Transfer amount must be positive integer minor units');
  return {
    fromMinor: calculateCategoryBalance({openingMinor:input.fromMinor, assignedMinor:0, spendingMinor:input.amountMinor}),
    toMinor: calculateCategoryBalance({openingMinor:input.toMinor, assignedMinor:input.amountMinor, spendingMinor:0}),
  };
}
