import type { LedgerContext } from './tenant-context';
import {
  insertFxSnapshotIfAbsent,
  readFxSnapshot,
  type D1Database,
  type FxRateSnapshotRow,
} from './db-types';
import { getCurrencyMeta } from '../src/domain/currencies';
import {
  convertMinorUnits,
  fetchFrankfurterSnapshot,
  isFxProviderError,
  parseFrankfurterRates,
  type ValidatedFxRates,
} from './fx-rates';

export interface LedgerReportQuery {
  from?: string | null;
  to?: string | null;
  currency?: string | null;
  reportingCurrency?: string | null;
  includeProvisional?: boolean;
  timeZone?: string;
}

export interface LedgerReportDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface LedgerReportCurrencyTotal {
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
  confirmedCount: number;
  provisionalCount: number;
}

export interface LedgerReportDailyTotal {
  date: string;
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
}

export interface LedgerReportConvertedTotals {
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
  confirmedCount: number;
  provisionalCount: number;
}

export interface LedgerReportConvertedDailyTotal {
  date: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
}

export interface LedgerReportChineseBankBand {
  eligible: true;
  currency: string;
  baseMinorUnits: number;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  percentageBasisPoints: 150;
}

export interface LedgerReportFx {
  provider: 'frankfurter';
  complete: boolean;
  unavailableSourceCurrencies: string[];
  lockedDateCount: number;
  observedDateRange: { earliest: string | null; latest: string | null };
  chineseBankBand: LedgerReportChineseBankBand | null;
}

export interface LedgerReport {
  ledgerId: string;
  asOf: string;
  timeBasis: 'accounting_date';
  timeZone: string;
  from: string | null;
  to: string | null;
  includeProvisional: boolean;
  currencyTotals: LedgerReportCurrencyTotal[];
  dailyTotals: LedgerReportDailyTotal[];
  reportingCurrency: string | null;
  convertedTotals: LedgerReportConvertedTotals | null;
  convertedDailyTotals: LedgerReportConvertedDailyTotal[];
  fx: LedgerReportFx;
  reviewCount: number;
  excludedCount: number;
  sourceCoverage: Record<string, number>;
}

interface SummaryRow {
  currency: string;
  confirmed_minor_units: number | null;
  provisional_minor_units: number | null;
  confirmed_count: number;
  provisional_count: number;
}

interface DailyRow {
  date: string;
  currency: string;
  confirmed_minor_units: number | null;
  provisional_minor_units: number | null;
}

interface CountRow {
  count: number;
}

interface SourceRow {
  source: string;
  count: number;
}

interface ConversionRow {
  date: string;
  lock_date: string;
  amount_minor: number;
  currency: string;
  kind: 'expense' | 'refund' | 'fee';
  status: 'confirmed' | 'provisional';
  institution: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIMEZONES = new Set(['America/Toronto', 'Asia/Shanghai', 'UTC']);

/** Keep report reads aligned with the canonical activity query. */
export function notSupersededAlertTransactionPredicate(alias = 't') {
  // A confirmation rebinds alert_projections.transaction_id to the statement
  // transaction. The source record's event_id remains the immutable link to
  // the preserved alert transaction; retain the direct lookup for legacy rows
  // that predate transaction_source_records.
  return `NOT (${alias}.source = 'alert' AND (
    EXISTS (
      SELECT 1
      FROM transaction_source_records alert_source
      JOIN alert_projections superseded_alert
        ON superseded_alert.ledger_id = alert_source.ledger_id
        AND superseded_alert.event_id = alert_source.event_id
      WHERE alert_source.ledger_id = ${alias}.ledger_id
        AND alert_source.source_kind = 'alert'
        AND alert_source.transaction_id = ${alias}.id
        AND superseded_alert.state = 'superseded'
    )
    OR EXISTS (
      SELECT 1 FROM alert_projections superseded_alert
      WHERE superseded_alert.ledger_id = ${alias}.ledger_id AND superseded_alert.transaction_id = ${alias}.id AND superseded_alert.state = 'superseded'
    )
  ))`;
}

function isCalendarDate(value: string) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateQuery(input: LedgerReportQuery) {
  const from = input.from ?? null;
  const to = input.to ?? null;
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)) || (from && to && from > to)) throw new RangeError('The report date range is not valid.');
  const currency = input.currency ?? null;
  if (currency !== null && getCurrencyMeta(currency) === null) throw new RangeError('The report currency is not valid.');
  const reportingCurrency = input.reportingCurrency ?? null;
  if (reportingCurrency !== null && getCurrencyMeta(reportingCurrency) === null) throw new RangeError('The reporting currency is not valid.');
  const timeZone = input.timeZone ?? 'America/Toronto';
  if (!VALID_TIMEZONES.has(timeZone)) throw new RangeError('The report timezone is not supported.');
  return { from, to, currency, reportingCurrency, timeZone, includeProvisional: input.includeProvisional === true };
}

