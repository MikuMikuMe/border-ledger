import {
  canonicalEventFingerprint,
  instrumentKey,
  resolveWealthEvents,
  replayWealthEvents,
  WealthDomainError,
} from '../src/domain/wealth';
import { assertPositiveQuantity } from '../src/domain/wealth-validation';
import type {
  CanonicalInstrument,
  HoldingValuation,
  WealthAccount,
  WealthCorrectionPayload,
  WealthEvent,
  WealthMoney,
} from '../src/domain/wealth-types';
import type { WealthModeTransitionRecord, WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../src/domain/wealth-api-types';
import type { D1Database, D1Statement } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import type { StoredBalance } from './lunchflow-balance-store';
import type { TransactionAliasRow } from './wealth-store-cashflows';
import { readWealthReportProjection, readWealthSnapshotProjection, type WealthReportReadServices } from './wealth-store-reports';
import { eventsForCurrentModeSegment, modeSegmentReplayAccounts, replayWealthEventsAcrossModeSegments } from './wealth-segment-projection';

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

function dateRange(query: WealthReportQuery): { asOf: string; from: string | null; to: string | null } {
  const asOf = query.asOf ? date(query.asOf, 'asOf') : new Date().toISOString().slice(0, 10);
  const from = query.from ? date(query.from, 'from') : null;
  const to = query.to ? date(query.to, 'to') : null;
  validateDateRange(from, to);
  return { asOf, from, to };
}

function validateDateRange(from: string | null, to: string | null): void {
  if (!from) return;
  if (!to) return;
  if (from <= to) return;
  throw new WealthStoreError('invalid_request', 'The report period is not valid.');
}

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
export interface StoredModeTransition { account_id: string; effective_date: string; from_mode: WealthAccount['mode']; to_mode: WealthAccount['mode']; revision: number; payload_json: string }
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

function wealthEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') {
    const replacement = event.replacement;
    return replacement.kind === 'transfer' ? [replacement.fromAccountId, replacement.toAccountId] : 'accountId' in replacement ? [replacement.accountId] : [];
  }
  return 'accountId' in event ? [event.accountId] : [];
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

function normalizeWealthReportingCurrency(value: string | null): 'CAD' | null {
  const code = value?.trim().toUpperCase() ?? '';
  if (!code) return null;
  if (code !== 'CAD') throw new WealthStoreError('invalid_request', 'Wealth reports support CAD as the converted reporting currency.');
  return code;
}

const wealthReportServices: WealthReportReadServices = {
  accounts: readAccounts,
  transitions: loadModeTransitions,
  events: readStoredEvents,
  valuations: readStoredValuations,
  balanceHistory: readLinkedBalanceHistory,
  currentRevision,
  accountsAtDate,
  modeAtDate,
  modeSegment,
  segmentReplayAccounts: modeSegmentReplayAccounts,
  eventsForCurrentModeSegment,
};

export async function readWealthSnapshot(
  db: D1Database,
  context: FinancialContext,
  query: Pick<WealthReportQuery, 'asOf' | 'reportingCurrency'> = {},
  dependencies: WealthReportDependencies = {},
) {
  const range = dateRange(query);
  const reportingCurrency = normalizeWealthReportingCurrency(query.reportingCurrency ?? null);
  return readWealthSnapshotProjection({ db, context, range, reportingCurrency, dependencies, services: wealthReportServices });
}

