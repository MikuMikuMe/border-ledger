import { assertCaptureAuthority, assertCaptureScope, captureScopePredicate, capturePublicationGuard, immutableCaptureContext } from './capture-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';
import { deriveAlertProjection, type BankAlertEventInput, type InstrumentMapping } from '../src/domain/bank-alerts';
import { getCurrencyMeta } from '../src/domain/currencies';
import { type CaptureScopeRecord, normalizeRfc3339Instant, parseRfc3339Instant, requestDigest, assertCaptureEventScope, type CaptureContext } from './mobile-auth';
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
  context:CaptureContext;
  internalId:string;
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

async function scopesFor(db:D1Database,context:CaptureContext,event:BankAlertEventInput):Promise<ScopeRow[]> {
  const candidates=context.sourceScopes.filter(scope=>scope.sourceProfileId===event.sourceProfileId && (!event.eventMoney || scope.currency===event.eventMoney.currency));
  const rows:ScopeRow[]=[];
  for(const scope of candidates) {
    const guard=captureScopePredicate(context,scope);
    if(await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(
      ...guard.bindings,
    ).first())rows.push({source_profile_id:scope.sourceProfileId,account_id:scope.accountId,currency:scope.currency,source_status:'approved',instrument_hint_kind:scope.instrumentHint?.kind??'none',instrument_hint_value:scope.instrumentHint?.value??''});
  }
  return rows;
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
    context,internalId:await ledgerScopedIdentifier(context,'alert-event',event.eventId),
    event,
    digest,
    accountId: row.account_id,
    scopeCurrency: row.currency,
    deviceId: context.deviceId,
    mapping: { accountId: row.account_id, sourceProfileId: event.sourceProfileId, approved: true, allowedCurrencies: [...new Set(rows.map((candidate) => candidate.currency))], instrumentHint: mappingHint },
  };
}

