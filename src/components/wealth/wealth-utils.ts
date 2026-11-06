import type {
  CanonicalInstrument,
  HoldingValuation,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashBalance,
  WealthCurrency,
  WealthPositionState,
  WealthReport,
  WealthSnapshot,
  WealthValuedPosition,
} from '../../domain/wealth-types';
import type { WealthAccountView, WealthAllocationRow, WealthFxStatus, WealthHistoryPoint as WealthApiHistoryPoint, WealthModifiedDietzByCurrency } from '../../domain/wealth-api-types';
import { reportCashFlows, type WealthCashFlowView } from './wealth-cashflow-utils';

export type { WealthCashFlowView } from './wealth-cashflow-utils';

export type WealthHistoryPoint = WealthApiHistoryPoint;

export interface WealthCoverage {
  status: 'complete' | 'incomplete' | 'stale' | 'unavailable';
  message: string;
  latestDate: string | null;
}

export interface WealthQuoteState {
  configured: boolean;
  provider: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  coverage: string | null;
}

export interface WealthEventHistoryItem {
  sourceId: string;
  date: string;
  kind: string;
  accountId: string;
  instrument: CanonicalInstrument | null;
  quantity: string | null;
  money: { currency: string; amountMinor: number } | null;
  memo: string | null;
  targetSourceId: string | null;
  replacement: WealthEventHistoryReplacement | null;
}

export interface WealthEventHistoryReplacement {
  date: string;
  kind: string;
  accountId: string;
  instrument: CanonicalInstrument | null;
  quantity: string | null;
  money: { currency: string; amountMinor: number } | null;
  memo: string | null;
}

export interface WealthValuationHistoryItem {
  id: string;
  accountId: string;
  instrument: CanonicalInstrument | null;
  asOf: string;
  priceMinor: number;
  source: 'manual' | 'provider';
  provider: string | null;
}

export interface WealthPayload extends Omit<WealthSnapshot, 'accounts'> {
  accounts: WealthAccountView[];
  revision: number;
  history: WealthHistoryPoint[];
  coverage: WealthCoverage;
  quoteSettings: WealthQuoteState;
  fx: WealthFxStatus;
  allocations: WealthAllocationRow[];
}

export interface WealthReportPayload extends Omit<WealthReport, 'accounts' | 'cashFlows'> {
  accounts: WealthAccountView[];
  cashFlows: WealthCashFlowView[];
  householdCashFlows: WealthCashFlowView[];
  investmentCashFlows: WealthCashFlowView[];
  revision: number;
  history: WealthHistoryPoint[];
  coverage: WealthCoverage;
  quoteSettings: WealthQuoteState;
  fx: WealthFxStatus;
  modifiedDietzByCurrency: WealthModifiedDietzByCurrency;
  allocations: WealthAllocationRow[];
}

const defaultCoverage: WealthCoverage = { status: 'unavailable', message: 'No dated observations are available yet.', latestDate: null };
const defaultQuotes: WealthQuoteState = { configured: false, provider: null, lastRefreshAt: null, lastError: null, coverage: null };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function firstValue(value: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (value[key] !== undefined) return value[key];
  return undefined;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function nullableInteger(value: unknown): number | null {
  return isSafeInteger(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function missingCoverageReasons(value: unknown): string[] {
  const entries = [...new Set(stringArray(value))];
  const hasDetailedGap = entries.some((entry) => entry.startsWith('account:') || entry.startsWith('position:'));
  return entries.filter((entry) => !entry.startsWith('valuation:') || !hasDetailedGap);
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const rate = typeof entry === 'string' ? entry.trim() : '';
    return key.trim() && rate ? [[key.trim().toUpperCase(), rate] as const] : [];
  }));
}

function instrument(value: unknown): CanonicalInstrument | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'stock' && value.type !== 'etf') return null;
  const exchange = stringValue(value.exchange).trim().toUpperCase();
  const ticker = stringValue(value.ticker).trim().toUpperCase();
  const currency = stringValue(value.currency).trim().toUpperCase();
  if ([exchange, ticker, currency].some((part) => part.length === 0)) return null;
  return { exchange, ticker, type: value.type, currency };
}

