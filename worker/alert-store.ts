import type { AlertEventRelation, AlertEventState, AlertProjectionProvenanceInput, CurrencyCode, D1Database, LedgerId } from './db-types';

export const MAX_ALERT_BATCH_SIZE = 50;
export const MAX_ALERT_BATCH_BYTES = 128 * 1024;

type EventTimeBasis = 'notification_posted' | 'bank_transaction_date' | 'statement_posting_date' | 'unresolved';
type EventType = 'purchase_notice' | 'authorization_reversal' | 'declined' | 'refund_notice' | 'hold_notice' | 'adjustment_notice' | 'repayment_notice' | 'transfer_notice' | 'fee_notice' | 'unknown';
type Direction = 'outflow' | 'inflow' | 'none' | 'unknown';
type MoneyRole = 'transaction' | 'authorization' | 'billing' | 'fee';
type FeeTreatment = 'included' | 'separate' | 'unknown';

export interface AlertEventStorageInput {
  id: string;
  ledgerId: LedgerId;
  eventId: string;
  observationId: string;
  sourceProfileId: string;
  parserVersion: string;
  notificationPostedAt: string | null;
  capturedAt: string;
  eventTimeBasis: EventTimeBasis;
  eventType: EventType;
  direction: Direction;
  instrumentHintKind?: string | null;
  instrumentHintValue?: string | null;
  accountId?: string | null;
  eventMoneyCurrency?: CurrencyCode | null;
  eventMoneyAmountMinor?: number | null;
  primaryMoneyRole?: MoneyRole | null;
  amountsJson: string;
  feeTreatment: FeeTreatment;
  bankReference?: string | null;
  bankDisplayedTime?: string | null;
  bankDisplayedZone?: string | null;
  bankDisplayedPrecision?: string | null;
  bankYearProvenance?: string | null;
  merchant?: string | null;
  completenessJson: string;
  payloadDigest: string;
}

export interface AlertProjectionStorageInput {
  id: string;
  ledgerId?: LedgerId;
  eventId: string;
  transactionId?: string | null;
  state: AlertEventState;
  reasonCodes: readonly string[];
  countedCurrency?: CurrencyCode | null;
  countedAmountMinor?: number | null;
  revision: number;
  provenance?: readonly AlertProjectionProvenanceInput[];
}

export interface AlertEventLinkStorageInput {
  id: string;
  ledgerId?: LedgerId;
  fromEventId: string;
  toEventId?: string | null;
  toTransactionId?: string | null;
  relation: AlertEventRelation;
  allocatedCurrency?: CurrencyCode | null;
  allocatedAmountMinor?: number | null;
  evidenceBasis: 'bank_reference' | 'user_review';
  revision: number;
}

export type TransactionSourceKind = 'plaid' | 'statement' | 'alert' | 'manual' | 'legacy';

export interface TransactionSourceRecordInput {
  id: string;
  ledgerId?: LedgerId;
  sourceKind: TransactionSourceKind;
  transactionId: string;
  accountId: string;
  providerItemId?: string | null;
  providerTransactionId?: string | null;
  providerPendingTransactionId?: string | null;
  bankSourceId?: string | null;
  bankRowId?: string | null;
  fileSha256?: string | null;
  rowIndex?: number | null;
  eventId?: string | null;
  manualId?: string | null;
  contentDigest: string;
}

const EVENT_TYPES = new Set<EventType>([
  'purchase_notice', 'authorization_reversal', 'declined', 'refund_notice', 'hold_notice',
  'adjustment_notice', 'repayment_notice', 'transfer_notice', 'fee_notice', 'unknown',
]);
const DIRECTIONS = new Set<Direction>(['outflow', 'inflow', 'none', 'unknown']);
const MONEY_ROLES = new Set<MoneyRole>(['transaction', 'authorization', 'billing', 'fee']);
const FEE_TREATMENTS = new Set<FeeTreatment>(['included', 'separate', 'unknown']);
const ALERT_STATES = new Set<AlertEventState>(['provisional', 'non_spending', 'needs_review', 'voided', 'superseded']);
const LINK_RELATIONS = new Set<AlertEventRelation>(['cancels', 'partially_reverses', 'replaces_authorization', 'refund_of', 'confirms', 'possible_duplicate']);