async function existingReceipt(db:D1Database,context:CaptureContext,eventId:string):Promise<ExistingReceiptRow|null> {
  return db.prepare(`SELECT COALESCE(e.raw_event_id,e.event_id) AS event_id,e.payload_digest,p.id AS projection_id,p.state AS projection_state,p.reason_codes_json,p.revision,e.device_id
    FROM alert_events e LEFT JOIN alert_projections p ON p.event_id=e.id AND p.ledger_id=e.ledger_id
    WHERE e.ledger_id=? AND COALESCE(e.raw_event_id,e.event_id)=? AND e.device_id=?`).bind(
      context.ledgerId,
      eventId,
      context.deviceId,
    ).first<ExistingReceiptRow>();
}
async function existingEventOwner(db:D1Database,context:CaptureContext,eventId:string) {
  return db.prepare('SELECT payload_digest,device_id FROM alert_events WHERE ledger_id=? AND COALESCE(raw_event_id,event_id)=?').bind(
    context.ledgerId,
    eventId,
  ).first<{payload_digest:string;device_id:string|null}>();
}
function eventInsert(db:D1Database,scoped:ScopedEvent) {
  const event = scoped.event;
  const bankTime = event.bankDisplayedTime;
  return db.prepare(`INSERT INTO alert_events
    (id,ledger_id,device_id,event_id,raw_event_id,observation_id,source_profile_id,parser_version,notification_posted_at,captured_at,
    event_time_basis,event_type,direction,instrument_hint_kind,instrument_hint_value,account_id,event_money_currency,event_money_amount_minor,
    primary_money_role,amounts_json,fee_treatment,bank_reference,bank_displayed_time,bank_displayed_zone,bank_displayed_precision,bank_year_provenance,merchant,completeness_json,payload_digest)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      scoped.internalId,
      scoped.context.ledgerId,
      scoped.deviceId,
      scoped.internalId,
      event.eventId,
      event.observationId,
      event.sourceProfileId,
      event.parserVersion,
      event.notificationPostedAt,
      event.capturedAt,
      event.eventTimeBasis,
      event.eventType,
      event.direction,
      event.instrumentHint?.kind??null,
      event.instrumentHint?.value??null,
      scoped.accountId,
      event.eventMoney?.currency??null,
      event.eventMoney?.amountMinor??null,
      event.primaryMoneyRole,
      JSON.stringify(event.amounts),
      event.feeTreatment,
      event.bankReference??null,
      bankTime?.localDateTime??null,
      bankTime?.zone??null,
      bankTime?.precision??null,
      bankTime?.yearProvenance??null,
      event.merchant??null,
      JSON.stringify(event.completeness),
      scoped.digest,
    );
}
function guarded(db:D1Database,scoped:ScopedEvent,sql:string,values:readonly unknown[]) {
  return db.prepare(`${sql} WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.ledger_id=? AND e.id=? AND e.device_id=? AND e.payload_digest=?)`).bind(
    ...values,
    scoped.context.ledgerId,
    scoped.internalId,
    scoped.deviceId,
    scoped.digest,
  );
}
function automaticConfirmationStatements(db:D1Database,scoped:ScopedEvent,match:AlertStatementMatch):D1Statement[] {
  const id = scoped.internalId;
  const ledger = scoped.context.ledgerId;
  const linkId=`alert-review:${encodeURIComponent(`${id}:${match.statementTransactionId}`)}`;
  const linkExists="EXISTS (SELECT 1 FROM alert_event_links WHERE id=? AND ledger_id=? AND relation='confirms')";
  return [
    db.prepare(`INSERT INTO alert_event_links(id,ledger_id,from_event_id,to_transaction_id,relation,evidence_basis,revision)
      SELECT ?,?,?,?,'confirms','bank_reference',2 WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.ledger_id=? AND e.id=? AND e.device_id=? AND e.payload_digest=?)
      AND NOT EXISTS (SELECT 1 FROM alert_event_links WHERE ledger_id=? AND relation='confirms' AND (from_event_id=? OR to_transaction_id=?))`)
      .bind(linkId,ledger,id,match.statementTransactionId,ledger,id,scoped.deviceId,scoped.digest,ledger,id,match.statementTransactionId),
    db.prepare(`UPDATE alert_projections SET transaction_id=?,state='superseded',reason_codes_json=?,counted_currency=NULL,counted_amount_minor=NULL,revision=2,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=? AND revision=1 AND ${linkExists}`).bind(
      match.statementTransactionId,
      JSON.stringify(['confirmed_elsewhere']),
      id,
      ledger,
      linkId,
      ledger,
    ),
    db.prepare(`UPDATE transactions SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=? AND source='statement' AND ${linkExists}`).bind(
      match.statementTransactionId,
      ledger,
      linkId,
      ledger,
    ),
    db.prepare(`INSERT INTO alert_projection_provenance(id,ledger_id,projection_id,source_kind,source_id,basis,revision) SELECT ?,?,?,'statement',?,'statement',2 WHERE ${linkExists}`).bind(
      `${id}:statement:${match.sourceRecordId}:2`,
      ledger,
      id,
      match.sourceRecordId,
      linkId,
      ledger,
    ),
    db.prepare(`UPDATE transactions SET status='needs_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=? AND source='alert' AND EXISTS (SELECT 1 FROM annotation_revisions WHERE transaction_id=? AND ledger_id=?) AND ${linkExists}`).bind(
      id,
      ledger,
      id,
      ledger,
      linkId,
      ledger,
    ),
    db.prepare(`DELETE FROM transactions WHERE id=? AND ledger_id=? AND source='alert'
      AND NOT EXISTS (SELECT 1 FROM annotation_revisions WHERE transaction_id=? AND ledger_id=?)
      AND NOT EXISTS (SELECT 1 FROM alert_projections WHERE transaction_id=? AND event_id<>? AND ledger_id=?)
      AND NOT EXISTS (SELECT 1 FROM alert_event_links WHERE to_transaction_id=? AND ledger_id=?) AND ${linkExists}`).bind(
        id,
        ledger,
        id,
        ledger,
        id,
        id,
        ledger,
        id,
        ledger,
        linkId,
        ledger,
      ),
  ];
}
function projectionStatements(db:D1Database,scoped:ScopedEvent,projection:ReturnType<typeof deriveAlertProjection>,resolution:StatementResolution):D1Statement[] {
  const id = scoped.internalId;
  const ledger = scoped.context.ledgerId;
  const transaction = projection.transaction;
  const statements: D1Statement[] = [];
  if(transaction) {
    statements.push(guarded(
      db,
      scoped,
      `INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,fx_lock_date) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?`,
      [
        id, ledger, transaction.accountId,
        transaction.date, transaction.merchant, transaction.amountMinor,
        transaction.currency, transaction.category, transaction.kind,
        transaction.status, transaction.source, transaction.fingerprint,
        transaction.date,
      ],
    ));
    statements.push(guarded(
      db,
      scoped,
      `INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) SELECT ?,?,'alert',?,?,?,?,?`,
      [
        `source-record:${id}`, ledger, `alert:${ledger}:${id}`,
        id, transaction.accountId, id,
        scoped.digest,
      ],
    ));
  }
  statements.push(guarded(
    db,
    scoped,
    `INSERT INTO alert_projections(id,ledger_id,event_id,transaction_id,state,reason_codes_json,counted_currency,counted_amount_minor,revision) SELECT ?,?,?,?,?,?,?,?,1`,
    [
      id, ledger, id,
      transaction?id:null, projection.state, JSON.stringify(projection.reasonCodes),
      projection.countedMoney?.currency??null, projection.countedMoney?.amountMinor??null,
    ],
  ));
  statements.push(guarded(
    db,
    scoped,
    `INSERT INTO alert_projection_provenance(id,ledger_id,projection_id,source_kind,source_id,basis,revision) SELECT ?,?,?,'alert',?,'alert_event',1`,
    [
      `${id}:alert:${id}:1`, ledger, id,
      id,
    ],
  ));
  for(const match of resolution.candidates)statements.push(guarded(
    db,
    scoped,
    `INSERT INTO statement_reconciliation_candidates(id,ledger_id,source_record_id,statement_transaction_id,candidate_transaction_id,score,reason_codes_json,evidence_basis,status) SELECT ?,?,?,?,?,?,?,?,'open'`,
    [
      `statement-candidate:${encodeURIComponent(`${match.sourceRecordId}:${id}`)}`, ledger, match.sourceRecordId,
      match.statementTransactionId, id, match.score,
      JSON.stringify(match.reasonCodes), match.basis,
    ],
  ));
  if(resolution.auto&&transaction)statements.push(...automaticConfirmationStatements(db,scoped,resolution.auto));
  return statements;
}
function digestStatement(db:D1Database,scoped:ScopedEvent) {
  return guarded(
    db,
    scoped,
    `INSERT INTO alert_event_digests(event_id,ledger_id,algorithm,digest) SELECT ?,?,'payload-sha256',?`,
    [
      scoped.internalId,
      scoped.context.ledgerId,
      scoped.digest,
    ],
  );
}
function eventScope(scoped:ScopedEvent) {
  return {sourceProfileId:scoped.event.sourceProfileId,accountId:scoped.accountId,currency:scoped.scopeCurrency,instrumentHint:scoped.event.instrumentHint};
}
async function revalidateEvents(db:D1Database,context:CaptureContext,events:ScopedEvent[]) {
  await assertCaptureAuthority(db,context);
  for(const scoped of events)await assertCaptureScope(db,context,eventScope(scoped));
}

