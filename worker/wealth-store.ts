import {
  classifyWealthCashFlows,
  calculateModifiedDietz,
  createWealthAccountRegistry,
  createWealthReport,
  createWealthSnapshot,
  canonicalEventFingerprint,
  instrumentKey,
  resolveWealthEvents,
  replayWealthEvents,
  WealthDomainError,
} from '../src/domain/wealth';
import { assertPositiveQuantity } from '../src/domain/wealth-validation';
import type {
  CanonicalInstrument,
  ClassifiedWealthCashFlow,
  HoldingValuation,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashFlowRecord,
  WealthCorrectionPayload,
  WealthEvent,
  WealthMoney,
  WealthReport,
  WealthSnapshot,
} from '../src/domain/wealth-types';
import type { WealthAllocationRow, WealthFxStatus, WealthHistoryPoint, WealthModeTransitionRecord, WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../src/domain/wealth-api-types';
import type { D1Database, D1Statement } from './db-types';
import { readFxSnapshot } from './db-types';
import { convertMinorUnits, parseFrankfurterRates, type ValidatedFxRates } from './fx-rates';
import { warmFxSnapshot } from './ledger-reports';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import { readLunchFlowBalances, type StoredBalance } from './lunchflow-balance-store';
import { readWealthQuotes, wealthQuoteToHoldingValuation, type WealthQuoteInstrument } from './wealth-quotes';

export type WealthOpeningPositionInput = WealthOpeningPositionRequest;
export type WealthModeTransitionInput = WealthModeTransitionRequest;
export type WealthAccountInput = Omit<WealthAccount, 'active'> & {
  amountMinor?: number | null;
  asOf?: string | null;
  effectiveDate?: string | null;
  openingCashMinor?: number | null;
  openingValueMinor?: number | null;
  openingPositions?: readonly WealthOpeningPositionInput[];
  modeTransition?: WealthModeTransitionInput | null;
  active?: boolean;
  expectedRevision?: number;
  operationId?: string;
};
export type WealthInstrumentInput = CanonicalInstrument & { id: string; expectedRevision?: number; operationId?: string };
export type WealthValuationInput = {
  id: string;
  accountId: string;
  instrument?: CanonicalInstrument | null;
  asOf: string;
  priceMinor: number;
  source?: 'manual' | 'provider';
  provider?: string | null;
  expectedRevision?: number;
  operationId?: string;
};
export interface WealthReportQuery { asOf?: string | null; from?: string | null; to?: string | null; currency?: string | null; reportingCurrency?: string | null }
export interface WealthReportDependencies { fetcher?: typeof fetch; now?: () => Date }

export class WealthStoreError extends Error {
  readonly code: string; readonly status: number; readonly retryable: boolean; readonly currentRevision?: number;
  constructor(code: string, message: string, ...options: [status?: number, retryable?: boolean, currentRevision?: number]) {
    const [status = 400, retryable = false, currentRevision] = options;
    super(message); this.name = 'WealthStoreError'; this.code = code; this.status = status; this.retryable = retryable; this.currentRevision = currentRevision;
  }
}
export class WealthRevisionConflictError extends WealthStoreError {
  constructor(currentRevision: number) { super('revision_conflict', 'The wealth data changed; reload before saving.', 409, false, currentRevision); this.name = 'WealthRevisionConflictError'; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
export const ACCOUNT_VALUE_KEY = '__account__';

interface StoredAccount { ledger_id: string; id: string; name: string; kind: WealthAccount['kind']; mode: WealthAccount['mode']; currency: string | null; linked_bank_account_id: string | null; amount_minor: number | null; active: number; revision: number }
interface StoredModeTransition { account_id: string; effective_date: string; from_mode: WealthAccount['mode']; to_mode: WealthAccount['mode']; revision: number; payload_json: string }
interface StoredInstrument { id: string; exchange: string; ticker: string; type: 'stock' | 'etf'; currency: string; revision: number }
interface StoredValuation { id: string; account_id: string; instrument_key: string; as_of: string; price_minor: number; source: 'manual' | 'provider'; provider: string | null; payload_json: string; revision: number }
interface StoredEvent { id: string; source_id: string; date: string; sequence: number; kind: WealthEvent['kind']; account_id: string | null; from_account_id: string | null; to_account_id: string | null; linked_bank_source_id: string | null; payload_json: string }
interface StoredOperation { payload_hash: string; response_json: string; result_revision: number }
interface SqlGuard { sql: string; bindings: unknown[] }
interface MutationPlan { operationId: string; operationKind: string; expectedRevision: number; payloadHash: string; response: unknown; eventCount?: number; statements: (guard: SqlGuard) => D1Statement[] }
interface MutationExecution { db: D1Database; context: FinancialContext; plan: MutationPlan; operation: D1Statement; state: D1Statement; resultRevision: number }

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}
function object(value: unknown, message = 'The wealth request body is not valid.') {
  if (!isObjectRecord(value)) throw new WealthStoreError('invalid_request', message);
  return value as Record<string, unknown>;
}
function isBoundedText(value: unknown, max: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() !== value) return false;
  if (value.length === 0) return false;
  return value.length <= max;
}
export function bounded(value: unknown, label: string, max: number): string {
  if (!isBoundedText(value, max)) throw new WealthStoreError('invalid_request', `The ${label} is not valid.`);
  return value;
}
function optionalBounded(value: unknown, label: string, max: number): string | null { return value === undefined || value === null ? null : bounded(value, label, max); }
function integer(value: unknown, label: string, allowNull = false): number | null {
  if (value === null && allowNull) return null;
  if (!Number.isSafeInteger(value)) throw new WealthStoreError('invalid_request', `The ${label} is not a safe integer.`);
  return value as number;
}
export function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new WealthStoreError('invalid_request', `The ${label} is not a valid date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new WealthStoreError('invalid_request', `The ${label} is not a valid date.`);
  return value;
}
export function currency(value: unknown, label: string, allowNull = false): string | null {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new WealthStoreError('invalid_request', `The ${label} is not a valid currency.`);
  return value;
}
export function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}
export function randomId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
export function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value) as T; } catch { throw new WealthStoreError('storage_error', `The stored wealth ${label} is malformed.`, 500, true); }
}
function accountView(row: StoredAccount): WealthAccount & Record<string, unknown> {
  return { id: row.id, name: row.name, kind: row.kind, mode: row.mode, currency: row.currency ?? undefined, linkedBankAccountId: row.linked_bank_account_id, active: row.active === 1, amountMinor: row.amount_minor, revision: row.revision };
}
function instrumentView(row: StoredInstrument): CanonicalInstrument & Record<string, unknown> {
  return { id: row.id, exchange: row.exchange, ticker: row.ticker, type: row.type, currency: row.currency, revision: row.revision };
}
function normalizeInstrument(value: unknown): CanonicalInstrument {
  const body = object(value, 'The instrument is required.');
  const exchange = bounded(body.exchange, 'instrument exchange', 32).toUpperCase();
  const ticker = bounded(body.ticker, 'instrument ticker', 32).toUpperCase();
  const type = body.type;
  if (type !== 'stock' && type !== 'etf') throw new WealthStoreError('invalid_request', 'The instrument type is not supported.');
  return { exchange, ticker, type, currency: currency(body.currency, 'instrument currency')! };
}
export function normalizeEvent(value: unknown): WealthEvent {
  const event = object(value, 'The wealth event is not valid.') as unknown as WealthEvent;
  if (typeof event.id !== 'string' || typeof event.sourceId !== 'string') throw new WealthStoreError('invalid_request', 'Event id and sourceId are required.');
  date(event.date, 'event date');
  if (!event.kind) throw new WealthStoreError('invalid_request', 'Event kind is required.');
  return event;
}
function eventForDigest(event: WealthEvent): string {
  try {
    return canonicalEventFingerprint(event);
  } catch {
    const { id: _id, sequence: _sequence, ...content } = event;
    return stable(content);
  }
}
function valuationFingerprint(value: Record<string, unknown>): string {
  const { id: _id, ...content } = value;
  return stable(content);
}
function rowEvent(row: StoredEvent): WealthEvent { return { ...parseJson<WealthEvent>(row.payload_json, 'event'), sequence: row.sequence }; }

function valuationRowKey(row: StoredValuation): string {
  return `${row.account_id}:${row.instrument_key}:${row.as_of}`;
}

function latestValuationRows(rows: readonly StoredValuation[]): StoredValuation[] {
  const latest = new Map<string, StoredValuation>();
  for (const row of rows) {
    const key = valuationRowKey(row);
    const prior = latest.get(key);
    if (shouldReplaceValuation(prior, row)) latest.set(key, row);
  }
  return [...latest.values()].sort((left, right) => left.as_of.localeCompare(right.as_of) || left.account_id.localeCompare(right.account_id) || left.id.localeCompare(right.id));
}

function shouldReplaceValuation(prior: StoredValuation | undefined, candidate: StoredValuation): boolean {
  return !prior || candidate.revision > prior.revision || (candidate.revision === prior.revision && candidate.id > prior.id);
}

interface ValuationLookup { readonly accountId: string; readonly instrumentKey: string; readonly asOf: string }
interface InitialAggregateValuation { readonly id: string; readonly accountId: string; readonly asOf: string; readonly amountMinor: number; readonly payload: Record<string, unknown> }

async function currentStoredValuation(db: D1Database, context: FinancialContext, lookup: ValuationLookup): Promise<StoredValuation | null> {
  const rows = await db.prepare(`SELECT id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision FROM wealth_valuations WHERE ledger_id=? AND account_id=? AND instrument_key=? AND as_of=?
    UNION ALL
    SELECT id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision FROM wealth_valuation_corrections WHERE ledger_id=? AND account_id=? AND instrument_key=? AND as_of=?`)
    .bind(context.ledgerId, lookup.accountId, lookup.instrumentKey, lookup.asOf, context.ledgerId, lookup.accountId, lookup.instrumentKey, lookup.asOf).all<StoredValuation>();
  return latestValuationRows(rows.results)[0] ?? null;
}

export async function currentRevision(db: D1Database, context: FinancialContext): Promise<number> {
  const row = await db.prepare('SELECT revision FROM wealth_state WHERE ledger_id=?').bind(context.ledgerId).first<{ revision: number }>();
  if (!row) throw new WealthStoreError('storage_error', 'The wealth state is not initialized.', 500, true);
  return row.revision;
}
export async function currentEventSequence(db: D1Database, context: FinancialContext): Promise<number> {
  const row = await db.prepare('SELECT event_sequence FROM wealth_state WHERE ledger_id=?').bind(context.ledgerId).first<{ event_sequence: number }>();
  if (!row) throw new WealthStoreError('storage_error', 'The wealth state is not initialized.', 500, true);
  return row.event_sequence;
}
async function existingOperation(db: D1Database, context: FinancialContext, operationId: string): Promise<StoredOperation | null> {
  return db.prepare('SELECT payload_hash,response_json,result_revision FROM wealth_operations WHERE ledger_id=? AND operation_id=?').bind(context.ledgerId, operationId).first<StoredOperation>();
}
function mutationGuard(context: FinancialContext, operationId: string, resultRevision: number): SqlGuard {
  const authority = financialAuthorityPredicate(context, 'wealth:write');
  return { sql: `EXISTS (SELECT 1 FROM wealth_operations op WHERE op.ledger_id=? AND op.operation_id=? AND op.result_revision=?) AND ${authority.sql}`, bindings: [context.ledgerId, operationId, resultRevision, ...authority.bindings] };
}

function replayOperation<T>(operation: StoredOperation, payloadHash: string): T {
  if (operation.payload_hash !== payloadHash) throw new WealthStoreError('idempotency_conflict', 'The idempotency key was already used for another wealth request.', 409);
  return parseJson<T>(operation.response_json, 'operation response');
}

async function replayIfPresent<T>(db: D1Database, context: FinancialContext, operationId: string, payloadHash: string): Promise<{ found: false } | { found: true; value: T }> {
  const operation = await existingOperation(db, context, operationId);
  return operation ? { found: true, value: replayOperation<T>(operation, payloadHash) } : { found: false };
}

function mutationApplied(result: readonly { meta?: { changes?: number } }[]): boolean {
  return Number(result[0]?.meta?.changes ?? 0) >= 1 && Number(result[1]?.meta?.changes ?? 0) >= 1;
}

function assertMutationApplied(result: readonly { meta?: { changes?: number } }[], revision: number): void {
  if (mutationApplied(result)) return;
  throw new WealthRevisionConflictError(revision);
}

async function executeMutation<T>({ db, context, plan, operation, state, resultRevision }: MutationExecution): Promise<T> {
  const result = await db.batch([operation, state, ...plan.statements(mutationGuard(context, plan.operationId, resultRevision))]);
  assertMutationApplied(result, await currentRevision(db, context));
  return plan.response as T;
}

async function recoverMutation<T>(db: D1Database, context: FinancialContext, plan: MutationPlan, error: unknown): Promise<T> {
  if (error instanceof WealthRevisionConflictError) throw error;
  const retry = await replayIfPresent<T>(db, context, plan.operationId, plan.payloadHash);
  if (retry.found) return retry.value;
  throw error;
}

export async function runMutation<T>(db: D1Database, context: FinancialContext, plan: MutationPlan): Promise<T> {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const prior = await replayIfPresent<T>(db, context, plan.operationId, plan.payloadHash);
  if (prior.found) return prior.value;
  const authority = financialAuthorityPredicate(context, 'wealth:write');
  const resultRevision = plan.expectedRevision + 1;
  const operation = db.prepare(`INSERT INTO wealth_operations(ledger_id,operation_id,operation_kind,expected_revision,result_revision,payload_hash,response_json)
    SELECT ?,?,?,?,?,?,? WHERE ${authority.sql} AND EXISTS(SELECT 1 FROM wealth_state WHERE ledger_id=? AND revision=?)`)
    .bind(context.ledgerId, plan.operationId, plan.operationKind, plan.expectedRevision, resultRevision, plan.payloadHash, JSON.stringify(plan.response), ...authority.bindings, context.ledgerId, plan.expectedRevision);
  const stateAuthority = financialAuthorityPredicate(context, 'wealth:write');
  const state = db.prepare(`UPDATE wealth_state SET revision=revision+1,event_sequence=event_sequence+?,updated_at=CURRENT_TIMESTAMP WHERE ledger_id=? AND revision=? AND EXISTS(SELECT 1 FROM wealth_operations WHERE ledger_id=? AND operation_id=?) AND ${stateAuthority.sql}`)
    .bind(plan.eventCount ?? 0, context.ledgerId, plan.expectedRevision, context.ledgerId, plan.operationId, ...stateAuthority.bindings);
  try {
    return await executeMutation({ db, context, plan, operation, state, resultRevision });
  } catch (error) {
    return recoverMutation(db, context, plan, error);
  }
}
function expectedRevision(body: Record<string, unknown>, revision: number): number {
  if (body.expectedRevision === undefined) return revision;
  const value = integer(body.expectedRevision, 'expectedRevision')!;
  if (value < 0) throw new WealthStoreError('invalid_request', 'The expectedRevision is not valid.');
  return value;
}
function operationId(body: Record<string, unknown>, requested?: string, prefix = 'wealth'): string {
  const value = requested ?? (typeof body.operationId === 'string' ? body.operationId : undefined);
  return value ? bounded(value, 'operationId', 256) : randomId(prefix);
}

async function validateLinkedBankReference(db: D1Database, context: FinancialContext, accountId: string | null): Promise<void> {
  if (!accountId) return;
  const row = await db.prepare('SELECT id FROM accounts WHERE ledger_id=? AND id=?').bind(context.ledgerId, accountId).first<{ id: string }>();
  if (!row) throw new WealthStoreError('invalid_request', 'The linked bank account does not belong to this ledger.');
}

async function assertLinkedBankUnique(db: D1Database, context: FinancialContext, accountId: string, linkedBankAccountId: string | null): Promise<void> {
  if (!linkedBankAccountId) return;
  const row = await db.prepare('SELECT id FROM wealth_accounts WHERE ledger_id=? AND linked_bank_account_id=? AND id<>?').bind(context.ledgerId, linkedBankAccountId, accountId).first<{ id: string }>();
  if (row) throw new WealthStoreError('linked_bank_conflict', 'That bank account is already linked to another wealth account.', 409);
}

async function assertInstrumentUnique(db: D1Database, context: FinancialContext, id: string, instrument: CanonicalInstrument): Promise<void> {
  const row = await db.prepare('SELECT id FROM wealth_instruments WHERE ledger_id=? AND exchange=? AND ticker=? AND type=? AND currency=? AND id<>?').bind(context.ledgerId, instrument.exchange, instrument.ticker, instrument.type, instrument.currency, id).first<{ id: string }>();
  if (row) throw new WealthStoreError('instrument_conflict', 'That security identity is already registered in this ledger.', 409);
}

function normalizeMoney(value: unknown, label: string): WealthMoney {
  const body = object(value, `The ${label} is required.`);
  const code = currency(body.currency, `${label} currency`)!;
  const amountMinor = integer(body.amountMinor, `${label} amountMinor`)!;
  if (amountMinor < 0) throw new WealthStoreError('invalid_request', `The ${label} amount cannot be negative.`);
  return { currency: code, amountMinor };
}

function nonNegativeMinor(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  const amount = integer(value, label)!;
  if (amount < 0) throw new WealthStoreError('invalid_request', `The ${label} cannot be negative.`);
  return amount;
}

function transitionBody(body: Record<string, unknown>): Record<string, unknown> {
  if (body.modeTransition === undefined || body.modeTransition === null) return body;
  return object(body.modeTransition, 'The mode transition is not valid.');
}

function transitionField(body: Record<string, unknown>, field: string): unknown {
  const nested = transitionBody(body);
  return nested[field] === undefined ? body[field] : nested[field];
}

function transitionRequested(body: Record<string, unknown>): boolean {
  return body.modeTransition !== undefined || ['effectiveDate', 'openingCashMinor', 'openingValueMinor', 'openingPositions'].some((field) => body[field] !== undefined);
}

interface NormalizedOpeningPosition extends WealthOpeningPositionInput {
  readonly id: string;
  readonly sourceId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: string;
  readonly basis: WealthMoney | null;
  readonly priceMinor: number | null;
}

interface ModeTransitionPlan {
  readonly fromMode: WealthAccount['mode'];
  readonly toMode: WealthAccount['mode'];
  readonly effectiveDate: string;
  readonly openingCashMinor: number | null;
  readonly openingValueMinor: number | null;
  readonly openingPositions: readonly NormalizedOpeningPosition[];
}

function normalizeOpeningPosition(value: unknown, accountId: string, effectiveDate: string, index: number): NormalizedOpeningPosition {
  const position = object(value, 'An opening position is not valid.');
  const instrument = normalizeInstrument(position.instrument);
  const quantity = openingQuantity(position.quantity);
  const basis = position.basis === undefined || position.basis === null ? null : normalizeMoney(position.basis, 'opening position basis');
  if (basis && basis.currency !== instrument.currency) throw new WealthStoreError('invalid_request', 'Opening position basis currency must match its instrument currency.');
  const priceMinor = nonNegativeMinor(position.priceMinor, 'opening position priceMinor');
  const id = position.id === undefined ? `opening-position:${accountId}:${effectiveDate}:${index}` : bounded(position.id, 'opening position id', 160);
  const sourceId = position.sourceId === undefined ? id : bounded(position.sourceId, 'opening position sourceId', 256);
  return { id, sourceId, instrument, quantity, basis, priceMinor };
}

function openingQuantity(value: unknown): string {
  const quantity = bounded(value, 'opening position quantity', 128);
  try {
    assertPositiveQuantity(quantity);
    return quantity;
  } catch (error) {
    throw new WealthStoreError('invalid_quantity', error instanceof Error ? error.message : 'Opening position quantity must be positive.');
  }
}

function assertUniqueOpeningPrices(positions: readonly NormalizedOpeningPosition[]): void {
  const instruments = new Set<string>();
  for (const position of positions) {
    if (position.priceMinor === null) continue;
    const key = instrumentKey(position.instrument);
    if (instruments.has(key)) throw new WealthStoreError('invalid_request', 'Opening positions cannot contain duplicate priced instruments.');
    instruments.add(key);
  }
}

function assertOpeningPositionIdentity(position: NormalizedOpeningPosition, ids: Set<string>, sourceIds: Set<string>): void {
  if (ids.has(position.id) || sourceIds.has(position.sourceId)) throw new WealthStoreError('invalid_request', 'Opening position identities must be unique.');
  ids.add(position.id);
  sourceIds.add(position.sourceId);
}

function normalizeOpeningPositions(value: unknown, accountId: string, effectiveDate: string): readonly NormalizedOpeningPosition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 1000) throw new WealthStoreError('invalid_request', 'Opening positions are not valid.');
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  const positions = value.map((item, index) => {
    const position = normalizeOpeningPosition(item, accountId, effectiveDate, index);
    assertOpeningPositionIdentity(position, ids, sourceIds);
    return position;
  });
  assertUniqueOpeningPrices(positions);
  return positions;
}

function normalizedModeTransition(body: Record<string, unknown>, fromMode: WealthAccount['mode'], toMode: WealthAccount['mode'], accountId: string, prior: ModeTransitionPlan | null = null): ModeTransitionPlan | null {
  if (fromMode === toMode) {
    if (prior) return prior;
    if (transitionRequested(body)) throw new WealthStoreError('invalid_request', 'A mode transition is only valid when the account representation changes.');
    return null;
  }
  const openingDataRequested = transitionRequested(body) || body.asOf !== undefined || (toMode === 'aggregate' && body.amountMinor !== undefined);
  if (!openingDataRequested) return null;
  const effectiveDateValue = transitionField(body, 'effectiveDate') ?? transitionField(body, 'asOf');
  if (effectiveDateValue === undefined || effectiveDateValue === null) throw new WealthStoreError('invalid_request', 'An effective date is required when changing account representation.');
  const effectiveDate = date(effectiveDateValue, 'mode transition effective date');
  const openingCashMinor = nonNegativeMinor(transitionField(body, 'openingCashMinor'), 'openingCashMinor');
  const openingValueMinor = nonNegativeMinor(transitionField(body, 'openingValueMinor'), 'openingValueMinor');
  const openingPositions = normalizeOpeningPositions(transitionField(body, 'openingPositions'), accountId, effectiveDate);
  if (toMode === 'holdings') {
    if (openingValueMinor !== null) throw new WealthStoreError('invalid_request', 'Holdings transitions cannot include an aggregate opening value.');
    if (openingCashMinor === null && openingPositions.length === 0) throw new WealthStoreError('invalid_request', 'Holdings transitions require opening cash or opening positions.');
  }
  if (toMode === 'aggregate') {
    if (openingCashMinor !== null || openingPositions.length > 0) throw new WealthStoreError('invalid_request', 'Aggregate transitions cannot include holdings opening data.');
    const value = openingValueMinor ?? (body.amountMinor === undefined ? null : nonNegativeMinor(body.amountMinor, 'amountMinor'));
    if (value === null) throw new WealthStoreError('invalid_request', 'Aggregate transitions require an opening value.');
    return { fromMode, toMode, effectiveDate, openingCashMinor: null, openingValueMinor: value, openingPositions };
  }
  return { fromMode, toMode, effectiveDate, openingCashMinor, openingValueMinor: null, openingPositions };
}

interface AccountHistory { readonly hasHistory: boolean; readonly latestDate: string | null }

async function accountHistory(db: D1Database, context: FinancialContext, accountId: string): Promise<AccountHistory> {
  const [events, valuations, transitions] = await Promise.all([
    db.prepare('SELECT date,payload_json FROM wealth_events WHERE ledger_id=?').bind(context.ledgerId).all<{ date: string; payload_json: string }>(),
    db.prepare(`SELECT as_of AS date FROM wealth_valuations WHERE ledger_id=? AND account_id=?
      UNION ALL SELECT as_of AS date FROM wealth_valuation_corrections WHERE ledger_id=? AND account_id=?`).bind(context.ledgerId, accountId, context.ledgerId, accountId).all<{ date: string }>(),
    db.prepare('SELECT effective_date AS date FROM wealth_account_mode_transitions WHERE ledger_id=? AND account_id=?').bind(context.ledgerId, accountId).all<{ date: string }>(),
  ]);
  const eventDates = events.results.flatMap((row) => {
    try { return wealthEventAccountIds(JSON.parse(row.payload_json) as WealthEvent).includes(accountId) ? [row.date] : []; } catch { return []; }
  });
  const dates = [...eventDates, ...valuations.results.map((row) => row.date), ...transitions.results.map((row) => row.date)].sort();
  return { hasHistory: dates.length > 0, latestDate: dates.at(-1) ?? null };
}

async function assertAccountModeChangeSafe(
  db: D1Database,
  context: FinancialContext,
  accountId: string,
  mode: WealthAccount['mode'],
  kind: WealthAccount['kind'],
  currencyCode: string | null,
  linkedBankAccountId: string | null,
  transition: ModeTransitionPlan | null,
): Promise<void> {
  const existing = await db.prepare('SELECT mode,kind,currency,linked_bank_account_id FROM wealth_accounts WHERE ledger_id=? AND id=?').bind(context.ledgerId, accountId).first<{ mode: WealthAccount['mode']; kind: WealthAccount['kind']; currency: string | null; linked_bank_account_id: string | null }>();
  const shapeChanged = existing && (existing.mode !== mode || existing.kind !== kind || existing.currency !== currencyCode || existing.linked_bank_account_id !== linkedBankAccountId);
  if (!shapeChanged) return;
  const history = await accountHistory(db, context, accountId);
  const modeOnly = existing && existing.mode !== mode && existing.kind === kind && existing.currency === currencyCode && existing.linked_bank_account_id === linkedBankAccountId;
  if (modeOnly && !transition && !history.hasHistory) throw new WealthStoreError('invalid_request', 'A mode transition requires an effective-dated opening value or zero opening.');
  if (modeOnly && transition) {
    if (history.latestDate && history.latestDate >= transition.effectiveDate) throw new WealthStoreError('account_mode_conflict', 'The transition date must be after all existing account history.', 409);
    return;
  }
  if (history.hasHistory) throw new WealthStoreError('account_mode_conflict', 'An account with recorded events or dated values cannot change representation, kind, currency, or linked bank account without an effective-dated opening transition.', 409);
}

function initialAggregateValuation(body: Record<string, unknown>, id: string, kind: WealthAccount['kind'], mode: WealthAccount['mode'], amountMinor: number | null): InitialAggregateValuation | null {
  if (mode !== 'aggregate' || kind === 'linked_bank' || amountMinor === null || body.asOf === undefined || body.asOf === null) return null;
  const asOf = date(body.asOf, 'account effective date');
  const valuationId = bounded(body.initialValuationId ?? `account-value:${id}:${asOf}`, 'initial valuation id', 160);
  const payload = { id: valuationId, accountId: id, instrument: null, asOf, priceMinor: amountMinor, source: 'manual', provider: null };
  return { id: valuationId, accountId: id, asOf, amountMinor, payload };
}

function transitionEvents(plan: ModeTransitionPlan, accountId: string, currencyCode: string): WealthEvent[] {
  const events: WealthEvent[] = [];
  if (plan.openingCashMinor !== null) {
    const sourceId = `opening-cash:${accountId}:${plan.effectiveDate}`;
    events.push({ id: sourceId, sourceId, date: plan.effectiveDate, kind: 'opening_cash', accountId, money: { currency: currencyCode, amountMinor: plan.openingCashMinor } });
  }
  for (const position of plan.openingPositions) {
    events.push({ id: position.id, sourceId: position.sourceId, date: plan.effectiveDate, kind: 'opening_position', accountId, instrument: position.instrument, quantity: position.quantity, basis: position.basis });
  }
  return events;
}

function transitionValuations(plan: ModeTransitionPlan, accountId: string): InitialAggregateValuation[] {
  if (plan.toMode === 'aggregate' && plan.openingValueMinor !== null) {
    const id = `account-value:${accountId}:${plan.effectiveDate}`;
    return [{ id, accountId, asOf: plan.effectiveDate, amountMinor: plan.openingValueMinor, payload: { id, accountId, instrument: null, asOf: plan.effectiveDate, priceMinor: plan.openingValueMinor, source: 'manual', provider: null } }];
  }
  return plan.openingPositions.flatMap((position) => position.priceMinor === null ? [] : [{
    id: `${position.id}:valuation`, accountId, asOf: plan.effectiveDate, amountMinor: position.priceMinor,
    payload: { id: `${position.id}:valuation`, accountId, instrument: position.instrument, asOf: plan.effectiveDate, priceMinor: position.priceMinor, source: 'manual', provider: null },
  }]);
}

function sequencedEvents(events: readonly WealthEvent[], startingSequence: number): WealthEvent[] {
  return events.map((event, index) => ({ ...event, sequence: startingSequence + index + 1 }));
}

interface ValuationModeCheck { readonly accountId: string; readonly instrument: CanonicalInstrument | null; readonly asOf: string }

function assertValuationAccount(row: { readonly id: string; readonly mode: WealthAccount['mode'] } | null): asserts row is { readonly id: string; readonly mode: WealthAccount['mode'] } {
  if (!row) throw new WealthStoreError('invalid_request', 'The valuation account does not belong to this ledger.');
}

function assertValuationMode(mode: WealthAccount['mode'], instrument: CanonicalInstrument | null): void {
  const requiredMode = instrument ? 'holdings' : 'aggregate';
  if (mode !== requiredMode) throw new WealthStoreError('account_mode_conflict', `A ${instrument ? 'security' : 'account'} valuation requires a ${requiredMode} wealth account.`);
}

async function validateValuationAccountMode(db: D1Database, context: FinancialContext, check: ValuationModeCheck): Promise<void> {
  const { accountId, instrument, asOf } = check;
  const row = await db.prepare('SELECT id,mode FROM wealth_accounts WHERE ledger_id=? AND id=?').bind(context.ledgerId, accountId).first<{ id: string; mode: WealthAccount['mode'] }>();
  assertValuationAccount(row);
  const transitions = await loadModeTransitions(db, context);
  const mode = modeAtDate({ id: row.id, mode: row.mode }, transitions, asOf);
  assertValuationMode(mode, instrument);
  if (!instrument && await hasOpeningCashInAggregateSegment({ db, context, account: { id: row.id, mode: row.mode }, transitions, asOf })) throw new WealthStoreError('account_mode_conflict', 'An aggregate account cannot combine opening cash with a dated aggregate valuation.', 409);
}

async function loadModeTransitions(db: D1Database, context: FinancialContext): Promise<StoredModeTransition[]> {
  const rows = await db.prepare(`SELECT account_id,effective_date,from_mode,to_mode,revision,payload_json
    FROM wealth_account_mode_transitions WHERE ledger_id=? ORDER BY account_id,effective_date,revision`).bind(context.ledgerId).all<StoredModeTransition>();
  return rows.results;
}

function modeTransitionRecord(row: StoredModeTransition): WealthModeTransitionRecord {
  const payload = parseJson<ModeTransitionPlan>(row.payload_json, 'mode transition');
  return {
    accountId: row.account_id,
    effectiveDate: row.effective_date,
    fromMode: row.from_mode,
    toMode: row.to_mode,
    revision: row.revision,
    payload: {
      effectiveDate: row.effective_date,
      openingCashMinor: payload.openingCashMinor,
      openingValueMinor: payload.openingValueMinor,
      openingPositions: payload.openingPositions,
    },
  };
}

export async function readWealthModeTransitions(db: D1Database, context: FinancialContext): Promise<readonly WealthModeTransitionRecord[]> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  return (await loadModeTransitions(db, context)).map(modeTransitionRecord);
}

async function priorModeTransition(db: D1Database, context: FinancialContext, accountId: string, body: Record<string, unknown>, toMode: WealthAccount['mode']): Promise<ModeTransitionPlan | null> {
  if (!transitionRequested(body)) return null;
  const effectiveDateValue = transitionField(body, 'effectiveDate') ?? transitionField(body, 'asOf');
  if (effectiveDateValue === undefined || effectiveDateValue === null) return null;
  const effectiveDate = date(effectiveDateValue, 'mode transition effective date');
  const row = await db.prepare(`SELECT from_mode,to_mode,effective_date,payload_json FROM wealth_account_mode_transitions
    WHERE ledger_id=? AND account_id=? AND effective_date=?`).bind(context.ledgerId, accountId, effectiveDate).first<{ from_mode: WealthAccount['mode']; to_mode: WealthAccount['mode']; effective_date: string; payload_json: string }>();
  if (!row || row.to_mode !== toMode) return null;
  const payload = parseJson<ModeTransitionPlan>(row.payload_json, 'mode transition');
  if (payload.fromMode !== row.from_mode || payload.toMode !== row.to_mode || payload.effectiveDate !== row.effective_date) return null;
  return payload;
}

function accountTransitions(accountId: string, transitions: readonly StoredModeTransition[]): StoredModeTransition[] {
  return transitions.filter((transition) => transition.account_id === accountId).sort((left, right) => left.effective_date.localeCompare(right.effective_date) || left.revision - right.revision);
}

function modeAtDate(account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly StoredModeTransition[], asOf: string): WealthAccount['mode'] {
  const history = accountTransitions(account.id, transitions);
  const prior = history.filter((transition) => transition.effective_date <= asOf).at(-1);
  if (prior) return prior.to_mode;
  return history[0]?.from_mode ?? account.mode;
}

function storedTransitionRecords(records: readonly WealthModeTransitionRecord[]): StoredModeTransition[] {
  return records.map((record) => ({
    account_id: record.accountId,
    effective_date: record.effectiveDate,
    from_mode: record.fromMode,
    to_mode: record.toMode,
    revision: record.revision,
    payload_json: JSON.stringify(record.payload),
  }));
}

export function wealthAccountModeAtDate(account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly WealthModeTransitionRecord[], asOf: string): WealthAccount['mode'] {
  return modeAtDate(account, storedTransitionRecords(transitions), asOf);
}

function modeSegment(account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly StoredModeTransition[], asOf: string): { mode: WealthAccount['mode']; startDate: string | null } {
  const history = accountTransitions(account.id, transitions);
  const prior = history.filter((transition) => transition.effective_date <= asOf).at(-1);
  if (prior) return { mode: prior.to_mode, startDate: prior.effective_date };
  return { mode: history[0]?.from_mode ?? account.mode, startDate: null };
}

function accountsAtDate(accounts: readonly (WealthAccount & { amountMinor?: number | null })[], transitions: readonly StoredModeTransition[], asOf: string): (WealthAccount & { amountMinor?: number | null })[] {
  return accounts.map((account) => ({ ...account, mode: modeAtDate(account, transitions, asOf) }));
}

function eventInModeSegment(event: WealthEvent, accounts: readonly WealthAccount[], transitions: readonly StoredModeTransition[], asOf: string): boolean {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const accountIds = wealthEventAccountIds(event);
  if (accountIds.length === 0) return false;
  return accountIds.every((accountId) => {
    const account = byId.get(accountId);
    if (!account) return false;
    const segment = modeSegment(account, transitions, asOf);
    return segment.mode === 'holdings' && (segment.startDate === null || event.date >= segment.startDate);
  });
}

function eventsForCurrentModeSegment(events: readonly WealthEvent[], accounts: readonly WealthAccount[], transitions: readonly StoredModeTransition[], asOf: string): readonly WealthEvent[] {
  return resolveWealthEvents(events.filter((event) => event.date <= asOf)).filter((event) => eventInModeSegment(event, accounts, transitions, asOf));
}

async function loadAccounts(db: D1Database, context: FinancialContext) {
  const rows = await db.prepare(`SELECT ledger_id,id,name,kind,mode,currency,linked_bank_account_id,amount_minor,active,revision FROM wealth_accounts WHERE ledger_id=? ORDER BY id`).bind(context.ledgerId).all<StoredAccount>();
  return rows.results.map(accountView);
}
export async function readAccounts(db: D1Database, context: FinancialContext) {
  await assertFinancialAuthority(db, context, 'wealth:read');
  return loadAccounts(db, context);
}
export async function readInstruments(db: D1Database, context: FinancialContext) {
  await assertFinancialAuthority(db, context, 'wealth:read');
  const rows = await db.prepare(`SELECT id,exchange,ticker,type,currency,revision FROM wealth_instruments WHERE ledger_id=? ORDER BY exchange,ticker,id`).bind(context.ledgerId).all<StoredInstrument>();
  return rows.results.map(instrumentView);
}
async function loadStoredEvents(db: D1Database, context: FinancialContext): Promise<WealthEvent[]> {
  const rows = await db.prepare(`SELECT id,source_id,date,sequence,kind,account_id,from_account_id,to_account_id,linked_bank_source_id,payload_json FROM wealth_events WHERE ledger_id=? ORDER BY date,sequence,source_id,id`).bind(context.ledgerId).all<StoredEvent>();
  return rows.results.map(rowEvent);
}
export async function readStoredEvents(db: D1Database, context: FinancialContext): Promise<WealthEvent[]> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  return loadStoredEvents(db, context);
}
export async function readStoredValuations(db: D1Database, context: FinancialContext): Promise<(HoldingValuation & { valueMinor?: number; id: string })[]> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  const rows = await db.prepare(`SELECT id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision FROM wealth_valuations WHERE ledger_id=?
    UNION ALL
    SELECT id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision FROM wealth_valuation_corrections WHERE ledger_id=?`).bind(context.ledgerId, context.ledgerId).all<StoredValuation>();
  return latestValuationRows(rows.results).map((row) => {
    const payload = parseJson<Record<string, unknown>>(row.payload_json, 'valuation');
    const instrument = payload.instrument as CanonicalInstrument | null | undefined;
    return { id: row.id, accountId: row.account_id, instrument: instrument ?? { exchange: '', ticker: '', type: 'stock', currency: 'CAD' }, asOf: row.as_of, priceMinor: row.price_minor, source: row.source, provider: row.provider, ...(row.instrument_key === ACCOUNT_VALUE_KEY ? { valueMinor: row.price_minor } : {}) };
  });
}
async function readLinkedBalanceHistory(db: D1Database, context: FinancialContext): Promise<StoredBalance[]> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  const table = await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='wealth_linked_balance_observations'").first<{present:number}>();
  if (!table) return [];
  const rows = await db.prepare(`SELECT account_id AS accountId,currency,amount_minor AS amountMinor,observed_at AS observedAt,0 AS stale FROM wealth_linked_balance_observations WHERE ledger_id=? ORDER BY observed_at,account_id`).bind(context.ledgerId).all<StoredBalance>();
  return rows.results;
}
function mergeBalances(history: readonly StoredBalance[], latest: readonly StoredBalance[]): StoredBalance[] {
  const seen = new Set<string>(); const merged: StoredBalance[] = [];
  for (const balance of [...latest, ...history]) {
    const key = `${balance.accountId}|${balance.currency}|${balance.amountMinor}|${balance.observedAt}`;
    if (!seen.has(key)) { seen.add(key); merged.push(balance); }
  }
  return merged;
}
async function mergeProviderValuations(db: D1Database, context: FinancialContext, accounts: readonly WealthAccount[], transitions: readonly StoredModeTransition[], events: readonly WealthEvent[], valuations: readonly (HoldingValuation & { valueMinor?: number; id: string })[], asOf: string) {
  const accountInstruments = new Map<string, { instrument: WealthQuoteInstrument; accountIds: Set<string> }>();
  for (const event of events) {
    if (!('accountId' in event) || !('instrument' in event) || !event.instrument || !accounts.some((account) => account.id === event.accountId && modeAtDate(account, transitions, event.date) === 'holdings')) continue;
    const instrument = event.instrument as WealthQuoteInstrument; const key = instrumentKey(instrument); const current = accountInstruments.get(key) ?? { instrument, accountIds: new Set<string>() }; current.accountIds.add(event.accountId); accountInstruments.set(key, current);
  }
  if (accountInstruments.size === 0) return valuations;
  const quotes = await readWealthQuotes(db, context, [...accountInstruments.values()].map((entry) => entry.instrument), new Date(`${asOf}T23:59:59.999Z`));
  const existing = new Set(valuations.map((valuation) => `${valuation.accountId}:${valuation.instrument.exchange ? instrumentKey(valuation.instrument) : ACCOUNT_VALUE_KEY}:${valuation.asOf}`)); const merged = [...valuations];
  for (const quote of quotes) {
    const entry = accountInstruments.get(quote.instrumentKey); if (!entry) continue;
    for (const accountId of entry.accountIds) {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account || modeAtDate(account, transitions, quote.quoteDate) !== 'holdings') continue;
      const valuation = wealthQuoteToHoldingValuation(accountId, quote); const key = `${accountId}:${instrumentKey(valuation.instrument)}:${valuation.asOf}`;
      if (!existing.has(key)) { existing.add(key); merged.push({ ...valuation, id: `quote:${quote.revision}:${accountId}` }); }
    }
  }
  return merged;
}
function dateRange(query: WealthReportQuery): { asOf: string; from: string | null; to: string | null } {
  const asOf = query.asOf ? date(query.asOf, 'asOf') : new Date().toISOString().slice(0, 10);
  const from = query.from ? date(query.from, 'from') : null; const to = query.to ? date(query.to, 'to') : null;
  validateDateRange(from, to);
  return { asOf, from, to };
}

function validateDateRange(from: string | null, to: string | null): void {
  if (!from) return;
  if (!to) return;
  if (from <= to) return;
  throw new WealthStoreError('invalid_request', 'The report period is not valid.');
}

function linkedStatus(account: WealthAccount, balances: readonly StoredBalance[], asOf: string) {
  if (account.kind !== 'linked_bank' || !account.linkedBankAccountId) return null;
  const balance = balances.filter((candidate) => candidate.accountId === account.linkedBankAccountId && candidate.observedAt.slice(0, 10) <= asOf).sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.stale - left.stale)[0];
  if (!balance) return { state: 'missing' as const, balance: null, observedAt: null };
  if (balance.stale || balance.observedAt.slice(0, 10) > asOf) return { state: 'stale' as const, balance: null, observedAt: balance.observedAt };
  return { state: 'fresh' as const, balance: balance.amountMinor, observedAt: balance.observedAt };
}
function aggregateValue(account: WealthAccount & { amountMinor?: number | null }, valuations: readonly (HoldingValuation & { valueMinor?: number })[], balances: readonly StoredBalance[], asOf: string, historical: boolean) {
  if (account.mode !== 'aggregate') return null;
  const dated = valuations.filter((item) => item.accountId === account.id && item.asOf <= asOf && item.valueMinor !== undefined).sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
  if (dated) return { amount: account.kind === 'debt' ? -Math.abs(dated.valueMinor!) : dated.valueMinor!, observedAt: dated.asOf, state: 'fresh' as const };
  const linked = linkedStatus(account, balances, asOf);
  if (linked) return { amount: linked.balance === null ? null : account.kind === 'debt' ? -Math.abs(linked.balance) : linked.balance, observedAt: linked.observedAt, state: linked.state };
  if (historical) return { amount: null, observedAt: null, state: 'missing' as const };
  return { amount: null, observedAt: null, state: 'missing' as const };
}
function addTotal(target: Record<string, number>, currencyCode: string | undefined, amount: number | null) {
  if (!currencyCode || amount === null) return;
  target[currencyCode] = (target[currencyCode] ?? 0) + amount;
}

function wealthEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') {
    const replacement = event.replacement;
    return replacement.kind === 'transfer' ? [replacement.fromAccountId, replacement.toAccountId] : 'accountId' in replacement ? [replacement.accountId] : [];
  }
  return 'accountId' in event ? [event.accountId] : [];
}

function isPortfolioBaseEvent(event: WealthEvent, investmentIds: ReadonlySet<string>): boolean {
  if (event.kind === 'reversal' || event.kind === 'correction') return false;
  const accountIds = wealthEventAccountIds(event);
  return accountIds.length > 0 && accountIds.every((id) => investmentIds.has(id));
}

function addPortfolioControls(events: readonly WealthEvent[], sources: Set<string>): void {
  for (const event of events) {
    if (!isPortfolioControl(event)) continue;
    if (!sources.has(event.targetSourceId)) continue;
    sources.add(event.sourceId);
  }
}

function isPortfolioControl(event: WealthEvent): event is Extract<WealthEvent, { kind: 'reversal' | 'correction' }> {
  return event.kind === 'reversal' || event.kind === 'correction';
}

function portfolioEventSources(events: readonly WealthEvent[], investmentIds: ReadonlySet<string>): Set<string> {
  const sources = new Set(events.filter((event) => isPortfolioBaseEvent(event, investmentIds)).map((event) => event.sourceId));
  let previousSize = -1;
  while (sources.size !== previousSize) { previousSize = sources.size; addPortfolioControls(events, sources); }
  return sources;
}

function addAggregateStatus(target: Record<string, 'complete' | 'incomplete'>, currencyCode: string | undefined, state: 'fresh' | 'stale' | 'missing'): void {
  if (!currencyCode) return;
  if (state !== 'fresh') {
    target[currencyCode] = 'incomplete';
    return;
  }
  target[currencyCode] ??= 'complete';
}

async function domainSnapshot(
  accounts: readonly (WealthAccount & { amountMinor?: number | null })[], transitions: readonly StoredModeTransition[], events: readonly WealthEvent[], valuations: readonly (HoldingValuation & { valueMinor?: number })[], balances: readonly StoredBalance[], asOf: string, historical = false,
): Promise<WealthSnapshot & { accounts: readonly (WealthAccount & Record<string, unknown>)[]; balanceStatuses: readonly Record<string, unknown>[] }> {
  const datedAccounts = accountsAtDate(accounts, transitions, asOf);
  const registry = createWealthAccountRegistry(datedAccounts);
  const normalValuations = valuations.filter((item) => {
    if (!item.instrument.exchange) return false;
    const account = accounts.find((candidate) => candidate.id === item.accountId);
    if (!account) return false;
    const segment = modeSegment(account, transitions, asOf);
    return segment.mode === 'holdings' && (segment.startDate === null || item.asOf >= segment.startDate);
  });
  const domainEvents = eventsForCurrentModeSegment(events, datedAccounts, transitions, asOf);
  const base = createWealthSnapshot(domainEvents, { asOf, accounts: registry, valuations: normalValuations });
  const totals = { ...base.totalByCurrency } as Record<string, number>;
  const totalStatusByCurrency = { ...base.totalStatusByCurrency } as Record<string, 'complete' | 'incomplete'>;
  const statuses: Record<string, unknown>[] = [];
  const renderedAccounts = datedAccounts.map((account) => {
    const value = aggregateValue(account, valuations, balances, asOf, historical);
    if (value) { addTotal(totals, account.currency, value.amount); addAggregateStatus(totalStatusByCurrency, account.currency, value.state); statuses.push({ accountId: account.id, state: value.state, observedAt: value.observedAt }); }
    return { ...account, ...(value ? { valueMinor: value.amount, valueState: value.state, valueObservedAt: value.observedAt } : {}) };
  });
  return { ...base, accounts: renderedAccounts, totalByCurrency: Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))), totalStatusByCurrency: Object.fromEntries(Object.entries(totalStatusByCurrency).sort(([left], [right]) => left.localeCompare(right))), balanceStatuses: statuses };
}

interface TransactionRow { id: string; account_id: string; account_name: string | null; wealth_account_id: string | null; wealth_account_name: string | null; merchant: string; date: string; amount_minor: number; currency: string; category: string | null; kind: 'expense' | 'income' | 'refund' | 'fee'; status: string; source: string | null }
interface TransactionAliasRow { transaction_id: string; id: string; identity_key: string; provider_transaction_id: string | null; provider_pending_transaction_id: string | null; bank_source_id: string | null; bank_row_id: string | null; event_id: string | null; bank_reference: string | null }
type StoredCashFlowRecord = WealthCashFlowRecord & { transactionId: string; accountName: string | null; merchant: string; category: string | null; bankKind: TransactionRow['kind']; source: string | null; status: string; linkConflict?: boolean };
type CashFlowSummaryRecord = WealthCashFlowRecord & { classification?: ClassifiedWealthCashFlow['classification']; bankKind?: TransactionRow['kind']; linkConflict?: boolean; confirmed?: boolean; reason?: string };
interface CashFlowTotal { inflowMinor: number; outflowMinor: number; netMinor: number; incomeMinor: number; expenseMinor: number; refundMinor: number; feeMinor: number }
type InvestmentEventKind = 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal';
type InvestmentCashFlowRecord = ClassifiedWealthCashFlow & { eventKind?: InvestmentEventKind; bankKind?: TransactionRow['kind']; confirmed?: boolean };

type ExternalPortfolioEvent = Extract<WealthEvent, { kind: 'contribution' | 'withdrawal' }>;
type InvestmentCashEvent = Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal' }>;
type InvestmentTradeEvent = Extract<WealthEvent, { kind: 'buy' | 'sell' }>;
type InvestmentCashFlowInput = WealthCashFlowRecord & { embeddedTradeFee?: true };

function visibleEffectiveEvents(events: readonly WealthEvent[], asOf: string): readonly WealthEvent[] {
  return resolveWealthEvents(events.filter((event) => event.date <= asOf));
}

function isExternalPortfolioEvent(event: WealthEvent, investmentIds: ReadonlySet<string>): event is ExternalPortfolioEvent {
  return (event.kind === 'contribution' || event.kind === 'withdrawal') && investmentIds.has(event.accountId);
}

function isInvestmentCashEvent(event: WealthEvent, investmentIds: ReadonlySet<string>): event is InvestmentCashEvent {
  return ['dividend', 'withholding', 'fee', 'contribution', 'withdrawal'].includes(event.kind) && 'accountId' in event && investmentIds.has(event.accountId);
}

function eventCashFlowRecord(event: InvestmentCashEvent): WealthCashFlowRecord {
  const inflow = event.kind === 'contribution' || event.kind === 'dividend';
  return {
    sourceId: event.sourceId,
    date: event.date,
    accountId: event.accountId,
    money: event.money,
    direction: inflow ? 'inflow' : 'outflow',
    kind: inflow ? 'contribution' : 'withdrawal',
    linkedWealthSourceId: event.sourceId,
  };
}

function embeddedTradeFeeRecord(event: InvestmentTradeEvent): InvestmentCashFlowInput | null {
  if (!event.fee || event.fee.amountMinor === 0) return null;
  return {
    sourceId: `${event.sourceId}:fee`,
    date: event.date,
    accountId: event.accountId,
    money: event.fee,
    direction: 'outflow',
    kind: 'withdrawal',
    embeddedTradeFee: true,
  };
}

function investmentEventInRange(event: WealthEvent, investmentIds: ReadonlySet<string>, from: string | null, to: string | null): boolean {
  return 'accountId' in event && investmentIds.has(event.accountId) && (!from || event.date >= from) && (!to || event.date <= to);
}

function investmentEventCashFlows(event: WealthEvent, investmentIds: ReadonlySet<string>): InvestmentCashFlowInput[] {
  const records: InvestmentCashFlowInput[] = [];
  if (isInvestmentCashEvent(event, investmentIds)) records.push(eventCashFlowRecord(event));
  if (event.kind === 'buy' || event.kind === 'sell') {
    const fee = embeddedTradeFeeRecord(event);
    if (fee) records.push(fee);
  }
  return records;
}

function eventCashFlowRecords(events: readonly WealthEvent[], investmentIds: ReadonlySet<string>, from: string | null, to: string | null): InvestmentCashFlowInput[] {
  return events.filter((event) => investmentEventInRange(event, investmentIds, from, to)).flatMap((event) => investmentEventCashFlows(event, investmentIds));
}

function portfolioBankRecords(records: readonly StoredCashFlowRecord[], eventSources: ReadonlySet<string>): StoredCashFlowRecord[] {
  return records.filter((record) => {
    const sourceId = record.linkedWealthSourceId;
    return typeof sourceId === 'string' && eventSources.has(sourceId);
  });
}

interface PortfolioFlowQuery { readonly records: readonly StoredCashFlowRecord[]; readonly events: readonly WealthEvent[]; readonly investmentIds: ReadonlySet<string>; readonly from?: string | null; readonly to?: string | null }

function portfolioFlowRecords(query: PortfolioFlowQuery): InvestmentCashFlowInput[] {
  const portfolioEvents = query.events.filter((event) => isPortfolioBaseEvent(event, query.investmentIds));
  const eventSources = new Set(portfolioEvents.map((event) => event.sourceId));
  const bankRecords = portfolioBankRecords(query.records, eventSources);
  const linkedSources = new Set(bankRecords.map((record) => record.linkedWealthSourceId).filter((source): source is string => Boolean(source)));
  const manualRecords = eventCashFlowRecords(portfolioEvents, query.investmentIds, query.from ?? null, query.to ?? null).filter((record) => !linkedSources.has(record.linkedWealthSourceId ?? ''));
  return [...bankRecords, ...manualRecords];
}

function isInvestmentIncomeEvent(event: WealthEvent | undefined): event is Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' }> {
  return event?.kind === 'dividend' || event?.kind === 'withholding' || event?.kind === 'fee';
}

function investmentFlowBankKind(kind: InvestmentEventKind): TransactionRow['kind'] {
  return kind === 'dividend' ? 'income' : kind === 'contribution' || kind === 'withdrawal' ? 'income' : 'fee';
}

type ClassifiedInvestmentInput = ClassifiedWealthCashFlow & { embeddedTradeFee?: true };

function classifyEmbeddedTradeFee(flow: ClassifiedInvestmentInput): InvestmentCashFlowRecord | null {
  if (!flow.embeddedTradeFee) return null;
  const { embeddedTradeFee: _embeddedTradeFee, ...record } = flow;
  return { ...record, eventKind: 'fee', bankKind: 'fee', confirmed: true, includedInPerformance: false, reason: 'Embedded trade fee; trade principal remains excluded from cash-flow totals.' };
}

function classifyInvestmentIncomeFlow(flow: ClassifiedWealthCashFlow, event: Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' }>): InvestmentCashFlowRecord {
  const eventKind = event.kind;
  const expectedDirection = eventKind === 'dividend' ? 'inflow' : 'outflow';
  const bankMatch = flow.kind !== 'bank' || (flow.direction === expectedDirection && sameMoney(flow.money, event.money));
  return { ...flow, eventKind, bankKind: investmentFlowBankKind(eventKind), confirmed: bankMatch, includedInPerformance: false, reason: bankMatch ? 'Recorded investment income or expense; excluded from external capital flows.' : 'Linked bank amount does not agree with the recorded investment income or expense.' };
}

function classifyInvestmentFlow(flow: ClassifiedInvestmentInput, eventsBySource: ReadonlyMap<string, WealthEvent>): InvestmentCashFlowRecord {
  const embeddedFee = classifyEmbeddedTradeFee(flow);
  if (embeddedFee) return embeddedFee;
  const event = flow.linkedWealthSourceId ? eventsBySource.get(flow.linkedWealthSourceId) : undefined;
  return isInvestmentIncomeEvent(event) ? classifyInvestmentIncomeFlow(flow, event) : flow;
}

function classifyInvestmentCashFlows(records: readonly WealthCashFlowRecord[], events: readonly WealthEvent[]): InvestmentCashFlowRecord[] {
  const classified = classifyWealthCashFlows(records, events) as ClassifiedInvestmentInput[];
  const eventsBySource = new Map(events.map((event) => [event.sourceId, event]));
  return classified.map((flow) => classifyInvestmentFlow(flow, eventsBySource));
}

function sameMoney(left: WealthCashFlowRecord['money'], right: WealthCashFlowRecord['money']): boolean {
  return left.currency.toUpperCase() === right.currency.toUpperCase() && left.amountMinor === right.amountMinor;
}

function emptyCashFlowTotal(): CashFlowTotal {
  return { inflowMinor: 0, outflowMinor: 0, netMinor: 0, incomeMinor: 0, expenseMinor: 0, refundMinor: 0, feeMinor: 0 };
}

function addFlowDirection(total: CashFlowTotal, flow: WealthCashFlowRecord): void {
  if (flow.direction === 'inflow') { total.inflowMinor += flow.money.amountMinor; total.netMinor += flow.money.amountMinor; }
  if (flow.direction === 'outflow') { total.outflowMinor += flow.money.amountMinor; total.netMinor -= flow.money.amountMinor; }
}

function addBankCategory(total: CashFlowTotal, kind: TransactionRow['kind'] | undefined, amount: number): void {
  if (kind === 'income') total.incomeMinor += amount;
  if (kind === 'expense') total.expenseMinor += amount;
  if (kind === 'refund') total.refundMinor += amount;
  if (kind === 'fee') total.feeMinor += amount;
}

function addInvestmentCategory(total: CashFlowTotal, kind: InvestmentEventKind | undefined, amount: number): void {
  if (kind === 'dividend') total.incomeMinor += amount;
  if (kind === 'withholding') total.expenseMinor += amount;
  if (kind === 'fee') { total.expenseMinor += amount; total.feeMinor += amount; }
}

function summarizeInvestmentCashFlows(flows: readonly InvestmentCashFlowRecord[]): Readonly<Record<string, CashFlowTotal>> {
  return summarizeFlowTotals(flows, (total, flow) => addInvestmentCategory(total, flow.eventKind, flow.money.amountMinor));
}

function summarizeCashFlows(flows: readonly CashFlowSummaryRecord[]): Readonly<Record<string, CashFlowTotal>> {
  return summarizeFlowTotals(flows, (total, flow) => addBankCategory(total, flow.bankKind, flow.money.amountMinor));
}

function summarizeFlowTotals<T extends CashFlowSummaryRecord>(flows: readonly T[], addCategory: (total: CashFlowTotal, flow: T) => void): Readonly<Record<string, CashFlowTotal>> {
  const totals: Record<string, CashFlowTotal> = {};
  for (const flow of flows) {
    if (!summaryEligible(flow)) continue;
    const code = flow.money.currency.toUpperCase();
    const current = totals[code] ?? emptyCashFlowTotal();
    addFlowDirection(current, flow);
    addCategory(current, flow);
    totals[code] = current;
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)));
}

function summaryEligible(flow: CashFlowSummaryRecord): boolean {
  if (flow.classification === 'trade' || flow.classification === 'internal_transfer') return false;
  if (flow.linkConflict || flow.confirmed === false) return false;
  return flow.reason !== 'Conflicting bank records share one explicit wealth link.';
}

async function cashFlowRecords(db: D1Database, context: FinancialContext, events: readonly WealthEvent[]): Promise<StoredCashFlowRecord[]> {
  const [rows, aliases] = await Promise.all([
    db.prepare(`SELECT t.id,t.account_id,t.merchant,t.date,t.amount_minor,t.currency,t.category,t.kind,t.status,t.source,
      (SELECT a.name FROM accounts a WHERE a.ledger_id=t.ledger_id AND a.id=t.account_id LIMIT 1) AS account_name,
      (SELECT wa.id FROM wealth_accounts wa WHERE wa.ledger_id=t.ledger_id AND wa.linked_bank_account_id=t.account_id ORDER BY wa.id LIMIT 1) AS wealth_account_id,
      (SELECT wa.name FROM wealth_accounts wa WHERE wa.ledger_id=t.ledger_id AND wa.linked_bank_account_id=t.account_id ORDER BY wa.id LIMIT 1) AS wealth_account_name
      FROM transactions t WHERE t.ledger_id=? AND t.status='confirmed' AND t.kind IN ('income','expense','refund','fee') ORDER BY t.date,t.id`).bind(context.ledgerId).all<TransactionRow>(),
    db.prepare(`SELECT transaction_id,id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference
      FROM transaction_source_records WHERE ledger_id=? ORDER BY transaction_id,id`).bind(context.ledgerId).all<TransactionAliasRow>(),
  ]);
  const aliasesByTransaction = new Map<string, Set<string>>();
  const sourceRecordByTransaction = new Map<string, string>();
  for (const alias of aliases.results) {
    const values = [alias.id, alias.identity_key, alias.provider_transaction_id, alias.provider_pending_transaction_id, alias.bank_source_id, alias.bank_row_id, alias.event_id, alias.bank_reference].filter((value): value is string => Boolean(value));
    const set = aliasesByTransaction.get(alias.transaction_id) ?? new Set<string>();
    values.forEach((value) => set.add(value));
    aliasesByTransaction.set(alias.transaction_id, set);
    sourceRecordByTransaction.set(alias.transaction_id, sourceRecordByTransaction.get(alias.transaction_id) ?? alias.id);
  }
  return rows.results.map((row) => {
    const candidates = aliasesByTransaction.get(row.id) ?? new Set<string>([row.id]);
    const linked = events.filter((event) => event.linkedBankSourceId && candidates.has(event.linkedBankSourceId));
    const linkedSources = [...new Set(linked.map((event) => event.sourceId))];
    const linkConflict = linkedSources.length > 1;
    return { sourceId: sourceRecordByTransaction.get(row.id) ?? row.id, transactionId: row.id, merchant: row.merchant, accountName: row.wealth_account_name ?? row.account_name, date: row.date, accountId: row.wealth_account_id ?? row.account_id, category: row.category, bankKind: row.kind, source: row.source, status: row.status, money: { currency: row.currency, amountMinor: Math.abs(row.amount_minor) }, direction: row.kind === 'income' || row.kind === 'refund' ? 'inflow' : 'outflow', kind: 'bank', linkedWealthSourceId: linkConflict ? null : linkedSources[0] ?? null, ...(linkConflict ? { linkConflict: true } : {}) };
  });
}
function emptyFxProvenance(): Pick<WealthFxStatus, 'effectiveDate' | 'provider' | 'baseCurrency' | 'rates'> {
  return { effectiveDate: null, provider: null, baseCurrency: null, rates: {} };
}

function fxProvenance(rates: ValidatedFxRates | null, totals: Readonly<Record<string, number>>, requested: string): Pick<WealthFxStatus, 'effectiveDate' | 'provider' | 'baseCurrency' | 'rates'> {
  const sourceCodes = Object.keys(totals).filter((code) => code !== requested);
  if (!rates || sourceCodes.length === 0) return emptyFxProvenance();
  const requiredQuotes = new Set<string>();
  for (const sourceCode of sourceCodes) {
    if (sourceCode !== 'EUR') requiredQuotes.add(sourceCode);
    if (requested !== 'EUR') requiredQuotes.add(requested);
  }
  const quotedRates = Object.fromEntries([...requiredQuotes].sort().flatMap((quote) => {
    const rate = rates.rates[quote];
    return rate === undefined ? [] : [[quote, rate] as const];
  }));
  return { effectiveDate: rates.effectiveDate, provider: 'frankfurter', baseCurrency: 'EUR', rates: quotedRates };
}

function incompleteCurrencyCodes(statusByCurrency: Readonly<Record<string, string>>): readonly string[] {
  return Object.entries(statusByCurrency).filter(([, status]) => status === 'incomplete').map(([currency]) => currency);
}

function normalizeWealthReportingCurrency(value: string | null): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  if (!code) return null;
  if (code !== 'CAD') throw new WealthStoreError('invalid_request', 'Wealth reports support CAD as the converted reporting currency.');
  return code;
}

async function convertTotals(db: D1Database, totals: Readonly<Record<string, number>>, requested: string | null, asOf: string, dependencies: WealthReportDependencies = {}, statusByCurrency: Readonly<Record<string, string>> = {}): Promise<WealthFxStatus> {
  const target = normalizeWealthReportingCurrency(requested);
  if (!target) return { convertedCadMinor: null, complete: false, unavailable: [], ...emptyFxProvenance() };
  let total = 0; const unavailable: string[] = [];
  const row = await readFxSnapshot(db, asOf);
  let rates: ReturnType<typeof parseFrankfurterRates> | null = null;
  if (row) {
    try { rates = parseFrankfurterRates(Object.entries(JSON.parse(row.rates_json) as Record<string, unknown>).map(([quote, rate]) => ({ date: row.effective_date, base: 'EUR', quote, rate }))); } catch { rates = null; }
  }
  if (!rates && dependencies.fetcher) {
    try { rates = await warmFxSnapshot(db, asOf, dependencies); } catch { rates = null; }
  }
  for (const [code, amount] of Object.entries(totals)) {
    if (code === target) total += amount;
    else {
      const converted = rates ? convertMinorUnits({ amountMinorUnits: amount, sourceCode: code, targetCode: target, rates }) : null;
      if (converted === null) unavailable.push(code); else total += converted;
    }
  }
  const incomplete = incompleteCurrencyCodes(statusByCurrency);
  const complete = unavailable.length === 0 && incomplete.length === 0;
  return { convertedCadMinor: complete ? total : null, complete, unavailable, ...fxProvenance(rates, totals, target) };
}

type SnapshotAccount = WealthAccount & { amountMinor?: number | null; valueMinor?: number | null; valueState?: 'fresh' | 'stale' | 'missing'; valueObservedAt?: string | null };
type SnapshotWithStatus = Omit<WealthSnapshot, 'accounts'> & { accounts: readonly SnapshotAccount[]; balanceStatuses: readonly Record<string, unknown>[] };
interface WealthHistoryPointInternal extends WealthHistoryPoint {}

function addBalanceCoverage(snapshot: SnapshotWithStatus, missing: Set<string>): boolean {
  let stale = false;
  for (const status of snapshot.balanceStatuses) {
    const accountId = typeof status.accountId === 'string' ? status.accountId : null;
    if (status.state === 'stale') stale = true;
    if (accountId && status.state === 'missing') missing.add(`account:${accountId}`);
  }
  return stale;
}

function addValuationCoverage(snapshot: SnapshotWithStatus, missing: Set<string>): void {
  for (const [currencyCode, state] of Object.entries(snapshot.totalStatusByCurrency)) if (state === 'incomplete') missing.add(`valuation:${currencyCode}`);
  for (const position of snapshot.positions) if (position.quantity !== '0' && position.valuation === null) missing.add(`position:${position.accountId}:${instrumentKey(position.instrument)}`);
}

function snapshotCoverage(snapshot: SnapshotWithStatus) {
  const missing = new Set<string>();
  const stale = addBalanceCoverage(snapshot, missing);
  addValuationCoverage(snapshot, missing);
  return { stale, missingData: [...missing].sort() };
}

function missingAccountObservation(account: SnapshotAccount, point: string): string | null {
  if (account.mode !== 'aggregate') return null;
  if (!account.valueObservedAt) return null;
  if (account.valueObservedAt.slice(0, 10) === point) return null;
  return `account:${account.id}:observation`;
}

function missingPositionObservation(position: WealthSnapshot['positions'][number], point: string): string | null {
  if (position.quantity === '0') return null;
  if (position.valuation?.asOf === point) return null;
  return `position:${position.accountId}:${instrumentKey(position.instrument)}:observation`;
}

function historyPointCoverage(snapshot: SnapshotWithStatus, point: string): { readonly complete: boolean; readonly stale: boolean; readonly missingData: readonly string[] } {
  const quality = snapshotCoverage(snapshot);
  const observations = [
    ...snapshot.accounts.map((account) => missingAccountObservation(account, point)),
    ...snapshot.positions.map((position) => missingPositionObservation(position, point)),
  ].filter((value): value is string => value !== null);
  const missingData = [...new Set([...quality.missingData, ...observations])].sort();
  const valuesComplete = Object.values(snapshot.totalStatusByCurrency).every((state) => state === 'complete');
  return { complete: !quality.stale && missingData.length === 0 && valuesComplete, stale: quality.stale, missingData };
}

type AllocationDraft = Omit<WealthAllocationRow, 'share'>;

function investmentAccountIds(snapshot: SnapshotWithStatus): ReadonlySet<string> {
  return new Set(snapshot.accounts.filter((account) => account.kind === 'brokerage').map((account) => account.id));
}

function allocationDrafts(snapshot: SnapshotWithStatus): AllocationDraft[] {
  const ids = investmentAccountIds(snapshot);
  const holdingsIds = new Set(snapshot.accounts.filter((account) => ids.has(account.id) && account.mode === 'holdings').map((account) => account.id));
  const aggregate = snapshot.accounts.filter((account) => ids.has(account.id) && account.mode === 'aggregate' && account.currency).map((account) => ({ currency: account.currency!.toUpperCase(), accountId: account.id, kind: 'aggregate' as const, instrument: null, valueMinor: account.valueMinor ?? null, available: account.valueState === 'fresh' && account.valueMinor !== null }));
  const cash = snapshot.cash.filter((balance) => holdingsIds.has(balance.accountId)).map((balance) => ({ currency: balance.currency.toUpperCase(), accountId: balance.accountId, kind: 'cash' as const, instrument: null, valueMinor: balance.amountMinor, available: true }));
  const holdings = snapshot.positions.filter((position) => holdingsIds.has(position.accountId) && position.quantity !== '0').map((position) => ({ currency: position.instrument.currency.toUpperCase(), accountId: position.accountId, kind: 'holding' as const, instrument: position.instrument, valueMinor: position.marketValueMinor, available: position.marketValueMinor !== null }));
  return [...aggregate, ...cash, ...holdings];
}

function allocationTotals(rows: readonly AllocationDraft[]): { totals: ReadonlyMap<string, number>; incomplete: ReadonlySet<string> } {
  const totals = new Map<string, number>();
  const incomplete = new Set<string>();
  for (const row of rows) {
    if (row.valueMinor === null) { incomplete.add(row.currency); continue; }
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.valueMinor);
  }
  return { totals, incomplete };
}

function allocationRowShare(row: AllocationDraft, totals: ReadonlyMap<string, number>, incomplete: ReadonlySet<string>): number | null {
  const total = totals.get(row.currency) ?? 0;
  if (allocationUnavailable(row, total, incomplete)) return null;
  if (row.valueMinor === null) return null;
  return row.valueMinor / total;
}

function allocationUnavailable(row: AllocationDraft, total: number, incomplete: ReadonlySet<string>): boolean {
  if (!row.available || incomplete.has(row.currency)) return true;
  if (row.valueMinor === null) return true;
  return total === 0;
}

function compareAllocationRows(left: WealthAllocationRow, right: WealthAllocationRow): number {
  const leftKey = allocationSortKey(left);
  const rightKey = allocationSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const comparison = leftKey[index].localeCompare(rightKey[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function allocationSortKey(row: WealthAllocationRow): readonly string[] {
  return [row.currency, row.accountId, row.kind, row.instrument?.exchange ?? '', row.instrument?.ticker ?? ''];
}

function wealthAllocationRows(snapshot: SnapshotWithStatus): readonly WealthAllocationRow[] {
  const drafts = allocationDrafts(snapshot);
  const { totals, incomplete } = allocationTotals(drafts);
  return drafts.map((row) => ({ ...row, share: allocationRowShare(row, totals, incomplete) })).sort(compareAllocationRows);
}

async function buildWealthHistory(
  db: D1Database,
  accounts: readonly (WealthAccount & { amountMinor?: number | null })[],
  transitions: readonly StoredModeTransition[],
  events: readonly WealthEvent[],
  valuations: readonly (HoldingValuation & { valueMinor?: number })[],
  balances: readonly StoredBalance[],
  asOf: string,
  reportingCurrency: string | null,
  dependencies: WealthReportDependencies = {},
): Promise<WealthHistoryPointInternal[]> {
  const dates = new Set<string>();
  for (const event of events) if (event.date <= asOf) dates.add(event.date);
  for (const valuation of valuations) if (valuation.asOf <= asOf) dates.add(valuation.asOf);
  for (const balance of balances) if (balance.observedAt.slice(0, 10) <= asOf) dates.add(balance.observedAt.slice(0, 10));
  const history: WealthHistoryPointInternal[] = [];
  for (const point of [...dates].sort()) {
    const pointSnapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, point, true);
    const conversion = await convertTotals(db, pointSnapshot.totalByCurrency, reportingCurrency, point, dependencies, pointSnapshot.totalStatusByCurrency);
    const coverage = historyPointCoverage(pointSnapshot, point);
    history.push({ date: point, totals: pointSnapshot.totalByCurrency, convertedCadMinor: conversion.convertedCadMinor, ...coverage });
  }
  return history;
}

function unavailableDietz(): ModifiedDietzResult {
  return { value: null, available: false, reason: 'incomplete_flows' };
}

interface DietzValues {
  readonly startValues: Readonly<Record<string, number>> | null | undefined;
  readonly endValues: Readonly<Record<string, number>> | null | undefined;
}
interface DietzPeriod {
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}
interface DietzByCurrencyInput extends DietzValues, DietzPeriod {
  readonly flows: readonly ClassifiedWealthCashFlow[];
}

function currencyDietz(
  currencyCode: string,
  values: DietzValues,
  flows: readonly ClassifiedWealthCashFlow[],
  period: DietzPeriod,
): ModifiedDietzResult {
  const currencyFlows = flows.filter((flow) => flow.money.currency.toUpperCase() === currencyCode);
  const performanceFlows = currencyFlows.filter((flow) => flow.includedInPerformance);
  if (performanceFlows.some((flow) => flow.classification === 'ambiguous')) return unavailableDietz();
  if (!period.periodStart || !period.periodEnd) return unavailableDietz();
  return calculateModifiedDietz(values.startValues?.[currencyCode] ?? null, values.endValues?.[currencyCode] ?? null, performanceFlows, period.periodStart, period.periodEnd);
}

function modifiedDietzByCurrency(input: DietzByCurrencyInput): Readonly<Record<string, ModifiedDietzResult>> {
  const currencies = new Set<string>([...Object.keys(input.startValues ?? {}), ...Object.keys(input.endValues ?? {}), ...input.flows.map((flow) => flow.money.currency.toUpperCase())]);
  const period = { periodStart: input.periodStart, periodEnd: input.periodEnd };
  const values = { startValues: input.startValues, endValues: input.endValues };
  return Object.fromEntries([...currencies].sort().map((currencyCode) => [currencyCode, currencyDietz(currencyCode, values, input.flows, period)]));
}

export async function readWealthSnapshot(db: D1Database, context: FinancialContext, query: Pick<WealthReportQuery, 'asOf' | 'reportingCurrency'> = {}, dependencies: WealthReportDependencies = {}) {
  const { asOf } = dateRange(query);
  const [accounts, transitions, events, storedValuations, latestBalances, balanceHistory] = await Promise.all([readAccounts(db, context), loadModeTransitions(db, context), readStoredEvents(db, context), readStoredValuations(db, context), readLunchFlowBalances(db, context), readLinkedBalanceHistory(db, context)]);
  const effectiveEvents = visibleEffectiveEvents(events, asOf);
  const balances = mergeBalances(balanceHistory, latestBalances);
  const valuations = await mergeProviderValuations(db, context, accounts, transitions, events, storedValuations, asOf);
  const snapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, asOf);
  const [history, records] = await Promise.all([
    buildWealthHistory(db, accounts, transitions, events, valuations, balances, asOf, query.reportingCurrency ?? null, dependencies),
    cashFlowRecords(db, context, effectiveEvents),
  ]);
  const quality = snapshotCoverage(snapshot);
  const cashFlows = classifyWealthCashFlows(records.filter((record) => record.date <= asOf), effectiveEvents);
  return {
    ...snapshot,
    allocations: wealthAllocationRows(snapshot),
    history,
    cashFlows,
    cashFlowTotals: summarizeCashFlows(cashFlows),
    modifiedDietz: { value: null, available: false, reason: 'missing_end_valuation' as const },
    stale: quality.stale,
    missingData: quality.missingData,
    revision: await currentRevision(db, context),
    fx: await convertTotals(db, snapshot.totalByCurrency, query.reportingCurrency ?? null, asOf, dependencies, snapshot.totalStatusByCurrency),
  };
}

export async function readWealthReport(db: D1Database, context: FinancialContext, query: WealthReportQuery = {}, dependencies: WealthReportDependencies = {}): Promise<WealthReport & { history: readonly WealthHistoryPoint[]; revision: number; balanceStatuses: readonly Record<string, unknown>[]; stale: boolean; missingData: readonly string[]; fx: WealthFxStatus; cashFlowTotals: Readonly<Record<string, CashFlowTotal>>; householdCashFlows: readonly WealthCashFlowRecord[]; investmentCashFlows: readonly InvestmentCashFlowRecord[]; investmentCashFlowTotals: Readonly<Record<string, CashFlowTotal>>; modifiedDietzByCurrency: Readonly<Record<string, ModifiedDietzResult>>; allocations: readonly WealthAllocationRow[] }> {
  const range = dateRange(query);
  const [accounts, transitions, events, storedValuations, latestBalances, balanceHistory] = await Promise.all([readAccounts(db, context), loadModeTransitions(db, context), readStoredEvents(db, context), readStoredValuations(db, context), readLunchFlowBalances(db, context), readLinkedBalanceHistory(db, context)]);
  const effectiveEvents = visibleEffectiveEvents(events, range.asOf);
  const balances = mergeBalances(balanceHistory, latestBalances);
  const valuations = await mergeProviderValuations(db, context, accounts, transitions, events, storedValuations, range.asOf);
  const historyInternal = await buildWealthHistory(db, accounts, transitions, events, valuations, balances, range.asOf, query.reportingCurrency ?? null, dependencies);
  const history = historyInternal;
  const snapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, range.asOf);
  const records = await cashFlowRecords(db, context, effectiveEvents);
  const filtered = records.filter((record) => (!range.from || record.date >= range.from) && (!range.to || record.date <= range.to));
  const investmentAccounts = accounts.filter((account) => account.kind === 'brokerage');
  const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
  const reportInvestmentAccounts = accountsAtDate(investmentAccounts, transitions, range.asOf);
  // Cash-flow classification and Dietz use the complete resolved portfolio
  // ledger. Snapshot replay remains segment-scoped, but a flow before a later
  // representation transition must still be included in the period return.
  const investmentEvents = effectiveEvents.filter((event) => isPortfolioBaseEvent(event, investmentAccountIds));
  const investmentValuations = valuations.filter((valuation) => investmentAccountIds.has(valuation.accountId));
  // Aggregate brokerage values are already represented by the portfolio
  // start/end totals. They use the account-value valuation key and have no
  // instrument; only holding prices belong in the domain report valuation
  // list, which normalizes instruments while replaying positions.
  const reportValuations = investmentValuations.filter((valuation) => Boolean(valuation.instrument.exchange));
  const portfolioEventIds = portfolioEventSources(events, investmentAccountIds);
  const portfolioHistoryEvents = events.filter((event) => portfolioEventIds.has(event.sourceId));
  const portfolioHistory = await buildWealthHistory(db, investmentAccounts, transitions, portfolioHistoryEvents, investmentValuations, [], range.asOf, query.reportingCurrency ?? null, dependencies);
  const startPoint = range.from ? portfolioHistory.find((point) => point.date === range.from && point.complete) : undefined;
  const endPoint = range.to ? portfolioHistory.find((point) => point.date === range.to && point.complete) : undefined;
  const investmentRecords = portfolioFlowRecords({ records: filtered, events: investmentEvents, investmentIds: investmentAccountIds, from: range.from, to: range.to });
  // Valuations are end-of-day observations. The domain Dietz helper therefore
  // ignores start-date flows (already included in the opening observation) and
  // keeps end-date flows with zero time weight so they are removed from the
  // ending balance without being treated as return.
  const dietzRecords = investmentRecords.filter((record) => {
    if (range.from && record.date <= range.from) return false;
    const linked = record.linkedWealthSourceId ? investmentEvents.find((event) => event.sourceId === record.linkedWealthSourceId) : undefined;
    return linked?.kind === 'contribution' || linked?.kind === 'withdrawal';
  });
  const investmentCashFlows = classifyInvestmentCashFlows(investmentRecords, investmentEvents);
  const report = createWealthReport(investmentEvents, dietzRecords, { asOf: range.asOf, accounts: reportInvestmentAccounts, valuations: reportValuations, startValuation: startPoint?.totals ?? null, endValuation: endPoint?.totals ?? null, periodStart: range.from ?? undefined, periodEnd: range.to ?? undefined });
  const dietzByCurrency = modifiedDietzByCurrency({ startValues: startPoint?.totals ?? null, endValues: endPoint?.totals ?? null, flows: investmentCashFlows, periodStart: range.from, periodEnd: range.to });
  const quality = snapshotCoverage(snapshot);
  const householdCashFlows = classifyWealthCashFlows(filtered, effectiveEvents);
  return { ...report, ...snapshot, allocations: wealthAllocationRows(snapshot), cashFlows: householdCashFlows, cashFlowTotals: summarizeCashFlows(householdCashFlows), householdCashFlows, investmentCashFlows, investmentCashFlowTotals: summarizeInvestmentCashFlows(investmentCashFlows), modifiedDietzByCurrency: dietzByCurrency, history, revision: await currentRevision(db, context), balanceStatuses: snapshot.balanceStatuses, stale: quality.stale, missingData: quality.missingData, fx: await convertTotals(db, snapshot.totalByCurrency, query.reportingCurrency ?? null, range.asOf, dependencies, snapshot.totalStatusByCurrency) };
}

export async function validateExpected(db: D1Database, context: FinancialContext, expected: number) {
  const actual = await currentRevision(db, context);
  if (expected !== actual) throw new WealthRevisionConflictError(actual);
}

export async function upsertWealthAccount(db: D1Database, context: FinancialContext, input: WealthAccountInput): Promise<{ account: WealthAccount & Record<string, unknown>; revision: number }> {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const body = object(input); const revision = await currentRevision(db, context);
  const id = bounded(body.id, 'account id', 128); const name = bounded(body.name, 'account name', 160); const kind = body.kind; const mode = body.mode;
  if (!['linked_bank', 'manual_asset', 'debt', 'brokerage'].includes(String(kind))) throw new WealthStoreError('invalid_request', 'The account kind is not supported.');
  if (mode !== 'aggregate' && mode !== 'holdings') throw new WealthStoreError('invalid_request', 'The account mode is not supported.');
  if (mode === 'holdings' && kind !== 'brokerage') throw new WealthStoreError('account_mode_conflict', 'Only brokerage accounts support holdings plus cash representation.');
  const code = currency(body.currency, 'account currency', true); const linkedBankAccountId = optionalBounded(body.linkedBankAccountId, 'linked bank account id', 128); const amountMinor = body.amountMinor === undefined ? null : integer(body.amountMinor, 'amountMinor', true); const active = body.active === undefined ? true : body.active === true;
  if (kind === 'linked_bank' && !linkedBankAccountId) throw new WealthStoreError('invalid_request', 'A linked bank account is required.');
  if (kind !== 'linked_bank' && linkedBankAccountId) throw new WealthStoreError('invalid_request', 'Only linked bank wealth accounts may reference a bank account.');
  if (kind === 'linked_bank' && mode !== 'aggregate') throw new WealthStoreError('invalid_request', 'Linked bank wealth accounts must be aggregate accounts.');
  await validateLinkedBankReference(db, context, linkedBankAccountId);
  await assertLinkedBankUnique(db, context, id, linkedBankAccountId);
  const existing = await db.prepare('SELECT mode,kind,currency,linked_bank_account_id FROM wealth_accounts WHERE ledger_id=? AND id=?').bind(context.ledgerId, id).first<{ mode: WealthAccount['mode']; kind: WealthAccount['kind']; currency: string | null; linked_bank_account_id: string | null }>();
  if (!existing && transitionRequested(body)) throw new WealthStoreError('invalid_request', 'Opening transition data requires an existing account representation.');
  const prior = existing && existing.mode === mode ? await priorModeTransition(db, context, id, body, mode as WealthAccount['mode']) : null;
  const modeTransition = existing ? normalizedModeTransition(body, existing.mode, mode as WealthAccount['mode'], id, prior) : null;
  if (modeTransition?.openingCashMinor !== null && !code) throw new WealthStoreError('invalid_request', 'An account currency is required for opening cash.');
  const expected = expectedRevision(body, revision); const next = expected + 1;
  await assertAccountModeChangeSafe(db, context, id, mode, kind as WealthAccount['kind'], code, linkedBankAccountId, modeTransition);
  const initialValue = modeTransition ? null : initialAggregateValuation(body, id, kind as WealthAccount['kind'], mode, amountMinor);
  let initialInsert = initialValue;
  if (initialValue) {
    const existingValue = await currentStoredValuation(db, context, { accountId: id, instrumentKey: ACCOUNT_VALUE_KEY, asOf: initialValue.asOf });
    if (existingValue) {
      const prior = parseJson<Record<string, unknown>>(existingValue.payload_json, 'valuation');
      if (valuationFingerprint(prior) !== valuationFingerprint(initialValue.payload)) throw new WealthStoreError('valuation_conflict', 'A different manual valuation exists for this date; supply a valuation correction instead.', 409);
      initialInsert = null;
    }
  }
  const openingEvents = modeTransition ? sequencedEvents(transitionEvents(modeTransition, id, code ?? 'CAD'), await currentEventSequence(db, context)) : [];
  const transitionValues = modeTransition ? transitionValuations(modeTransition, id) : [];
  const normalized = { id, name, kind, mode, currency: code, linkedBankAccountId, amountMinor, active, asOf: initialValue?.asOf ?? null, modeTransition, transitionValues };
  const response = { account: { id, name, kind, mode, currency: code, linkedBankAccountId, amountMinor, active, revision: next }, ...(initialInsert ? { initialValuation: initialInsert.payload } : {}), ...(modeTransition ? { transition: { fromMode: modeTransition.fromMode, toMode: modeTransition.toMode, effectiveDate: modeTransition.effectiveDate } } : {}), revision: next };
  return runMutation(db, context, { operationId: operationId(body, undefined, `account-${id}`), operationKind: modeTransition ? 'account.mode_transition' : 'account.upsert', expectedRevision: expected, eventCount: openingEvents.length, payloadHash: await digest(normalized), response, statements: (guard) => {
    const accountStatement = db.prepare(`INSERT INTO wealth_accounts(ledger_id,id,name,kind,mode,currency,linked_bank_account_id,amount_minor,active,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(ledger_id,id) DO UPDATE SET name=excluded.name,kind=excluded.kind,mode=excluded.mode,currency=excluded.currency,linked_bank_account_id=excluded.linked_bank_account_id,amount_minor=excluded.amount_minor,active=excluded.active,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP`).bind(context.ledgerId, id, name, kind, mode, code, linkedBankAccountId, amountMinor, active ? 1 : 0, next, ...guard.bindings);
    const statements: D1Statement[] = [accountStatement];
    if (modeTransition) {
      statements.push(db.prepare(`INSERT INTO wealth_account_mode_transitions(ledger_id,account_id,effective_date,from_mode,to_mode,revision,payload_json) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, id, modeTransition.effectiveDate, modeTransition.fromMode, modeTransition.toMode, next, JSON.stringify(modeTransition), ...guard.bindings));
      for (const event of openingEvents) {
        const fields = eventAccountFields(event);
        statements.push(db.prepare(`INSERT INTO wealth_events(ledger_id,id,source_id,date,sequence,kind,account_id,from_account_id,to_account_id,linked_bank_source_id,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, event.id, event.sourceId, event.date, event.sequence, event.kind, fields.accountId, fields.fromAccountId, fields.toAccountId, event.linkedBankSourceId ?? null, JSON.stringify(event), ...guard.bindings));
      }
      for (const value of transitionValues) {
        const key = value.payload.instrument ? instrumentKey(value.payload.instrument as CanonicalInstrument) : ACCOUNT_VALUE_KEY;
        statements.push(db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, value.id, id, key, value.asOf, value.amountMinor, 'manual', null, JSON.stringify(value.payload), next, ...guard.bindings));
      }
    } else if (initialInsert) {
      statements.push(db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, initialInsert.id, id, ACCOUNT_VALUE_KEY, initialInsert.asOf, initialInsert.amountMinor, 'manual', null, JSON.stringify(initialInsert.payload), next, ...guard.bindings));
    }
    return statements;
  } });
}

export async function upsertWealthInstrument(db: D1Database, context: FinancialContext, input: WealthInstrumentInput): Promise<{ instrument: CanonicalInstrument & Record<string, unknown>; revision: number }> {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const body = object(input); const revision = await currentRevision(db, context); const id = bounded(body.id, 'instrument id', 128); const instrument = normalizeInstrument(body); const expected = expectedRevision(body, revision);
  await assertInstrumentUnique(db, context, id, instrument);
  const next = expected + 1; const response = { instrument: { id, ...instrument, revision: next }, revision: next };
  return runMutation(db, context, { operationId: operationId(body, undefined, `instrument-${id}`), operationKind: 'instrument.upsert', expectedRevision: expected, payloadHash: await digest({ id, ...instrument }), response, statements: (guard) => [db.prepare(`INSERT INTO wealth_instruments(ledger_id,id,exchange,ticker,type,currency,revision) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(ledger_id,id) DO UPDATE SET exchange=excluded.exchange,ticker=excluded.ticker,type=excluded.type,currency=excluded.currency,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP`).bind(context.ledgerId, id, instrument.exchange, instrument.ticker, instrument.type, instrument.currency, next, ...guard.bindings)] });
}

export async function upsertWealthValuation(db: D1Database, context: FinancialContext, input: WealthValuationInput): Promise<{ valuation: Record<string, unknown>; revision: number }> {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const body = object(input); const revision = await currentRevision(db, context); const id = bounded(body.id, 'valuation id', 160); const accountId = bounded(body.accountId, 'valuation account id', 128); const asOf = date(body.asOf, 'valuation date'); const priceMinor = integer(body.priceMinor, 'priceMinor')!;
  if (priceMinor < 0) throw new WealthStoreError('invalid_request', 'The valuation price cannot be negative.');
  const source = body.source === undefined ? 'manual' : body.source; if (source !== 'manual' && source !== 'provider') throw new WealthStoreError('invalid_request', 'The valuation source is not supported.');
  const instrument = body.instrument === null || body.instrument === undefined ? null : normalizeInstrument(body.instrument); const key = instrument ? instrumentKey(instrument) : ACCOUNT_VALUE_KEY; const provider = optionalBounded(body.provider, 'valuation provider', 128);
  await validateValuationAccountMode(db, context, { accountId, instrument, asOf });
  const expected = expectedRevision(body, revision);
  const payload = { id, accountId, instrument, asOf, priceMinor, source, provider };
  const existing = await currentStoredValuation(db, context, { accountId, instrumentKey: key, asOf });
  if (existing) {
    const previous = parseJson<Record<string, unknown>>(existing.payload_json, 'valuation');
    if (valuationFingerprint(previous) === valuationFingerprint(payload)) return { valuation: previous, revision };
    if (source !== 'manual' || existing.source !== 'manual' || body.expectedRevision === undefined) throw new WealthStoreError('valuation_conflict', 'A different manual valuation exists for this date; supply the current expectedRevision to correct it.', 409);
    const next = expected + 1; const response = { valuation: payload, revision: next };
    return runMutation(db, context, { operationId: operationId(body, undefined, `valuation-${id}`), operationKind: 'valuation.correct', expectedRevision: expected, payloadHash: await digest(payload), response, statements: (guard) => [db.prepare(`INSERT INTO wealth_valuation_corrections(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, id, accountId, key, asOf, priceMinor, source, provider, JSON.stringify(payload), next, ...guard.bindings)] });
  }
  const next = expected + 1; const response = { valuation: payload, revision: next };
  return runMutation(db, context, { operationId: operationId(body, undefined, `valuation-${id}`), operationKind: 'valuation.append', expectedRevision: expected, payloadHash: await digest(payload), response, statements: (guard) => [db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, id, accountId, key, asOf, priceMinor, source, provider, JSON.stringify(payload), next, ...guard.bindings)] });
}

