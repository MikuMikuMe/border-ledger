import { calculateCategoryBalance } from './budget';

export interface BudgetMonthInput {
  month: string;
  assignedMinor: number;
  activityMinor: number;
  missingTransactionIds: string[];
}
export interface BudgetMonthProjection {
  month: string;
  openingMinor: number | null;
  availableMinor: number | null;
  missingTransactionIds: string[];
}

function monthIndex(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Invalid budget month');
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
}

function validateAmounts(input: BudgetMonthInput): void {
  if (!Number.isSafeInteger(input.assignedMinor) || !Number.isSafeInteger(input.activityMinor)) throw new RangeError('Amount must be safe integer minor units');
}

function availableBalance(input: BudgetMonthInput, openingMinor: number | null): number | null {
  if (openingMinor === null || input.missingTransactionIds.length > 0) return null;
  return calculateCategoryBalance({openingMinor, assignedMinor:input.assignedMinor, spendingMinor:-input.activityMinor});
}

export function projectCategoryMonths(months: readonly BudgetMonthInput[]): BudgetMonthProjection[] {
  let priorIndex: number | undefined;
  let openingMinor: number | null = 0;
  return months.map(input => {
    const index = monthIndex(input.month);
    if (priorIndex !== undefined && index !== priorIndex + 1) throw new RangeError('Budget months must be consecutive');
    priorIndex = index;
    validateAmounts(input);
    const availableMinor = availableBalance(input, openingMinor);
    const result = {month:input.month, openingMinor, availableMinor, missingTransactionIds:[...input.missingTransactionIds]};
    openingMinor = availableMinor;
    return result;
  });
}