function boundedText(value: string | null | undefined, field: string, max = 2048): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

function requiredText(value: string, field: string, max = 2048) {
  const normalized = boundedText(value, field, max);
  if (!normalized) throw new RangeError(`${field} is required.`);
  return normalized;
}

function safeMinor(value: number | null | undefined, field: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${field} must be a safe integer.`);
  return value;
}

function boundedJson(value: string, field: string, max = MAX_ALERT_BATCH_BYTES) {
  requiredText(value, field, max);
  try {
    JSON.parse(value);
  } catch {
    throw new TypeError(`${field} must be JSON.`);
  }
  return value;
}

function validateEvent(event: AlertEventStorageInput) {
  requiredText(event.id, 'event id', 256);
  requiredText(event.eventId, 'event identity', 256);
  if (event.id !== event.eventId) throw new RangeError('Storage event ID must equal the immutable event identity.');
  requiredText(event.observationId, 'observation identity', 256);
  requiredText(event.sourceProfileId, 'source profile', 256);
  requiredText(event.parserVersion, 'parser version', 128);
  requiredText(event.capturedAt, 'captured at', 64);
  boundedText(event.notificationPostedAt, 'notification posted at', 64);
  if (!EVENT_TYPES.has(event.eventType)) throw new RangeError('Unsupported alert event type.');
  if (!DIRECTIONS.has(event.direction)) throw new RangeError('Unsupported alert direction.');
  if (!MONEY_ROLES.has(event.primaryMoneyRole as MoneyRole) && event.primaryMoneyRole !== null && event.primaryMoneyRole !== undefined) throw new RangeError('Unsupported money role.');
  if (!FEE_TREATMENTS.has(event.feeTreatment)) throw new RangeError('Unsupported fee treatment.');
  boundedText(event.instrumentHintKind, 'instrument hint kind', 64);
  boundedText(event.instrumentHintValue, 'instrument hint value', 256);
  boundedText(event.accountId, 'account id', 256);
  boundedText(event.eventMoneyCurrency, 'event currency', 12);
  safeMinor(event.eventMoneyAmountMinor, 'event amount');
  boundedJson(event.amountsJson, 'amounts JSON');
  boundedText(event.bankReference, 'bank reference', 512);
  boundedText(event.bankDisplayedTime, 'bank displayed time', 40);
  boundedText(event.bankDisplayedZone, 'bank displayed zone', 64);
  boundedText(event.bankDisplayedPrecision, 'bank displayed precision', 32);
  boundedText(event.bankYearProvenance, 'bank year provenance', 32);
  boundedText(event.merchant, 'merchant', 512);
  boundedJson(event.completenessJson, 'completeness JSON');
  requiredText(event.payloadDigest, 'payload digest', 256);
}

function eventStatement(db: D1Database, event: AlertEventStorageInput) {
  return db.prepare(`INSERT INTO alert_events
    (id, ledger_id, event_id, observation_id, source_profile_id, parser_version, notification_posted_at, captured_at,
     event_time_basis, event_type, direction, instrument_hint_kind, instrument_hint_value, account_id,
     event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, bank_reference,
     bank_displayed_time, bank_displayed_zone, bank_displayed_precision, bank_year_provenance, merchant, completeness_json,
     payload_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    event.id,
    event.ledgerId,
    event.eventId,
    event.observationId,
    event.sourceProfileId,
    event.parserVersion,
    event.notificationPostedAt ?? null,
    event.capturedAt,
    event.eventTimeBasis,
    event.eventType,
    event.direction,
    event.instrumentHintKind ?? null,
    event.instrumentHintValue ?? null,
    event.accountId ?? null,
    event.eventMoneyCurrency ?? null,
    event.eventMoneyAmountMinor ?? null,
    event.primaryMoneyRole ?? null,
    event.amountsJson,
    event.feeTreatment,
    event.bankReference ?? null,
    event.bankDisplayedTime ?? null,
    event.bankDisplayedZone ?? null,
    event.bankDisplayedPrecision ?? null,
    event.bankYearProvenance ?? null,
    event.merchant ?? null,
    event.completenessJson,
    event.payloadDigest,
  );
}