async function readStoredReceipts(db: D1Database, context: CaptureContext, eventIds: readonly string[]) {
  const rows = new Map<string, ExistingReceiptRow>();
  for (const eventId of eventIds) {
    const row = await existingReceipt(db, context, eventId);
    if (row) rows.set(eventId, row);
  }
  return rows;
}

async function resolveStatement(db: D1Database, scoped: ScopedEvent, projection: ReturnType<typeof deriveAlertProjection>, reserved: Set<string>): Promise<StatementResolution> {
  const transaction = projection.transaction;
  if (!transaction) return { candidates: [], auto: null };
  const matches = await findAlertStatementMatches(db, scoped.context, {
    accountId: scoped.accountId, date: transaction.date, merchant: transaction.merchant,
    amountMinor: transaction.amountMinor, currency: transaction.currency, kind: transaction.kind,
    bankReference: scoped.event.bankReference ?? null,
  });
  const bankMatches = matches.filter(match => match.basis === 'bank_reference');
  if (bankMatches.length !== 1 || reserved.has(bankMatches[0].statementTransactionId)) return { candidates: matches, auto: null };
  const match = bankMatches[0];
  const occupied = await db.prepare(`SELECT id FROM alert_event_links
    WHERE ledger_id = ? AND relation = 'confirms' AND to_transaction_id = ? LIMIT 1`)
    .bind(scoped.context.ledgerId, match.statementTransactionId).first();
  if (occupied) return { candidates: matches, auto: null };
  reserved.add(match.statementTransactionId);
  return { candidates: [match], auto: match };
}

