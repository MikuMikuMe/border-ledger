import { decimal } from './wealth-math';
import type {
  CanonicalInstrument,
  WealthAccount,
  WealthAccountRegistry,
  WealthCorrectionPayload,
  WealthEvent,
  WealthMoney,
} from './wealth-types';

export class WealthDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WealthDomainError';
    this.code = code;
  }
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_INSTRUMENT_KINDS = new Set(['opening_position', 'buy', 'sell', 'split']);
const OPTIONAL_INSTRUMENT_KINDS = new Set(['dividend', 'withholding', 'fee']);
const MONEY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  opening_position: ['basis'],
  opening_cash: ['money'],
  buy: ['consideration', 'fee'],
  sell: ['proceeds', 'fee'],
  dividend: ['money'],
  withholding: ['money'],
  fee: ['money'],
  contribution: ['money'],
  withdrawal: ['money'],
  transfer: ['money'],
};

export interface UniqueEvents {
  readonly events: readonly WealthEvent[];
  readonly duplicates: readonly string[];
}

export function createWealthAccountRegistry(accounts: readonly WealthAccount[]): WealthAccountRegistry {
  const normalized: WealthAccount[] = [];
  const byId: Record<string, WealthAccount> = Object.create(null) as Record<string, WealthAccount>;
  for (const account of accounts) {
    validateAccount(account, byId);
    const copy = Object.freeze({ ...account, currency: account.currency?.toUpperCase() });
    normalized.push(copy);
    byId[account.id] = copy;
  }
  normalized.sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({ accounts: Object.freeze(normalized), byId: Object.freeze(byId) });
}

export function accountRegistry(accounts: WealthAccountRegistry | readonly WealthAccount[]): WealthAccountRegistry {
  return 'byId' in accounts && 'accounts' in accounts ? accounts : createWealthAccountRegistry(accounts);
}

export function uniqueEvents(events: readonly WealthEvent[]): UniqueEvents {
  const seen = new Map<string, string>();
  const unique: WealthEvent[] = [];
  const duplicates: string[] = [];
  for (const raw of events) {
    const normalized = normalizeEvent(raw);
    const fingerprint = canonicalEventFingerprint(normalized);
    const prior = seen.get(normalized.sourceId);
    if (prior === undefined) {
      seen.set(normalized.sourceId, fingerprint);
      unique.push(normalized);
    } else if (prior === fingerprint) {
      duplicates.push(normalized.sourceId);
    } else {
      throw new WealthDomainError('source_conflict', `Source ${normalized.sourceId} was reused with different content.`);
    }
  }
  return { events: unique, duplicates: Object.freeze(duplicates) };
}

/** Stable retry identity for backend idempotency. Event ids and server order
 * are transport metadata; normalized accounting content remains comparable. */
export function canonicalEventFingerprint(event: WealthEvent): string {
  return stableSerialize(eventPayloadWithoutIdentity(normalizeEvent(event)));
}

export function normalizeEvent(raw: WealthEvent): WealthEvent {
  if (!raw || typeof raw !== 'object') throw new WealthDomainError('invalid_event', 'Event must be an object.');
  if (!nonEmpty(raw.id) || !nonEmpty(raw.sourceId)) throw new WealthDomainError('invalid_event', 'Event id and sourceId are required.');
  assertDate(raw.date, 'event date');
  assertSequence(raw.sequence, 'event sequence');
  return normalizeEventBody(normalizeEventMoney(raw));
}

function eventPayloadWithoutIdentity(event: WealthEvent): Record<string, unknown> {
  const payload = { ...event } as Record<string, unknown>;
  delete payload.id;
  delete payload.sequence;
  if (event.kind === 'correction') {
    const replacement = { ...event.replacement } as Record<string, unknown>;
    delete replacement.sequence;
    payload.replacement = replacement;
  }
  return payload;
}

export function normalizeReplacement(replacement: WealthCorrectionPayload): WealthCorrectionPayload {
  const normalized = normalizeReplacementMoney(replacement);
  assertDate(normalized.date, 'correction replacement date');
  assertSequence(normalized.sequence, 'correction replacement sequence');
  if (hasInstrument(normalized)) return { ...normalized, instrument: normalizeInstrument(normalized.instrument) } as WealthCorrectionPayload;
  if (hasOptionalInstrument(normalized)) return { ...normalized, instrument: normalized.instrument ? normalizeInstrument(normalized.instrument) : normalized.instrument } as WealthCorrectionPayload;
  if (normalized.kind === 'transfer' && normalized.transferKind === 'position') {
    return { ...normalized, instrument: normalizeInstrument(normalized.instrument) } as WealthCorrectionPayload;
  }
  return normalized;
}