export function eventAccountFields(event: WealthEvent) {
  if (event.kind === 'transfer') return { accountId: null, fromAccountId: event.fromAccountId, toAccountId: event.toAccountId };
  if ('accountId' in event) return { accountId: event.accountId, fromAccountId: null, toAccountId: null };
  return { accountId: null, fromAccountId: null, toAccountId: null };
}

function transferPairs(event: WealthEvent): Array<readonly [string, string]> {
  if (event.kind === 'transfer') return [[event.fromAccountId, event.toAccountId]];
  if (event.kind === 'correction' && event.replacement.kind === 'transfer') return [[event.replacement.fromAccountId, event.replacement.toAccountId]];
  return [];
}

export function mixedTransferMode(accounts: readonly WealthAccount[], event: WealthEvent): boolean {
  const modes = new Map(accounts.map((account) => [account.id, account.mode]));
  return transferPairs(event).some(([from, to]) => modes.has(from) && modes.has(to) && modes.get(from) !== modes.get(to));
}

export function mixedTransferModeAtDate(accounts: readonly WealthAccount[], transitions: readonly WealthModeTransitionRecord[], event: WealthEvent): boolean {
  const stored = storedTransitionRecords(transitions);
  const modes = new Map(accounts.map((account) => [account.id, modeAtDate(account, stored, eventModeDate(event))]));
  return transferPairs(event).some((pair) => transferHasMixedModes(pair, modes));
}