function isAlertPublicationConflict(error: unknown) {
  return isReconciliationUniqueConflict(error)
    || (error instanceof Error && error.message.includes('alert event identity collision'));
}

function repeatedAcknowledgment(ack: IngestAck): IngestAck {
  if (ack.status !== 'accepted' && ack.status !== 'replayed') return { ...ack };
  if (!ack.receiptId || ack.revision === null || ack.projectionState === null || ack.error !== null) {
    throw new Error('The repeated event has no durable receipt.');
  }
  return { ...ack, status: 'replayed' };
}

function resolveAcknowledgments(acks: Array<IngestAck | null>, duplicates: Map<number, number>) {
  return acks.map((ack, index) => {
    const first = duplicates.get(index);
    if (first === undefined) return ack ?? rejection('event-' + index, ['invalid_event']);
    const resolved = acks[first];
    if (!resolved) throw new Error('The repeated event has no resolved acknowledgment.');
    return repeatedAcknowledgment(resolved);
  });
}

export async function ingestAlertBatch(db: D1Database, inputContext: CaptureContext, value: unknown, retryOnUnique = true): Promise<IngestBatchResponse> {
  const context=immutableCaptureContext(inputContext);
  await assertCaptureAuthority(db,context);
  const touched:ScopedEvent[]=[];
  const events = parseAlertBatch(value);
  const acks: Array<IngestAck | null> = Array.from({ length: events.length }, () => null);
  const firstIndex = new Map<string, number>();
  const duplicateIndexes = new Map<number, number>();
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
    touched.push(scoped);
    const priorDigest = eventDigests.get(event.eventId);
    if (priorDigest !== undefined) {
      if (priorDigest === digest) duplicateIndexes.set(index, firstIndex.get(event.eventId)!);
      else acks[index] = conflict(event.eventId);
      continue;
    }
    eventDigests.set(event.eventId, digest);
    firstIndex.set(event.eventId, index);
    const existing = await existingReceipt(db, context, event.eventId);
    if (existing) {
      acks[index] = existing.payload_digest === digest ? receipt(existing, 'replayed') : conflict(event.eventId);
      continue;
    }
    if (await existingEventOwner(db, context, event.eventId)) {
      acks[index] = conflict(event.eventId);
      continue;
    }
    pending.push(scoped);
    pendingIndex.set(event.eventId, index);
    acks[index] = receipt({ event_id: event.eventId, device_id: context.deviceId, payload_digest: digest, projection_id: event.eventId, projection_state: null, reason_codes_json: '[]', revision: 1 }, 'accepted');
  }

  if (pending.length > 0) {
    const statements: D1Statement[] = [capturePublicationGuard(db,context)];
    const insertIndexes = new Map<string, number>();
    const reservedStatementMatches = new Set<string>();
    for (const scoped of pending) {
      statements.push(capturePublicationGuard(db,context,eventScope(scoped)));
      insertIndexes.set(scoped.event.eventId, statements.length);
      statements.push(eventInsert(db, scoped));
      statements.push(digestStatement(db, scoped));
      const projection = deriveAlertProjection({...scoped.event,eventId:scoped.internalId}, scoped.mapping, []);
      const resolution = await resolveStatement(db, scoped, projection, reservedStatementMatches);
      statements.push(...projectionStatements(db, scoped, projection, resolution));
    }
    let batchResults: D1Result[] | null = null;
    try {
      batchResults = await db.batch(statements);
    } catch (error) {
      await revalidateEvents(db,context,touched);
      const rows = await readStoredReceipts(db, context, pending.map((item) => item.event.eventId));
      const owners = new Map<string, { payload_digest: string; device_id: string | null }>();
      for (const scoped of pending) {
        const owner = await existingEventOwner(db, context, scoped.event.eventId);
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
      if (!reconciled && isAlertPublicationConflict(error) && retryOnUnique) {
        const retry = await ingestAlertBatch(db, context, { events: pending.map((item) => item.event) }, false);
        for (const [pendingSlot, scoped] of pending.entries()) {
          const slot = pendingIndex.get(scoped.event.eventId)!;
          const finalAck = retry.acks[pendingSlot];
          acks[slot] = finalAck;
        }
      } else if (!reconciled && isAlertPublicationConflict(error)) {
        for (const scoped of pending) acks[pendingIndex.get(scoped.event.eventId)!] = conflict(scoped.event.eventId);
      } else if (!reconciled) {
        throw error;
      }
    }
    if (batchResults) {
      const rows = await readStoredReceipts(db, context, pending.map((item) => item.event.eventId));
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
        }
      }
    }
  }

  await revalidateEvents(db,context,touched);
  return { acks: resolveAcknowledgments(acks, duplicateIndexes) };
}

