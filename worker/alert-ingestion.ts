import { deriveAlertProjection, type BankAlertEventInput, type InstrumentMapping } from '../src/domain/bank-alerts';
import { getCurrencyMeta } from '../src/domain/currencies';
import { normalizeRfc3339Instant, parseRfc3339Instant, requestDigest, assertCaptureEventScope, type CaptureContext } from './mobile-auth';
import { MAX_ALERT_BATCH_BYTES, MAX_ALERT_BATCH_SIZE } from './alert-store';
import type { D1Database, D1Result, D1Statement } from './db-types';
import { findAlertStatementMatches, isReconciliationUniqueConflict, type AlertStatementMatch } from './reconciliation-store';

const EVENT_TYPES = new Set(['purchase_notice', 'authorization_reversal', 'declined', 'refund_notice', 'hold_notice', 'adjustment_notice', 'repayment_notice', 'transfer_notice', 'fee_notice', 'unknown']);
const DIRECTIONS = new Set(['outflow', 'inflow', 'none', 'unknown']);
const EVENT_TIME_BASES = new Set(['notification_posted', 'bank_transaction_date', 'statement_posting_date', 'unresolved']);
const MONEY_ROLES = new Set(['transaction', 'authorization', 'billing', 'fee']);
const FEE_TREATMENTS = new Set(['included', 'separate', 'unknown']);
const INSTRUMENT_HINT_KINDS = new Set(['card_suffix', 'account_hint', 'source_reference']);
const PRECISIONS = new Set(['minute', 'second', 'date', 'unknown']);
const YEAR_PROVENANCE = new Set(['explicit', 'inferred', 'two_digit', 'missing']);
export const ALERT_EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IngestProjectionState = 'provisional' | 'non_spending' | 'needs_review' | 'voided' | 'superseded' | 'rejected';
export type IngestAckStatus = 'accepted' | 'replayed' | 'rejected' | 'conflict';

