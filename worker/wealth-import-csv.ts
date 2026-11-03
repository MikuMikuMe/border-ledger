import type { CanonicalInstrument, WealthEvent } from '../src/domain/wealth-types';
import { CANONICAL_CSV_HEADERS } from './wealth-import-types';
import type {
  CsvEventBuilder,
  CsvEventContext,
  CsvMappingMetadata,
  CsvParserTools,
  CsvScanState,
  ImportAccount,
  ImportInstrument,
  ImportModeTransition,
  ImportValuation,
  WealthImportRecord,
} from './wealth-import-types';
import { transitionRecordId } from './wealth-import-transitions';

function finishCsvRow(state: CsvScanState): void {
  state.row.push(state.value);
  state.value = '';
  if (state.row.some((field) => field.length > 0)) state.rows.push(state.row);
  state.row = [];
}

function appendQuotedCharacter(source: string, index: number, state: CsvScanState): number | null {
  if (state.quoted && source[index + 1] === '"') {
    state.value += '"';
    return index + 1;
  }
  state.quoted = !state.quoted;
  return null;
}

function appendDelimiter(state: CsvScanState): void {
  state.row.push(state.value);
  state.value = '';
}

function appendLineBreak(source: string, index: number, state: CsvScanState): number {
  finishCsvRow(state);
  return source[index] === '\r' && source[index + 1] === '\n' ? index + 1 : index;
}

function isCsvDelimiter(character: string, state: CsvScanState): boolean {
  return character === ',' && !state.quoted;
}

function isCsvLineBreak(character: string, state: CsvScanState): boolean {
  return (character === '\n' || character === '\r') && !state.quoted;
}

function consumeCsvCharacter(source: string, index: number, state: CsvScanState): number {
  const character = source[index];
  if (character === '"') return appendQuotedCharacter(source, index, state) ?? index;
  if (isCsvDelimiter(character, state)) {
    appendDelimiter(state);
    return index;
  }
  if (isCsvLineBreak(character, state)) return appendLineBreak(source, index, state);
  state.value += character;
  return index;
}

function scanCsvRows(source: string, tools: CsvParserTools): string[][] {
  const state: CsvScanState = { rows: [], row: [], value: '', quoted: false };
  for (let index = 0; index < source.length; index += 1) index = consumeCsvCharacter(source, index, state);
  if (state.quoted) throw tools.invalidCsv('The CSV contains an unterminated quoted field.');
  if (state.value.length > 0 || state.row.length > 0) finishCsvRow(state);
  return state.rows;
}

function normalizedHeaders(rows: readonly (readonly string[])[], tools: CsvParserTools, allowCustomHeaders: boolean): string[] {
  if (rows.length === 0) throw tools.invalidCsv('The CSV is empty.');
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (!allowCustomHeaders && !hasRecordHeader(headers) && !hasEventHeaders(headers)) throw tools.invalidCsv('The CSV must include a record_type column or date and kind columns.');
  return headers;
}