function accountKind(value: unknown): WealthAccount['kind'] | null {
  return ['linked_bank', 'manual_asset', 'debt', 'brokerage'].includes(String(value)) ? value as WealthAccount['kind'] : null;
}

function accountMode(value: unknown): WealthAccount['mode'] | null {
  return value === 'holdings' || value === 'aggregate' ? value : null;
}

function accountValueState(value: Record<string, unknown>): WealthAccountView['valueState'] {
  const state = value.valueState ?? value.value_state;
  return state === 'fresh' || state === 'stale' || state === 'missing' ? state : undefined;
}

function nonEmptyString(value: unknown): string | null {
  const text = stringValue(value).trim();
  return text || null;
}

function accountIdentity(value: Record<string, unknown>): { id: string; name: string; kind: WealthAccount['kind']; mode: WealthAccount['mode'] } | null {
  const id = nonEmptyString(value.id);
  const name = nonEmptyString(value.name);
  if (!id || !name) return null;
  const kind = accountKind(value.kind);
  const mode = accountMode(value.mode);
  return kind && mode ? { id, name, kind, mode } : null;
}

function accountDetails(value: Record<string, unknown>): Omit<WealthAccountView, 'id' | 'name' | 'kind' | 'mode'> {
  const valueObservedAt = value.valueObservedAt ?? value.value_observed_at;
  return {
    currency: stringValue(value.currency).trim().toUpperCase() || undefined,
    linkedBankAccountId: typeof value.linkedBankAccountId === 'string' ? value.linkedBankAccountId : null,
    active: value.active !== false,
    amountMinor: nullableInteger(value.amountMinor ?? value.amount_minor),
    valueMinor: nullableInteger(value.valueMinor ?? value.value_minor),
    valueState: accountValueState(value),
    valueObservedAt: typeof valueObservedAt === 'string' ? valueObservedAt : null,
    revision: nullableInteger(value.revision) ?? undefined,
  };
}

function account(value: unknown): WealthAccountView | null {
  if (!isRecord(value)) return null;
  const identity = accountIdentity(value);
  return identity ? { ...identity, ...accountDetails(value) } : null;
}

function parseAccounts(value: unknown): WealthAccountView[] {
  return Array.isArray(value) ? value.flatMap((entry) => { const parsed = account(entry); return parsed ? [parsed] : []; }) : [];
}

function valuationInstrument(value: Record<string, unknown>, fallbackInstrument: CanonicalInstrument): CanonicalInstrument | null {
  if (value.instrument === undefined || value.instrument === null) return fallbackInstrument;
  return instrument(value.instrument);
}

function valuationSource(value: Record<string, unknown>): 'manual' | 'provider' {
  return value.source === 'provider' ? 'provider' : 'manual';
}

function valuationProvider(value: Record<string, unknown>): string | null {
  return typeof value.provider === 'string' ? value.provider : null;
}

function valuation(value: unknown, fallbackInstrument: CanonicalInstrument, fallbackAccountId: string): HoldingValuation | null {
  if (!isRecord(value)) return null;
  const parsedInstrument = valuationInstrument(value, fallbackInstrument);
  const asOf = stringValue(firstValue(value, ['asOf', 'as_of'])).trim();
  const priceMinor = nullableInteger(firstValue(value, ['priceMinor', 'price_minor']));
  const accountId = nonEmptyString(firstValue(value, ['accountId', 'account_id'])) ?? fallbackAccountId;
  if (!parsedInstrument) return null;
  if (!asOf || priceMinor === null) return null;
  return { accountId, instrument: parsedInstrument, asOf, priceMinor, source: valuationSource(value), provider: valuationProvider(value) };
}

function position(value: unknown): WealthValuedPosition | null {
  if (!isRecord(value)) return null;
  const parsedInstrument = instrument(value.instrument);
  const accountId = stringValue(value.accountId ?? value.account_id).trim();
  const quantity = stringValue(value.quantity).trim();
  if (!parsedInstrument) return null;
  if (!accountId || !quantity) return null;
  const base: WealthPositionState = {
    accountId,
    instrument: parsedInstrument,
    quantity,
    costBasisMinor: nullableInteger(value.costBasisMinor ?? value.cost_basis_minor),
    basisKnown: value.basisKnown === true || value.basis_known === true,
    realizedGainMinor: nullableInteger(value.realizedGainMinor ?? value.realized_gain_minor),
  };
  return { ...base, valuation: valuation(value.valuation, parsedInstrument, accountId), marketValueMinor: nullableInteger(value.marketValueMinor ?? value.market_value_minor), unrealizedGainMinor: nullableInteger(value.unrealizedGainMinor ?? value.unrealized_gain_minor) };
}

