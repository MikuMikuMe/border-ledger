import type { CurrencyCode, D1Database, LedgerPreferenceRow } from './db-types';

export interface ReportingPreferences {
  ledgerId: 'personal';
  reportingTimezone: string;
  weekStart: number;
  preferredCurrency: CurrencyCode | null;
  revision: number;
  updatedAt: string;
}

export interface ReportingPreferencesInput {
  reportingTimezone: string;
  weekStart: number;
  preferredCurrency: CurrencyCode | null;
}

export class PreferenceRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('Preference revision conflict.');
    this.currentRevision = currentRevision;
    this.name = 'PreferenceRevisionConflictError';
  }
}

function validTimezone(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new RangeError('Reporting timezone is not bounded.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
  } catch {
    throw new RangeError('Reporting timezone is not recognized.');
  }
  return value;
}

function mapRow(row: LedgerPreferenceRow): ReportingPreferences {
  return {
    ledgerId: row.ledger_id,
    reportingTimezone: row.reporting_timezone,
    weekStart: row.week_start,
    preferredCurrency: row.preferred_currency,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export async function readPreferences(db: D1Database): Promise<ReportingPreferences> {
  const result = await db.prepare(`SELECT ledger_id, reporting_timezone, week_start, preferred_currency, revision, updated_at
    FROM ledger_preferences WHERE ledger_id = 'personal'`).all<LedgerPreferenceRow>();
  const row = result.results[0];
  if (!row) throw new Error('Personal reporting preferences are not initialized.');
  return mapRow(row);
}

export async function updatePreferences(db: D1Database, expectedRevision: number, input: ReportingPreferencesInput) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RangeError('Preference revision is not valid.');
  validTimezone(input.reportingTimezone);
  if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) throw new RangeError('Week start is not valid.');
  if (input.preferredCurrency !== null) {
    if (typeof input.preferredCurrency !== 'string' || input.preferredCurrency.length > 12) throw new RangeError('Preferred currency is not bounded.');
    const currency = await db.prepare('SELECT code FROM currencies WHERE code = ?').bind(input.preferredCurrency).all<{ code: string }>();
    if (currency.results.length !== 1) throw new RangeError('Preferred currency is not registered.');
  }
  const result = await db.prepare(`UPDATE ledger_preferences SET
      reporting_timezone = ?, week_start = ?, preferred_currency = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE ledger_id = 'personal' AND revision = ?`).bind(
    input.reportingTimezone,
    input.weekStart,
    input.preferredCurrency,
    expectedRevision,
  ).run();
  if (result.meta?.changes !== 1) {
    const current = await readPreferences(db);
    throw new PreferenceRevisionConflictError(current.revision);
  }
  return readPreferences(db);
}