export function csvRows(text: string, tools: CsvParserTools, options: { readonly allowCustomHeaders?: boolean } = {}): string[][] {
  const rows = scanCsvRows(text.replace(/^\uFEFF/, ''), tools);
  const headers = normalizedHeaders(rows, tools, options.allowCustomHeaders === true);
  return [headers, ...rows.slice(1)];
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalField(value: string, tools: CsvParserTools): string {
  const normalized = normalizedHeader(value);
  if (!CANONICAL_CSV_HEADERS.includes(normalized as typeof CANONICAL_CSV_HEADERS[number])) throw tools.invalidCsv(`Mapping references unsupported canonical field ${value}.`);
  return normalized;
}

function mappingObject(rawMapping: unknown, tools: CsvParserTools): Record<string, unknown> {
  if (rawMapping === undefined || rawMapping === null) return {};
  if (typeof rawMapping !== 'object' || Array.isArray(rawMapping)) throw tools.invalidCsv('CSV mapping must be an object of canonical fields to source headers.');
  return rawMapping as Record<string, unknown>;
}

function mappingSource(rawCanonical: string, rawSource: unknown, sourceHeaders: ReadonlySet<string>, tools: CsvParserTools): [string, string] {
  const canonical = canonicalField(rawCanonical, tools);
  if (typeof rawSource !== 'string' || normalizedHeader(rawSource) === '') throw tools.invalidCsv(`CSV mapping for ${canonical} must name a source header.`);
  const source = normalizedHeader(rawSource);
  if (!sourceHeaders.has(source)) throw tools.invalidCsv(`CSV mapping source header ${rawSource} was not found.`);
  return [canonical, source];
}

function explicitMapping(rawMapping: unknown, sourceHeaders: readonly string[], tools: CsvParserTools): Map<string, string> {
  const mapping = new Map<string, string>();
  const usedSources = new Set<string>();
  const availableSources = new Set(sourceHeaders);
  for (const [rawCanonical, rawSource] of Object.entries(mappingObject(rawMapping, tools))) {
    const [canonical, source] = mappingSource(rawCanonical, rawSource, availableSources, tools);
    if (mapping.has(canonical)) throw tools.invalidCsv(`CSV mapping repeats canonical field ${canonical}.`);
    if (usedSources.has(source)) throw tools.invalidCsv(`CSV mapping assigns source header ${source} more than once.`);
    mapping.set(canonical, source);
    usedSources.add(source);
  }
  return mapping;
}

function resolvedMapping(sourceHeaders: readonly string[], rawMapping: unknown, tools: CsvParserTools): Record<string, string> {
  const explicit = explicitMapping(rawMapping, sourceHeaders, tools);
  const sourceSet = new Set(sourceHeaders);
  const explicitSources = new Set(explicit.values());
  const resolved: Record<string, string> = {};
  const used = new Map<string, string>();
  for (const canonical of CANONICAL_CSV_HEADERS) {
    const source = explicit.get(canonical) ?? (sourceSet.has(canonical) && !explicitSources.has(canonical) ? canonical : undefined);
    if (!source) continue;
    const prior = used.get(source);
    if (prior && prior !== canonical) throw tools.invalidCsv(`CSV mapping assigns source header ${source} more than once.`);
    used.set(source, canonical);
    resolved[canonical] = source;
  }
  return resolved;
}

export function applyCsvMapping(parsed: readonly (readonly string[])[], rawMapping: unknown, tools: CsvParserTools, options: { readonly allowUnmapped?: boolean } = {}): { readonly parsed: string[][]; readonly metadata: CsvMappingMetadata } {
  const sourceHeaders = [...parsed[0]];
  if (new Set(sourceHeaders).size !== sourceHeaders.length) throw tools.invalidCsv('CSV source headers must be unique.');
  const mapping = resolvedMapping(sourceHeaders, rawMapping, tools);
  const canonicalHeaders = CANONICAL_CSV_HEADERS.filter((canonical) => mapping[canonical]);
  if (!options.allowUnmapped && !canonicalHeaders.includes('record_type') && !(canonicalHeaders.includes('date') && canonicalHeaders.includes('kind'))) throw tools.invalidCsv('CSV mapping must provide record_type or both date and kind fields.');
  const sourceIndexes = canonicalHeaders.map((canonical) => sourceHeaders.indexOf(mapping[canonical]));
  const rows = parsed.slice(1).map((row) => sourceIndexes.map((index) => row[index] ?? ''));
  return {
    parsed: [canonicalHeaders, ...rows],
    metadata: { sourceHeaders, canonicalHeaders: [...CANONICAL_CSV_HEADERS], mapping },
  };
}

function hasRecordHeader(headers: readonly string[]): boolean {
  return headers.includes('record_type');
}

function hasEventHeaders(headers: readonly string[]): boolean {
  return headers.includes('date') && headers.includes('kind');
}

export function csvRecord(headers: readonly string[], values: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => { record[header] = values[index] ?? ''; });
  return record;
}

function csvInteger(value: string, label: string, tools: CsvParserTools, allowEmpty = false): number | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (allowEmpty && normalized === '') return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw tools.invalidCsv(`${label} must be a safe integer.`);
  return parsed;
}