function parsePositions(value: unknown): WealthValuedPosition[] {
  return Array.isArray(value) ? value.flatMap((entry) => { const parsed = position(entry); return parsed ? [parsed] : []; }) : [];
}

interface AllocationIdentity {
  currency: string;
  accountId: string;
  kind: 'aggregate' | 'holding' | 'cash';
}

function allocationIdentity(value: Record<string, unknown>): AllocationIdentity | null {
  const currency = nonEmptyString(value.currency)?.toUpperCase();
  const accountId = nonEmptyString(firstValue(value, ['accountId', 'account_id']));
  const kind = value.kind === 'aggregate' || value.kind === 'holding' || value.kind === 'cash' ? value.kind : null;
  return currency && accountId && kind ? { currency, accountId, kind } : null;
}

function allocationValue(value: Record<string, unknown>): { valueMinor: number | null; present: boolean } {
  const raw = firstValue(value, ['valueMinor', 'value_minor']);
  return { valueMinor: raw === null ? null : nullableInteger(raw), present: raw !== undefined };
}

function allocationShare(value: Record<string, unknown>): { share: number | null; valid: boolean } {
  const raw = value.share;
  if (raw === null) return { share: null, valid: true };
  if (raw === undefined) return { share: null, valid: false };
  const share = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
  return { share, valid: share !== null };
}

function allocationInstrument(value: Record<string, unknown>): CanonicalInstrument | null {
  return value.instrument === null || value.instrument === undefined ? null : instrument(value.instrument);
}

interface AllocationShapeInput {
  identity: AllocationIdentity;
  instrument: CanonicalInstrument | null;
  valuePresent: boolean;
  shareValid: boolean;
  available: unknown;
}

function validAllocationShape(input: AllocationShapeInput): boolean {
  if (!input.valuePresent) return false;
  if (!input.shareValid) return false;
  if (typeof input.available !== 'boolean') return false;
  return input.identity.kind === 'holding' ? input.instrument !== null : input.instrument === null;
}

function allocation(value: unknown): WealthAllocationRow | null {
  if (!isRecord(value)) return null;
  const identity = allocationIdentity(value);
  if (!identity) return null;
  const parsedInstrument = allocationInstrument(value);
  const amount = allocationValue(value);
  const share = allocationShare(value);
  if (!validAllocationShape({ identity, instrument: parsedInstrument, valuePresent: amount.present, shareValid: share.valid, available: value.available })) return null;
  return { ...identity, instrument: parsedInstrument, valueMinor: amount.valueMinor, share: share.share, available: value.available as boolean };
}

function parseAllocations(value: unknown): WealthAllocationRow[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((entry) => { const parsed = allocation(entry); return parsed ? [parsed] : []; });
  return rows.length === value.length ? rows : null;
}

function cash(value: unknown): WealthCashBalance | null {
  if (!isRecord(value)) return null;
  const accountId = stringValue(value.accountId ?? value.account_id).trim();
  const currency = stringValue(value.currency).trim().toUpperCase();
  if (!accountId || !currency) return null;
  const amountMinor = nullableInteger(value.amountMinor ?? value.amount_minor);
  return amountMinor === null ? null : { accountId, currency, amountMinor };
}

function parseCash(value: unknown): WealthCashBalance[] {
  return Array.isArray(value) ? value.flatMap((entry) => { const parsed = cash(entry); return parsed ? [parsed] : []; }) : [];
}

function historyItems(value: unknown, key: 'events' | 'valuations'): unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function historyMoney(value: unknown): { currency: string; amountMinor: number } | null {
  if (!isRecord(value)) return null;
  const currency = stringValue(value.currency).trim().toUpperCase();
  const amountMinor = nullableInteger(value.amountMinor ?? value.amount_minor);
  return currency && amountMinor !== null ? { currency, amountMinor } : null;
}