function holdingsEventKind(kind: WealthEvent['kind']): boolean {
  return kind === 'opening_position' || kind === 'buy' || kind === 'sell' || kind === 'dividend' || kind === 'withholding' || kind === 'fee' || kind === 'contribution' || kind === 'withdrawal' || kind === 'split';
}

function openingCashPayload(event: WealthEvent): { readonly accountId: string; readonly date: string } | null {
  if (event.kind === 'opening_cash') return event;
  if (event.kind === 'correction' && event.replacement.kind === 'opening_cash') return event.replacement;
  return null;
}

async function validateOpeningCashMode(db: D1Database, context: FinancialContext, opening: { readonly accountId: string; readonly date: string }): Promise<void> {
  const [accounts, transitions] = await Promise.all([loadAccounts(db, context), loadModeTransitions(db, context)]);
  const account = accounts.find((candidate) => candidate.id === opening.accountId);
  if (!account) throw new WealthStoreError('account_mode_conflict', 'The opening cash account does not belong to this ledger.');
  if (account.kind === 'debt') throw new WealthStoreError('account_mode_conflict', 'Debt accounts cannot contain opening cash.', 409);
  if (modeAtDate(account, transitions, opening.date) !== 'holdings') throw new WealthStoreError('account_mode_conflict', 'Opening cash events require holdings accounts.', 409);
}