function firstCsvValue(record: Record<string, string>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function requiredCsvInteger(record: Record<string, string>, fields: readonly string[], label: string, tools: CsvParserTools): number {
  const value = firstCsvValue(record, fields);
  if (value === null) throw tools.invalidCsv(`${label} is required.`);
  return csvInteger(value, label, tools)!;
}

function optionalCsvInteger(value: string | undefined, label: string, tools: CsvParserTools): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return csvInteger(value, label, tools);
}

function csvCurrency(value: string, label: string, tools: CsvParserTools, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value === '') {
    if (allowEmpty) return null;
    throw tools.invalidCsv(`${label} is required.`);
  }
  return tools.currency(value.toUpperCase(), label, allowEmpty);
}

const TRUE_CSV_VALUES = new Set(['', '1', 'true']);
const FALSE_CSV_VALUES = new Set(['0', 'false']);

function csvBoolean(value: string, label: string, tools: CsvParserTools): boolean {
  const normalized = value.toLowerCase();
  if (TRUE_CSV_VALUES.has(normalized)) return true;
  if (FALSE_CSV_VALUES.has(normalized)) return false;
  throw tools.invalidCsv(`${label} must be 0, 1, true, or false.`);
}

function accountKind(record: Record<string, string>, tools: CsvParserTools): ImportAccount['kind'] {
  const kind = record.account_kind || record.kind;
  if (!['linked_bank', 'manual_asset', 'debt', 'brokerage'].includes(kind)) throw tools.invalidCsv('The account kind is not supported.');
  return kind as ImportAccount['kind'];
}

function accountMode(record: Record<string, string>, tools: CsvParserTools): ImportAccount['mode'] {
  const mode = record.account_mode || record.mode;
  if (mode !== 'aggregate' && mode !== 'holdings') throw tools.invalidCsv('The account mode is not supported.');
  return mode;
}

function validateAccountLink(kind: ImportAccount['kind'], mode: ImportAccount['mode'], linkedBankAccountId: string | null, tools: CsvParserTools): void {
  const linkedBank = kind === 'linked_bank';
  if (linkedBank && (!linkedBankAccountId || mode !== 'aggregate')) throw tools.invalidCsv('Linked bank accounts must be aggregate accounts with a bank link.');
  if (!linkedBank && linkedBankAccountId) throw tools.invalidCsv('Only linked bank accounts may reference a bank account.');
}

export function importAccountFromCsv(record: Record<string, string>, tools: CsvParserTools): ImportAccount {
  const id = tools.bounded(record.id, 'account id', 128);
  const name = tools.bounded(record.name, 'account name', 160);
  const kind = accountKind(record, tools);
  const mode = accountMode(record, tools);
  const linkedBankAccountId = record.linked_bank_account_id || null;
  validateAccountLink(kind, mode, linkedBankAccountId, tools);
  return {
    id,
    name,
    kind,
    mode,
    currency: csvCurrency(record.currency, 'account currency', tools, true),
    linkedBankAccountId,
    amountMinor: csvInteger(record.amount_minor, 'amount_minor', tools, true),
    active: csvBoolean(record.active, 'active', tools),
  };
}

export function importInstrumentFromCsv(record: Record<string, string>, tools: CsvParserTools): ImportInstrument {
  const id = tools.bounded(record.id, 'instrument id', 128);
  const exchange = tools.bounded(record.exchange, 'instrument exchange', 32).toUpperCase();
  const ticker = tools.bounded(record.ticker, 'instrument ticker', 32).toUpperCase();
  if (record.type !== 'stock' && record.type !== 'etf') throw tools.invalidCsv('The instrument type is not supported.');
  return { id, exchange, ticker, type: record.type, currency: csvCurrency(record.currency, 'instrument currency', tools)! };
}

function valuationInstrument(record: Record<string, string>, tools: CsvParserTools): CanonicalInstrument | null {
  if (!record.exchange) return null;
  const instrument = {
    exchange: record.exchange.toUpperCase(),
    ticker: record.ticker.toUpperCase(),
    type: record.type as 'stock' | 'etf',
    currency: csvCurrency(record.currency, 'valuation instrument currency', tools)!,
  };
  if (instrument.type !== 'stock' && instrument.type !== 'etf') throw tools.invalidCsv('The valuation instrument type is not supported.');
  return instrument;
}