function historyReplacement(value: unknown): WealthEventHistoryReplacement | null {
  if (!isRecord(value)) return null;
  const date = stringValue(value.date);
  const kind = stringValue(value.kind).replaceAll('_', ' ');
  if (!date || !kind) return null;
  return {
    date,
    kind,
    accountId: stringValue(value.accountId ?? value.account_id ?? value.fromAccountId ?? value.from_account_id),
    instrument: instrument(value.instrument),
    quantity: typeof value.quantity === 'string' ? value.quantity : null,
    money: historyMoney(value.money ?? value.consideration ?? value.proceeds ?? value.basis),
    memo: typeof value.memo === 'string' ? value.memo : null,
  };
}

interface HistoryEventIdentity {
  date: string;
  kind: string;
  sourceId: string;
}

function historyEventIdentity(value: Record<string, unknown>): HistoryEventIdentity | null {
  const date = stringValue(value.date);
  const kind = stringValue(value.kind).replaceAll('_', ' ');
  const sourceId = nonEmptyString(firstValue(value, ['sourceId', 'source_id']));
  return date && kind && sourceId ? { date, kind, sourceId } : null;
}

function historyAccountId(value: Record<string, unknown>, replacement: WealthEventHistoryReplacement | null): string {
  return stringValue(value.accountId ?? value.account_id ?? value.fromAccountId ?? value.from_account_id) || replacement?.accountId || '';
}

function historyEventMoney(value: Record<string, unknown>, replacement: WealthEventHistoryReplacement | null): { currency: string; amountMinor: number } | null {
  return historyMoney(value.money ?? value.consideration ?? value.proceeds) ?? replacement?.money ?? null;
}

function historyInstrumentValue(value: Record<string, unknown>, replacement: WealthEventHistoryReplacement | null): CanonicalInstrument | null {
  return instrument(value.instrument) ?? replacement?.instrument ?? null;
}

function historyQuantityValue(value: Record<string, unknown>, replacement: WealthEventHistoryReplacement | null): string | null {
  return typeof value.quantity === 'string' ? value.quantity : replacement?.quantity ?? null;
}

function historyMemoValue(value: Record<string, unknown>, replacement: WealthEventHistoryReplacement | null): string | null {
  return typeof value.memo === 'string' ? value.memo : replacement?.memo ?? null;
}

function historyTargetSource(value: Record<string, unknown>): string | null {
  return nonEmptyString(firstValue(value, ['targetSourceId', 'target_source_id'])) ?? null;
}

function normalizeHistoryEvent(value: unknown): WealthEventHistoryItem | null {
  if (!isRecord(value)) return null;
  const identity = historyEventIdentity(value);
  if (!identity) return null;
  const replacement = identity.kind === 'correction' ? historyReplacement(value.replacement) : null;
  return {
    ...identity,
    accountId: historyAccountId(value, replacement),
    instrument: historyInstrumentValue(value, replacement),
    quantity: historyQuantityValue(value, replacement),
    money: historyEventMoney(value, replacement),
    memo: historyMemoValue(value, replacement),
    targetSourceId: historyTargetSource(value),
    replacement,
  };
}

export function normalizeEventHistory(value: unknown): WealthEventHistoryItem[] {
  return historyItems(value, 'events').flatMap((entry) => { const parsed = normalizeHistoryEvent(entry); return parsed ? [parsed] : []; });
}

export function normalizeValuationHistory(value: unknown): WealthValuationHistoryItem[] {
  return historyItems(value, 'valuations').flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const asOf = stringValue(entry.asOf ?? entry.as_of);
    const accountId = stringValue(entry.accountId ?? entry.account_id);
    const id = nonEmptyString(entry.id);
    const priceMinor = nullableInteger(entry.priceMinor ?? entry.price_minor);
    if (!asOf) return [];
    if (!accountId) return [];
    if (!id) return [];
    if (priceMinor === null) return [];
    return [{ id, accountId, instrument: instrument(entry.instrument), asOf, priceMinor, source: entry.source === 'provider' ? 'provider' : 'manual', provider: typeof entry.provider === 'string' ? entry.provider : null }];
  });
}

function integerRecord(value: unknown): Record<WealthCurrency, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([currency, amount]) => typeof amount === 'number' && Number.isSafeInteger(amount) ? [[currency, amount]] : []));
}