export interface IngestAck {
  eventId: string;
  status: IngestAckStatus;
  receiptId: string | null;
  revision: number | null;
  projectionState: IngestProjectionState | null;
  reasonCodes: string[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface IngestBatchResponse {
  acks: IngestAck[];
}

interface ValidationFailure {
  eventId: string;
  reasonCodes: string[];
}

interface ScopedEvent {
  event: BankAlertEventInput;
  digest: string;
  accountId: string;
  scopeCurrency: string;
  deviceId: string;
  mapping: InstrumentMapping;
}

interface ExistingReceiptRow {
  event_id: string;
  device_id: string | null;
  payload_digest: string;
  projection_id: string | null;
  projection_state: IngestProjectionState | null;
  reason_codes_json: string | null;
  revision: number | null;
}

interface ScopeRow {
  source_profile_id: string;
  account_id: string;
  currency: string;
  source_status: string;
  instrument_hint_kind: string;
  instrument_hint_value: string;
}

interface StatementResolution {
  candidates: AlertStatementMatch[];
  auto: AlertStatementMatch | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function keysExactly(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function nonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function nullableString(value: unknown, max: number): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max);
}

function nullableNonEmptyString(value: unknown, max: number): value is string | null {
  return value === null || nonEmptyString(value, max);
}

function validTimestamp(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  if (typeof value !== 'string' || value.length > 64) return false;
  return parseRfc3339Instant(value) !== null;
}

function validMoney(value: unknown): value is { currency: string; amountMinor: number } {
  const item = record(value);
  return !!item && keysExactly(item, ['currency', 'amountMinor']) && nonEmptyString(item.currency, 12) && getCurrencyMeta(item.currency) !== null && typeof item.amountMinor === 'number' && Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0;
}

function parseEvent(value: unknown): BankAlertEventInput | ValidationFailure {
  const item = record(value);
  const eventId = typeof item?.eventId === 'string' ? item.eventId : '';
  if (!item || !keysExactly(item, ['schemaVersion', 'eventId', 'observationId', 'sourceProfileId', 'parserVersion', 'notificationPostedAt', 'capturedAt', 'eventTimeBasis', 'eventType', 'direction', 'instrumentHint', 'eventMoney', 'primaryMoneyRole', 'amounts', 'feeTreatment', 'bankReference', 'bankDisplayedTime', 'merchant', 'completeness'])) return { eventId, reasonCodes: ['unknown_field'] };
  if (!['schemaVersion', 'eventId', 'observationId', 'sourceProfileId', 'parserVersion', 'notificationPostedAt', 'capturedAt', 'eventTimeBasis', 'eventType', 'direction', 'eventMoney', 'primaryMoneyRole', 'amounts', 'feeTreatment', 'bankDisplayedTime', 'completeness'].every((key) => Object.prototype.hasOwnProperty.call(item, key))) return { eventId, reasonCodes: ['invalid_event'] };
  if (!ALERT_EVENT_ID.test(eventId)) return { eventId, reasonCodes: ['invalid_event_id'] };
  if (item.schemaVersion !== 1 || !nonEmptyString(item.observationId, 128) || !nonEmptyString(item.sourceProfileId, 128) || !nonEmptyString(item.parserVersion, 64)) return { eventId, reasonCodes: ['invalid_event'] };
  if (!validTimestamp(item.notificationPostedAt, true) || !validTimestamp(item.capturedAt)) return { eventId, reasonCodes: ['invalid_time'] };
  if (typeof item.eventTimeBasis !== 'string' || !EVENT_TIME_BASES.has(item.eventTimeBasis) || typeof item.eventType !== 'string' || !EVENT_TYPES.has(item.eventType) || typeof item.direction !== 'string' || !DIRECTIONS.has(item.direction) || (item.primaryMoneyRole !== null && typeof item.primaryMoneyRole !== 'string') || (item.primaryMoneyRole !== null && !MONEY_ROLES.has(item.primaryMoneyRole)) || typeof item.feeTreatment !== 'string' || !FEE_TREATMENTS.has(item.feeTreatment)) return { eventId, reasonCodes: ['invalid_event'] };
  if (item.instrumentHint !== undefined && item.instrumentHint !== null) {
    const hint = record(item.instrumentHint);
    if (!hint || !keysExactly(hint, ['kind', 'value']) || typeof hint.kind !== 'string' || !INSTRUMENT_HINT_KINDS.has(hint.kind) || !nonEmptyString(hint.value, 128)) return { eventId, reasonCodes: ['invalid_instrument'] };
  }
  if (item.eventMoney !== null && item.eventMoney !== undefined && !validMoney(item.eventMoney)) {
    const money = record(item.eventMoney);
    if (money && typeof money.currency === 'string' && getCurrencyMeta(money.currency) === null) return { eventId, reasonCodes: ['invalid_currency'] };
    return { eventId, reasonCodes: money && typeof money.amountMinor === 'number' && !Number.isInteger(money.amountMinor) ? ['invalid_money_scale'] : ['invalid_money'] };
  }
  if (!Array.isArray(item.amounts) || item.amounts.length > 16 || item.amounts.some((part) => {
    const candidate = record(part);
    return !candidate || !keysExactly(candidate, ['role', 'currency', 'amountMinor']) || typeof candidate.role !== 'string' || !MONEY_ROLES.has(candidate.role) || !validMoney({ currency: candidate.currency, amountMinor: candidate.amountMinor });
  })) {
    const invalidComponent = Array.isArray(item.amounts) ? item.amounts.map(record).find((candidate) => candidate && (typeof candidate.currency !== 'string' || getCurrencyMeta(candidate.currency) === null || typeof candidate.amountMinor !== 'number' || !Number.isInteger(candidate.amountMinor))) : null;
    if (invalidComponent && typeof invalidComponent.currency === 'string' && getCurrencyMeta(invalidComponent.currency) === null) return { eventId, reasonCodes: ['invalid_currency'] };
    if (invalidComponent && typeof invalidComponent.amountMinor === 'number' && !Number.isInteger(invalidComponent.amountMinor)) return { eventId, reasonCodes: ['invalid_money_scale'] };
    return { eventId, reasonCodes: ['invalid_money'] };
  }
  if (!nullableString(item.bankReference, 128) || !nullableString(item.merchant, 160)) return { eventId, reasonCodes: ['invalid_event'] };
  if (item.bankDisplayedTime !== null && item.bankDisplayedTime !== undefined) {
    const bankTime = record(item.bankDisplayedTime);
    const bankTimeKeys = ['localDateTime', 'zone', 'precision', 'yearProvenance'] as const;
    if (!bankTime || !keysExactly(bankTime, bankTimeKeys) || !bankTimeKeys.every((key) => Object.prototype.hasOwnProperty.call(bankTime, key)) || !nullableNonEmptyString(bankTime.localDateTime, 40) || !nullableNonEmptyString(bankTime.zone, 64) || typeof bankTime.precision !== 'string' || !PRECISIONS.has(bankTime.precision) || typeof bankTime.yearProvenance !== 'string' || !YEAR_PROVENANCE.has(bankTime.yearProvenance)) return { eventId, reasonCodes: ['invalid_time'] };
  }
  const completeness = record(item.completeness);
  if (!completeness || !keysExactly(completeness, ['individualTimestamp', 'supportedSource', 'labeledMoney']) || typeof completeness.individualTimestamp !== 'boolean' || typeof completeness.supportedSource !== 'boolean' || typeof completeness.labeledMoney !== 'boolean') return { eventId, reasonCodes: ['invalid_event'] };
  return {
    schemaVersion: 1,
    eventId,
    observationId: item.observationId as string,
    sourceProfileId: item.sourceProfileId as string,
    parserVersion: item.parserVersion as string,
    notificationPostedAt: item.notificationPostedAt as string | null,
    capturedAt: item.capturedAt as string,
    eventTimeBasis: item.eventTimeBasis as BankAlertEventInput['eventTimeBasis'],
    eventType: item.eventType as BankAlertEventInput['eventType'],
    direction: item.direction as BankAlertEventInput['direction'],
    instrumentHint: (item.instrumentHint ?? null) as BankAlertEventInput['instrumentHint'],
    eventMoney: (item.eventMoney ?? null) as BankAlertEventInput['eventMoney'],
    primaryMoneyRole: item.primaryMoneyRole as BankAlertEventInput['primaryMoneyRole'],
    amounts: item.amounts as BankAlertEventInput['amounts'],
    feeTreatment: item.feeTreatment as BankAlertEventInput['feeTreatment'],
    bankReference: (item.bankReference ?? null) as string | null,
    bankDisplayedTime: (item.bankDisplayedTime ?? null) as BankAlertEventInput['bankDisplayedTime'],
    merchant: (item.merchant ?? null) as string | null,
    completeness: completeness as unknown as BankAlertEventInput['completeness'],
  };
}

type ParsedEvent = BankAlertEventInput | ValidationFailure;

export function parseAlertBatch(value: unknown): ParsedEvent[] {
  const body = record(value);
  if (!body || !keysExactly(body, ['events']) || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > MAX_ALERT_BATCH_SIZE) throw new AlertBatchError('invalid_request', 'The alert envelope must contain between 1 and 50 events.');
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_ALERT_BATCH_BYTES) throw new AlertBatchError('payload_too_large', 'The alert envelope is too large.');
  return body.events.map(parseEvent);
}

export class AlertBatchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AlertBatchError';
  }
}

