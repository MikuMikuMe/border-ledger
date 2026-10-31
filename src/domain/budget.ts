export interface CategoryBalanceInput {
  openingMinor: number;
  assignedMinor: number;
  spendingMinor: number;
}

function requireMinorUnits(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Amount must be safe integer minor units');
  return value;
}

export function calculateCategoryBalance(input: CategoryBalanceInput): number {
  const opening = requireMinorUnits(input.openingMinor);
  const assigned = requireMinorUnits(input.assignedMinor);
  const spending = requireMinorUnits(input.spendingMinor);
  return requireMinorUnits(requireMinorUnits(opening + assigned) - spending);
}

export function suggestFunding(targetMinor: number, availableMinor: number): number {
  const target = requireMinorUnits(targetMinor);
  const available = requireMinorUnits(availableMinor);
  if (target < 0) throw new RangeError('Target must not be negative');
  return Math.max(0, requireMinorUnits(target - available));
}