export async function readWealthReport(
  db: D1Database,
  context: FinancialContext,
  query: WealthReportQuery = {},
  dependencies: WealthReportDependencies = {},
) {
  const range = dateRange(query);
  const reportingCurrency = normalizeWealthReportingCurrency(query.reportingCurrency ?? null);
  return readWealthReportProjection({ db, context, range, reportingCurrency, dependencies, services: wealthReportServices });
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

interface BankSourceIdentity {
  readonly values: readonly string[];
  readonly transactionIds: readonly string[];
}

async function bankSourceCandidates(db: D1Database, context: FinancialContext, linked: string): Promise<BankSourceIdentity> {
  const aliases = await db.prepare(`SELECT transaction_id,id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference
    FROM transaction_source_records WHERE ledger_id=? AND (? IN (id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference,transaction_id))`).bind(context.ledgerId, linked).all<TransactionAliasRow>();
  const candidates = new Set<string>([linked]);
  for (const row of aliases.results) [row.transaction_id, row.id, row.identity_key, row.provider_transaction_id, row.provider_pending_transaction_id, row.bank_source_id, row.bank_row_id, row.event_id, row.bank_reference].forEach((value) => { if (value) candidates.add(value); });
  return { values: [...candidates], transactionIds: [...new Set(aliases.results.map((row) => row.transaction_id))] };
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

function sameBankTransaction(left: BankSourceIdentity, right: BankSourceIdentity | null): boolean {
  if (!right) return false;
  if (left.transactionIds.length !== 1) return false;
  if (right.transactionIds.length !== 1) return false;
  return left.transactionIds[0] === right.transactionIds[0];
}

async function bankSourceForWrite(db: D1Database, context: FinancialContext, linked: string): Promise<BankSourceIdentity> {
  const candidates = await bankSourceCandidates(db, context, linked);
  if (candidates.transactionIds.length > 1) throw new WealthStoreError('ambiguous_bank_link', 'The bank link matches multiple transactions. Choose a transaction ID or unique source alias.', 400);
  return candidates;
}

export async function assertBankLinkAvailable(db: D1Database, context: FinancialContext, event: WealthEvent): Promise<void> {
  const targetLink = await correctionTargetBankLink(db, context, event);
  const targetIdentity = targetLink ? await bankSourceCandidates(db, context, targetLink) : null;
  for (const linked of linkedBankSources(event)) {
    const candidates = await bankSourceForWrite(db, context, linked);
    if (linked === targetLink) continue;
    if (sameBankTransaction(candidates, targetIdentity)) continue;
    if (await existingBankLink(db, context, candidates.values)) throw new WealthStoreError('bank_link_conflict', 'A bank transaction is already linked to another wealth event.', 409);
  }
}

function correctionLineageEvents(events: readonly WealthEvent[], event: WealthEvent): readonly WealthEvent[] {
  if (event.kind !== 'correction') return [];
  const bySourceId = new Map(events.map((candidate) => [candidate.sourceId, candidate]));
  const lineage: WealthEvent[] = [event];
  const visited = new Set<string>();
  let targetSourceId: string | null = event.targetSourceId;
  while (targetSourceId && !visited.has(targetSourceId)) {
    visited.add(targetSourceId);
    const target = bySourceId.get(targetSourceId);
    if (!target) break;
    lineage.push(target);
    targetSourceId = target.kind === 'correction' || target.kind === 'reversal' ? target.targetSourceId : null;
  }
  return lineage;
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
  const expected = options.expectedRevision ?? revision; await validateExpected(db, context, expected); await validateTransferModes(db, context, event); await validateEventAccountModes(db, context, event); await assertBankLinkAvailable(db, context, event);
  const [events, accounts, transitions] = await Promise.all([loadStoredEvents(db, context), loadAccounts(db, context), loadModeTransitions(db, context)]);
  const orderedEvent = { ...event, sequence: (await currentEventSequence(db, context)) + 1 } as WealthEvent;
  const proposedEvents = [...events, orderedEvent];
  try {
    resolveWealthEvents(proposedEvents);
    const replayAsOf = [...proposedEvents.map((candidate) => candidate.date), ...transitions.map((transition) => transition.effective_date)].sort().at(-1) ?? eventModeDate(event);
    replayWealthEventsAcrossModeSegments({
      events: proposedEvents,
      context: { accounts, transitions, lineageEvents: correctionLineageEvents(proposedEvents, orderedEvent) },
      asOf: replayAsOf,
      fromDate: eventModeDate(event),
    });
  } catch (error) { if (error instanceof WealthDomainError) throw new WealthStoreError(error.code, error.message); throw error; }
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