function history(value: unknown): WealthHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !stringValue(entry.date)) return [];
    const rawTotals = isRecord(entry.totals) ? entry.totals : isRecord(entry.totalByCurrency) ? entry.totalByCurrency : {};
    const totals = Object.fromEntries(Object.entries(rawTotals).flatMap(([currency, amount]) => typeof amount === 'number' && Number.isSafeInteger(amount) ? [[currency, amount]] : []));
    const missingData = firstValue(entry, ['missingData', 'missing_data']);
    return [{ date: stringValue(entry.date), totals, convertedCadMinor: nullableInteger(entry.convertedCadMinor ?? entry.converted_cad_minor), complete: entry.complete === true, stale: entry.stale === true, missingData: missingCoverageReasons(missingData) }];
  });
}

function coverage(value: unknown): WealthCoverage {
  if (!isRecord(value)) return defaultCoverage;
  const status = ['complete', 'incomplete', 'stale', 'unavailable'].includes(String(value.status)) ? value.status as WealthCoverage['status'] : defaultCoverage.status;
  return { status, message: stringValue(value.message, status === 'complete' ? 'Dated observations are complete.' : defaultCoverage.message), latestDate: typeof value.latestDate === 'string' ? value.latestDate : typeof value.latest_date === 'string' ? value.latest_date : null };
}

function responseCoverage(raw: Record<string, unknown>): WealthCoverage {
  if (raw.coverage !== undefined) return coverage(raw.coverage);
  const missing = missingCoverageReasons(firstValue(raw, ['missingData', 'missing_data']));
  const stale = raw.stale === true;
  if (stale) return { status: 'stale', message: 'Some connected balances or provider prices are older than the report date.', latestDate: null };
  if (missing.length > 0) return { status: 'incomplete', message: `${missing.length} dated value${missing.length === 1 ? '' : 's'} still need review.`, latestDate: null };
  return { status: 'complete', message: 'Dated observations are complete for the current report.', latestDate: null };
}

function quotes(value: unknown): WealthQuoteState {
  if (!isRecord(value)) return defaultQuotes;
  return { configured: value.configured === true, provider: typeof value.provider === 'string' ? value.provider : null, lastRefreshAt: typeof value.lastRefreshAt === 'string' ? value.lastRefreshAt : typeof value.last_refresh_at === 'string' ? value.last_refresh_at : null, lastError: typeof value.lastError === 'string' ? value.lastError : typeof value.last_error === 'string' ? value.last_error : null, coverage: typeof value.coverage === 'string' ? value.coverage : null };
}

function fx(value: unknown): WealthFxStatus {
  if (!isRecord(value)) return { convertedCadMinor: null, complete: false, unavailable: [], effectiveDate: null, provider: null, baseCurrency: null, rates: {} };
  const convertedCadMinor = nullableInteger(value.convertedCadMinor ?? value.converted_cad_minor);
  const unavailable = Array.isArray(value.unavailable) ? value.unavailable.filter((entry): entry is string => typeof entry === 'string') : [];
  const effectiveDate = stringValue(value.effectiveDate ?? value.effective_date).trim() || null;
  const provider = value.provider === 'frankfurter' ? 'frankfurter' : null;
  const baseCurrency = value.baseCurrency === 'EUR' || value.base_currency === 'EUR' ? 'EUR' : null;
  return { convertedCadMinor, complete: value.complete === true, unavailable, effectiveDate, provider, baseCurrency, rates: stringMap(value.rates) };
}

function modifiedDietz(value: unknown): ModifiedDietzResult {
  const raw = isRecord(value) ? value : {};
  const reason = ['missing_start_valuation', 'missing_end_valuation', 'incomplete_flows', 'invalid_period'].includes(String(raw.reason)) ? raw.reason as ModifiedDietzResult['reason'] : null;
  return { available: raw.available === true, value: typeof raw.value === 'number' ? raw.value : null, reason };
}

function modifiedDietzByCurrency(value: unknown): WealthModifiedDietzByCurrency {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([currency, result]) => {
    const code = currency.trim().toUpperCase();
    return code && isRecord(result) ? [[code, modifiedDietz(result)]] : [];
  }));
}