function rejection(eventId: string, reasonCodes: string[]): IngestAck {
  return { eventId, status: 'rejected', receiptId: null, revision: null, projectionState: null, reasonCodes, error: { code: reasonCodes[0] ?? 'validation_failed', message: 'The event was rejected.', retryable: false } };
}

function receipt(row: ExistingReceiptRow, status: 'accepted' | 'replayed'): IngestAck {
  let reasonCodes: string[] = [];
  try { reasonCodes = row.reason_codes_json ? JSON.parse(row.reason_codes_json) as string[] : []; } catch { reasonCodes = ['invalid_receipt']; }
  return { eventId: row.event_id, status, receiptId: row.projection_id ? row.event_id : null, revision: row.revision, projectionState: row.projection_state, reasonCodes, error: null };
}

function conflict(eventId: string): IngestAck {
  return { eventId, status: 'conflict', receiptId: null, revision: null, projectionState: null, reasonCodes: ['idempotency_conflict'], error: { code: 'idempotency_conflict', message: 'The event ID is already bound to different content.', retryable: false } };
}

async function scopesFor(db: D1Database, context: CaptureContext, event: BankAlertEventInput): Promise<ScopeRow[]> {
  const currency = event.eventMoney?.currency;
  const result = await db.prepare(`SELECT ds.source_profile_id, ds.account_id, ds.currency, sp.status AS source_status,
      ds.instrument_hint_kind, ds.instrument_hint_value
    FROM device_source_scopes ds
    JOIN source_profiles sp ON sp.id = ds.source_profile_id
    WHERE ds.device_id = ? AND ds.source_profile_id = ? AND ds.status = 'approved'
      AND (? IS NULL OR ds.currency = ?)
      AND (ds.expires_at IS NULL OR ds.expires_at > CURRENT_TIMESTAMP)
    ORDER BY ds.account_id, ds.currency, ds.instrument_hint_kind, ds.instrument_hint_value`).bind(context.deviceId, event.sourceProfileId, currency ?? null, currency ?? null).all<ScopeRow>();
  return result.results.filter((row) => row.source_status === 'approved');
}