function whereFor(context: LedgerContext, query: ReturnType<typeof validateQuery>) {
  const clauses: string[] = ['t.ledger_id = ?', notSupersededAlertTransactionPredicate('t')];
  const bindings: unknown[] = [context.ledgerId];
  if (query.from) {
    clauses.push('t.date >= ?');
    bindings.push(query.from);
  }
  if (query.to) {
    clauses.push('t.date <= ?');
    bindings.push(query.to);
  }
  if (query.currency) {
    clauses.push('t.currency = ?');
    bindings.push(query.currency);
  }
  return { where: clauses.join(' AND '), bindings };
}

function emptyFx(): LedgerReportFx {
  return {
    provider: 'frankfurter',
    complete: true,
    unavailableSourceCurrencies: [],
    lockedDateCount: 0,
    observedDateRange: { earliest: null, latest: null },
    chineseBankBand: null,
  };
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function computeFxSnapshotDigest(effectiveDate: string, ratesJson: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${effectiveDate}\n${ratesJson}`));
  return hex(digest);
}

export class FxSnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxSnapshotIntegrityError';
  }
}

async function decodeStoredSnapshot(row: FxRateSnapshotRow): Promise<ValidatedFxRates> {
  const expectedDigest = await computeFxSnapshotDigest(row.effective_date, row.rates_json);
  if (row.content_digest.toLowerCase() !== expectedDigest) {
    throw new FxSnapshotIntegrityError(`The FX snapshot for ${row.requested_date} failed integrity validation.`);
  }

  try {
    const payload = JSON.parse(row.rates_json) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('object required');
    const rates = Object.entries(payload as Record<string, unknown>);
    if (rates.length === 0) throw new Error('rates required');
    const validated = parseFrankfurterRates(rates.map(([quote, rate]) => ({
      date: row.effective_date,
      base: 'EUR',
      quote,
      rate,
    })));
    if (validated.effectiveDate !== row.effective_date) throw new Error('effective date mismatch');
    return validated;
  } catch {
    throw new FxSnapshotIntegrityError(`The FX snapshot for ${row.requested_date} is malformed.`);
  }
}

async function loadFxSnapshot(
  db: D1Database,
  requestedDate: string,
  dependencies: LedgerReportDependencies,
): Promise<ValidatedFxRates | null> {
  const existing = await readFxSnapshot(db, requestedDate);
  if (existing) return decodeStoredSnapshot(existing);

  const fetched = await fetchFrankfurterSnapshot(requestedDate, dependencies.fetcher ?? fetch);
  const ratesJson = JSON.stringify(fetched.rates);
  const row: FxRateSnapshotRow = {
    requested_date: requestedDate,
    effective_date: fetched.effectiveDate,
    provider: 'frankfurter',
    rates_json: ratesJson,
    content_digest: await computeFxSnapshotDigest(fetched.effectiveDate, ratesJson),
    fetched_at: (dependencies.now?.() ?? new Date()).toISOString(),
  };
  const inserted = await insertFxSnapshotIfAbsent(db, row);
  if (inserted) return decodeStoredSnapshot(row);
  const winner = await readFxSnapshot(db, requestedDate);
  return winner ? decodeStoredSnapshot(winner) : null;
}

export async function warmFxSnapshot(
  db: D1Database,
  requestedDate: string,
  dependencies: LedgerReportDependencies = {},
) {
  return loadFxSnapshot(db, requestedDate, dependencies);
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

function safeInteger(value: unknown, label: string) {
  let integer: bigint;
  if (typeof value === 'bigint') {
    integer = value;
  } else if (typeof value === 'number' && Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is outside the safe integer range.`);
    integer = BigInt(value);
  } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    integer = BigInt(value);
  } else {
    throw new RangeError(`${label} is not a valid integer.`);
  }
  if (integer > MAX_SAFE_INTEGER_BIGINT || integer < MIN_SAFE_INTEGER_BIGINT) {
    throw new RangeError(`${label} is outside the safe integer range.`);
  }
  return Number(integer);
}