interface OpeningCashSegmentQuery {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly account: Pick<WealthAccount, 'id' | 'mode'>;
  readonly transitions: readonly StoredModeTransition[];
  readonly asOf: string;
}

async function hasOpeningCashInAggregateSegment(query: OpeningCashSegmentQuery): Promise<boolean> {
  const segment = modeSegment(query.account, query.transitions, query.asOf);
  if (segment.mode !== 'aggregate') return false;
  const events = await loadStoredEvents(query.db, query.context);
  return resolveWealthEvents(events.filter((event) => event.date <= query.asOf)).some((event) => event.kind === 'opening_cash' && event.accountId === query.account.id && (!segment.startDate || event.date >= segment.startDate));
}

function eventModeAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'correction') return correctionModeAccountIds(event.replacement);
  if (event.kind === 'transfer') return event.transferKind === 'position' ? [event.fromAccountId, event.toAccountId] : [];
  return 'accountId' in event ? [event.accountId] : [];
}

function correctionModeAccountIds(replacement: WealthCorrectionPayload): string[] {
  if (replacement.kind === 'transfer') return replacement.transferKind === 'position' ? [replacement.fromAccountId, replacement.toAccountId] : [];
  return 'accountId' in replacement ? [replacement.accountId] : [];
}

function eventRequiresHoldings(event: WealthEvent): boolean {
  if (event.kind === 'correction') {
    if (event.replacement.kind === 'transfer') return event.replacement.transferKind === 'position';
    return holdingsEventKind(event.replacement.kind);
  }
  if (event.kind === 'transfer') return event.transferKind === 'position';
  return holdingsEventKind(event.kind);
}