export function normalizeInstrument(instrument: CanonicalInstrument): CanonicalInstrument {
  if (!instrument || typeof instrument !== 'object') throw new WealthDomainError('invalid_instrument', 'Instrument is required.');
  const exchange = instrument.exchange.trim().toUpperCase();
  const ticker = instrument.ticker.trim().toUpperCase();
  assertInstrumentIdentity(exchange, ticker, instrument.type);
  assertCurrency(instrument.currency, 'instrument currency');
  return Object.freeze({ exchange, ticker, type: instrument.type, currency: instrument.currency.toUpperCase() });
}

export function instrumentKey(instrument: CanonicalInstrument): string {
  const normalized = normalizeInstrument(instrument);
  return `${normalized.exchange}:${normalized.ticker}:${normalized.type}:${normalized.currency}`;
}

export function validateAccountIds(event: WealthEvent, accounts?: WealthAccountRegistry | readonly WealthAccount[]): void {
  if (!accounts) return;
  const registry = accountRegistry(accounts);
  const ids = event.kind === 'transfer' ? [event.fromAccountId, event.toAccountId] : 'accountId' in event ? [event.accountId] : [];
  for (const id of ids) if (!registry.byId[id]) throw new WealthDomainError('unknown_account', `Account ${id} is not registered.`);
}

export function assertMoney(money: WealthMoney | null, label: string, nullable = false): void {
  if (money === null && nullable) return;
  assertMoneyObject(money, label);
  assertCurrency(money.currency, `${label} currency`);
  assertNonNegativeMinor(money.amountMinor, label);
}

export function assertInstrumentMoney(money: WealthMoney | null, instrument: CanonicalInstrument, label: string): void {
  if (!money || money.currency.toUpperCase() !== instrument.currency.toUpperCase()) throw new WealthDomainError('currency_mismatch', `${label} currency must match the instrument.`);
}

export function assertFee(fee: WealthMoney | null | undefined, instrument: CanonicalInstrument): void {
  if (fee === undefined || fee === null) return;
  assertMoney(fee, 'fee');
  assertInstrumentMoney(fee, instrument, 'fee');
}

export function assertPositiveQuantity(value: string): void {
  const parsed = decimal(value);
  if (parsed.coefficient <= 0n) throw new WealthDomainError('invalid_quantity', 'Quantity must be positive.');
}

export function assertDate(value: string, label: string): void {
  if (parseDate(value) === null) throw new WealthDomainError('invalid_date', `Invalid ${label}.`);
}

export function parseDate(value: string): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime();
}

export function compareEvents(left: WealthEvent, right: WealthEvent): number {
  return left.date.localeCompare(right.date) || left.sourceId.localeCompare(right.sourceId) || left.id.localeCompare(right.id);
}

export function compareEventsWithOrder(left: WealthEvent, right: WealthEvent, inputOrder: ReadonlyMap<string, number>): number {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  const sequenceOrder = sequenceComparison(left, right);
  if (sequenceOrder !== null) return sequenceOrder;
  const inputOrderResult = inputOrderComparison(left, right, inputOrder);
  if (inputOrderResult !== null) return inputOrderResult;
  return compareEvents(left, right);
}

export function assertCurrency(currency: string, label: string): void {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency.toUpperCase())) throw new WealthDomainError('invalid_currency', `Invalid ${label}.`);
}