export async function appendAlertEventBatch(db: D1Database, events: readonly AlertEventStorageInput[]) {
  if (events.length < 1 || events.length > MAX_ALERT_BATCH_SIZE) throw new RangeError(`Alert batches are limited to ${MAX_ALERT_BATCH_SIZE} events.`);
  const encoded = JSON.stringify(events);
  if (new TextEncoder().encode(encoded).byteLength > MAX_ALERT_BATCH_BYTES) throw new RangeError('Alert batch exceeds 128 KiB.');
  events.forEach(validateEvent);
  const statements = events.flatMap((event) => [
    eventStatement(db, event),
    db.prepare(`INSERT INTO alert_event_digests (event_id, algorithm, digest)
      VALUES (?, 'payload-sha256', ?)`).bind(event.id, event.payloadDigest),
  ]);
  await db.batch(statements);
  return { acceptedEventIds: events.map((event) => event.eventId) };
}

export async function appendAlertProjection(db: D1Database, input: AlertProjectionStorageInput) {
  if (!ALERT_STATES.has(input.state)) throw new RangeError('Unsupported alert projection state.');
  requiredText(input.id, 'projection id', 256);
  requiredText(input.eventId, 'projection event id', 256);
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new RangeError('Projection revision must be positive.');
  safeMinor(input.countedAmountMinor, 'counted amount');
  const reasonCodesJson = JSON.stringify(input.reasonCodes.slice(0, 32));
  boundedJson(reasonCodesJson, 'reason codes JSON');
  const statements = [db.prepare(`INSERT INTO alert_projections
    (id, ledger_id, event_id, transaction_id, state, reason_codes_json, counted_currency, counted_amount_minor, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    input.id,
    input.ledgerId ?? 'personal',
    input.eventId,
    input.transactionId ?? null,
    input.state,
    reasonCodesJson,
    input.countedCurrency ?? null,
    input.countedAmountMinor ?? null,
    input.revision,
  )];
  for (const provenance of input.provenance ?? []) {
    const sourceKind = requiredText(provenance.sourceKind, 'provenance source kind', 64);
    const sourceId = requiredText(provenance.sourceId, 'provenance source id', 256);
    statements.push(db.prepare(`INSERT INTO alert_projection_provenance
      (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      `${input.id}:${sourceKind}:${sourceId}:${input.revision}`.slice(0, 512),
      input.ledgerId ?? 'personal',
      input.id,
      sourceKind,
      sourceId,
      provenance.basis,
      input.revision,
    ));
  }
  await db.batch(statements);
}