export function importValuationFromCsv(record: Record<string, string>, tools: CsvParserTools): ImportValuation {
  const id = tools.bounded(record.id, 'valuation id', 160);
  const accountId = tools.bounded(record.account_id, 'valuation account id', 128);
  return { id, accountId, instrument: valuationInstrument(record, tools), asOf: valuationDate(record, tools), priceMinor: valuationPrice(record, tools), source: valuationSource(record, tools), provider: record.provider || null };
}

function transitionMode(value: unknown, label: string, tools: CsvParserTools): 'aggregate' | 'holdings' {
  if (value !== 'aggregate' && value !== 'holdings') throw tools.invalidCsv(`The ${label} is not supported.`);
  return value;
}

function isEmptyTransitionInteger(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function transitionInteger(value: unknown, label: string, tools: CsvParserTools): number | null {
  if (isEmptyTransitionInteger(value)) return null;
  if (!Number.isSafeInteger(value)) throw tools.invalidCsv(`${label} must be a non-negative safe integer.`);
  if ((value as number) < 0) throw tools.invalidCsv(`${label} must be a non-negative safe integer.`);
  return value as number;
}

function transitionCsvInteger(recordValue: string, payloadValue: unknown, label: string, tools: CsvParserTools): number | null {
  return typeof recordValue !== 'string' || recordValue.trim() === '' ? transitionInteger(payloadValue, label, tools) : optionalCsvInteger(recordValue, label, tools);
}

function isTransitionObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function transitionObject(value: unknown, tools: CsvParserTools): Record<string, unknown> {
  if (!isTransitionObject(value)) throw tools.invalidCsv('The transition JSON is not an object.');
  return value as Record<string, unknown>;
}

function transitionInstrument(value: unknown, tools: CsvParserTools): CanonicalInstrument {
  const body = transitionObject(value, tools);
  const exchange = tools.bounded(body.exchange, 'opening position exchange', 32).toUpperCase();
  const ticker = tools.bounded(body.ticker, 'opening position ticker', 32).toUpperCase();
  const type = body.type;
  if (type !== 'stock' && type !== 'etf') throw tools.invalidCsv('The opening position instrument type is not supported.');
  const code = tools.currency(body.currency, 'opening position instrument currency');
  return { exchange, ticker, type, currency: code! };
}

function transitionPositions(record: Record<string, string>, payload: Record<string, unknown>, accountId: string, effectiveDate: string, tools: CsvParserTools): ImportModeTransition['openingPositions'] {
  let raw: unknown = payload.openingPositions;
  if (raw === undefined && record.opening_positions_json) {
    try { raw = JSON.parse(record.opening_positions_json); } catch { throw tools.invalidCsv('The opening positions JSON is not valid.'); }
  }
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw) || raw.length > 1000) throw tools.invalidCsv('Opening positions are not valid.');
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  return raw.map((value, index) => {
    const body = transitionObject(value, tools);
    const instrument = transitionInstrument(body.instrument, tools);
    const id = tools.bounded(body.id ?? `opening-position:${accountId}:${effectiveDate}:${index}`, 'opening position id', 160);
    const sourceId = tools.bounded(body.sourceId ?? id, 'opening position sourceId', 256);
    if (ids.has(id) || sourceIds.has(sourceId)) throw tools.invalidCsv('Opening position identities must be unique.');
    ids.add(id); sourceIds.add(sourceId);
    const quantity = tools.bounded(body.quantity, 'opening position quantity', 128);
    const basisValue = body.basis;
    const basis = basisValue === undefined || basisValue === null ? null : (() => {
      const basisObject = transitionObject(basisValue, tools);
      const amountMinor = transitionInteger(basisObject.amountMinor, 'opening position basis', tools);
      if (amountMinor === null) throw tools.invalidCsv('Opening position basis amount is required.');
      const currencyCode = tools.currency(basisObject.currency, 'opening position basis currency');
      if (currencyCode !== instrument.currency) throw tools.invalidCsv('Opening position basis currency must match its instrument currency.');
      return { currency: currencyCode!, amountMinor };
    })();
    const priceMinor = transitionInteger(body.priceMinor, 'opening position priceMinor', tools);
    return { id, sourceId, instrument, quantity, basis, priceMinor };
  });
}