export function stableSerialize(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function validateAccount(account: WealthAccount, byId: Readonly<Record<string, WealthAccount>>): void {
  assertAccountIdentity(account, byId);
  assertSupportedAccountKind(account.kind, account.id);
  assertSupportedAccountMode(account.mode, account.id);
  if (account.currency !== undefined) assertCurrency(account.currency, 'account currency');
}

function normalizeEventBody(raw: WealthEvent): WealthEvent {
  if (REQUIRED_INSTRUMENT_KINDS.has(raw.kind)) return normalizeRequiredInstrument(raw);
  if (OPTIONAL_INSTRUMENT_KINDS.has(raw.kind)) return normalizeOptionalInstrument(raw);
  if (raw.kind === 'transfer') return normalizeTransfer(raw);
  if (raw.kind === 'correction') return { ...raw, replacement: normalizeReplacement(raw.replacement) };
  return raw;
}

function normalizeEventMoney(raw: WealthEvent): WealthEvent {
  return normalizeMoneyFields(raw);
}

function normalizeReplacementMoney(replacement: WealthCorrectionPayload): WealthCorrectionPayload {
  return normalizeMoneyFields(replacement);
}

function normalizeMoneyFields<T extends WealthEvent | WealthCorrectionPayload>(value: T): T {
  const normalized = { ...value } as T & Record<string, unknown>;
  for (const field of MONEY_FIELDS[value.kind] ?? []) {
    const money = normalized[field] as WealthMoney | null | undefined;
    if (money) normalized[field] = normalizeMoney(money);
  }
  return normalized as T;
}

function normalizeMoney(money: WealthMoney): WealthMoney {
  if (!money || typeof money !== 'object') return money;
  return { ...money, currency: typeof money.currency === 'string' ? money.currency.toUpperCase() : money.currency };
}

function normalizeRequiredInstrument(raw: WealthEvent): WealthEvent {
  const value = raw as WealthEvent & { readonly instrument: CanonicalInstrument };
  return { ...value, instrument: normalizeInstrument(value.instrument) } as WealthEvent;
}

function normalizeOptionalInstrument(raw: WealthEvent): WealthEvent {
  const value = raw as WealthEvent & { readonly instrument?: CanonicalInstrument | null };
  return { ...value, instrument: value.instrument ? normalizeInstrument(value.instrument) : value.instrument } as WealthEvent;
}

function normalizeTransfer(raw: Extract<WealthEvent, { kind: 'transfer' }>): WealthEvent {
  if (raw.transferKind !== 'position') return raw;
  return { ...raw, instrument: normalizeInstrument(raw.instrument) } as WealthEvent;
}

function assertAccountIdentity(account: WealthAccount, byId: Readonly<Record<string, WealthAccount>>): void {
  if (!account || !nonEmpty(account.id)) throw new WealthDomainError('invalid_account', 'Account id is required.');
  if (byId[account.id]) throw new WealthDomainError('duplicate_account', `Account ${account.id} is duplicated.`);
  if (!nonEmpty(account.name)) throw new WealthDomainError('invalid_account', `Account ${account.id} needs a name.`);
}

function assertSupportedAccountKind(kind: WealthAccount['kind'], accountId: string): void {
  if (!['linked_bank', 'manual_asset', 'debt', 'brokerage'].includes(kind)) throw new WealthDomainError('invalid_account', `Account ${accountId} has an unsupported kind.`);
}

function assertSupportedAccountMode(mode: WealthAccount['mode'], accountId: string): void {
  if (!['aggregate', 'holdings'].includes(mode)) throw new WealthDomainError('invalid_account', `Account ${accountId} has an unsupported mode.`);
}

function assertInstrumentIdentity(exchange: string, ticker: string, type: CanonicalInstrument['type']): void {
  if (!exchange || !ticker || !['stock', 'etf'].includes(type)) throw new WealthDomainError('invalid_instrument', 'Exchange, ticker, type, and currency are required.');
}

function assertSequence(sequence: number | undefined, label: string): void {
  if (sequence !== undefined && !validSequence(sequence)) throw new WealthDomainError('invalid_event', `Invalid ${label}.`);
}

function validSequence(sequence: number): boolean {
  return Number.isSafeInteger(sequence) && sequence >= 0;
}

function sequenceComparison(left: WealthEvent, right: WealthEvent): number | null {
  const leftSequence = left.sequence;
  const rightSequence = right.sequence;
  if (leftSequence === undefined) return null;
  if (rightSequence === undefined) return null;
  if (leftSequence === rightSequence) return null;
  return leftSequence - rightSequence;
}

function inputOrderComparison(left: WealthEvent, right: WealthEvent, inputOrder: ReadonlyMap<string, number>): number | null {
  const leftOrder = inputOrder.get(left.sourceId);
  const rightOrder = inputOrder.get(right.sourceId);
  return leftOrder === undefined || rightOrder === undefined || leftOrder === rightOrder ? null : leftOrder - rightOrder;
}

function assertMoneyObject(money: WealthMoney | null, label: string): asserts money is WealthMoney {
  if (!money || typeof money !== 'object') throw new WealthDomainError('invalid_money', `${label} is required.`);
}

function assertNonNegativeMinor(amountMinor: number, label: string): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new WealthDomainError('invalid_money', `${label} must be a non-negative integer minor amount.`);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function hasInstrument(value: { readonly kind: string; readonly instrument?: unknown }): value is WealthEvent & { readonly instrument: CanonicalInstrument } {
  return ['opening_position', 'buy', 'sell', 'split'].includes(value.kind);
}

function hasOptionalInstrument(value: { readonly kind: string; readonly instrument?: unknown }): value is WealthEvent & { readonly instrument?: CanonicalInstrument | null } {
  return ['dividend', 'withholding', 'fee'].includes(value.kind);
}