/** Returns the historical representation error used by CSV preview and writes. */
export function wealthEventModeError(accounts: readonly WealthAccount[], transitions: readonly WealthModeTransitionRecord[], event: WealthEvent): string | null {
  if (mixedTransferModeAtDate(accounts, transitions, event)) return 'Transfers must stay within aggregate or holdings accounts.';
  const openingError = openingCashModeError(accounts, transitions, event);
  if (openingError) return openingError;
  const accountIds = eventModeAccountIds(event);
  if (!eventRequiresHoldings(event) || accountIds.length === 0) return null;
  return eventAccountsRequireHoldings(accounts, transitions, accountIds, eventModeDate(event)) ? null : 'This wealth event requires holdings accounts.';
}

function openingCashModeError(accounts: readonly WealthAccount[], transitions: readonly WealthModeTransitionRecord[], event: WealthEvent): string | null {
  const opening = openingCashPayload(event);
  if (!opening) return null;
  const account = accounts.find((candidate) => candidate.id === opening.accountId);
  if (!account) return null;
  if (account.kind === 'debt') return 'Debt accounts cannot contain opening cash.';
  return modeAtDate(account, storedTransitionRecords(transitions), eventModeDate(event)) === 'holdings' ? null : 'Opening cash events require holdings accounts.';
}

