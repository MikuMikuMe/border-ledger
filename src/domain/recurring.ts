import type { Currency } from './types';

export type RecurringFrequency = 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUALLY' | 'UNKNOWN';
export type RecurringClassification = 'unclassified' | 'subscription' | 'bill' | 'other' | 'excluded';
export type RecurringSourceStatus = 'MATURE' | 'EARLY_DETECTION' | 'INACTIVE' | 'TOMBSTONED' | string;

export interface RecurringMembership {
  providerTransactionId: string;
  pendingProviderTransactionId: string | null;
  date: string;
  amountMinor: number;
  currency: Currency;
  status?: 'posted' | 'pending';
  kind?: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
}

export interface RecurringStream {
  id: string;
  itemId: string;
  streamId: string;
  accountId: string;
  merchantName: string | null;
  merchantEntityId: string | null;
  currency: Currency;
  sourceStatus: RecurringSourceStatus;
  sourceFrequency: string;
  frequency: RecurringFrequency;
  isOutflow: boolean;
  firstDate: string | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  averageAmountMinor: number | null;
  lastAmountMinor: number | null;
  predictedAmountMinor: number | null;
  memberships: RecurringMembership[];
  sourceUpdatedAt: string | null;
  classification?: RecurringClassification;
}

export interface RecurringQuery {
  cursor?: string;
  limit?: number;
  today?: string;
  accountId?: string;
  currency?: Currency;
  classification?: RecurringClassification;
}

export interface RecurringSummaryQuery {
  startDate: string;
  endDate: string;
  today: string;
  accountId?: string;
  currency?: Currency;
  classification?: RecurringClassification;
}

export interface RecurringPage {
  streams: RecurringStream[];
  nextCursor: string | null;
  state: 'ready' | 'waiting' | 'empty' | 'stale' | 'error' | 'unavailable' | 'incomplete';
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  lastError: string | null;
  coverageWarnings: string[];
}

export interface RecurringDetailPage {
  stream: RecurringStream;
  history: RecurringMembership[];
  nextCursor: string | null;
  classification: RecurringClassification;
}

export interface RecurringEstimateSummary {
  monthlyByCurrency: Record<Currency, number>;
  yearlyByCurrency: Record<Currency, number>;
  subscriptionByCurrency: Record<Currency, number>;
  upcoming: Array<RecurringStream & { nextExpectedAmountMinor: number | null }>;
  latestPaymentChanges: RecurringStream[];
}

export interface RecurringSummary extends RecurringEstimateSummary {
  actualCostByCurrency: Record<Currency, number>;
  streamCount: number;
  coverageWarnings: string[];
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  lastError: string | null;
  state: RecurringPage['state'];
}

function shiftDay(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function activeOutflow(stream: RecurringStream) {
  if (!stream.isOutflow || stream.sourceStatus === 'EARLY_DETECTION' || stream.sourceStatus === 'INACTIVE' || stream.sourceStatus === 'TOMBSTONED' || stream.classification === 'excluded') return false;
  return stream.memberships.some((membership) => membership.status !== 'pending' && membership.currency === stream.currency && (membership.kind === 'expense' || membership.kind === 'fee'));
}

export function equivalentMinor(amountMinor: number, frequency: RecurringFrequency, period: 'month' | 'year'): number | null {
  const yearlyMultiplier: Record<RecurringFrequency, number | null> = {
    WEEKLY: 52,
    BIWEEKLY: 26,
    SEMI_MONTHLY: 24,
    MONTHLY: 12,
    ANNUALLY: 1,
    UNKNOWN: null,
  };
  const yearly = yearlyMultiplier[frequency];
  if (yearly === null || !Number.isSafeInteger(amountMinor)) return null;
  return Math.round(amountMinor * (period === 'year' ? yearly : yearly / 12));
}

export function analyzeRecurring(streams: readonly RecurringStream[], today: string): RecurringEstimateSummary {
  const monthlyByCurrency = { CAD: 0, CNY: 0 };
  const yearlyByCurrency = { CAD: 0, CNY: 0 };
  const subscriptionByCurrency = { CAD: 0, CNY: 0 };
  const upcoming: Array<RecurringStream & { nextExpectedAmountMinor: number | null }> = [];
  const latestPaymentChanges: RecurringStream[] = [];
  const lastUpcomingDay = shiftDay(today, 29);

  for (const stream of streams) {
    if (!activeOutflow(stream)) continue;
    const monthly = stream.averageAmountMinor === null ? null : equivalentMinor(stream.averageAmountMinor, stream.frequency, 'month');
    const yearly = stream.averageAmountMinor === null ? null : equivalentMinor(stream.averageAmountMinor, stream.frequency, 'year');
    if (monthly !== null) monthlyByCurrency[stream.currency] += monthly;
    if (yearly !== null) yearlyByCurrency[stream.currency] += yearly;
    if (stream.classification === 'subscription' && monthly !== null) subscriptionByCurrency[stream.currency] += monthly;

    if (stream.predictedNextDate && stream.predictedNextDate >= today && stream.predictedNextDate <= lastUpcomingDay) {
      upcoming.push({ ...stream, nextExpectedAmountMinor: stream.lastAmountMinor ?? stream.predictedAmountMinor ?? stream.averageAmountMinor });
    }

    const resolved = new Map<string, RecurringMembership>();
    for (const membership of stream.memberships) {
      if (membership.status === 'pending') continue;
      const kind = membership.kind ?? 'expense';
      if (kind !== 'expense' && kind !== 'fee') continue;
      if (membership.currency !== stream.currency || resolved.has(membership.providerTransactionId)) continue;
      resolved.set(membership.providerTransactionId, membership);
    }
    const payments = [...resolved.values()].sort((left, right) => left.date.localeCompare(right.date));
    if (payments.length >= 2 && payments[payments.length - 1].amountMinor !== payments[payments.length - 2].amountMinor) latestPaymentChanges.push(stream);
  }

  return { monthlyByCurrency, yearlyByCurrency, subscriptionByCurrency, upcoming, latestPaymentChanges };
}
