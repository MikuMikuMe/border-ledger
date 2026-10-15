import type {
  RecurringClassification,
  RecurringDetailPage,
  RecurringMembership,
  RecurringPage,
  RecurringQuery,
  RecurringStream,
  RecurringSummary,
  RecurringSummaryQuery,
} from '../src/domain/recurring';
import { analyzeRecurring } from '../src/domain/recurring';
import { emptyCurrencyTotals } from '../src/domain/currencies';
import type { Currency } from '../src/domain/types';
import type { D1Database, D1Statement } from './db-types';
import type { NormalizedRecurringSnapshot } from './plaid-recurring';

export type RecurringPublicationResult = 'published' | 'superseded' | 'disconnected';

export interface RecurringQueue {
  send(message: unknown): Promise<void>;
}

interface RecurringSyncState {
  item_id: string;
  requested_generation: number;
  completed_generation: number;
  source_updated_at: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  history_complete: number;
  coverage_warnings: string | null;
  lifecycle: 'active' | 'disconnecting' | 'disconnected';
  scope_version: number;
}

interface RecurringStreamRow {
  id: string;
  item_id: string;
  stream_id: string;
  account_id: string;
  merchant_name: string | null;
  merchant_entity_id: string | null;
  currency: Currency;
  source_status: string;
  source_frequency: string | null;
  frequency: RecurringStream['frequency'];
  is_outflow: number;
  first_date: string | null;
  last_date: string | null;
  predicted_next_date: string | null;
  average_amount_minor: number | null;
  last_amount_minor: number | null;
  predicted_amount_minor: number | null;
  source_updated_at: string | null;
  classification: string | null;
  revision?: number;
  sort_date?: string;
}

interface RecurringMembershipRow {
  recurring_stream_id: string;
  provider_transaction_id: string;
  provider_pending_transaction_id: string | null;
  date: string;
  amount_minor: number;
  currency: Currency;
  kind: RecurringMembership['kind'];
  transaction_status: 'confirmed' | 'provisional' | 'needs_review' | null;
  transaction_id: string | null;
}

interface CursorValue {
  date: string;
  id: string;
}

const RECURRING_CLASSIFICATIONS: readonly RecurringClassification[] = ['unclassified', 'subscription', 'bill', 'other', 'excluded'];
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

function classificationOrDefault(value: string | null | undefined): RecurringClassification {
  return value === 'subscription' || value === 'bill' || value === 'other' || value === 'excluded' ? value : 'unclassified';
}

async function syncState(db: D1Database, itemId: string) {
  const result = await db.prepare(`SELECT item_id, requested_generation, completed_generation, source_updated_at, lifecycle, scope_version
    FROM recurring_sync_state WHERE item_id = ?`).bind(itemId).all<RecurringSyncState>();
  return result.results[0] ?? null;
}

function boundedLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(value) || value < 1) throw new Error('Recurring page limit must be a positive integer.');
  return Math.min(value, MAX_PAGE_LIMIT);
}

function encodeCursor(value: CursorValue) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorValue>;
    if (typeof parsed.date !== 'string' || typeof parsed.id !== 'string' || parsed.date.length > 32 || parsed.id.length === 0 || parsed.id.length > 256) {
      throw new Error('invalid cursor');
    }
    return { date: parsed.date, id: parsed.id };
  } catch {
    throw new Error('Recurring cursor is not valid.');
  }
}

function mapStream(row: RecurringStreamRow, memberships: RecurringMembership[] = []): RecurringStream {
  return {
    id: row.id,
    itemId: row.item_id,
    streamId: row.stream_id,
    accountId: row.account_id,
    merchantName: row.merchant_name,
    merchantEntityId: row.merchant_entity_id,
    currency: row.currency,
    sourceStatus: row.source_status,
    sourceFrequency: row.source_frequency ?? row.frequency,
    frequency: row.frequency,
    isOutflow: row.is_outflow === 1,
    firstDate: row.first_date,
    lastDate: row.last_date,
    predictedNextDate: row.predicted_next_date,
    averageAmountMinor: row.average_amount_minor,
    lastAmountMinor: row.last_amount_minor,
    predictedAmountMinor: row.predicted_amount_minor,
    memberships,
    sourceUpdatedAt: row.source_updated_at,
    classification: classificationOrDefault(row.classification),
    revision: row.revision ?? 0,
  };
}