async function activeStatusScopes(db:D1Database,context:CaptureContext) {
  const scopes=[];
  for(const scope of context.sourceScopes) {
    const guard=captureScopePredicate(context,scope);
    if(await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first())scopes.push(scope);
  }
  return scopes;
}
export async function readCaptureStatus(db:D1Database,inputContext:CaptureContext,eventId?:string|null) {
  const context=immutableCaptureContext(inputContext);
  await assertCaptureAuthority(db,context);
  const credentialExpiresAt=normalizeRfc3339Instant(context.expiresAt);
  if(!credentialExpiresAt)throw new Error('The capture credential expiry is not a valid RFC3339 instant.');
  const scopes=await activeStatusScopes(db,context);
  const row=await db.prepare(`SELECT COALESCE(e.raw_event_id,e.event_id) AS event_id,e.payload_digest,p.id AS projection_id,p.state AS projection_state,p.reason_codes_json,p.revision,e.created_at,e.source_profile_id,e.account_id,e.event_money_currency,e.instrument_hint_kind,e.instrument_hint_value
    FROM alert_events e LEFT JOIN alert_projections p ON p.event_id=e.id AND p.ledger_id=e.ledger_id
    WHERE e.ledger_id=? AND e.device_id=? AND (? IS NULL OR COALESCE(e.raw_event_id,e.event_id)=?) AND EXISTS
    (SELECT 1 FROM json_each(?) s WHERE json_extract(s.value,'$.sourceProfileId')=e.source_profile_id AND json_extract(s.value,'$.accountId')=e.account_id
    AND (e.event_money_currency IS NULL OR json_extract(s.value,'$.currency')=e.event_money_currency)
    AND COALESCE(json_extract(s.value,'$.instrumentHint.kind'),'none')=COALESCE(e.instrument_hint_kind,'none')
    AND COALESCE(json_extract(s.value,'$.instrumentHint.value'),'')=COALESCE(e.instrument_hint_value,''))
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1`).bind(
      context.ledgerId,
      context.deviceId,
      eventId??null,
      eventId??null,
      JSON.stringify(scopes),
    ).first<StatusReceiptRow>();
  await assertStatusReceiptScope(db,context,scopes,row);
  await assertCaptureAuthority(db,context);
  return {deviceId:context.deviceId,credentialExpiresAt,ingestionState:'ready' as const,...statusReceipt(row)};
}

interface StatusReceiptRow extends ExistingReceiptRow {
  created_at: string;
  source_profile_id: string;
  account_id: string;
  event_money_currency: string | null;
  instrument_hint_kind: string | null;
  instrument_hint_value: string | null;
}
function statusHintMatches(scope: CaptureScopeRecord, row: StatusReceiptRow) {
  return (scope.instrumentHint?.kind ?? 'none') === (row.instrument_hint_kind ?? 'none')
    && (scope.instrumentHint?.value ?? '') === (row.instrument_hint_value ?? '');
}
function statusScopeMatches(scope: CaptureScopeRecord, row: StatusReceiptRow) {
  return scope.sourceProfileId === row.source_profile_id && scope.accountId === row.account_id
    && (!row.event_money_currency || scope.currency === row.event_money_currency) && statusHintMatches(scope,row);
}
async function assertStatusReceiptScope(db: D1Database, context: CaptureContext, scopes: CaptureScopeRecord[], row: StatusReceiptRow | null) {
  if (!row) return;
  const scope = scopes.find(candidate => statusScopeMatches(candidate,row));
  if (!scope) throw new Error('The capture receipt has no approved source scope.');
  await assertCaptureScope(db,context,scope);
}
function statusReceipt(row: StatusReceiptRow | null) {
  if (!row) return {lastAcceptedAt:null, receipt:null};
  const instant = /Z$|[+-]\d{2}:\d{2}$/.test(row.created_at) ? row.created_at : `${row.created_at.replace(' ','T')}Z`;
  return {lastAcceptedAt:new Date(instant).toISOString(),receipt:receipt(row,'replayed')};
}
