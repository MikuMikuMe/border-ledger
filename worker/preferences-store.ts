import { assertFinancialAuthority, financialAuthorityPredicate, immutableFinancialContext, type FinancialContext } from './financial-authority';
import type { CurrencyCode, D1Database, LedgerId, LedgerPreferenceRow } from './db-types';

export interface ReportingPreferences {
  ledgerId: LedgerId;
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

export async function readPreferences(db: D1Database, context: FinancialContext, scope: 'ledger:read' | 'preferences:write' = 'ledger:read'): Promise<ReportingPreferences> {
  const result = await db.prepare(`SELECT ledger_id, reporting_timezone, week_start, preferred_currency, revision, updated_at
    FROM ledger_preferences WHERE ledger_id = ?`).bind(context.ledgerId).all<LedgerPreferenceRow>();
  await assertFinancialAuthority(db, context, scope);
  const row = result.results[0];
  if (!row) throw new Error('Ledger reporting preferences are not initialized.');
  return mapRow(row);
}

async function validatePreferredCurrency(db: D1Database, preferredCurrency: CurrencyCode | null) {
  if (preferredCurrency === null) return;
  if (typeof preferredCurrency !== 'string' || preferredCurrency.length > 12) throw new RangeError('Preferred currency is not bounded.');
  const currency = await db.prepare('SELECT code FROM currencies WHERE code = ?').bind(preferredCurrency).all<{ code: string }>();
  if (currency.results.length !== 1) throw new RangeError('Preferred currency is not registered.');
}
export async function updatePreferences(db: D1Database, context: FinancialContext, expectedRevision: number, input: ReportingPreferencesInput) {
  context = immutableFinancialContext(context);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RangeError('Preference revision is not valid.');
  validTimezone(input.reportingTimezone);
  if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) throw new RangeError('Week start is not valid.');
  await validatePreferredCurrency(db, input.preferredCurrency);
  const authority = financialAuthorityPredicate(context, 'preferences:write');
  const result = await db.prepare(`UPDATE ledger_preferences SET
      reporting_timezone = ?, week_start = ?, preferred_currency = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE ledger_id = ? AND revision = ? AND ${authority.sql}`).bind(
    input.reportingTimezone,
    input.weekStart,
    input.preferredCurrency,
    context.ledgerId,
    expectedRevision,
    ...authority.bindings,
  ).run();
  const current = await readPreferences(db, context, 'preferences:write');
  if (result.meta?.changes !== 1) throw new PreferenceRevisionConflictError(current.revision);
  return current;
}
