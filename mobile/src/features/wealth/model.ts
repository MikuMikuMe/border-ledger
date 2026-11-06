import type {
  ClassifiedWealthCashFlow,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashBalance,
  WealthValuedPosition,
} from '../../../../src/domain/wealth-types';
import type { WealthAllocationRow, WealthCashFlowTotals, WealthFxStatus } from '../../../../src/domain/wealth-api-types';
import type { WealthCashFlowRow, WealthCsvMapping, WealthCsvState, WealthHistoryPoint, WealthQuoteState, WealthWireSnapshot } from './contracts';

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value) throw new Error('Invalid wealth response');
  if (typeof value !== 'object') throw new Error('Invalid wealth response');
  if (Array.isArray(value)) throw new Error('Invalid wealth response');
  return value as Record<string, unknown>;
};
const asString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid wealth ${label}`);
  return value;
};
const nullableString = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const nullableNumber = (value: unknown): number | null => {
  if (value === null) return null;
  if (value === undefined) return null;
  if (value === '') return null;
  let parsed = Number.NaN;
  if (typeof value === 'number') parsed = value;
  if (typeof value === 'string') parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const numberOrZeroForCount = (value: unknown): number => {
  const parsed = nullableNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const nullableMinor = (value: unknown): number => nullableNumber(value) as unknown as number;
const requiredMinor = (value: unknown, label: string): number => {
  const parsed = nullableNumber(value);
  if (parsed === null || !Number.isSafeInteger(parsed)) throw new Error(`Invalid wealth ${label}`);
  return parsed;
};
const objectArray = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(asObject) : [];
const objectOrNull = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};
const instrument = (value: unknown) => {
  const row = asObject(value);
  return { exchange: asString(row.exchange, 'exchange'), ticker: asString(row.ticker, 'ticker'), type: row.type as 'stock' | 'etf', currency: asString(row.currency, 'instrument currency') };
};
const money = (value: unknown) => {
  const row = asObject(value);
  return { currency: asString(row.currency, 'money currency'), amountMinor: requiredMinor(row.amountMinor, 'money amount') };
};

function account(value: unknown): WealthAccount {
  const row = asObject(value);
  return {
    id: asString(row.id, 'account id'), name: asString(row.name, 'account name'),
    kind: row.kind as WealthAccount['kind'], mode: row.mode as WealthAccount['mode'],
    currency: nullableString(row.currency) ?? undefined, linkedBankAccountId: nullableString(row.linkedBankAccountId), active: row.active !== false,
  };
}

function position(value: unknown): WealthValuedPosition {
  const row = asObject(value);
  const instrumentRow = asObject(row.instrument);
  const valuation = row.valuation === null || row.valuation === undefined ? null : (() => {
    const source = asObject(row.valuation);
    return { accountId: asString(source.accountId ?? row.accountId, 'valuation account'), instrument: instrument(source.instrument ?? row.instrument),
      asOf: asString(source.asOf, 'valuation date'), priceMinor: nullableMinor(source.priceMinor),
      source: source.source as 'manual' | 'provider', provider: nullableString(source.provider) };
  })();
  return {
    accountId: asString(row.accountId, 'position account'),
    instrument: instrument(instrumentRow),
    quantity: asString(row.quantity, 'quantity'), costBasisMinor: nullableNumber(row.costBasisMinor), basisKnown: row.basisKnown === true,
    realizedGainMinor: nullableNumber(row.realizedGainMinor), valuation, marketValueMinor: nullableNumber(row.marketValueMinor), unrealizedGainMinor: nullableNumber(row.unrealizedGainMinor),
  };
}

function cash(value: unknown): WealthCashBalance {
  const row = asObject(value);
  return { accountId: asString(row.accountId, 'cash account'), currency: asString(row.currency, 'cash currency'), amountMinor: nullableMinor(row.amountMinor) };
}

function cashFlow(value: unknown): WealthCashFlowRow {
  const row = asObject(value);
  return { sourceId: asString(row.sourceId, 'cash flow id'), date: asString(row.date, 'cash flow date'), accountId: asString(row.accountId, 'cash flow account'), money: money(row.money),
    direction: row.direction === 'inflow' || row.direction === 'outflow' ? row.direction : null, kind: typeof row.kind === 'string' ? row.kind as ClassifiedWealthCashFlow['kind'] : null,
    linkedWealthSourceId: nullableString(row.linkedWealthSourceId), classification: row.classification as ClassifiedWealthCashFlow['classification'], includedInPerformance: row.includedInPerformance === true, reason: asString(row.reason, 'cash flow reason'),
    transactionId: nullableString(row.transactionId), merchant: nullableString(row.merchant), accountName: nullableString(row.accountName), category: nullableString(row.category),
    bankKind: bankKind(row.bankKind), eventKind: investmentEventKind(row.eventKind), source: nullableString(row.source), status: nullableString(row.status),
    linkConflict: booleanOrUndefined(row.linkConflict), confirmed: booleanOrUndefined(row.confirmed), };
}

function bankKind(value: unknown): WealthCashFlowRow['bankKind'] {
  return value === 'expense' || value === 'income' || value === 'refund' || value === 'fee' ? value : undefined;
}

function investmentEventKind(value: unknown): WealthCashFlowRow['eventKind'] {
  return value === 'dividend' || value === 'withholding' || value === 'fee' || value === 'contribution' || value === 'withdrawal' ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function uniqueCashFlows(value: unknown): WealthCashFlowRow[] {
  const seen = new Set<string>();
  return objectArray(value).map(cashFlow).filter(flow => {
    if (seen.has(flow.sourceId)) return false;
    seen.add(flow.sourceId);
    return true;
  });
}

function cashFlowTotals(value: unknown): Readonly<Record<string, WealthCashFlowTotals>> {
  const source = objectOrNull(value);
  if (!source) return {};
  const result: Record<string, WealthCashFlowTotals> = {};
  for (const [currency, raw] of Object.entries(source)) {
    const row = objectOrNull(raw);
    if (!row) continue;
    const fields = ['inflowMinor', 'outflowMinor', 'netMinor', 'incomeMinor', 'expenseMinor', 'refundMinor', 'feeMinor'] as const;
    const values = Object.fromEntries(fields.map(field => [field, nullableNumber(row[field])])) as Record<typeof fields[number], number | null>;
    if (fields.some(field => values[field] === null || !Number.isSafeInteger(values[field]))) continue;
    result[currency] = values as WealthCashFlowTotals;
  }
  return result;
}

function history(value: unknown): WealthHistoryPoint[] {
  return objectArray(value).map(point => ({
    date: asString(point.date, 'history date'),
    totals: Object.fromEntries(Object.entries(asObject(point.totals ?? {})).map(([currency, amount]) => [currency, nullableNumber(amount)])),
    // Missing metadata must never be presented as a complete net-worth total.
    complete: point.complete === true,
  }));
}

function events(value: unknown): NonNullable<WealthWireSnapshot['events']> {
  return objectArray(value).map(row => ({
    id: asString(row.id, 'event id'), sourceId: asString(row.sourceId ?? row.id, 'event source id'),
    date: asString(row.date, 'event date'), kind: typeof row.kind === 'string' ? row.kind : 'event', label: nullableString(row.memo ?? row.label), accountId: eventAccountId(row), linkedBankSourceId: eventBankLink(row), instrumentKey: eventInstrumentKey(row),
  }));
}

function eventAccountId(row: Record<string, unknown>): string | null {
  const replacement = objectOrNull(row.replacement);
  const candidate = row.accountId ?? row.fromAccountId ?? replacement?.accountId ?? replacement?.fromAccountId;
  return nullableString(candidate);
}

function eventBankLink(row: Record<string, unknown>): string | null {
  const replacement = objectOrNull(row.replacement);
  return nullableString(row.linkedBankSourceId ?? replacement?.linkedBankSourceId);
}

function eventInstrumentKey(row: Record<string, unknown>): string | null {
  const instrument = objectOrNull(row.instrument) ?? objectOrNull(objectOrNull(row.replacement)?.instrument);
  if (!instrument) return null;
  const exchange = nullableString(instrument.exchange);
  const ticker = nullableString(instrument.ticker);
  const type = nullableString(instrument.type);
  const currency = nullableString(instrument.currency);
  return exchange && ticker && type && currency ? `${exchange}:${ticker}:${type}:${currency}` : null;
}

function valuations(value: unknown): NonNullable<WealthWireSnapshot['valuations']> {
  return objectArray(value).map(row => ({
    id: asString(row.id, 'valuation id'), accountId: asString(row.accountId, 'valuation account'),
    instrument: row.instrument === null || row.instrument === undefined ? null : instrument(row.instrument),
    asOf: asString(row.asOf, 'valuation date'), priceMinor: nullableNumber(row.priceMinor),
    source: row.source === 'provider' ? 'provider' : 'manual', provider: nullableString(row.provider),
  }));
}

function modifiedDietz(value: unknown): ModifiedDietzResult {
  const dietz = asObject(value ?? { value: null, available: false, reason: 'missing_end_valuation' });
  return { value: nullableNumber(dietz.value), available: dietz.available === true, reason: nullableString(dietz.reason) as ModifiedDietzResult['reason'] };
}

function modifiedDietzByCurrency(value: unknown): Readonly<Record<string, ModifiedDietzResult>> | undefined {
  const source = objectOrNull(value);
  if (!source) return undefined;
  const entries = Object.entries(source).map(([currency, result]) => [currency, modifiedDietz(result)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function positiveFxRateText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  const parsed = nullableNumber(text);
  return parsed !== null && parsed > 0 ? text : null;
}

function fxRates(value: unknown): Readonly<Record<string, string>> {
  const source = objectOrNull(value);
  if (!source) return {};
  return Object.fromEntries(Object.entries(source).flatMap(([currency, raw]) => {
    const rate = positiveFxRateText(raw);
    return rate === null ? [] : [[currency, rate]];
  }));
}

function fx(value: unknown): WealthFxStatus {
  const source = asObject(value ?? {});
  return {
    convertedCadMinor: nullableMinor(source.convertedCadMinor),
    complete: source.complete === true,
    unavailable: Array.isArray(source.unavailable) ? source.unavailable.filter((item): item is string => typeof item === 'string') : [],
    effectiveDate: nullableString(source.effectiveDate),
    provider: source.provider === 'frankfurter' ? 'frankfurter' : null,
    baseCurrency: source.baseCurrency === 'EUR' ? 'EUR' : null,
    rates: fxRates(source.rates),
  };
}

function allocations(value: unknown): WealthAllocationRow[] {
  return objectArray(value).flatMap(row => {
    const currency = nullableString(row.currency);
    const accountId = nullableString(row.accountId);
    const kind = allocationKind(row.kind);
    if (currency === null) return [];
    if (accountId === null) return [];
    if (kind === null) return [];
    const valueMinor = nullableNumber(row.valueMinor);
    const share = nullableNumber(row.share);
    const instrumentValue = row.instrument === null || row.instrument === undefined ? null : instrument(row.instrument);
    return [{ currency, accountId, kind, instrument: instrumentValue, valueMinor, share, available: row.available === true }];
  });
}

function allocationKind(value: unknown): WealthAllocationRow['kind'] | null {
  return value === 'aggregate' || value === 'holding' || value === 'cash' ? value : null;
}

function quote(value: unknown): WealthQuoteState {
  const source = asObject(value ?? {});
  return { configured: source.configured === true, provider: nullableString(source.provider), lastRefreshedAt: nullableString(source.lastRefreshedAt), error: nullableString(source.error) };
}

function csv(value: unknown): WealthCsvState {
  const source = asObject(value ?? {});
  return {
    template: nullableString(source.template), previewId: nullableString(source.previewId), revision: nullableNumber(source.revision),
    sourceHeaders: stringArray(source.sourceHeaders ?? source.headers),
    canonicalHeaders: stringArray(source.canonicalHeaders),
    mapping: csvMapping(source.mapping),
    validRowIds: Array.isArray(source.validRowIds) ? source.validRowIds.filter((item): item is string => typeof item === 'string') : [],
    rowCount: numberOrZeroForCount(source.rowCount),
    errors: Array.isArray(source.errors) ? source.errors.filter((item): item is string => typeof item === 'string') : [],
    duplicates: objectArray(source.duplicates).map(row => ({ id: asString(row.id, 'duplicate id'), sourceId: nullableString(row.sourceId), status: typeof row.status === 'string' ? row.status : 'open', reason: nullableString(row.reason) })),
  };
}

function previewPayload(row: Record<string, unknown>): Record<string, unknown> | null {
  const event = objectOrNull(row.event);
  if (event) return event;
  const record = objectOrNull(row.record);
  const recordType = nullableString(row.recordType);
  if (!recordType || !record) return record;
  const payloadKey = recordType === 'mode_transition' ? 'transition' : recordType;
  return objectOrNull(record[payloadKey]) ?? record;
}

function instrumentDetails(payload: Record<string, unknown>): string | null {
  const instrumentValue = objectOrNull(payload.instrument);
  if (!instrumentValue) return null;
  const exchange = nullableString(instrumentValue.exchange);
  if (!exchange) return null;
  const ticker = nullableString(instrumentValue.ticker);
  if (!ticker) return null;
  const currency = nullableString(instrumentValue.currency);
  if (!currency) return null;
  return `${exchange}:${ticker} · ${currency}`;
}

function moneyDetails(payload: Record<string, unknown>): string | null {
  const moneyValue = objectOrNull(payload.money);
  if (!moneyValue) return null;
  return nullableString(moneyValue.currency);
}

function previewDetails(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const transition = modeTransitionDetails(payload);
  if (transition) return transition;
  const instrument = instrumentDetails(payload);
  if (instrument) return instrument;
  const money = moneyDetails(payload);
  if (money) return money;
  return nullableString(payload.name);
}

function hasPreviewValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function transitionOpeningDetails(payload: Record<string, unknown>): string {
  const openingPositions = Array.isArray(payload.openingPositions) ? payload.openingPositions.length : 0;
  if (openingPositions > 0) {
    return ` · ${openingPositions} opening position${openingPositions === 1 ? '' : 's'}`;
  }
  if (hasPreviewValue(payload.openingCashMinor)) return ' · opening cash';
  if (hasPreviewValue(payload.openingValueMinor)) return ' · opening value';
  return '';
}

function modeTransitionDetails(payload: Record<string, unknown>): string | null {
  const fromMode = nullableString(payload.fromMode);
  const toMode = nullableString(payload.toMode);
  if (!fromMode || !toMode) return null;
  const account = nullableString(payload.accountId);
  const effectiveDate = nullableString(payload.effectiveDate ?? payload.date);
  const accountPrefix = account ? `Account ${account} · ` : '';
  const effectiveSuffix = effectiveDate ? ` · effective ${effectiveDate}` : '';
  return `${accountPrefix}${fromMode} → ${toMode}${effectiveSuffix}${transitionOpeningDetails(payload)}`;
}

export function decodeWealthSnapshot(raw: string): WealthWireSnapshot {
  const value = asObject(JSON.parse(raw));
  const totals = asObject(value.totalByCurrency ?? {});
  const householdFlows = Array.isArray(value.householdCashFlows) ? uniqueCashFlows(value.householdCashFlows) : uniqueCashFlows(value.cashFlows);
  return {
    revision: nullableNumber(value.revision),
    asOf: nullableString(value.asOf), stale: value.stale === true,
    missingData: Array.isArray(value.missingData) ? value.missingData.filter((item): item is string => typeof item === 'string') : [],
    accounts: objectArray(value.accounts).map(account), positions: objectArray(value.positions).map(position), cash: objectArray(value.cash).map(cash),
    totalByCurrency: Object.fromEntries(Object.entries(totals).map(([currency, amount]) => [currency, nullableNumber(amount)])),
    history: history(value.history),
    cashFlows: uniqueCashFlows(value.cashFlows),
    householdCashFlows: householdFlows,
    investmentCashFlows: uniqueCashFlows(value.investmentCashFlows),
    cashFlowTotals: cashFlowTotals(value.cashFlowTotals),
    investmentCashFlowTotals: cashFlowTotals(value.investmentCashFlowTotals),
    events: events(value.events),
    valuations: valuations(value.valuations),
    modifiedDietz: modifiedDietz(value.modifiedDietz),
    modifiedDietzByCurrency: modifiedDietzByCurrency(value.modifiedDietzByCurrency),
    allocations: allocations(value.allocations),
    fx: fx(value.fx),
    quote: quote(value.quote),
    csv: csv(value.csv),
    selectedAccount: value.selectedAccount ? account(value.selectedAccount) : null,
    selectedInstrument: value.selectedInstrument ? asObject(value.selectedInstrument) as WealthWireSnapshot['selectedInstrument'] : null,
  };
}

export function decodeWealthEvents(raw: string): WealthWireSnapshot['events'] {
  const value = asObject(JSON.parse(raw));
  return objectArray(value.events).map(row => ({
    id: asString(row.id, 'event id'), sourceId: asString(row.sourceId ?? row.id, 'event source id'),
    date: asString(row.date, 'event date'), kind: typeof row.kind === 'string' ? row.kind : 'event',
    label: nullableString(row.memo ?? row.label), accountId: eventAccountId(row), linkedBankSourceId: eventBankLink(row), instrumentKey: eventInstrumentKey(row),
  }));
}

export function decodeWealthQuoteSettings(raw: string): WealthWireSnapshot['quote'] {
  const value = asObject(JSON.parse(raw));
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const provider = providers.map(item => typeof item === 'string' ? item : nullableString(objectOrNull(item)?.provider)).find((item): item is string => Boolean(item)) ?? null;
  return { configured: provider !== null, provider, lastRefreshedAt: null };
}

export function decodeWealthValuations(raw: string): NonNullable<WealthWireSnapshot['valuations']> {
  const value = asObject(JSON.parse(raw));
  return objectArray(value.valuations).map(row => ({
    id: asString(row.id, 'valuation id'), accountId: asString(row.accountId, 'valuation account'),
    instrument: row.instrument === null || row.instrument === undefined ? null : instrument(row.instrument),
    asOf: asString(row.asOf, 'valuation date'), priceMinor: nullableNumber(row.priceMinor),
    source: row.source === 'provider' ? 'provider' : 'manual', provider: nullableString(row.provider),
  }));
}

export function decodeWealthCsvPreview(raw: string): WealthWireSnapshot['csv'] {
  const value = asObject(JSON.parse(raw));
  const errors = objectArray(value.errors).map(row => nullableString(row.error) ?? 'Invalid CSV row.');
  const duplicates = objectArray(value.duplicates).map(row => ({ id: asString(row.rowId, 'duplicate row id'), sourceId: nullableString(row.duplicateOf), status: 'duplicate', reason: 'Already present in the file or server ledger.' }));
  const rows = objectArray(value.rows).map(row => {
    const payload = previewPayload(row);
    return {
      rowId: asString(row.rowId, 'preview row id'), rowIndex: nullableNumber(row.rowIndex) ?? 0,
      recordType: nullableString(row.recordType), record: objectOrNull(row.record), event: objectOrNull(row.event),
      date: nullableString(payload?.date ?? payload?.asOf ?? payload?.effectiveDate), kind: nullableString(payload?.kind), accountId: nullableString(payload?.accountId ?? payload?.fromAccountId), details: previewDetails(payload),
      error: nullableString(row.error), duplicateOf: nullableString(row.duplicateOf),
    };
  });
  return {
    template: null, previewId: nullableString(value.previewId), revision: nullableNumber(value.revision),
    sourceHeaders: stringArray(value.sourceHeaders ?? value.headers),
    canonicalHeaders: stringArray(value.canonicalHeaders),
    mapping: csvMapping(value.mapping),
    validRowIds: rows.filter(row => !row.error && !row.duplicateOf).map(row => row.rowId), rowCount: rows.length,
    previewRows: rows, errors, duplicates,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function csvMapping(value: unknown): WealthCsvMapping | undefined {
  const source = objectOrNull(value);
  if (!source) return undefined;
  const entries = Object.entries(source).filter(([, header]) => header === null || typeof header === 'string') as [string, string | null][];
  return entries.length ? Object.fromEntries(entries) : undefined;
}