async function resolveScopedEvent(db: D1Database, context: CaptureContext, event: BankAlertEventInput, digest: string): Promise<ScopedEvent | ValidationFailure> {
  if (event.eventMoney && getCurrencyMeta(event.eventMoney.currency) === null) return { eventId: event.eventId, reasonCodes: ['invalid_currency'] };
  const rows = await scopesFor(db, context, event);
  const hint = event.instrumentHint;
  const matchingRows = rows.filter((row) => {
    const rowHint = row.instrument_hint_kind === 'none' && row.instrument_hint_value === ''
      ? null
      : { kind: row.instrument_hint_kind, value: row.instrument_hint_value };
    return rowHint?.kind === hint?.kind && rowHint?.value === hint?.value;
  });
  const accounts = [...new Set(matchingRows.map((row) => row.account_id))];
  if (matchingRows.length === 0 || accounts.length !== 1) return { eventId: event.eventId, reasonCodes: ['out_of_scope'] };
  const row = matchingRows[0];
  const mappingHint = row.instrument_hint_kind === 'none' && row.instrument_hint_value === ''
    ? null
    : { kind: row.instrument_hint_kind as 'card_suffix' | 'account_hint' | 'source_reference', value: row.instrument_hint_value };
  await assertCaptureEventScope(db, context, { sourceProfileId: event.sourceProfileId, accountId: row.account_id, currency: row.currency, instrumentHint: mappingHint });
  return {
    event,
    digest,
    accountId: row.account_id,
    scopeCurrency: row.currency,
    deviceId: context.deviceId,
    mapping: { accountId: row.account_id, sourceProfileId: event.sourceProfileId, approved: true, allowedCurrencies: [...new Set(rows.map((candidate) => candidate.currency))], instrumentHint: mappingHint },
  };
}

async function existingReceipt(db: D1Database, eventId: string, deviceId: string): Promise<ExistingReceiptRow | null> {
  return db.prepare(`SELECT e.event_id, e.payload_digest, p.id AS projection_id, p.state AS projection_state,
      p.reason_codes_json, p.revision, e.device_id
    FROM alert_events e LEFT JOIN alert_projections p ON p.event_id = e.event_id
    WHERE e.ledger_id = 'personal' AND e.event_id = ? AND e.device_id = ?`).bind(eventId, deviceId).first<ExistingReceiptRow>();
}

async function existingEventOwner(db: D1Database, eventId: string) {
  return db.prepare(`SELECT payload_digest, device_id FROM alert_events
    WHERE ledger_id = 'personal' AND event_id = ?`).bind(eventId).first<{ payload_digest: string; device_id: string | null }>();
}