function eventAccountsRequireHoldings(accounts: readonly WealthAccount[], transitions: readonly WealthModeTransitionRecord[], accountIds: readonly string[], asOf: string): boolean {
  const stored = storedTransitionRecords(transitions);
  return accountIds.every((accountId) => {
    const account = accounts.find((candidate) => candidate.id === accountId);
    return Boolean(account && modeAtDate(account, stored, asOf) === 'holdings');
  });
}

async function validateEventAccountModes(db: D1Database, context: FinancialContext, event: WealthEvent): Promise<void> {
  const opening = openingCashPayload(event);
  if (opening) {
    await validateOpeningCashMode(db, context, opening);
    return;
  }
  if (!eventRequiresHoldings(event)) return;
  const accountIds = eventModeAccountIds(event);
  if (accountIds.length === 0) return;
  const [accounts, transitions] = await Promise.all([loadAccounts(db, context), loadModeTransitions(db, context)]);
  const dateForMode = event.kind === 'correction' ? event.replacement.date : event.date;
  const byId = new Map(accounts.map((account) => [account.id, account]));
  if (accountIds.some((accountId) => !byId.has(accountId) || modeAtDate(byId.get(accountId)!, transitions, dateForMode) !== 'holdings')) throw new WealthStoreError('account_mode_conflict', 'This wealth event requires holdings accounts.');
}