function safeNumberFromBigInt(value: bigint, label: string) {
  if (value > MAX_SAFE_INTEGER_BIGINT || value < MIN_SAFE_INTEGER_BIGINT) {
    throw new RangeError(`${label} is outside the safe integer range.`);
  }
  return Number(value);
}

function signedSpendingAmount(row: ConversionRow) {
  const amount = safeInteger(row.amount_minor, 'Transaction amount');
  return row.kind === 'refund' ? -Math.abs(amount) : Math.abs(amount);
}

function isChineseBank(institution: string) {
  const normalized = institution.normalize('NFKC').toLocaleLowerCase('en-US');
  return normalized.includes('bank of china')
    || normalized.includes('boc')
    || normalized.includes('中国银行')
    || normalized.includes('中國銀行');
}

function roundBasisPoints(value: bigint, basisPoints: number) {
  const numerator = (value < 0n ? -value : value) * BigInt(basisPoints);
  const denominator = 10_000n;
  const rounded = numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n);
  return value < 0n ? -rounded : rounded;
}

async function convertedReport(
  db: D1Database,
  query: ReturnType<typeof validateQuery>,
  where: string,
  bindings: unknown[],
  confirmed: string,
  provisional: string,
  dependencies: LedgerReportDependencies,
): Promise<{
  convertedTotals: LedgerReportConvertedTotals;
  convertedDailyTotals: LedgerReportConvertedDailyTotal[];
  fx: LedgerReportFx;
}> {
  const rows = await db.prepare(`SELECT t.date, COALESCE(t.fx_lock_date, t.date) AS lock_date,
      t.amount_minor, t.currency, t.kind, t.status, COALESCE(a.institution, '') AS institution
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.ledger_id = t.ledger_id
    WHERE ${where} AND (${confirmed} OR ${query.includeProvisional ? provisional : '0'})
    ORDER BY t.date, t.id`).bind(...bindings).all<ConversionRow>();
  const countedRows = rows.results ?? [];
  const lockDates = [...new Set(countedRows.map((row) => row.lock_date))].sort();
  const snapshots = new Map<string, ValidatedFxRates | null>();
  for (const lockDate of lockDates) {
    const needsProviderRate = countedRows.some((row) => row.lock_date === lockDate && row.currency !== query.reportingCurrency);
    if (!needsProviderRate) {
      snapshots.set(lockDate, null);
      continue;
    }
    try {
      snapshots.set(lockDate, await loadFxSnapshot(db, lockDate, dependencies));
    } catch (error) {
      if (!isFxProviderError(error)) throw error;
      snapshots.set(lockDate, null);
    }
  }

  const totals = {
    confirmedMinorUnits: 0n,
    provisionalMinorUnits: 0n,
    confirmedCount: 0n,
    provisionalCount: 0n,
  };
  const daily = new Map<string, { date: string; confirmedMinorUnits: bigint; provisionalMinorUnits: bigint }>();
  const unavailable = new Set<string>();
  let bocEligible = false;
  let bocIncomplete = false;
  let bocBase = 0n;

  for (const row of countedRows) {
    const snapshot = snapshots.get(row.lock_date) ?? null;
    const converted = row.currency === query.reportingCurrency || snapshot
      ? convertMinorUnits({
        amountMinorUnits: signedSpendingAmount(row),
        sourceCurrency: row.currency,
        targetCurrency: query.reportingCurrency!,
        ...(snapshot ? { rates: snapshot } : {}),
      })
      : null;
    const eligibleBoc = row.currency !== 'CNY' && isChineseBank(row.institution);
    if (eligibleBoc) bocEligible = true;
    if (converted === null) {
      unavailable.add(row.currency);
      if (eligibleBoc) bocIncomplete = true;
      continue;
    }

    const convertedBigInt = BigInt(converted);
    const day = daily.get(row.date) ?? { date: row.date, confirmedMinorUnits: 0n, provisionalMinorUnits: 0n };
    if (row.status === 'confirmed') {
      totals.confirmedMinorUnits += convertedBigInt;
      totals.confirmedCount += 1n;
      day.confirmedMinorUnits += convertedBigInt;
    } else {
      totals.provisionalMinorUnits += convertedBigInt;
      totals.provisionalCount += 1n;
      day.provisionalMinorUnits += convertedBigInt;
    }
    daily.set(row.date, day);
    if (eligibleBoc) bocBase += convertedBigInt;
  }

  const observedDates = [...new Set([...snapshots.values()]
    .filter((snapshot): snapshot is ValidatedFxRates => snapshot !== null)
    .map((snapshot) => snapshot.effectiveDate))].sort();
  let chineseBankBand: LedgerReportChineseBankBand | null = null;
  if (bocEligible && !bocIncomplete) {
    const firstBound = roundBasisPoints(bocBase, 10_000 - 150);
    const secondBound = roundBasisPoints(bocBase, 10_000 + 150);
    chineseBankBand = {
      eligible: true,
      currency: query.reportingCurrency!,
      baseMinorUnits: safeNumberFromBigInt(bocBase, 'BOC base total'),
      lowerMinorUnits: safeNumberFromBigInt(firstBound < secondBound ? firstBound : secondBound, 'BOC lower bound'),
      upperMinorUnits: safeNumberFromBigInt(firstBound > secondBound ? firstBound : secondBound, 'BOC upper bound'),
      percentageBasisPoints: 150,
    };
  }

  return {
    convertedTotals: {
      confirmedMinorUnits: safeNumberFromBigInt(totals.confirmedMinorUnits, 'Converted confirmed total'),
      provisionalMinorUnits: safeNumberFromBigInt(totals.provisionalMinorUnits, 'Converted provisional total'),
      confirmedCount: safeNumberFromBigInt(totals.confirmedCount, 'Converted confirmed count'),
      provisionalCount: safeNumberFromBigInt(totals.provisionalCount, 'Converted provisional count'),
    },
    convertedDailyTotals: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)).map((day) => ({
      date: day.date,
      confirmedMinorUnits: safeNumberFromBigInt(day.confirmedMinorUnits, 'Converted daily confirmed total'),
      provisionalMinorUnits: safeNumberFromBigInt(day.provisionalMinorUnits, 'Converted daily provisional total'),
    })),
    fx: {
      provider: 'frankfurter',
      complete: unavailable.size === 0,
      unavailableSourceCurrencies: [...unavailable].sort(),
      lockedDateCount: lockDates.length,
      observedDateRange: {
        earliest: observedDates[0] ?? null,
        latest: observedDates.at(-1) ?? null,
      },
      chineseBankBand,
    },
  };
}