function eventInsert(db: D1Database, scoped: ScopedEvent) {
  const event = scoped.event;
  const bankTime = event.bankDisplayedTime;
  return db.prepare(`INSERT INTO alert_events
    (id, ledger_id, device_id, event_id, observation_id, source_profile_id, parser_version, notification_posted_at, captured_at,
     event_time_basis, event_type, direction, instrument_hint_kind, instrument_hint_value, account_id,
     event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, bank_reference,
     bank_displayed_time, bank_displayed_zone, bank_displayed_precision, bank_year_provenance, merchant, completeness_json,
     payload_digest)
    VALUES (
      ?, 'personal',
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )`).bind(
    event.eventId, scoped.deviceId, event.eventId, event.observationId, event.sourceProfileId, event.parserVersion, event.notificationPostedAt,
    event.capturedAt, event.eventTimeBasis, event.eventType, event.direction, event.instrumentHint?.kind ?? null,
    event.instrumentHint?.value ?? null, scoped.accountId, event.eventMoney?.currency ?? null, event.eventMoney?.amountMinor ?? null,
    event.primaryMoneyRole, JSON.stringify(event.amounts), event.feeTreatment, event.bankReference ?? null,
    bankTime?.localDateTime ?? null, bankTime?.zone ?? null, bankTime?.precision ?? null, bankTime?.yearProvenance ?? null,
    event.merchant ?? null, JSON.stringify(event.completeness), scoped.digest,
  );
}

function guarded(db: D1Database, scoped: ScopedEvent, sql: string, values: readonly unknown[]) {
  return db.prepare(`${sql} WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.ledger_id = 'personal' AND e.event_id = ? AND e.device_id = ? AND e.payload_digest = ?)`).bind(...values, scoped.event.eventId, scoped.deviceId, scoped.digest);
}

function projectionStatements(db: D1Database, scoped: ScopedEvent, projection: ReturnType<typeof deriveAlertProjection>, resolution: StatementResolution = { candidates: [], auto: null }): D1Statement[] {
  const event = scoped.event;
  const transaction = projection.transaction;
  const statements: D1Statement[] = [];
  const projectionTransactionId = transaction?.id ?? null;
  if (transaction) {
    statements.push(guarded(db, scoped, `INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, fx_lock_date)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`, [event.eventId, transaction.accountId, transaction.date, transaction.merchant, transaction.amountMinor, transaction.currency, transaction.category, transaction.kind, transaction.status, transaction.source, transaction.fingerprint, transaction.date]));
    statements.push(guarded(db, scoped, `INSERT INTO transaction_source_records
      (id, ledger_id, source_kind, identity_key, transaction_id, account_id, event_id, content_digest)
      SELECT ?, 'personal', 'alert', ?, ?, ?, ?, ?`, [`source-record:${event.eventId}`, `alert:personal:${event.eventId}`, event.eventId, transaction.accountId, event.eventId, scoped.digest]));
  }
  statements.push(guarded(db, scoped, `INSERT INTO alert_projections
    (id, ledger_id, event_id, transaction_id, state, reason_codes_json, counted_currency, counted_amount_minor, revision)
    SELECT ?, 'personal', ?, ?, ?, ?, ?, ?, 1`, [event.eventId, event.eventId, projectionTransactionId, projection.state, JSON.stringify(projection.reasonCodes), projection.countedMoney?.currency ?? null, projection.countedMoney?.amountMinor ?? null]));
  statements.push(guarded(db, scoped, `INSERT INTO alert_projection_provenance
    (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
    SELECT ?, 'personal', ?, 'alert', ?, 'alert_event', ?`, [`${event.eventId}:alert:${event.eventId}:1`, event.eventId, event.eventId, 1]));
  for (const match of resolution.candidates) {
    const candidateId = `statement-candidate:${encodeURIComponent(`${match.sourceRecordId}:${event.eventId}`)}`;
    statements.push(guarded(db, scoped, `INSERT INTO statement_reconciliation_candidates
      (id, ledger_id, source_record_id, statement_transaction_id, candidate_transaction_id, score, reason_codes_json, evidence_basis, status)
      SELECT ?, 'personal', ?, ?, ?, ?, ?, ?, 'open'`, [candidateId, match.sourceRecordId, match.statementTransactionId, event.eventId, match.score, JSON.stringify(match.reasonCodes), match.basis]));
  }
  if (resolution.auto && transaction) {
    const linkId = `alert-review:${encodeURIComponent(`${event.eventId}:${resolution.auto.statementTransactionId}`)}`;
    const linkExists = `(SELECT 1 FROM alert_event_links WHERE id = '${linkId.replace(/'/g, "''")}' AND relation = 'confirms')`;
    statements.push(db.prepare(`INSERT INTO alert_event_links
      (id, ledger_id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
      SELECT ?, 'personal', ?, ?, 'confirms', 'bank_reference', 2
      WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.ledger_id = 'personal' AND e.event_id = ? AND e.device_id = ? AND e.payload_digest = ?)
        AND NOT EXISTS (SELECT 1 FROM alert_event_links existing
          WHERE existing.ledger_id = 'personal' AND existing.relation = 'confirms'
            AND (existing.from_event_id = ? OR existing.to_transaction_id = ?))`)
      .bind(linkId, event.eventId, resolution.auto.statementTransactionId, event.eventId, scoped.deviceId, scoped.digest, event.eventId, resolution.auto.statementTransactionId));
    statements.push(db.prepare(`UPDATE alert_projections SET transaction_id = ?, state = 'superseded', reason_codes_json = ?, counted_currency = NULL, counted_amount_minor = NULL, revision = 2, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revision = 1 AND EXISTS ${linkExists}`)
      .bind(resolution.auto.statementTransactionId, JSON.stringify(['confirmed_elsewhere']), event.eventId));
    statements.push(db.prepare(`UPDATE transactions SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND source = 'statement' AND EXISTS ${linkExists}`)
      .bind(resolution.auto.statementTransactionId));
    statements.push(db.prepare(`INSERT INTO alert_projection_provenance
      (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      SELECT ?, 'personal', ?, 'statement', ?, 'statement', 2
      WHERE EXISTS ${linkExists}`)
      .bind(`${event.eventId}:statement:${resolution.auto.sourceRecordId}:2`, event.eventId, resolution.auto.sourceRecordId));
    statements.push(db.prepare(`UPDATE transactions SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND source = 'alert'
        AND EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ?)
        AND EXISTS ${linkExists}`)
        .bind(event.eventId, event.eventId));
    statements.push(db.prepare(`DELETE FROM transactions
      WHERE id = ? AND source = 'alert'
        AND NOT EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ?)
        AND NOT EXISTS (SELECT 1 FROM alert_projections other WHERE other.transaction_id = ? AND other.event_id <> ?)
        AND NOT EXISTS (SELECT 1 FROM alert_event_links existing WHERE existing.to_transaction_id = ?)
        AND EXISTS ${linkExists}`)
      .bind(event.eventId, event.eventId, event.eventId, event.eventId, event.eventId));
  }
  return statements;
}