type TotalStatus = 'complete' | 'incomplete';

function parsedStatuses(value: unknown): Record<WealthCurrency, TotalStatus> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([currency, status]) => status === 'complete' || status === 'incomplete' ? [[currency, status as TotalStatus]] : []));
}

function markMissingTotals(statuses: Record<WealthCurrency, TotalStatus>, totals: Readonly<Record<string, number>>): void {
  for (const currency of Object.keys(totals)) statuses[currency] ??= 'complete';
}

function markUnvaluedAccounts(statuses: Record<WealthCurrency, TotalStatus>, accounts: readonly WealthAccountView[]): void {
  for (const account of accounts) {
    if (account.mode !== 'aggregate') continue;
    if (!account.currency || account.valueState === 'fresh') continue;
    statuses[account.currency] = 'incomplete';
  }
}

function markUnvaluedPositions(statuses: Record<WealthCurrency, TotalStatus>, positions: readonly WealthValuedPosition[]): void {
  for (const position of positions) {
    if (position.marketValueMinor === null) statuses[position.instrument.currency] = 'incomplete';
  }
}

function totalStatuses(value: unknown, totals: Readonly<Record<string, number>>, accounts: readonly WealthAccountView[], positions: readonly WealthValuedPosition[]): Record<WealthCurrency, TotalStatus> {
  const statuses = parsedStatuses(value);
  markMissingTotals(statuses, totals);
  markUnvaluedAccounts(statuses, accounts);
  markUnvaluedPositions(statuses, positions);
  return statuses;
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.snapshot) ? value.snapshot : value;
}

interface SnapshotParts {
  raw: Record<string, unknown>;
  accounts: unknown[];
  positions: unknown[];
  cash: unknown[];
  asOf: string;
  revision: number;
  totals: Record<string, unknown>;
}

interface SnapshotArrays {
  accounts: unknown[];
  positions: unknown[];
  cash: unknown[];
}

function snapshotArrays(raw: Record<string, unknown>): SnapshotArrays | null {
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : null;
  const positions = Array.isArray(raw.positions) ? raw.positions : null;
  const cash = Array.isArray(raw.cash) ? raw.cash : null;
  return accounts && positions && cash ? { accounts, positions, cash } : null;
}

function snapshotParts(value: unknown): SnapshotParts | null {
  const raw = snapshotRecord(value);
  if (!raw) return null;
  const arrays = snapshotArrays(raw);
  if (!arrays) return null;
  const asOf = nonEmptyString(firstValue(raw, ['asOf', 'as_of']));
  const revision = nullableInteger(raw.revision);
  const totals = firstValue(raw, ['totalByCurrency', 'total_by_currency']);
  if (!asOf || revision === null) return null;
  if (revision < 0) return null;
  if (!isRecord(totals)) return null;
  return { raw, ...arrays, asOf, revision, totals };
}

function snapshotHistory(raw: Record<string, unknown>): WealthHistoryPoint[] {
  return history(firstValue(raw, ['history', 'netWorthHistory', 'net_worth_history']));
}

function snapshotStatus(raw: Record<string, unknown>, totals: Readonly<Record<string, number>>, accounts: readonly WealthAccountView[], positions: readonly WealthValuedPosition[]): Record<WealthCurrency, TotalStatus> {
  return totalStatuses(firstValue(raw, ['totalStatusByCurrency', 'total_status_by_currency']), totals, accounts, positions);
}

function snapshotFromParts(parts: SnapshotParts): WealthPayload | null {
  const accounts = parseAccounts(parts.accounts);
  const positions = parsePositions(parts.positions);
  const cashBalances = parseCash(parts.cash);
  if (accounts.length !== parts.accounts.length) return null;
  if (positions.length !== parts.positions.length) return null;
  if (cashBalances.length !== parts.cash.length) return null;
  const allocations = parseAllocations(parts.raw.allocations);
  if (!allocations) return null;
  const totals = integerRecord(parts.totals);
  const quoteSettings = firstValue(parts.raw, ['quoteSettings', 'quote_settings']);
  return { asOf: parts.asOf, accounts, positions, cash: cashBalances, totalByCurrency: totals, totalStatusByCurrency: snapshotStatus(parts.raw, totals, accounts, positions), revision: parts.revision, history: snapshotHistory(parts.raw), coverage: responseCoverage(parts.raw), quoteSettings: quotes(quoteSettings), fx: fx(parts.raw.fx), allocations };
}