function transitionText(recordValue: string | undefined, payloadValue: unknown): string {
  return typeof recordValue === 'string' && recordValue !== '' ? recordValue : String(payloadValue ?? '');
}

interface TransitionPayloadFieldCheck {
  readonly payload: Record<string, unknown>;
  readonly field: string;
  readonly value: string;
  readonly label: string;
  readonly tools: CsvParserTools;
}

function assertTransitionPayloadField(check: TransitionPayloadFieldCheck): void {
  if (check.payload[check.field] !== undefined && check.payload[check.field] !== check.value) throw check.tools.invalidCsv(`${check.label} must match transition_json.`);
}

function transitionJson(record: Record<string, string>, tools: CsvParserTools): Record<string, unknown> {
  if (!record.transition_json) return {};
  try { return transitionObject(JSON.parse(record.transition_json), tools); } catch (error) {
    if (error instanceof Error && error.message.includes('transition JSON')) throw error;
    throw tools.invalidCsv('The transition JSON is not valid.');
  }
}

function transitionIdentity(record: Record<string, string>, payload: Record<string, unknown>, tools: CsvParserTools): { readonly accountId: string; readonly effectiveDate: string; readonly fromMode: 'aggregate' | 'holdings'; readonly toMode: 'aggregate' | 'holdings' } {
  const accountId = tools.bounded(transitionText(record.account_id, payload.accountId), 'transition account id', 128);
  const effectiveDate = tools.date(transitionText(record.effective_date || record.date, payload.effectiveDate), 'transition effective date');
  const fromMode = transitionMode(transitionText(record.from_mode, payload.fromMode), 'transition from mode', tools);
  const toMode = transitionMode(transitionText(record.to_mode, payload.toMode), 'transition to mode', tools);
  if (fromMode === toMode) throw tools.invalidCsv('A mode transition must change the account representation.');
  assertTransitionPayloadField({ payload, field: 'fromMode', value: fromMode, label: 'Transition source mode', tools });
  assertTransitionPayloadField({ payload, field: 'toMode', value: toMode, label: 'Transition target mode', tools });
  assertTransitionPayloadField({ payload, field: 'effectiveDate', value: effectiveDate, label: 'Transition effective date', tools });
  return { accountId, effectiveDate, fromMode, toMode };
}

function transitionOpeningValues(record: Record<string, string>, payload: Record<string, unknown>, identity: Pick<ReturnType<typeof transitionIdentity>, 'accountId' | 'effectiveDate'>, tools: CsvParserTools): { readonly openingCashMinor: number | null; readonly openingValueMinor: number | null; readonly openingPositions: ImportModeTransition['openingPositions'] } {
  return {
    openingCashMinor: transitionCsvInteger(record.opening_cash_minor, payload.openingCashMinor, 'openingCashMinor', tools),
    openingValueMinor: transitionCsvInteger(record.opening_value_minor, payload.openingValueMinor, 'openingValueMinor', tools),
    openingPositions: transitionPositions(record, payload, identity.accountId, identity.effectiveDate, tools),
  };
}

function validateTransitionOpeningValues(toMode: 'aggregate' | 'holdings', openingCashMinor: number | null, openingValueMinor: number | null, openingPositions: ImportModeTransition['openingPositions'], tools: CsvParserTools): void {
  if (toMode === 'holdings' && openingValueMinor !== null) throw tools.invalidCsv('Holdings transitions cannot include an aggregate opening value.');
  if (toMode === 'holdings' && openingCashMinor === null && openingPositions.length === 0) throw tools.invalidCsv('Holdings transitions require opening cash or opening positions.');
  if (toMode === 'aggregate' && (openingCashMinor !== null || openingPositions.length > 0)) throw tools.invalidCsv('Aggregate transitions cannot include holdings opening data.');
  if (toMode === 'aggregate' && openingValueMinor === null) throw tools.invalidCsv('Aggregate transitions require an opening value.');
}