async function validateTransferModes(db: D1Database, context: FinancialContext, event: WealthEvent): Promise<void> {
  if (!transferPairs(event).length) return;
  const accounts = await loadAccounts(db, context);
  const transitions = await loadModeTransitions(db, context);
  const modes = new Map(accounts.map((account) => [account.id, modeAtDate(account, transitions, eventModeDate(event))]));
  if (transferPairs(event).some((pair) => transferHasMixedModes(pair, modes))) throw new WealthStoreError('mixed_account_mode', 'Transfers must stay within aggregate or holdings accounts.', 400);
}

function eventModeDate(event: WealthEvent): string {
  return event.kind === 'correction' ? event.replacement.date : event.date;
}

function transferHasMixedModes(pair: readonly [string, string], modes: ReadonlyMap<string, WealthAccount['mode']>): boolean {
  const fromMode = modes.get(pair[0]);
  const toMode = modes.get(pair[1]);
  if (fromMode === undefined || toMode === undefined) return false;
  return fromMode !== toMode;
}

function linkedBankSources(event: WealthEvent): string[] {
  const replacement = event.kind === 'correction' ? event.replacement.linkedBankSourceId : null;
  return [event.linkedBankSourceId, replacement].filter((value): value is string => Boolean(value));
}

async function bankSourceCandidates(db: D1Database, context: FinancialContext, linked: string): Promise<readonly string[]> {
  const aliases = await db.prepare(`SELECT transaction_id,id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference
    FROM transaction_source_records WHERE ledger_id=? AND (? IN (id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference,transaction_id))`).bind(context.ledgerId, linked).all<TransactionAliasRow>();
  const candidates = new Set<string>([linked]);
  for (const row of aliases.results) [row.transaction_id, row.id, row.identity_key, row.provider_transaction_id, row.provider_pending_transaction_id, row.bank_source_id, row.bank_row_id, row.event_id, row.bank_reference].forEach((value) => { if (value) candidates.add(value); });
  return [...candidates];
}