export function normalizeSnapshot(value: unknown): WealthPayload | null {
  const parts = snapshotParts(value);
  return parts ? snapshotFromParts(parts) : null;
}

interface ReportParts {
  raw: Record<string, unknown>;
  householdFlows: unknown[];
  investmentFlows: unknown[];
  history: unknown[];
  revision: number;
}

function firstArray(raw: Record<string, unknown>, keys: readonly string[]): unknown[] | null {
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key];
  return null;
}

function reportParts(value: unknown): ReportParts | null {
  if (!isRecord(value)) return null;
  const householdFlows = firstArray(value, ['householdCashFlows', 'household_cash_flows', 'cashFlows', 'cash_flows']);
  const investmentFlows = firstArray(value, ['investmentCashFlows', 'investment_cash_flows']);
  const reportHistory = firstArray(value, ['history', 'netWorthHistory', 'net_worth_history']);
  const revision = nullableInteger(value.revision);
  if (!householdFlows) return null;
  if (!investmentFlows) return null;
  if (!reportHistory) return null;
  if (revision === null || revision < 0) return null;
  return { raw: value, householdFlows, investmentFlows, history: reportHistory, revision };
}

function normalizeReportFlows(value: unknown[]): WealthCashFlowView[] | null {
  const flows = reportCashFlows(value);
  return flows.length === value.length ? flows : null;
}

function validReportHistory(value: unknown[], parsed: WealthHistoryPoint[]): boolean {
  return parsed.length === value.length;
}

export function normalizeReport(value: unknown, _fallback: WealthPayload): WealthReportPayload | null {
  const parts = reportParts(value);
  if (!parts) return null;
  const snapshot = normalizeSnapshot(parts.raw);
  if (!snapshot) return null;
  const householdCashFlows = normalizeReportFlows(parts.householdFlows);
  const investmentCashFlows = normalizeReportFlows(parts.investmentFlows);
  const reportHistory = history(parts.history);
  if (!householdCashFlows || !investmentCashFlows) return null;
  if (!validReportHistory(parts.history, reportHistory)) return null;
  const raw = parts.raw;
  const allocations = parseAllocations(raw.allocations);
  if (!allocations) return null;
  const dietz = modifiedDietz(firstValue(raw, ['modifiedDietz', 'modified_dietz']));
  const dietzByCurrency = modifiedDietzByCurrency(firstValue(raw, ['modifiedDietzByCurrency', 'modified_dietz_by_currency']));
  return { ...snapshot, cashFlows: householdCashFlows, householdCashFlows, investmentCashFlows, modifiedDietz: dietz, modifiedDietzByCurrency: dietzByCurrency, revision: parts.revision, history: reportHistory, coverage: responseCoverage(raw), quoteSettings: quotes(firstValue(raw, ['quoteSettings', 'quote_settings'])), fx: fx(raw.fx), allocations };
}

export function formatWealthMoney(amountMinor: number | null | undefined, currency: string, options?: Intl.NumberFormatOptions): string {
  if (amountMinor === null || amountMinor === undefined) return 'Unavailable';
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency, ...options }).format(amountMinor / 100); } catch { return `${currency} ${(amountMinor / 100).toFixed(2)}`; }
}

export function formatWealthPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'Unavailable' : `${(value * 100).toFixed(2)}%`;
}

export function formatQuantity(value: string | number): string {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-CA', { maximumFractionDigits: 8 }) : String(value);
}

export function parseMoneyMinor(value: string, currency: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const amount = Number(normalized.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) return null;
  return Math.round(amount * 100);
}

export function templateCsv(): string {
  return ['date,kind,account_id,exchange,ticker,instrument_type,currency,quantity,amount,price,fee,memo', '2026-01-01,opening_cash,account-id,,,cash,CAD,,,1000,,Opening cash', '2026-01-02,buy,account-id,TSX,SHOP,stock,CAD,2.5,300.00,120.00,4.95,Example trade'].join('\n');
}

export function downloadText(filename: string, content: string, type = 'text/csv;charset=utf-8'): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