export function importModeTransitionFromCsv(record: Record<string, string>, tools: CsvParserTools): ImportModeTransition {
  const payload = transitionJson(record, tools);
  const identity = transitionIdentity(record, payload, tools);
  const opening = transitionOpeningValues(record, payload, identity, tools);
  validateTransitionOpeningValues(identity.toMode, opening.openingCashMinor, opening.openingValueMinor, opening.openingPositions, tools);
  const accountCurrency = csvCurrency(record.currency, 'transition account currency', tools, true);
  if (opening.openingCashMinor !== null && accountCurrency === null) throw tools.invalidCsv('An account currency is required for opening cash.');
  const id = tools.bounded(record.id || transitionRecordId(identity.accountId, identity.effectiveDate), 'transition id', 160);
  return { id, ...identity, ...opening, accountCurrency };
}

function valuationDate(record: Record<string, string>, tools: CsvParserTools): string {
  return tools.date(record.as_of || record.date, 'valuation date');
}

function valuationPrice(record: Record<string, string>, tools: CsvParserTools): number {
  const priceMinor = requiredCsvInteger(record, ['price_minor', 'value_minor'], 'price_minor', tools);
  if (priceMinor < 0) throw tools.invalidCsv('The valuation price cannot be negative.');
  return priceMinor;
}

function valuationSource(record: Record<string, string>, tools: CsvParserTools): 'manual' | 'provider' {
  const source = record.source || 'manual';
  if (source !== 'manual' && source !== 'provider') throw tools.invalidCsv('The valuation source is not supported.');
  return source;
}

function eventSequence(record: Record<string, string>, tools: CsvParserTools): number | undefined {
  return optionalCsvInteger(record.sequence, 'sequence', tools) ?? undefined;
}

function eventBase(record: Record<string, string>, rowIndex: number, tools: CsvParserTools): Record<string, unknown> {
  const id = record.id || record.source_id || `csv-${rowIndex}`;
  const sourceId = record.source_id || id;
  const sequence = eventSequence(record, tools);
  return {
    id,
    sourceId,
    date: tools.date(record.date, 'event date'),
    accountId: record.account_id,
    memo: record.memo || null,
    linkedBankSourceId: record.linked_bank_source_id || null,
    ...(sequence === null || sequence === undefined ? {} : { sequence }),
  };
}

const EVENT_MONEY_KINDS: ReadonlySet<WealthEvent['kind']> = new Set([
  'opening_cash', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal',
]);

function eventAmount(record: Record<string, string>, kind: WealthEvent['kind'], tools: CsvParserTools): number {
  if (kind === 'buy') return requiredCsvInteger(record, ['consideration_minor', 'amount_minor'], 'consideration_minor', tools);
  if (kind === 'sell') return requiredCsvInteger(record, ['proceeds_minor', 'amount_minor'], 'proceeds_minor', tools);
  if (kind === 'transfer') return record.transfer_kind === 'position' ? 0 : requiredCsvInteger(record, ['amount_minor', 'value_minor'], 'amount_minor', tools);
  if (EVENT_MONEY_KINDS.has(kind)) return requiredCsvInteger(record, ['amount_minor', 'value_minor'], 'amount_minor', tools);
  return 0;
}

function eventContext(record: Record<string, string>, rowIndex: number, tools: CsvParserTools): CsvEventContext {
  const code = (record.currency || 'CAD').toUpperCase();
  const kind = record.kind as WealthEvent['kind'];
  const money = { currency: code, amountMinor: eventAmount(record, kind, tools) };
  const instrument = record.exchange ? { exchange: record.exchange, ticker: record.ticker, type: record.type as 'stock' | 'etf', currency: code } : undefined;
  return { record, kind, code, money, instrument, base: eventBase(record, rowIndex, tools), tools };
}

function positionBuilder(context: CsvEventContext): WealthEvent {
  const { base, record, code, instrument } = context;
  const basisMinor = optionalCsvInteger(record.basis_minor, 'basis_minor', context.tools);
  return { ...base, kind: 'opening_position', instrument: instrument!, quantity: record.quantity, basis: basisMinor === null ? null : { currency: code, amountMinor: basisMinor } } as WealthEvent;
}