function digestStatement(db: D1Database, scoped: ScopedEvent) {
  return db.prepare(`INSERT INTO alert_event_digests (event_id, algorithm, digest)
    SELECT ?, 'payload-sha256', ? WHERE EXISTS (
      SELECT 1 FROM alert_events WHERE ledger_id = 'personal' AND event_id = ? AND device_id = ? AND payload_digest = ?
    )`).bind(scoped.event.eventId, scoped.digest, scoped.event.eventId, scoped.deviceId, scoped.digest);
}

async function readStoredReceipts(db: D1Database, eventIds: readonly string[], deviceId: string) {
  const rows = new Map<string, ExistingReceiptRow>();
  for (const eventId of eventIds) {
    const row = await existingReceipt(db, eventId, deviceId);
    if (row) rows.set(eventId, row);
  }
  return rows;
}

export async function ingestAlertBatch(db: D1Database, context: CaptureContext, value: unknown, retryOnUnique = true): Promise<IngestBatchResponse> {
  const events = parseAlertBatch(value);
  const acks: Array<IngestAck | null> = Array.from({ length: events.length }, () => null);
  const firstIndex = new Map<string, number>();
  const eventDigests = new Map<string, string>();
  const pending: ScopedEvent[] = [];
  const pendingIndex = new Map<string, number>();
  for (const [index, candidate] of events.entries()) {
    if ('reasonCodes' in candidate) {
      acks[index] = rejection(candidate.eventId, candidate.reasonCodes);
      continue;
    }
    const event = candidate;
    const digest = await requestDigest(event);
    const scoped = await resolveScopedEvent(db, context, event, digest);
    if ('reasonCodes' in scoped) {
      acks[index] = rejection(event.eventId, scoped.reasonCodes);
      continue;
    }
    const priorDigest = eventDigests.get(event.eventId);
    if (priorDigest !== undefined) {
      acks[index] = priorDigest === digest ? { ...(acks[firstIndex.get(event.eventId)!] as IngestAck), status: 'replayed' } : conflict(event.eventId);
      continue;
    }
    eventDigests.set(event.eventId, digest);
    firstIndex.set(event.eventId, index);
    const existing = await existingReceipt(db, event.eventId, context.deviceId);
    if (existing) {
      acks[index] = existing.payload_digest === digest ? receipt(existing, 'replayed') : conflict(event.eventId);
      continue;
    }
    if (await existingEventOwner(db, event.eventId)) {
      acks[index] = conflict(event.eventId);
      continue;
    }
    pending.push(scoped);
    pendingIndex.set(event.eventId, index);
    acks[index] = receipt({ event_id: event.eventId, device_id: context.deviceId, payload_digest: digest, projection_id: event.eventId, projection_state: null, reason_codes_json: '[]', revision: 1 }, 'accepted');
  }

  if (pending.length > 0) {
    const statements: D1Statement[] = [];
    const insertIndexes = new Map<string, number>();
    const reservedStatementMatches = new Set<string>();
    for (const scoped of pending) {
      insertIndexes.set(scoped.event.eventId, statements.length);
      statements.push(eventInsert(db, scoped));
      statements.push(digestStatement(db, scoped));
      const projection = deriveAlertProjection(scoped.event, scoped.mapping, []);
      let resolution: StatementResolution = { candidates: [], auto: null };
      if (projection.transaction) {
        const matches = await findAlertStatementMatches(db, {
          accountId: scoped.accountId,
          date: projection.transaction.date,
          merchant: projection.transaction.merchant,
          amountMinor: projection.transaction.amountMinor,
          currency: projection.transaction.currency,
          kind: projection.transaction.kind,
          bankReference: scoped.event.bankReference ?? null,
        });
        const bankMatches = matches.filter((match) => match.basis === 'bank_reference');
        if (bankMatches.length === 1 && !reservedStatementMatches.has(bankMatches[0].statementTransactionId)) {
          const occupied = await db.prepare(`SELECT id FROM alert_event_links
            WHERE ledger_id = ? AND relation = 'confirms' AND to_transaction_id = ? LIMIT 1`)
            .bind('personal', bankMatches[0].statementTransactionId).first<{ id: string }>();
          if (!occupied) {
            resolution = { candidates: [bankMatches[0]], auto: bankMatches[0] };
            reservedStatementMatches.add(bankMatches[0].statementTransactionId);
          } else {
            resolution = { candidates: matches, auto: null };
          }
        } else {
          resolution = { candidates: matches, auto: null };
        }
      }
      statements.push(...projectionStatements(db, scoped, projection, resolution));
    }
    let batchResults: D1Result[] | null = null;
    try {
      batchResults = await db.batch(statements);
    } catch (error) {
      const rows = await readStoredReceipts(db, pending.map((item) => item.event.eventId), context.deviceId);
      const owners = new Map<string, { payload_digest: string; device_id: string | null }>();
      for (const scoped of pending) {
        const owner = await existingEventOwner(db, scoped.event.eventId);
        if (owner) owners.set(scoped.event.eventId, owner);
      }
      const reconciled = pending.every((scoped) => {
        const stored = rows.get(scoped.event.eventId);
        const owner = owners.get(scoped.event.eventId);
        const slot = pendingIndex.get(scoped.event.eventId)!;
        if (stored?.payload_digest === scoped.digest) {
          acks[slot] = receipt(stored, 'replayed');
          return true;
        }
        if (owner) {
          acks[slot] = conflict(scoped.event.eventId);
          return true;
        }
        return false;
      });
      if (!reconciled && isReconciliationUniqueConflict(error) && retryOnUnique) {
        const retry = await ingestAlertBatch(db, context, { events: pending.map((item) => item.event) }, false);
        for (const [pendingSlot, scoped] of pending.entries()) {
          const slot = pendingIndex.get(scoped.event.eventId)!;
          const finalAck = retry.acks[pendingSlot];
          acks[slot] = finalAck;
          for (const [index, candidate] of events.entries()) {
            if (!('reasonCodes' in candidate) && candidate.eventId === scoped.event.eventId && index !== slot && acks[index]?.status !== 'conflict') acks[index] = { ...finalAck, status: 'replayed' };
          }
        }
      } else if (!reconciled && isReconciliationUniqueConflict(error)) {
        for (const scoped of pending) acks[pendingIndex.get(scoped.event.eventId)!] = conflict(scoped.event.eventId);
      } else if (!reconciled) {
        throw error;
      }
    }
    if (batchResults) {
      const rows = await readStoredReceipts(db, pending.map((item) => item.event.eventId), context.deviceId);
      for (const scoped of pending) {
        const stored = rows.get(scoped.event.eventId);
        if (!stored) throw new Error('Alert ingestion commit did not produce a receipt.');
        if (stored.payload_digest !== scoped.digest) {
          acks[pendingIndex.get(scoped.event.eventId)!] = conflict(scoped.event.eventId);
        } else {
          const slot = pendingIndex.get(scoped.event.eventId)!;
          const inserted = Number(batchResults[insertIndexes.get(scoped.event.eventId)!]?.meta?.changes ?? 1) > 0;
          const finalAck = receipt(stored, inserted ? 'accepted' : 'replayed');
          acks[slot] = finalAck;
          for (const [index, candidate] of events.entries()) {
            if (!('reasonCodes' in candidate) && candidate.eventId === scoped.event.eventId && index !== slot && acks[index]?.status !== 'conflict') acks[index] = { ...finalAck, status: 'replayed' };
          }
        }
      }
    }
  }

  return { acks: acks.map((ack, index) => ack ?? rejection('event-' + index, ['invalid_event'])) };
}