async function attachClassificationRevisions(db: D1Database, rows: RecurringStreamRow[]) {
  if (rows.length === 0) return rows;
  const revisions = new Map<string, number>();
  try {
    const result = await db.prepare(`SELECT recurring_stream_id, revision
      FROM recurring_classifications WHERE recurring_stream_id IN (${rows.map(() => '?').join(', ')})`)
      .bind(...rows.map((row) => row.id)).all<{ recurring_stream_id: string; revision: number }>();
    for (const row of result.results) revisions.set(row.recurring_stream_id, Number.isSafeInteger(row.revision) ? row.revision : 0);
  } catch {
    // Keep databases created before the classification revision migration readable during rollout.
  }
  return rows.map((row) => ({ ...row, revision: revisions.get(row.id) ?? 0 }));
}

function mapMembership(row: RecurringMembershipRow): RecurringMembership {
  const pending = row.transaction_status === 'provisional' || (row.transaction_id === null && row.provider_pending_transaction_id !== null);
  return {
    providerTransactionId: row.provider_transaction_id,
    pendingProviderTransactionId: row.provider_pending_transaction_id,
    date: row.date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: pending ? 'pending' : 'posted',
    kind: row.kind,
  };
}

function parseWarnings(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function syncMetadata(db: D1Database) {
  const result = await db.prepare(`SELECT item_id, history_complete, source_updated_at, last_success_at, last_attempt_at, last_error,
      coverage_warnings, lifecycle FROM recurring_sync_state ORDER BY updated_at DESC`).all<RecurringSyncState>();
  const rows = result.results;
  const checkedAt = rows.map((row) => row.last_success_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const sourceUpdatedAt = rows.map((row) => row.source_updated_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const lastError = rows.find((row) => row.last_error)?.last_error ?? null;
  const coverageWarnings = [...new Set(rows.flatMap((row) => parseWarnings(row.coverage_warnings)))].slice(0, 20);
  const activeRows = rows.filter((row) => row.lifecycle === 'active');
  return {
    rows,
    checkedAt,
    sourceUpdatedAt,
    lastError,
    coverageWarnings,
    hasActiveFeed: activeRows.length > 0,
    historyIncomplete: activeRows.some((row) => row.history_complete !== 1),
  };
}

function feedState(streamCount: number, metadata: Awaited<ReturnType<typeof syncMetadata>>): RecurringPage['state'] {
  if (metadata.lastError) return 'error';
  if (!metadata.hasActiveFeed) return streamCount === 0 ? 'unavailable' : 'ready';
  if (!metadata.checkedAt) return streamCount === 0 ? 'waiting' : 'incomplete';
  const checkedMillis = Date.parse(metadata.checkedAt);
  if (!Number.isNaN(checkedMillis) && Date.now() - checkedMillis > 24 * 60 * 60 * 1000) return 'stale';
  if (metadata.historyIncomplete) return streamCount === 0 ? 'waiting' : 'incomplete';
  return streamCount === 0 ? 'empty' : 'ready';
}

function streamFilter(clauses: string[], bindings: unknown[], query: RecurringQuery | RecurringSummaryQuery) {
  clauses.push('s.present_in_latest_snapshot = 1');
  if (query.accountId) {
    clauses.push('s.account_id = ?');
    bindings.push(query.accountId);
  }
  if (query.currency) {
    clauses.push('s.currency = ?');
    bindings.push(query.currency);
  }
  if (query.classification) {
    clauses.push("COALESCE(c.classification, 'unclassified') = ?");
    bindings.push(query.classification);
  }
}

async function readStreamRows(db: D1Database, query: RecurringSummaryQuery | RecurringQuery, limit?: number, cursor?: CursorValue | null) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  streamFilter(clauses, bindings, query);
  if (cursor) {
    clauses.push("(COALESCE(s.predicted_next_date, '9999-12-31') > ? OR (COALESCE(s.predicted_next_date, '9999-12-31') = ? AND s.id > ?))");
    bindings.push(cursor.date, cursor.date, cursor.id);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const suffix = limit ? ` LIMIT ${limit + 1}` : '';
  const result = await db.prepare(`SELECT s.id, s.item_id, s.stream_id, s.account_id, s.merchant_name, s.merchant_entity_id,
      s.currency, s.source_status, s.source_frequency, s.frequency, s.is_outflow, s.first_date, s.last_date,
      s.predicted_next_date, s.average_amount_minor, s.last_amount_minor, s.predicted_amount_minor, s.source_updated_at,
      COALESCE(c.classification, 'unclassified') AS classification,
      COALESCE(s.predicted_next_date, '9999-12-31') AS sort_date
    FROM recurring_streams s
    LEFT JOIN recurring_classifications c ON c.recurring_stream_id = s.id
    ${where}
    ORDER BY sort_date ASC, s.id ASC${suffix}`).bind(...bindings).all<RecurringStreamRow>();
  return attachClassificationRevisions(db, result.results);
}

async function readMembershipRows(db: D1Database, streamIds?: readonly string[]) {
  const clauses = ['rt.present_in_latest_snapshot = 1'];
  const bindings: unknown[] = [];
  if (streamIds && streamIds.length > 0) {
    clauses.push(`rt.recurring_stream_id IN (${streamIds.map(() => '?').join(', ')})`);
    bindings.push(...streamIds);
  }
  if (streamIds && streamIds.length === 0) return new Map<string, RecurringMembership[]>();
  const result = await db.prepare(`SELECT rt.recurring_stream_id, rt.provider_transaction_id, rt.provider_pending_transaction_id,
      rt.date, rt.amount_minor, rt.currency, COALESCE(t.kind, rt.kind) AS kind,
      t.status AS transaction_status, rt.transaction_id
    FROM recurring_stream_transactions rt
    LEFT JOIN transactions t ON t.id = rt.transaction_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY rt.date DESC, rt.provider_transaction_id DESC`).bind(...bindings).all<RecurringMembershipRow>();
  const grouped = new Map<string, RecurringMembership[]>();
  for (const row of result.results) {
    const list = grouped.get(row.recurring_stream_id) ?? [];
    list.push(mapMembership(row));
    grouped.set(row.recurring_stream_id, list);
  }
  return grouped;
}

export async function readRecurringPage(db: D1Database, query: RecurringQuery = {}): Promise<RecurringPage> {
  const limit = boundedLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const rows = await readStreamRows(db, query, limit, cursor);
  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;
  const metadata = await syncMetadata(db);
  const streams = visibleRows.map((row) => mapStream(row));
  const last = visibleRows.at(-1);
  return {
    streams,
    nextCursor: hasMore && last ? encodeCursor({ date: last.sort_date ?? '9999-12-31', id: last.id }) : null,
    state: feedState(streams.length > 0 ? streams.length : rows.length, metadata),
    checkedAt: metadata.checkedAt,
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    lastError: metadata.lastError,
    coverageWarnings: metadata.coverageWarnings,
  };
}

export async function readRecurringDetail(db: D1Database, id: string, cursor?: string, requestedLimit?: number): Promise<RecurringDetailPage | null> {
  const streamResult = await db.prepare(`SELECT s.id, s.item_id, s.stream_id, s.account_id, s.merchant_name, s.merchant_entity_id,
      s.currency, s.source_status, s.source_frequency, s.frequency, s.is_outflow, s.first_date, s.last_date,
      s.predicted_next_date, s.average_amount_minor, s.last_amount_minor, s.predicted_amount_minor, s.source_updated_at,
      COALESCE(c.classification, 'unclassified') AS classification
    FROM recurring_streams s
    LEFT JOIN recurring_classifications c ON c.recurring_stream_id = s.id
    WHERE s.id = ? AND s.present_in_latest_snapshot = 1`).bind(id).all<RecurringStreamRow>();
  const row = streamResult.results[0];
  if (!row) return null;
  const [rowWithRevision] = await attachClassificationRevisions(db, [row]);
  const limit = boundedLimit(requestedLimit);
  const decoded = decodeCursor(cursor);
  const clauses = ['rt.recurring_stream_id = ?', 'rt.present_in_latest_snapshot = 1'];
  const bindings: unknown[] = [id];
  if (decoded) {
    clauses.push('(rt.date < ? OR (rt.date = ? AND rt.provider_transaction_id < ?))');
    bindings.push(decoded.date, decoded.date, decoded.id);
  }
  const historyResult = await db.prepare(`SELECT rt.recurring_stream_id, rt.provider_transaction_id, rt.provider_pending_transaction_id,
      rt.date, rt.amount_minor, rt.currency, COALESCE(t.kind, rt.kind) AS kind,
      t.status AS transaction_status, rt.transaction_id
    FROM recurring_stream_transactions rt
    LEFT JOIN transactions t ON t.id = rt.transaction_id
    WHERE ${clauses.join(' AND ')}
      ORDER BY rt.date DESC, rt.provider_transaction_id DESC LIMIT ${limit + 1}`).bind(...bindings).all<RecurringMembershipRow>();
  const hasMore = historyResult.results.length > limit;
  const historyRows = hasMore ? historyResult.results.slice(0, limit) : historyResult.results;
  const last = historyRows.at(-1);
  return {
    stream: mapStream(rowWithRevision, historyRows.map(mapMembership)),
    history: historyRows.map(mapMembership),
    nextCursor: hasMore && last ? encodeCursor({ date: last.date, id: last.provider_transaction_id }) : null,
    classification: classificationOrDefault(rowWithRevision.classification),
  };
}

export async function readRecurringSummary(db: D1Database, query: RecurringSummaryQuery): Promise<RecurringSummary> {
  if (query.startDate > query.endDate) throw new Error('Recurring summary date range is not valid.');
  const rows = await readStreamRows(db, query);
  const streamIds = rows.map((row) => row.id);
  const memberships = await readMembershipRows(db, streamIds);
  const streams = rows.map((row) => mapStream(row, memberships.get(row.id) ?? []));
  const estimates = analyzeRecurring(streams, query.today);
  const actualCostByCurrency = emptyCurrencyTotals() as Record<Currency, number>;
  if (streamIds.length > 0) {
    const clauses: string[] = [
      'rt.present_in_latest_snapshot = 1',
      't.status = \'confirmed\'',
      "t.kind IN ('expense', 'refund', 'fee')",
      't.date >= ?',
      't.date <= ?',
      "s.source_status NOT IN ('INACTIVE', 'TOMBSTONED')",
      "COALESCE(c.classification, 'unclassified') <> 'excluded'",
      `rt.recurring_stream_id IN (${streamIds.map(() => '?').join(', ')})`,
    ];
    const bindings: unknown[] = [query.startDate, query.endDate, ...streamIds];
    if (query.accountId) {
      clauses.push('s.account_id = ?');
      bindings.push(query.accountId);
    }
    if (query.currency) {
      clauses.push('t.currency = ?');
      bindings.push(query.currency);
    }
    const actual = await db.prepare(`SELECT t.id, t.currency, t.amount_minor
      FROM recurring_stream_transactions rt
      JOIN recurring_streams s ON s.id = rt.recurring_stream_id
      LEFT JOIN recurring_classifications c ON c.recurring_stream_id = s.id
      JOIN transactions t ON t.id = rt.transaction_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY t.id, t.currency, t.amount_minor`).bind(...bindings).all<{ id: string; currency: Currency; amount_minor: number }>();
    for (const row of actual.results) actualCostByCurrency[row.currency] -= row.amount_minor;
  }
  const metadata = await syncMetadata(db);
  return {
    ...estimates,
    actualCostByCurrency,
    streamCount: streams.length,
    coverageWarnings: metadata.coverageWarnings,
    checkedAt: metadata.checkedAt,
    sourceUpdatedAt: metadata.sourceUpdatedAt,
    lastError: metadata.lastError,
    state: feedState(streams.length, metadata),
  };
}

export async function requestRecurringSync(db: D1Database, queue: RecurringQueue, itemId: string) {
  let state = await syncState(db, itemId);
  if (!state) {
    const item = await db.prepare('SELECT item_id FROM plaid_items WHERE item_id = ?').bind(itemId).all<{ item_id: string }>();
    if (item.results.length === 0) throw new Error('Recurring Item is not active.');
    await db.prepare(`INSERT INTO recurring_sync_state (item_id, lifecycle, scope_version)
      VALUES (?, 'active', 0) ON CONFLICT(item_id) DO NOTHING`).bind(itemId).run();
    state = await syncState(db, itemId);
  }
  if (!state || state.lifecycle !== 'active') throw new Error('Recurring Item is not active.');
  const generation = state.requested_generation + 1;
  await db.prepare(`UPDATE recurring_sync_state SET requested_generation = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND lifecycle = 'active'`)
    .bind(generation, itemId).run();
  await queue.send({ type: 'plaid-recurring-sync', itemId, generation });
  return generation;
}

function streamStatements(db: D1Database, itemId: string, stream: RecurringStream): D1Statement[] {
  const statements: D1Statement[] = [
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, merchant_entity_id, currency, source_status, source_frequency, frequency, is_outflow,
       first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor,
       source_updated_at, present_in_latest_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        item_id = excluded.item_id,
        stream_id = excluded.stream_id,
        account_id = excluded.account_id,
        merchant_name = excluded.merchant_name,
        merchant_entity_id = excluded.merchant_entity_id,
        currency = excluded.currency,
        source_status = excluded.source_status,
        source_frequency = excluded.source_frequency,
        frequency = excluded.frequency,
        is_outflow = excluded.is_outflow,
        first_date = excluded.first_date,
        last_date = excluded.last_date,
        predicted_next_date = excluded.predicted_next_date,
        average_amount_minor = excluded.average_amount_minor,
        last_amount_minor = excluded.last_amount_minor,
        predicted_amount_minor = excluded.predicted_amount_minor,
        source_updated_at = excluded.source_updated_at,
        present_in_latest_snapshot = 1,
        updated_at = CURRENT_TIMESTAMP`)
      .bind(
        stream.id,
        itemId,
        stream.streamId,
        stream.accountId,
        stream.merchantName,
        stream.merchantEntityId,
        stream.currency,
        stream.sourceStatus,
        stream.sourceFrequency,
        stream.frequency,
        stream.isOutflow ? 1 : 0,
        stream.firstDate,
        stream.lastDate,
        stream.predictedNextDate,
        stream.averageAmountMinor,
        stream.lastAmountMinor,
        stream.predictedAmountMinor,
        stream.sourceUpdatedAt,
      ),
    db.prepare(`INSERT INTO recurring_classifications (recurring_stream_id, classification)
      VALUES (?, 'unclassified') ON CONFLICT(recurring_stream_id) DO NOTHING`).bind(stream.id),
    db.prepare('DELETE FROM recurring_stream_transactions WHERE recurring_stream_id = ?').bind(stream.id),
  ];
  for (const membership of stream.memberships) {
    statements.push(db.prepare(`INSERT INTO recurring_stream_transactions
      (recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id,
       date, amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot)
      VALUES (?, ?, ?, ?, COALESCE(
        (SELECT id FROM transactions WHERE plaid_item_id = ? AND provider_transaction_id = ? LIMIT 1),
        (SELECT id FROM transactions WHERE plaid_item_id = ? AND provider_pending_transaction_id = ? LIMIT 1)
      ), ?, ?, ?, ?, ?, ?, ?, 1)`)
      .bind(
        stream.id,
        itemId,
        membership.providerTransactionId,
        membership.pendingProviderTransactionId,
        itemId,
        membership.providerTransactionId,
        itemId,
        membership.pendingProviderTransactionId,
        stream.accountId,
        membership.date,
        membership.amountMinor,
        membership.currency,
        stream.isOutflow ? 'expense' : 'income',
        stream.isOutflow ? 1 : 0,
        membership.providerTransactionId,
      ));
  }
  return statements;
}

export async function publishRecurringSnapshot(
  db: D1Database,
  itemId: string,
  generation: number,
  scopeVersion: number,
  snapshot: NormalizedRecurringSnapshot,
  checkedAt: string,
): Promise<RecurringPublicationResult> {
  if (snapshot.itemId !== itemId) throw new Error('Recurring snapshot Item does not match the requested Item.');
  if (!snapshot.sourceUpdatedAt) throw new Error('Recurring source timestamp is required before publication.');
  const state = await syncState(db, itemId);
  if (!state || state.lifecycle !== 'active') return 'disconnected';
  if (state.scope_version !== scopeVersion || generation < state.requested_generation || generation < state.completed_generation) return 'superseded';
  if (state.source_updated_at && state.source_updated_at > snapshot.sourceUpdatedAt) return 'superseded';

  const statements: D1Statement[] = [
    db.prepare(`UPDATE recurring_streams SET present_in_latest_snapshot = 0, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?`).bind(itemId),
    db.prepare('DELETE FROM recurring_stream_transactions WHERE item_id = ?').bind(itemId),
  ];
  for (const stream of snapshot.streams) statements.push(...streamStatements(db, itemId, stream));
  statements.push(db.prepare(`UPDATE recurring_sync_state SET
    history_complete = ?, completed_generation = ?, source_updated_at = ?, last_success_at = ?, last_attempt_at = ?, last_error = NULL, coverage_warnings = ?, updated_at = CURRENT_TIMESTAMP
    WHERE item_id = ? AND lifecycle = 'active' AND scope_version = ? AND requested_generation <= ?`)
    .bind(snapshot.historyComplete === true ? 1 : 0, generation, snapshot.sourceUpdatedAt, checkedAt, checkedAt, JSON.stringify(snapshot.coverageWarnings.slice(0, 20)), itemId, scopeVersion, generation));
  await db.batch(statements);
  return 'published';
}

export interface RecurringClassificationUpdateResult {
  kind: 'updated' | 'not_found' | 'conflict';
  id: string;
  revision: number;
  updatedAt: string | null;
}

async function recurringClassificationRevision(db: D1Database, id: string) {
  const row = await db.prepare('SELECT revision FROM recurring_classifications WHERE recurring_stream_id = ?').bind(id).first<{ revision: number }>();
  if (!row) return 0;
  if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Recurring classification revision is unavailable.');
  return row.revision;
}

export async function updateRecurringClassification(
  db: D1Database,
  id: string,
  classification: RecurringClassification,
  expectedRevision: number,
): Promise<RecurringClassificationUpdateResult> {
  if (!RECURRING_CLASSIFICATIONS.includes(classification)) return { kind: 'not_found', id, revision: 0, updatedAt: null };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Recurring classification revision is not valid.');
  const existing = await db.prepare('SELECT id FROM recurring_streams WHERE id = ? AND present_in_latest_snapshot = 1').bind(id).first<{ id: string }>();
  if (!existing) return { kind: 'not_found', id, revision: 0, updatedAt: null };
  const normalized = classificationOrDefault(classification);
  const currentRevision = await recurringClassificationRevision(db, id);
  if (expectedRevision !== currentRevision) return { kind: 'conflict', id, revision: currentRevision, updatedAt: null };
  const inserted = await db.prepare(`INSERT INTO recurring_classifications (recurring_stream_id, classification, revision, updated_at)
      VALUES (?, 'unclassified', 0, CURRENT_TIMESTAMP) ON CONFLICT(recurring_stream_id) DO NOTHING`).bind(id).run();
  if (inserted.success === false) throw new Error('Recurring classification initialization failed.');
  const result = await db.prepare(`UPDATE recurring_classifications
      SET classification = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE recurring_stream_id = ? AND revision = ?`).bind(normalized, id, expectedRevision).run();
  if (result.success === false) throw new Error('Recurring classification update failed.');
  if ((result.meta?.changes ?? 0) !== 1) {
    const revision = await recurringClassificationRevision(db, id);
    return { kind: 'conflict', id, revision, updatedAt: null };
  }
  const updated = await db.prepare('SELECT updated_at FROM recurring_classifications WHERE recurring_stream_id = ?').bind(id).first<{ updated_at: string | null }>();
  if (!updated?.updated_at) throw new Error('Recurring classification acknowledgement is unavailable.');
  return { kind: 'updated', id, revision: currentRevision + 1, updatedAt: updated.updated_at };
}

export async function setRecurringClassification(db: D1Database, id: string, classification: RecurringClassification) {
  if (!RECURRING_CLASSIFICATIONS.includes(classification)) return false;
  const existing = await db.prepare('SELECT id FROM recurring_streams WHERE id = ? AND present_in_latest_snapshot = 1').bind(id).first<{ id: string }>();
  if (!existing) return false;
  try {
    const currentRevision = await recurringClassificationRevision(db, id);
    const result = await updateRecurringClassification(db, id, classification, currentRevision);
    return result.kind === 'updated';
  } catch (error) {
    if (!(error instanceof Error) || !/no such column:\s*revision/i.test(error.message)) throw error;
    const result = await db.prepare(`INSERT INTO recurring_classifications (recurring_stream_id, classification, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(recurring_stream_id) DO UPDATE SET classification = excluded.classification, updated_at = CURRENT_TIMESTAMP`)
      .bind(id, classification).run();
    if (result.success === false) throw new Error('Recurring legacy classification update failed.');
    return true;
  }
}
