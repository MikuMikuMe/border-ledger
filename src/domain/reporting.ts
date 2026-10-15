import type { ReportWindow, Transaction } from './types';

export type ReportingTimezone = 'America/Toronto' | 'Asia/Shanghai';
export type WeekStartsOn = 'monday' | 'sunday';

function datePartsInTimezone(now: Date, timezone: ReportingTimezone) {
  if (Number.isNaN(now.valueOf())) throw new Error('A valid reporting date is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekDay(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

export function formatReportingDay(date: string, timezone: ReportingTimezone = 'America/Toronto') {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function getReportWindows(
  now: Date,
  timezone: ReportingTimezone = 'America/Toronto',
  weekStartsOn: WeekStartsOn = 'monday',
): ReportWindow[] {
  const today = datePartsInTimezone(now, timezone);
  const startDay = weekStartsOn === 'sunday' ? 0 : 1;
  const daysSinceStart = (weekDay(today) - startDay + 7) % 7;
  const weekStart = shiftDate(today, -daysSinceStart);
  const monthStart = `${today.slice(0, 7)}-01`;

  return [
    { key: 'today', label: 'Today', start: today, end: today },
    { key: 'week', label: 'This week', start: weekStart, end: today },
    { key: 'month', label: 'This month', start: monthStart, end: today },
  ];
}

export interface ReportTransaction extends Pick<Transaction, 'date' | 'amountMinor' | 'currency' | 'kind' | 'status' | 'source'> {}

export interface ReportCurrencyTotal {
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
  confirmedCount: number;
  provisionalCount: number;
}

export interface ReportDailyTotal {
  date: string;
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
}

export interface ReportAggregate {
  from: string | null;
  to: string | null;
  includeProvisional: boolean;
  currencyTotals: ReportCurrencyTotal[];
  dailyTotals: ReportDailyTotal[];
  excludedCount: number;
  reviewCount: number;
  sourceCoverage: Record<string, number>;
}

export interface ReportAggregateOptions {
  from?: string | null;
  to?: string | null;
  currency?: string | null;
  includeProvisional?: boolean;
}

const reportSpendingKinds = new Set(['expense', 'refund', 'fee']);

function validCalendarDate(value: string | null | undefined) {
  if (value == null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function signedSpendingMinorUnits(transaction: ReportTransaction) {
  const amount = Math.abs(transaction.amountMinor);
  return transaction.kind === 'refund' ? -amount : amount;
}

/**
 * Aggregate the entire selected source window. This function intentionally
 * receives rows rather than a paginated UI page; Worker callers can use it
 * after a bounded full-window query or an equivalent SQL aggregate.
 */
export function aggregateReportTransactions(
  transactions: readonly ReportTransaction[],
  options: ReportAggregateOptions = {},
): ReportAggregate {
  const from = options.from ?? null;
  const to = options.to ?? null;
  if (!validCalendarDate(from) || !validCalendarDate(to) || (from && to && from > to)) throw new Error('The report date range is not valid.');
  if (options.currency === '') throw new Error('The report currency is not valid.');

  const currency = options.currency ?? null;
  const includeProvisional = options.includeProvisional === true;
  const selected = transactions.filter((transaction) => {
    if (from && transaction.date < from) return false;
    if (to && transaction.date > to) return false;
    if (currency && transaction.currency !== currency) return false;
    return true;
  });
  const totals = new Map<string, ReportCurrencyTotal>();
  const daily = new Map<string, ReportDailyTotal>();
  const sourceCoverage: Record<string, number> = {};
  let excludedCount = 0;
  let reviewCount = 0;

  for (const transaction of selected) {
    sourceCoverage[transaction.source] = (sourceCoverage[transaction.source] ?? 0) + 1;
    if (transaction.status === 'needs_review') {
      reviewCount += 1;
      continue;
    }
    if (!reportSpendingKinds.has(transaction.kind)) {
      excludedCount += 1;
      continue;
    }
    const isProvisional = transaction.status === 'provisional';
    if (isProvisional && !includeProvisional) continue;
    if (transaction.status !== 'confirmed' && !isProvisional) {
      excludedCount += 1;
      continue;
    }
    const amount = signedSpendingMinorUnits(transaction);
    const total = totals.get(transaction.currency) ?? {
      currency: transaction.currency,
      confirmedMinorUnits: 0,
      provisionalMinorUnits: 0,
      confirmedCount: 0,
      provisionalCount: 0,
    };
    const day = daily.get(`${transaction.date}:${transaction.currency}`) ?? {
      date: transaction.date,
      currency: transaction.currency,
      confirmedMinorUnits: 0,
      provisionalMinorUnits: 0,
    };
    if (isProvisional) {
      total.provisionalMinorUnits += amount;
      total.provisionalCount += 1;
      day.provisionalMinorUnits += amount;
    } else {
      total.confirmedMinorUnits += amount;
      total.confirmedCount += 1;
      day.confirmedMinorUnits += amount;
    }
    totals.set(transaction.currency, total);
    daily.set(`${transaction.date}:${transaction.currency}`, day);
  }

  return {
    from,
    to,
    includeProvisional,
    currencyTotals: [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
    dailyTotals: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date) || left.currency.localeCompare(right.currency)),
    excludedCount,
    reviewCount,
    sourceCoverage,
  };
}