function rowUsesBankSource(row: { linked_bank_source_id: string | null; payload_json: string }, candidates: readonly string[]): boolean {
  if (row.linked_bank_source_id && candidates.includes(row.linked_bank_source_id)) return true;
  try {
    const stored = JSON.parse(row.payload_json) as WealthEvent;
    const nested = stored.kind === 'correction' ? stored.replacement.linkedBankSourceId : null;
    return Boolean(nested && candidates.includes(nested));
  } catch { return false; }
}

async function existingBankLink(db: D1Database, context: FinancialContext, candidates: readonly string[]): Promise<boolean> {
  const rows = await db.prepare('SELECT linked_bank_source_id,payload_json FROM wealth_events WHERE ledger_id=?').bind(context.ledgerId).all<{ linked_bank_source_id: string | null; payload_json: string }>();
  return rows.results.some((row) => rowUsesBankSource(row, candidates));
}

async function correctionTargetBankLink(db: D1Database, context: FinancialContext, event: WealthEvent): Promise<string | null> {
  if (event.kind !== 'correction') return null;
  const row = await db.prepare('SELECT payload_json FROM wealth_events WHERE ledger_id=? AND source_id=?').bind(context.ledgerId, event.targetSourceId).first<{ payload_json: string }>();
  if (!row) return null;
  const target = parseJson<WealthEvent>(row.payload_json, 'event');
  return target.linkedBankSourceId ?? (target.kind === 'correction' ? target.replacement.linkedBankSourceId ?? null : null);
}

export async function assertBankLinkAvailable(db: D1Database, context: FinancialContext, event: WealthEvent): Promise<void> {
  const targetLink = await correctionTargetBankLink(db, context, event);
  for (const linked of linkedBankSources(event)) {
    if (linked === targetLink) continue;
    const candidates = await bankSourceCandidates(db, context, linked);
    if (await existingBankLink(db, context, candidates)) throw new WealthStoreError('bank_link_conflict', 'A bank transaction is already linked to another wealth event.', 409);
  }
}

export async function appendWealthEvent(db: D1Database, context: FinancialContext, input: unknown, options: { expectedRevision?: number; operationId?: string } = {}): Promise<{ event: WealthEvent; revision: number; replayed?: boolean }> {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const event = normalizeEvent(input); const revision = await currentRevision(db, context);
  const existing = await db.prepare('SELECT id,sequence,payload_json FROM wealth_events WHERE ledger_id=? AND source_id=?').bind(context.ledgerId, event.sourceId).first<{ id: string; sequence: number; payload_json: string }>();
  if (existing) {
    const prior = { ...parseJson<WealthEvent>(existing.payload_json, 'event'), sequence: existing.sequence };
    if (await digest(eventForDigest(prior)) !== await digest(eventForDigest(event))) throw new WealthStoreError('source_conflict', 'The wealth source id was reused with different content.', 409);
    return { event: prior, revision, replayed: true };
  }
  const expected = options.expectedRevision ?? revision; await validateExpected(db, context, expected); await validateTransferModes(db, context, event); await validateEventAccountModes(db, context, event); await assertBankLinkAvailable(db, context, event); const events = await loadStoredEvents(db, context); const orderedEvent = { ...event, sequence: (await currentEventSequence(db, context)) + 1 } as WealthEvent;
  try { replayWealthEvents([...events, orderedEvent]); } catch (error) { if (error instanceof WealthDomainError) throw new WealthStoreError(error.code, error.message); throw error; }
  const fields = eventAccountFields(orderedEvent); const next = expected + 1; const response = { event: orderedEvent, revision: next };
  return runMutation(db, context, { operationId: options.operationId ?? `event-${event.sourceId}`, operationKind: 'event.append', expectedRevision: expected, eventCount: 1, payloadHash: await digest(eventForDigest(event)), response, statements: (guard) => [db.prepare(`INSERT INTO wealth_events(ledger_id,id,source_id,date,sequence,kind,account_id,from_account_id,to_account_id,linked_bank_source_id,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(context.ledgerId, orderedEvent.id, orderedEvent.sourceId, orderedEvent.date, orderedEvent.sequence, orderedEvent.kind, fields.accountId, fields.fromAccountId, fields.toAccountId, orderedEvent.linkedBankSourceId ?? null, JSON.stringify(orderedEvent), ...guard.bindings)] });
}

export async function readWealthAccounts(db: D1Database, context: FinancialContext) { return { accounts: await readAccounts(db, context), revision: await currentRevision(db, context) }; }
export async function readWealthInstruments(db: D1Database, context: FinancialContext) { return { instruments: await readInstruments(db, context), revision: await currentRevision(db, context) }; }

interface WealthHistoryQuery { readonly accountId?: string | null; readonly instrumentKey?: string | null; readonly limit?: number }
type WealthHistoryEvent = WealthEvent | WealthCorrectionPayload;

function eventAccountMatches(event: WealthHistoryEvent, accountId: string): boolean {
  if (event.kind === 'transfer') return event.fromAccountId === accountId || event.toAccountId === accountId;
  if (event.kind === 'correction') return eventAccountMatches(event.replacement, accountId);
  return 'accountId' in event && event.accountId === accountId;
}

function eventInstrument(event: WealthHistoryEvent): CanonicalInstrument | null {
  if (event.kind === 'correction') return eventInstrument(event.replacement);
  if (!('instrument' in event) || !event.instrument) return null;
  return event.instrument;
}

function eventMatchesInstrument(event: WealthHistoryEvent, requested: string | null): boolean {
  return requested === null || (eventInstrument(event) ? instrumentKey(eventInstrument(event)!) === requested : false);
}

function normalizeHistoryQuery(query: WealthHistoryQuery): { accountId: string | null; instrumentKey: string | null; limit: number } {
  return {
    accountId: query.accountId ? bounded(query.accountId, 'account id', 128) : null,
    instrumentKey: query.instrumentKey ? bounded(query.instrumentKey, 'instrument key', 256) : null,
    limit: Math.min(Math.max(query.limit ?? 500, 1), 1000),
  };
}

export async function readWealthEvents(db: D1Database, context: FinancialContext, query: WealthHistoryQuery = {}) {
  const normalized = normalizeHistoryQuery(query); const events = await readStoredEvents(db, context);
  const filtered = events.filter((event) => (!normalized.accountId || eventAccountMatches(event, normalized.accountId)) && eventMatchesInstrument(event, normalized.instrumentKey));
  return { events: filtered.slice(0, normalized.limit), revision: await currentRevision(db, context) };
}
export async function readWealthValuations(db: D1Database, context: FinancialContext, query: WealthHistoryQuery = {}) {
  const normalized = normalizeHistoryQuery(query); const valuations = await readStoredValuations(db, context);
  const filtered = valuations.filter((valuation) => (!normalized.accountId || valuation.accountId === normalized.accountId) && (normalized.instrumentKey === null || (valuation.instrument.exchange && instrumentKey(valuation.instrument) === normalized.instrumentKey)));
  return { valuations: filtered.slice(0, normalized.limit).map((valuation) => ({ ...valuation, instrument: valuation.instrument.exchange ? valuation.instrument : null })), revision: await currentRevision(db, context) };
}

export {
  commitWealthImport,
  createWealthImportPreview,
  wealthExportCsv,
  WEALTH_CSV_TEMPLATE,
} from './wealth-import';