export async function appendAlertEventLink(db: D1Database, input: AlertEventLinkStorageInput) {
  if (!LINK_RELATIONS.has(input.relation)) throw new RangeError('Unsupported alert link relation.');
  requiredText(input.id, 'link id', 256);
  requiredText(input.fromEventId, 'link source event', 256);
  const hasEventTarget = Boolean(input.toEventId);
  const hasTransactionTarget = Boolean(input.toTransactionId);
  if (hasEventTarget === hasTransactionTarget) throw new RangeError('Alert links need exactly one target.');
  if (input.toEventId === input.fromEventId) throw new RangeError('Alert event links cannot self-reference.');
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new RangeError('Link revision must be positive.');
  safeMinor(input.allocatedAmountMinor, 'allocated amount');

  if (input.toEventId) {
    const cycle = await db.prepare(`WITH RECURSIVE reachable(id) AS (
      SELECT ?
      UNION ALL
      SELECT l.to_event_id FROM alert_event_links l JOIN reachable r ON l.from_event_id = r.id WHERE l.to_event_id IS NOT NULL
    ) SELECT id FROM reachable WHERE id = ? LIMIT 1`).bind(input.toEventId, input.fromEventId).all<{ id: string }>();
    if (cycle.results.length > 0) throw new Error('Alert event link would create a cycle.');
  }
  await db.prepare(`INSERT INTO alert_event_links
    (id, ledger_id, from_event_id, to_event_id, to_transaction_id, relation, allocated_currency, allocated_amount_minor, evidence_basis, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    input.id,
    input.ledgerId ?? 'personal',
    input.fromEventId,
    input.toEventId ?? null,
    input.toTransactionId ?? null,
    input.relation,
    input.allocatedCurrency ?? null,
    input.allocatedAmountMinor ?? null,
    input.evidenceBasis,
    input.revision,
  ).run();
}

function sourceIdentity(input: TransactionSourceRecordInput) {
  if (input.sourceKind === 'plaid') {
    if (!input.providerItemId || (!input.providerTransactionId && !input.providerPendingTransactionId)) throw new RangeError('Plaid source records need Item and transaction identity.');
    return `plaid:${input.providerItemId}:${input.providerTransactionId ?? `pending:${input.providerPendingTransactionId}`}`;
  }
  if (input.sourceKind === 'statement') {
    if (input.bankSourceId && input.bankRowId) return `statement:${input.accountId}:${input.bankSourceId}:${input.bankRowId}`;
    if (input.fileSha256 && Number.isInteger(input.rowIndex) && (input.rowIndex ?? -1) >= 0) return `statement:${input.accountId}:${input.fileSha256}:${input.rowIndex}`;
    throw new RangeError('Statement source records need a bank row or file row identity.');
  }
  if (input.sourceKind === 'alert') {
    if (input.ledgerId !== undefined && input.ledgerId !== 'personal') throw new RangeError('Alert source records use the personal ledger.');
    if (!input.eventId) throw new RangeError('Alert source records need an event identity.');
    return `alert:personal:${input.eventId}`;
  }
  if (input.sourceKind === 'manual') {
    if (!input.manualId) throw new RangeError('Manual source records need a random identity.');
    return `manual:${input.manualId}`;
  }
  return `legacy:${input.transactionId}`;
}

export async function appendTransactionSourceRecord(db: D1Database, input: TransactionSourceRecordInput) {
  const identityKey = sourceIdentity(input);
  requiredText(input.id, 'source record id', 256);
  requiredText(input.transactionId, 'source transaction id', 256);
  requiredText(input.accountId, 'source account id', 256);
  requiredText(input.contentDigest, 'source content digest', 256);
  boundedText(input.providerItemId, 'provider Item id', 256);
  boundedText(input.providerTransactionId, 'provider transaction id', 256);
  boundedText(input.providerPendingTransactionId, 'provider pending transaction id', 256);
  boundedText(input.bankSourceId, 'bank source id', 256);
  boundedText(input.bankRowId, 'bank row id', 256);
  boundedText(input.fileSha256, 'file hash', 256);
  boundedText(input.eventId, 'source event id', 256);
  boundedText(input.manualId, 'manual source id', 256);
  if (input.rowIndex !== null && input.rowIndex !== undefined && (!Number.isInteger(input.rowIndex) || input.rowIndex < 0)) throw new RangeError('Source row index is not valid.');
  const transaction = await db.prepare('SELECT account_id FROM transactions WHERE id = ? LIMIT 1').bind(input.transactionId).all<{ account_id: string }>();
  if (transaction.results[0]?.account_id !== input.accountId) throw new RangeError('Source record account must match its transaction.');
  await db.prepare(`INSERT INTO transaction_source_records
    (id, ledger_id, source_kind, identity_key, transaction_id, account_id, provider_item_id, provider_transaction_id,
     provider_pending_transaction_id, bank_source_id, bank_row_id, file_sha256, row_index, event_id, manual_id, content_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    input.id,
    input.ledgerId ?? 'personal',
    input.sourceKind,
    identityKey,
    input.transactionId,
    input.accountId,
    input.providerItemId ?? null,
    input.providerTransactionId ?? null,
    input.providerPendingTransactionId ?? null,
    input.bankSourceId ?? null,
    input.bankRowId ?? null,
    input.fileSha256 ?? null,
    input.rowIndex ?? null,
    input.eventId ?? null,
    input.manualId ?? null,
    input.contentDigest,
  ).run();
}