function tradeBuilder(kind: 'buy' | 'sell', context: CsvEventContext): WealthEvent {
  const { base, record, code, instrument } = context;
  const feeMinor = optionalCsvInteger(record.fee_minor, 'fee_minor', context.tools);
  const fee = feeMinor === null ? null : { currency: code, amountMinor: feeMinor };
  if (kind === 'buy') return { ...base, kind, instrument: instrument!, quantity: record.quantity, consideration: { currency: code, amountMinor: context.money.amountMinor }, fee } as WealthEvent;
  return { ...base, kind, instrument: instrument!, quantity: record.quantity, proceeds: { currency: code, amountMinor: context.money.amountMinor }, fee } as WealthEvent;
}

function splitBuilder(context: CsvEventContext): WealthEvent {
  return { ...context.base, kind: 'split', instrument: context.instrument!, numerator: requiredCsvInteger(context.record as Record<string, string>, ['numerator'], 'numerator', context.tools), denominator: requiredCsvInteger(context.record as Record<string, string>, ['denominator'], 'denominator', context.tools) } as WealthEvent;
}

function moneyEventBuilder(kind: 'dividend' | 'withholding' | 'fee' | 'opening_cash' | 'contribution' | 'withdrawal', context: CsvEventContext): WealthEvent {
  return { ...context.base, kind, ...(kind === 'opening_cash' || kind === 'contribution' || kind === 'withdrawal' ? {} : { instrument: context.instrument ?? null }), money: context.money } as WealthEvent;
}

function transferBuilder(context: CsvEventContext): WealthEvent {
  const { base, record, instrument, money } = context;
  if (record.transfer_kind === 'position') return { ...base, kind: 'transfer', transferKind: 'position', fromAccountId: record.from_account_id, toAccountId: record.to_account_id, instrument: instrument!, quantity: record.quantity, transferId: record.transfer_id || null } as WealthEvent;
  return { ...base, kind: 'transfer', transferKind: 'cash', fromAccountId: record.from_account_id, toAccountId: record.to_account_id, money, transferId: record.transfer_id || null } as WealthEvent;
}

const CSV_EVENT_BUILDERS: Partial<Record<WealthEvent['kind'], CsvEventBuilder>> = {
  opening_position: positionBuilder,
  buy: (context) => tradeBuilder('buy', context),
  sell: (context) => tradeBuilder('sell', context),
  split: splitBuilder,
  dividend: (context) => moneyEventBuilder('dividend', context),
  withholding: (context) => moneyEventBuilder('withholding', context),
  fee: (context) => moneyEventBuilder('fee', context),
  opening_cash: (context) => moneyEventBuilder('opening_cash', context),
  contribution: (context) => moneyEventBuilder('contribution', context),
  withdrawal: (context) => moneyEventBuilder('withdrawal', context),
  reversal: (context) => ({ ...context.base, kind: 'reversal', targetSourceId: context.record.target_source_id } as WealthEvent),
  transfer: transferBuilder,
};

function eventFromCsv(headers: readonly string[], values: readonly string[], rowIndex: number, tools: CsvParserTools): WealthEvent {
  const record = csvRecord(headers, values);
  if (record.event_json) return tools.normalizeEvent(JSON.parse(record.event_json));
  const context = eventContext(record, rowIndex, tools);
  const builder = CSV_EVENT_BUILDERS[context.kind];
  if (!builder) throw tools.invalidCsv(`The CSV row ${rowIndex} has an unsupported event kind.`);
  return builder(context);
}

export function importRecordFromCsv(headers: readonly string[], values: readonly string[], rowIndex: number, tools: CsvParserTools): WealthImportRecord {
  const record = csvRecord(headers, values);
  const recordType = (record.record_type || 'event').toLowerCase();
  if (recordType === 'account') return { recordType, account: importAccountFromCsv(record, tools) };
  if (recordType === 'instrument') return { recordType, instrument: importInstrumentFromCsv(record, tools) };
  if (recordType === 'mode_transition') return { recordType, transition: importModeTransitionFromCsv(record, tools) };
  if (recordType === 'valuation') return { recordType, valuation: importValuationFromCsv(record, tools) };
  if (recordType === 'event') return { recordType, event: eventFromCsv(headers, values, rowIndex, tools) };
  throw tools.invalidCsv(`The CSV row ${rowIndex} has an unsupported record type.`);
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
