import type { Currency } from './types';
import type { CurrencyCode } from './currencies';
import { emptyCurrencyTotals, getCurrencyMeta, type CurrencyRegistry } from './currencies';

export type RecurringFrequency = 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUALLY' | 'UNKNOWN';
export type RecurringClassification = 'unclassified' | 'subscription' | 'bill' | 'other' | 'excluded';
export type RecurringSourceStatus = 'MATURE' | 'EARLY_DETECTION' | 'INACTIVE' | 'TOMBSTONED' | string;

export interface RecurringMembership<Code extends CurrencyCode = Currency> {
  providerTransactionId: string;
  pendingProviderTransactionId: string | null;
  date: string;
  amountMinor: number;
  currency: Code;
  status?: 'posted' | 'pending';
  kind?: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
}

export interface RecurringStream<Code extends CurrencyCode = Currency> {
  id: string;
  itemId: string;
  streamId: string;
  accountId: string;
  merchantName: string | null;
  merchantEntityId: string | null;
  currency: Code;
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
  memberships: RecurringMembership<Code>[];
  sourceUpdatedAt: string | null;
  classification?: RecurringClassification;
  /** Local owner classification revision; provider refreshes never overwrite it. */
  revision?: number;
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

export interface RecurringEstimateSummary<Code extends CurrencyCode = Currency> {
  monthlyByCurrency: Record<Code | Currency, number>;
  yearlyByCurrency: Record<Code | Currency, number>;
  subscriptionByCurrency: Record<Code | Currency, number>;
  upcoming: Array<RecurringStream<Code> & { nextExpectedAmountMinor: number | null }>;
  latestPaymentChanges: RecurringStream<Code>[];
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

function activeOutflow<Code extends CurrencyCode>(stream: RecurringStream<Code>) {
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

export function analyzeRecurring<Code extends CurrencyCode>(streams: readonly RecurringStream<Code>[], today: string, registry?: CurrencyRegistry): RecurringEstimateSummary<Code> {
  const monthlyByCurrency = emptyCurrencyTotals(registry) as Record<Code | Currency, number>;
  const yearlyByCurrency = emptyCurrencyTotals(registry) as Record<Code | Currency, number>;
  const subscriptionByCurrency = emptyCurrencyTotals(registry) as Record<Code | Currency, number>;
  const upcoming: Array<RecurringStream<Code> & { nextExpectedAmountMinor: number | null }> = [];
  const latestPaymentChanges: RecurringStream<Code>[] = [];
  const lastUpcomingDay = shiftDay(today, 29);

  for (const stream of streams) {
    if (!getCurrencyMeta(stream.currency, registry)) continue;
    if (!activeOutflow(stream)) continue;
    const monthly = stream.averageAmountMinor === null ? null : equivalentMinor(stream.averageAmountMinor, stream.frequency, 'month');
    const yearly = stream.averageAmountMinor === null ? null : equivalentMinor(stream.averageAmountMinor, stream.frequency, 'year');
    if (monthly !== null) monthlyByCurrency[stream.currency] = (monthlyByCurrency[stream.currency] ?? 0) + monthly;
    if (yearly !== null) yearlyByCurrency[stream.currency] = (yearlyByCurrency[stream.currency] ?? 0) + yearly;
    if (stream.classification === 'subscription' && monthly !== null) subscriptionByCurrency[stream.currency] = (subscriptionByCurrency[stream.currency] ?? 0) + monthly;

    if (stream.predictedNextDate && stream.predictedNextDate >= today && stream.predictedNextDate <= lastUpcomingDay) {
      upcoming.push({ ...stream, nextExpectedAmountMinor: stream.lastAmountMinor ?? stream.predictedAmountMinor ?? stream.averageAmountMinor });
    }

    const resolved = new Map<string, RecurringMembership<Code>>();
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