/**
 * Read report aggregates directly from D1. This is intentionally separate
 * from the paginated Activity endpoint: charts and totals cover the whole
 * selected window, while the activity list can remain bounded.
 */
export async function readLedgerReport(
  db: D1Database,
  context: LedgerContext,
  input: LedgerReportQuery = {},
  dependencies: LedgerReportDependencies = {},
): Promise<LedgerReport> {
  const query = validateQuery(input);
  const { where, bindings } = whereFor(context, query);
  const spending = "t.kind IN ('expense', 'refund', 'fee')";
  const signedAmount = "CASE WHEN t.kind = 'refund' THEN -ABS(t.amount_minor) ELSE ABS(t.amount_minor) END";
  const confirmed = `t.status = 'confirmed' AND ${spending}`;
  const provisional = `t.status = 'provisional' AND ${spending}`;

  const summary = await db.prepare(`SELECT t.currency,
      COALESCE(SUM(CASE WHEN ${confirmed} THEN ${signedAmount} ELSE 0 END), 0) AS confirmed_minor_units,
      COALESCE(SUM(CASE WHEN ${query.includeProvisional ? provisional : '0'} THEN ${signedAmount} ELSE 0 END), 0) AS provisional_minor_units,
      SUM(CASE WHEN ${confirmed} THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN ${query.includeProvisional ? provisional : '0'} THEN 1 ELSE 0 END) AS provisional_count
    FROM transactions t WHERE ${where} GROUP BY t.currency ORDER BY t.currency`).bind(...bindings).all<SummaryRow>();
  const daily = await db.prepare(`SELECT t.date, t.currency,
      COALESCE(SUM(CASE WHEN ${confirmed} THEN ${signedAmount} ELSE 0 END), 0) AS confirmed_minor_units,
      COALESCE(SUM(CASE WHEN ${query.includeProvisional ? provisional : '0'} THEN ${signedAmount} ELSE 0 END), 0) AS provisional_minor_units
    FROM transactions t WHERE ${where} GROUP BY t.date, t.currency ORDER BY t.date, t.currency`).bind(...bindings).all<DailyRow>();
  const reviews = await db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${where} AND t.status = 'needs_review'`).bind(...bindings).first<CountRow>();
  const excluded = await db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${where}
    AND status <> 'needs_review' AND NOT (${confirmed} OR ${query.includeProvisional ? provisional : '0'})`).bind(...bindings).first<CountRow>();
  const sources = await db.prepare(`SELECT t.source, COUNT(*) AS count FROM transactions t WHERE ${where} GROUP BY t.source ORDER BY t.source`).bind(...bindings).all<SourceRow>();
  const converted = query.reportingCurrency
    ? await convertedReport(db, query, where, bindings, confirmed, provisional, dependencies)
    : { convertedTotals: null, convertedDailyTotals: [], fx: emptyFx() };

  return {
    ledgerId: context.ledgerId,
    asOf: (dependencies.now?.() ?? new Date()).toISOString(),
    timeBasis: 'accounting_date',
    timeZone: query.timeZone,
    from: query.from,
    to: query.to,
    includeProvisional: query.includeProvisional,
    currencyTotals: (summary.results ?? []).map((row) => ({
      currency: row.currency,
      confirmedMinorUnits: safeInteger(row.confirmed_minor_units ?? 0, 'Source confirmed total'),
      provisionalMinorUnits: safeInteger(row.provisional_minor_units ?? 0, 'Source provisional total'),
      confirmedCount: safeInteger(row.confirmed_count ?? 0, 'Source confirmed count'),
      provisionalCount: safeInteger(row.provisional_count ?? 0, 'Source provisional count'),
    })),
    dailyTotals: (daily.results ?? []).map((row) => ({
      date: row.date,
      currency: row.currency,
      confirmedMinorUnits: safeInteger(row.confirmed_minor_units ?? 0, 'Source daily confirmed total'),
      provisionalMinorUnits: safeInteger(row.provisional_minor_units ?? 0, 'Source daily provisional total'),
    })),
    reportingCurrency: query.reportingCurrency,
    convertedTotals: converted.convertedTotals,
    convertedDailyTotals: converted.convertedDailyTotals,
    fx: converted.fx,
    reviewCount: safeInteger(reviews?.count ?? 0, 'Review count'),
    excludedCount: safeInteger(excluded?.count ?? 0, 'Excluded count'),
    sourceCoverage: Object.fromEntries((sources.results ?? []).map((row) => [row.source, safeInteger(row.count, `Source coverage for ${row.source}`)])),
  };
}