async function scopedStatusRows(db: D1Database, context: CaptureContext) {
  return db.prepare(`SELECT source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value FROM device_source_scopes
    WHERE device_id = ? AND status = 'approved' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value`).bind(context.deviceId).all<{
      source_profile_id: string;
      account_id: string;
      currency: string;
      instrument_hint_kind: string;
      instrument_hint_value: string;
    }>();
}

export async function readCaptureStatus(db: D1Database, context: CaptureContext, eventId?: string | null): Promise<{ deviceId: string; credentialExpiresAt: string; ingestionState: 'ready'; lastAcceptedAt: string | null; receipt: IngestAck | null }> {
  const credentialExpiresAt = normalizeRfc3339Instant(context.expiresAt);
  if (!credentialExpiresAt) throw new Error('The capture credential expiry is not a valid RFC3339 instant.');
  const scopes = await scopedStatusRows(db, context);
  if (scopes.results.length === 0) return { deviceId: context.deviceId, credentialExpiresAt, ingestionState: 'ready', lastAcceptedAt: null, receipt: null };
  const clauses = scopes.results.map(() => `(e.source_profile_id = ? AND e.account_id = ? AND (e.event_money_currency = ? OR e.event_money_currency IS NULL) AND COALESCE(e.instrument_hint_kind, 'none') = ? AND COALESCE(e.instrument_hint_value, '') = ?)`).join(' OR ');
  const bindings = scopes.results.flatMap((scope) => [
    scope.source_profile_id,
    scope.account_id,
    scope.currency,
    scope.instrument_hint_kind,
    scope.instrument_hint_value,
  ]);
  const query = eventId ? ` AND e.event_id = ?` : '';
  const rows = await db.prepare(`SELECT e.event_id, e.payload_digest, p.id AS projection_id, p.state AS projection_state,
      p.reason_codes_json, p.revision, e.created_at
    FROM alert_events e LEFT JOIN alert_projections p ON p.event_id = e.event_id
    WHERE e.ledger_id = 'personal' AND e.device_id = ? AND (${clauses})${query}
    ORDER BY e.created_at DESC, e.event_id DESC LIMIT 1`).bind(context.deviceId, ...bindings, ...(eventId ? [eventId] : [])).all<ExistingReceiptRow & { created_at: string }>();
  const row = rows.results[0];
  return {
    deviceId: context.deviceId,
    credentialExpiresAt,
    ingestionState: 'ready',
    lastAcceptedAt: row?.created_at ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(row.created_at) ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`).toISOString() : null,
    receipt: row ? receipt(row, 'replayed') : null,
  };
}

