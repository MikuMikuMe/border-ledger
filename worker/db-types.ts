export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1RunResult {
  success?: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
    [key: string]: unknown;
  };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}

export type LedgerId = string;
export type CurrencyCode = string;
export type AlertEventState = 'provisional' | 'non_spending' | 'needs_review' | 'voided' | 'superseded';
export type AlertEventRelation = 'cancels' | 'partially_reverses' | 'replaces_authorization' | 'refund_of' | 'confirms' | 'possible_duplicate';

export interface LedgerPreferenceRow {
  ledger_id: LedgerId;
  reporting_timezone: string;
  week_start: number;
  preferred_currency: CurrencyCode | null;
  revision: number;
  updated_at: string;
}

export interface FxRateSnapshotRow {
  requested_date: string;
  effective_date: string;
  provider: 'frankfurter';
  rates_json: string;
  content_digest: string;
  fetched_at: string;
}

export async function readFxSnapshot(db: D1Database, requestedDate: string): Promise<FxRateSnapshotRow | null> {
  return db.prepare(`SELECT requested_date, effective_date, provider, rates_json, content_digest, fetched_at
    FROM fx_rate_snapshots WHERE requested_date = ?`).bind(requestedDate).first<FxRateSnapshotRow>();
}

export async function insertFxSnapshotIfAbsent(db: D1Database, snapshot: FxRateSnapshotRow): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO fx_rate_snapshots
    (requested_date, effective_date, provider, rates_json, content_digest, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(requested_date) DO NOTHING`).bind(
    snapshot.requested_date,
    snapshot.effective_date,
    snapshot.provider,
    snapshot.rates_json,
    snapshot.content_digest,
    snapshot.fetched_at,
  ).run();
  return (result.meta?.changes ?? 0) === 1;
}

export interface SourceProfileRow {
  id: string;
  ledger_id: LedgerId;
  provider: string;
  source_kind: string;
  display_name: string;
  parser_version: string;
  status: 'pending' | 'approved' | 'paused' | 'unsupported';
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface AlertProjectionProvenanceInput {
  sourceKind: string;
  sourceId: string;
  basis: 'alert_event' | 'statement' | 'provider' | 'user_review';
}
