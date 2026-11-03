import type { D1Database } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';

export const WEALTH_QUOTE_PROVIDER = 'alpha_vantage' as const;
export const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query';
export const WEALTH_QUOTE_MAX_REQUESTS = 25;
export const WEALTH_QUOTE_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_PROVIDER_BODY_BYTES = 256 * 1024;
const MAX_PROVIDER_CSV_BYTES = 2 * 1024 * 1024;
const MAX_LISTING_ROWS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CREDENTIAL_LENGTH = 4096;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const encoder = new TextEncoder();

export type WealthQuoteProvider = typeof WEALTH_QUOTE_PROVIDER;
export type WealthQuoteInstrument = {
  readonly exchange: string;
  readonly ticker: string;
  readonly type: 'stock' | 'etf';
  readonly currency: string;
};

export interface SealedWealthCredential {
  readonly ciphertext: string;
  readonly iv: string;
}

export interface WealthCredentialBinding {
  readonly ledgerId: string;
  readonly provider: WealthQuoteProvider;
  readonly userId?: string;
}

export interface WealthQuoteCredentialInput {
  readonly provider?: WealthQuoteProvider;
  readonly credential: string;
}

export interface WealthQuoteCredentialOptions {
  readonly secret: string;
}

export interface WealthQuoteCredentialMetadata {
  readonly provider: WealthQuoteProvider;
  readonly revision: string;
}

export interface AlphaVantageSearchMatch {
  readonly providerSymbol: string;
  readonly name: string;
  readonly type: string;
  readonly region: string;
  readonly currency: string;
  readonly exchange?: string;
  readonly matchScore?: string;
}

export interface AlphaVantageQuote {
  readonly symbol: string;
  readonly priceMinor: number;
  readonly quoteDate: string;
  readonly currency?: string;
}

export interface AlphaVantageListing {
  readonly providerSymbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly type: 'Equity' | 'ETF';
  readonly region: 'United States';
  readonly currency: 'USD';
}

export interface WealthQuoteObservation {
  readonly ledgerId: string;
  readonly instrumentKey: string;
  readonly instrument: WealthQuoteInstrument;
  readonly provider: WealthQuoteProvider;
  readonly providerSymbol: string;
  readonly quoteDate: string;
  readonly priceMinor: number;
  readonly observedAt: string;
  readonly revision: string;
}

export type WealthQuoteStatus =
  | 'refreshed'
  | 'cached'
  | 'manual'
  | 'unsupported'
  | 'quota_exhausted'
  | 'provider_error'
  | 'stale'
  | 'skipped';

export interface WealthQuoteResult {
  readonly status: WealthQuoteStatus;
  readonly quote: WealthQuoteObservation | null;
  readonly reason?: string;
}

export interface WealthQuoteRuntimeOptions {
  readonly secret: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

export interface WealthQuoteRefreshRequest {
  readonly instrument: WealthQuoteInstrument;
  /** A symbol returned by a confirmed SYMBOL_SEARCH match. */
  readonly providerSymbol?: string;
}

export interface WealthQuoteBatchOptions extends WealthQuoteRuntimeOptions {
  readonly maxCandidates?: number;
}

export interface WealthQuoteLookupOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  /** Internal high-level callers reserve each provider request atomically. */
  readonly reserveRequest?: () => Promise<boolean>;
}

interface WealthQuoteFetchOptions {
  readonly credential: string;
  readonly providerSymbol: string;
  readonly fetcher?: typeof fetch;
  readonly asOf?: string;
  readonly now?: () => Date;
}

export interface WealthQuoteSearchOptions extends WealthQuoteLookupOptions {
  readonly secret: string;
}

export type WealthQuoteLookupResult =
  | { readonly status: 'matched'; readonly providerSymbol: string; readonly match: AlphaVantageSearchMatch }
  | { readonly status: 'unsupported' | 'not_found' | 'ambiguous' | 'provider_error' | 'quota_exhausted'; readonly reason: string; readonly matches?: readonly AlphaVantageSearchMatch[] };

interface ExchangeRule {
  readonly canonical: string;
  readonly currency: 'CAD' | 'USD';
  readonly region: 'Canada' | 'United States';
  readonly suffix: string | null;
}

const EXCHANGE_RULES: Readonly<Record<string, ExchangeRule>> = {
  TSX: { canonical: 'TSX', currency: 'CAD', region: 'Canada', suffix: '.TRT' },
  TSE: { canonical: 'TSX', currency: 'CAD', region: 'Canada', suffix: '.TRT' },
  TSXV: { canonical: 'TSXV', currency: 'CAD', region: 'Canada', suffix: '.VAN' },
  VENTURE: { canonical: 'TSXV', currency: 'CAD', region: 'Canada', suffix: '.VAN' },
  NEO: { canonical: 'NEO', currency: 'CAD', region: 'Canada', suffix: '.NEO' },
  CSE: { canonical: 'CSE', currency: 'CAD', region: 'Canada', suffix: '.CN' },
  NYSE: { canonical: 'NYSE', currency: 'USD', region: 'United States', suffix: null },
  NASDAQ: { canonical: 'NASDAQ', currency: 'USD', region: 'United States', suffix: null },
  AMEX: { canonical: 'AMEX', currency: 'USD', region: 'United States', suffix: null },
  ARCA: { canonical: 'ARCA', currency: 'USD', region: 'United States', suffix: null },
  NYSEARCA: { canonical: 'ARCA', currency: 'USD', region: 'United States', suffix: null },
  BATS: { canonical: 'BATS', currency: 'USD', region: 'United States', suffix: null },
  'NYSE ARCA': { canonical: 'ARCA', currency: 'USD', region: 'United States', suffix: null },
  'NYSE AMERICAN': { canonical: 'AMEX', currency: 'USD', region: 'United States', suffix: null },
  NYSEAMERICAN: { canonical: 'AMEX', currency: 'USD', region: 'United States', suffix: null },
  'NYSE MKT': { canonical: 'AMEX', currency: 'USD', region: 'United States', suffix: null },
  NYSEMKT: { canonical: 'AMEX', currency: 'USD', region: 'United States', suffix: null },
};

const EXCHANGE_SUFFIXES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(EXCHANGE_RULES).filter((rule): rule is ExchangeRule & { suffix: string } => rule.suffix !== null).map((rule) => [rule.suffix, rule.canonical]),
);

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid credential encoding');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function associatedData(binding: WealthCredentialBinding): Uint8Array {
  return encoder.encode(JSON.stringify(['wealth-quote-credential-v1', binding.ledgerId, binding.provider, binding.userId ?? '']));
}

async function encryptionKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error('Wealth credential encryption is not configured');
  const bytes = Uint8Array.from(secret.match(/../g)!, (part) => parseInt(part, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [usage]);
}

function validateCredential(credential: unknown): asserts credential is string {
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > MAX_CREDENTIAL_LENGTH || credential.trim() !== credential) {
    throw new RangeError('Invalid wealth provider credential');
  }
}

function validateBinding(binding: WealthCredentialBinding): void {
  if (!binding.ledgerId || binding.provider !== WEALTH_QUOTE_PROVIDER) throw new RangeError('Invalid wealth credential binding');
}

export async function sealWealthCredential(credential: string, secret: string, binding: WealthCredentialBinding): Promise<SealedWealthCredential> {
  validateCredential(credential);
  validateBinding(binding);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(associatedData(binding)) },
    await encryptionKey(secret, 'encrypt'),
    arrayBuffer(encoder.encode(credential)),
  );
  return { ciphertext: encode(new Uint8Array(ciphertext)), iv: encode(iv) };
}

export async function openWealthCredential(sealed: SealedWealthCredential, secret: string, binding: WealthCredentialBinding): Promise<string> {
  validateBinding(binding);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: arrayBuffer(decode(sealed.iv)), additionalData: arrayBuffer(associatedData(binding)) },
      await encryptionKey(secret, 'decrypt'),
      arrayBuffer(decode(sealed.ciphertext)),
    );
    const credential = new TextDecoder().decode(plaintext);
    validateCredential(credential);
    return credential;
  } catch {
    throw new Error('Wealth provider credential could not be opened');
  }
}

function canonicalExchange(exchange: string): ExchangeRule | null {
  return EXCHANGE_RULES[exchange.trim().toUpperCase()] ?? null;
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateFor(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new RangeError('The quote clock is not valid');
  return now.toISOString().slice(0, 10);
}

function validInstrumentTicker(ticker: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(ticker);
}

function validInstrumentType(type: unknown): type is 'stock' | 'etf' {
  return type === 'stock' || type === 'etf';
}

function requireExchange(rule: ExchangeRule | null): ExchangeRule {
  if (!rule) throw new RangeError('The investment instrument is unsupported');
  return rule;
}

function requireTicker(ticker: string): void {
  if (!validInstrumentTicker(ticker)) throw new RangeError('The investment instrument is unsupported');
}

function requireInstrumentType(type: unknown): asserts type is 'stock' | 'etf' {
  if (!validInstrumentType(type)) throw new RangeError('The investment instrument is unsupported');
}

function requireCurrency(currency: string, rule: ExchangeRule): void {
  if (currency !== rule.currency) throw new RangeError('The investment instrument is unsupported');
}

function normalizeInstrument(input: WealthQuoteInstrument): WealthQuoteInstrument {
  if (!input || typeof input !== 'object') throw new RangeError('The investment instrument is not valid');
  const exchange = typeof input.exchange === 'string' ? input.exchange.trim().toUpperCase() : '';
  const ticker = typeof input.ticker === 'string' ? input.ticker.trim().toUpperCase() : '';
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  const rule = canonicalExchange(exchange);
  const supported = requireExchange(rule);
  requireTicker(ticker);
  requireInstrumentType(input.type);
  requireCurrency(currency, supported);
  return { exchange: supported.canonical, ticker, type: input.type, currency };
}

export function wealthQuoteInstrumentKey(input: WealthQuoteInstrument): string {
  const instrument = normalizeInstrument(input);
  return [instrument.exchange, instrument.ticker, instrument.type, instrument.currency].join('\u0000');
}

function textField(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof value[key] === 'string' && value[key].trim()) return (value[key] as string).trim();
  return '';
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseProviderNumber(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage response was invalid.');
    return String(value);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage response was invalid.');
  return value.trim();
}

function decimalToMinor(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  const digits = fraction.padEnd(2, '0');
  const rounded = digits.length > 2 && Number(digits[2]) >= 5 ? BigInt(digits.slice(0, 2) || '0') + 1n : BigInt(digits.slice(0, 2) || '0');
  const minor = BigInt(whole) * 100n + rounded;
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage price was invalid.');
  return Number(minor);
}

function providerExchange(match: AlphaVantageSearchMatch): string | null {
  const explicit = match.exchange ? canonicalExchange(match.exchange) : null;
  if (explicit) return explicit.canonical;
  const symbol = match.providerSymbol.toUpperCase();
  for (const [suffix, exchange] of Object.entries(EXCHANGE_SUFFIXES)) if (symbol.endsWith(suffix)) return exchange;
  return null;
}

function providerTicker(match: AlphaVantageSearchMatch, exchange: ExchangeRule): string {
  const symbol = match.providerSymbol.toUpperCase();
  if (exchange.suffix && symbol.endsWith(exchange.suffix)) return symbol.slice(0, -exchange.suffix.length);
  return symbol;
}

export function confirmAlphaVantageMatch(input: WealthQuoteInstrument, match: AlphaVantageSearchMatch): boolean {
  let instrument: WealthQuoteInstrument;
  try { instrument = normalizeInstrument(input); } catch { return false; }
  const rule = canonicalExchange(instrument.exchange);
  if (!rule) return false;
  if (match.currency.toUpperCase() !== rule.currency || match.region !== rule.region) return false;
  if (providerExchange(match) !== rule.canonical || providerTicker(match, rule) !== instrument.ticker) return false;
  const type = match.type.toLowerCase();
  return instrument.type === 'etf' ? type === 'etf' : type === 'equity' || type === 'stock';
}

function searchFields(item: Record<string, unknown>): { providerSymbol: string; name: string; type: string; region: string; currency: string; exchange: string; matchScore: string } | null {
  const providerSymbol = textField(item, '1. symbol', 'symbol');
  const name = textField(item, '2. name', 'name');
  const type = textField(item, '3. type', 'type');
  const region = textField(item, '4. region', 'region');
  const currency = textField(item, '8. currency', 'currency').toUpperCase();
  if ([providerSymbol, name, type, region, currency].some((value) => value.length === 0)) return null;
  return { providerSymbol, name, type, region, currency, exchange: textField(item, 'exchange', '10. exchange', 'listingExchange', 'market'), matchScore: textField(item, '9. matchScore') };
}

function parseAlphaSearchRow(row: unknown): AlphaVantageSearchMatch | null {
  const item = rawObject(row);
  if (!item) return null;
  const fields = searchFields(item);
  if (!fields) return null;
  return { providerSymbol: fields.providerSymbol, name: fields.name, type: fields.type, region: fields.region, currency: fields.currency, ...(fields.exchange ? { exchange: fields.exchange } : {}), ...(fields.matchScore ? { matchScore: fields.matchScore } : {}) };
}

export function parseAlphaVantageSearch(payload: unknown): AlphaVantageSearchMatch[] {
  const object = rawObject(payload);
  const rows = object?.bestMatches;
  if (!Array.isArray(rows) || rows.length === 0) throw new WealthQuoteProviderError('empty_response', 'Alpha Vantage returned no matching instruments.');
  const matches = rows.slice(0, 20).map(parseAlphaSearchRow).filter((match): match is AlphaVantageSearchMatch => match !== null);
  if (matches.length === 0) throw new WealthQuoteProviderError('empty_response', 'Alpha Vantage returned no usable instrument matches.');
  return matches;
}

function parseAlphaQuoteFields(quote: Record<string, unknown>): AlphaVantageQuote {
  const symbol = textField(quote, '01. symbol', 'symbol');
  const price = decimalToMinor(parseProviderNumber(quote['05. price'] ?? quote.price));
  const quoteDate = textField(quote, '07. latest trading day', 'latestTradingDay');
  if (!symbol || !validDate(quoteDate)) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage quote was invalid.');
  const currency = textField(quote, '08. currency', 'currency').toUpperCase();
  return { symbol, priceMinor: price, quoteDate, ...(currency ? { currency } : {}) };
}

export function parseAlphaVantageQuote(payload: unknown, asOf: string): AlphaVantageQuote {
  const object = rawObject(payload);
  const quote = rawObject(object?.['Global Quote']);
  if (!quote || !validDate(asOf)) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage quote was invalid.');
  const parsed = parseAlphaQuoteFields(quote);
  if (parsed.quoteDate > asOf) throw new WealthQuoteProviderError('future_observation', 'Alpha Vantage returned a future quote date.');
  return parsed;
}

export class WealthQuoteProviderError extends Error {
  constructor(public readonly code: 'provider_request' | 'rate_limited' | 'invalid_response' | 'empty_response' | 'future_observation' | 'timeout', message: string, public readonly status?: number) {
    super(message);
    this.name = 'WealthQuoteProviderError';
  }
}

type AlphaVantageFunction = 'GLOBAL_QUOTE' | 'SYMBOL_SEARCH' | 'LISTING_STATUS';
type ProviderResponseFormat = 'json' | 'csv';

function providerUrl(functionName: AlphaVantageFunction, params: Record<string, string>): string {
  const url = new URL(ALPHA_VANTAGE_ENDPOINT);
  url.search = new URLSearchParams({ function: functionName, ...params }).toString();
  if (url.origin !== 'https://www.alphavantage.co' || url.pathname !== '/query') throw new Error('Alpha Vantage endpoint is not fixed');
  return url.href;
}

async function readProviderBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return await consumeProviderBody(reader, decoder, maxBytes);
  } catch (error) {
    if (error instanceof WealthQuoteProviderError) throw error;
    throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage response was invalid.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function consumeProviderBody(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>, decoder: TextDecoder, maxBytes: number): Promise<string> {
  const state = { total: 0, text: '' };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return state.text + decoder.decode();
    appendProviderChunk(state, chunk.value, decoder, maxBytes);
  }
}

function appendProviderChunk(state: { total: number; text: string }, chunk: Uint8Array, decoder: TextDecoder, maxBytes: number): void {
  state.total += chunk.byteLength;
  if (state.total > maxBytes) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage response was too large.');
  state.text += decoder.decode(chunk, { stream: true });
}

async function requestProvider(functionName: AlphaVantageFunction, params: Record<string, string>, fetcher: typeof fetch, format: ProviderResponseFormat = 'json'): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new WealthQuoteProviderError('timeout', 'The Alpha Vantage request timed out.'));
    }, REQUEST_TIMEOUT_MS);
  });
  const operation = (async () => {
    let response: Response;
    try {
      response = await fetcher(providerUrl(functionName, params), { method: 'GET', headers: { accept: format === 'csv' ? 'text/csv' : 'application/json' }, cache: 'no-store', redirect: 'error', signal: controller.signal });
    } catch {
      throw new WealthQuoteProviderError(timedOut ? 'timeout' : 'provider_request', 'The Alpha Vantage provider is unavailable.');
    }
    if (response.status === 429) throw new WealthQuoteProviderError('rate_limited', 'The Alpha Vantage provider rate limit was reached.', 429);
    if (!response.ok) throw new WealthQuoteProviderError('provider_request', 'The Alpha Vantage provider request failed.', response.status);
    const text = await readProviderBody(response, format === 'csv' ? MAX_PROVIDER_CSV_BYTES : MAX_PROVIDER_BODY_BYTES);
    if (!text.trim()) throw new WealthQuoteProviderError('empty_response', 'The Alpha Vantage provider returned an empty response.');
    if (format === 'csv') return text;
    try { return JSON.parse(text) as unknown; } catch { throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage provider response was invalid.'); }
  })();
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

interface CsvParseState { readonly rows: string[][]; fields: string[]; field: string; quoted: boolean }

function finishCsvRow(state: CsvParseState): void {
  state.fields.push(state.field);
  if (state.fields.some((value) => value.length > 0)) state.rows.push(state.fields);
  if (state.rows.length > MAX_LISTING_ROWS) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage listing response was too large.');
  state.fields = [];
  state.field = '';
}

function consumeQuotedCsvCharacter(csv: string, index: number, state: CsvParseState): number {
  const character = csv[index];
  if (character === '"' && csv[index + 1] === '"') { state.field += '"'; return index + 1; }
  if (character === '"') state.quoted = false;
  else state.field += character;
  return index;
}

function consumeUnquotedCsvCharacter(csv: string, index: number, state: CsvParseState): number {
  const character = csv[index];
  if (character === '"' && state.field.length === 0) { state.quoted = true; return index; }
  if (character === ',') { state.fields.push(state.field); state.field = ''; return index; }
  if (character === '\n' || character === '\r') {
    finishCsvRow(state);
    return character === '\r' && csv[index + 1] === '\n' ? index + 1 : index;
  }
  state.field += character;
  return index;
}

function consumeCsvCharacter(csv: string, index: number, state: CsvParseState): number {
  return state.quoted ? consumeQuotedCsvCharacter(csv, index, state) : consumeUnquotedCsvCharacter(csv, index, state);
}

function parseCsvRows(csv: string): string[][] {
  const state: CsvParseState = { rows: [], fields: [], field: '', quoted: false };
  for (let index = 0; index < csv.length; index += 1) index = consumeCsvCharacter(csv, index, state);
  if (state.quoted) throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage listing response was invalid.');
  if (state.field.length > 0 || state.fields.length > 0) finishCsvRow(state);
  return state.rows;
}

function listingColumnIndexes(header: readonly string[]): Record<string, number> {
  const indexes: Record<string, number> = {};
  header.forEach((name, index) => { indexes[name.trim().replace(/^\uFEFF/, '').toLowerCase()] = index; });
  const required = ['symbol', 'name', 'exchange', 'assettype', 'status'];
  if (!required.every((column) => indexes[column] !== undefined)) {
    throw new WealthQuoteProviderError('invalid_response', 'The Alpha Vantage listing response was invalid.');
  }
  return indexes;
}

function listingAssetType(value: string): AlphaVantageListing['type'] | null {
  const type = value.trim().toLowerCase();
  if (type === 'etf') return 'ETF';
  if (type === 'stock' || type === 'equity') return 'Equity';
  return null;
}

function activeListingRow(row: readonly string[], indexes: Readonly<Record<string, number>>): boolean {
  return (row[indexes.status] ?? '').trim().toLowerCase() === 'active';
}

function supportedListingExchange(row: readonly string[], indexes: Readonly<Record<string, number>>): ExchangeRule | null {
  const exchange = canonicalExchange(row[indexes.exchange] ?? '');
  return exchange?.region === 'United States' ? exchange : null;
}

function listingFromCsvRow(row: readonly string[], indexes: Readonly<Record<string, number>>): AlphaVantageListing | null {
  if (!activeListingRow(row, indexes)) return null;
  const symbol = (row[indexes.symbol] ?? '').trim().toUpperCase();
  const exchange = supportedListingExchange(row, indexes);
  const type = listingAssetType(row[indexes.assettype] ?? '');
  if (!symbol) return null;
  if (!exchange) return null;
  if (!type) return null;
  return { providerSymbol: symbol, name: (row[indexes.name] ?? '').trim() || symbol, exchange: exchange.canonical, type, region: 'United States', currency: 'USD' };
}

export function parseAlphaVantageListing(payload: string): AlphaVantageListing[] {
  if (typeof payload !== 'string' || payload.length === 0) throw new WealthQuoteProviderError('empty_response', 'Alpha Vantage returned no listing data.');
  const rows = parseCsvRows(payload);
  if (rows.length < 2) throw new WealthQuoteProviderError('empty_response', 'Alpha Vantage returned no listing data.');
  const indexes = listingColumnIndexes(rows[0]);
  const listings = rows.slice(1).map((row) => listingFromCsvRow(row, indexes)).filter((listing): listing is AlphaVantageListing => listing !== null);
  if (listings.length === 0) throw new WealthQuoteProviderError('empty_response', 'Alpha Vantage returned no usable listings.');
  return listings;
}

function listingMatches(instrument: WealthQuoteInstrument, listings: readonly AlphaVantageListing[]): AlphaVantageSearchMatch[] {
  const rule = canonicalExchange(instrument.exchange);
  if (!rule) return [];
  return listings.filter((listing) => listing.providerSymbol === instrument.ticker && listing.exchange === rule.canonical && (instrument.type === 'etf' ? listing.type === 'ETF' : listing.type === 'Equity'))
    .map((listing) => ({ providerSymbol: listing.providerSymbol, name: listing.name, type: listing.type, region: listing.region, currency: listing.currency, exchange: listing.exchange }));
}

async function reserveProviderRequest(options: WealthQuoteLookupOptions): Promise<boolean> {
  return options.reserveRequest ? options.reserveRequest() : true;
}

export async function lookupAlphaVantageInstrument(instrumentInput: WealthQuoteInstrument, credential: string, options: WealthQuoteLookupOptions = {}): Promise<WealthQuoteLookupResult> {
  const instrument = normalizeInstrument(instrumentInput);
  validateCredential(credential);
  const fetcher = options.fetcher ?? fetch;
  try {
    if (!await reserveProviderRequest(options)) return { status: 'quota_exhausted', reason: 'The free provider allowance is exhausted for this rolling 24-hour window.' };
    let matches: AlphaVantageSearchMatch[] = [];
    try {
      matches = parseAlphaVantageSearch(await requestProvider('SYMBOL_SEARCH', { keywords: instrument.ticker, apikey: credential }, fetcher));
    } catch (error) {
      if (!(error instanceof WealthQuoteProviderError) || error.code !== 'empty_response') throw error;
    }
    const confirmed = matches.filter((match) => confirmAlphaVantageMatch(instrument, match));
    if (confirmed.length === 1) return { status: 'matched', providerSymbol: confirmed[0].providerSymbol, match: confirmed[0] };
    if (confirmed.length > 1) return { status: 'ambiguous', reason: 'The provider returned multiple confirmed instrument matches.', matches: confirmed };
    if (instrument.currency === 'USD') {
      if (!await reserveProviderRequest(options)) return { status: 'quota_exhausted', reason: 'The free provider allowance is exhausted for this rolling 24-hour window.' };
      const listingPayload = await requestProvider('LISTING_STATUS', { apikey: credential, state: 'active' }, fetcher, 'csv');
      const listings = parseAlphaVantageListing(String(listingPayload));
      const listingConfirmed = listingMatches(instrument, listings).filter((match) => confirmAlphaVantageMatch(instrument, match));
      if (listingConfirmed.length === 1) return { status: 'matched', providerSymbol: listingConfirmed[0].providerSymbol, match: listingConfirmed[0] };
      if (listingConfirmed.length > 1) return { status: 'ambiguous', reason: 'The provider listing returned multiple confirmed instrument matches.', matches: listingConfirmed };
    }
    return { status: matches.length === 0 ? 'not_found' : 'unsupported', reason: 'The provider did not confirm the requested exchange, currency, and instrument type.', matches };
  } catch (error) {
    if (error instanceof WealthQuoteProviderError) return { status: 'provider_error', reason: error.code === 'rate_limited' ? 'The provider quota was reached.' : 'The provider quote lookup was unavailable.' };
    return { status: 'provider_error', reason: 'The provider quote lookup was unavailable.' };
  }
}

export async function searchWealthQuote(db: D1Database, context: FinancialContext, instrumentInput: WealthQuoteInstrument, options: WealthQuoteSearchOptions): Promise<WealthQuoteLookupResult> {
  const instrument = normalizeInstrument(instrumentInput);
  await assertFinancialAuthority(db, context, 'wealth:read');
  const credential = await storedCredential(db, context, options.secret);
  if (!credential) return { status: 'unsupported', reason: 'A provider key is not configured; use a manual valuation.' };
  const now = options.now?.() ?? new Date();
  return lookupAlphaVantageInstrument(instrument, credential, {
    fetcher: options.fetcher,
    now: () => now,
    reserveRequest: () => reserveWealthQuoteQuota(db, context, { instrumentKey: wealthQuoteInstrumentKey(instrument), now }),
  });
}

function validateProviderSymbol(providerSymbol: string): void {
  if (!providerSymbol || providerSymbol.length > 64) throw new RangeError('The provider symbol is not valid');
}

function validateFetchedQuote(instrument: WealthQuoteInstrument, providerSymbol: string, quote: AlphaVantageQuote): AlphaVantageQuote {
  if (quote.symbol.toUpperCase() !== providerSymbol.toUpperCase()) throw new WealthQuoteProviderError('invalid_response', 'The provider quote symbol did not match the requested instrument.');
  if (quote.currency && quote.currency !== instrument.currency) throw new WealthQuoteProviderError('invalid_response', 'The provider quote currency did not match the instrument.');
  return quote;
}

async function fetchAlphaVantageQuoteForSymbol(instrumentInput: WealthQuoteInstrument, options: WealthQuoteFetchOptions & { readonly asOf: string }): Promise<AlphaVantageQuote> {
  const instrument = normalizeInstrument(instrumentInput);
  validateCredential(options.credential);
  validateProviderSymbol(options.providerSymbol);
  const quote = await requestProvider('GLOBAL_QUOTE', { symbol: options.providerSymbol, apikey: options.credential }, options.fetcher ?? fetch);
  return validateFetchedQuote(instrument, options.providerSymbol, parseAlphaVantageQuote(quote, options.asOf));
}

function validStoredQuoteIdentity(row: StoredQuoteRow): boolean {
  return row.provider === WEALTH_QUOTE_PROVIDER
    && typeof row.ledger_id === 'string'
    && typeof row.instrument_key === 'string' && row.instrument_key.length > 0
    && typeof row.provider_symbol === 'string' && row.provider_symbol.length > 0
    && typeof row.revision === 'string' && row.revision.length > 0;
}

function validStoredQuoteDate(row: StoredQuoteRow): boolean {
  return validDate(row.quote_date) && typeof row.observed_at === 'string' && validDate(row.observed_at.slice(0, 10));
}

function validStoredQuotePrice(row: StoredQuoteRow): boolean {
  return Number.isSafeInteger(row.price_minor) && row.price_minor > 0;
}

function validStoredQuoteRow(row: StoredQuoteRow): row is StoredQuoteRow & { instrument_type: 'stock' | 'etf' } {
  const validType = row.instrument_type === 'stock' || row.instrument_type === 'etf';
  return validStoredQuoteIdentity(row) && validType && validStoredQuoteDate(row) && validStoredQuotePrice(row);
}

function storedQuoteMatchesInstrument(row: StoredQuoteRow & { instrument_type: 'stock' | 'etf' }, instrument: WealthQuoteInstrument, ledgerId: string): boolean {
  const rule = canonicalExchange(instrument.exchange);
  if (row.ledger_id !== ledgerId || !rule) return false;
  if (row.instrument_key !== wealthQuoteInstrumentKey(instrument)) return false;
  const type = instrument.type === 'etf' ? 'ETF' : 'Equity';
  const match = { providerSymbol: row.provider_symbol, name: row.ticker, type, region: rule.region, currency: rule.currency, exchange: rule.canonical };
  return confirmAlphaVantageMatch(instrument, match);
}

function observationFromRow(row: StoredQuoteRow, ledgerId: string): WealthQuoteObservation | null {
  if (!validStoredQuoteRow(row)) return null;
  try {
    const instrument = normalizeInstrument({ exchange: row.exchange, ticker: row.ticker, type: row.instrument_type, currency: row.currency });
    if (!storedQuoteMatchesInstrument(row, instrument, ledgerId)) return null;
    return { ledgerId, instrumentKey: wealthQuoteInstrumentKey(instrument), instrument, provider: WEALTH_QUOTE_PROVIDER, providerSymbol: row.provider_symbol, quoteDate: row.quote_date, priceMinor: row.price_minor, observedAt: row.observed_at, revision: row.revision };
  } catch { return null; }
}

interface StoredQuoteRow {
  ledger_id: string;
  instrument_key: string;
  exchange: string;
  ticker: string;
  instrument_type: string;
  currency: string;
  provider: string;
  provider_symbol: string;
  quote_date: string;
  price_minor: number;
  observed_at: string;
  revision: string;
}

async function readStoredQuote(db: D1Database, context: FinancialContext, instrument: WealthQuoteInstrument, asOf?: string): Promise<WealthQuoteObservation | null> {
  const row = await db.prepare(`SELECT ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision
    FROM wealth_quote_observations WHERE ledger_id=? AND instrument_key=? AND provider=?`).bind(context.ledgerId, wealthQuoteInstrumentKey(instrument), WEALTH_QUOTE_PROVIDER).first<StoredQuoteRow>();
  const quote = row ? observationFromRow(row, context.ledgerId) : null;
  return quote && (!asOf || quote.quoteDate <= asOf) ? quote : null;
}

export async function readWealthQuote(db: D1Database, context: FinancialContext, instrument: WealthQuoteInstrument, now = new Date()): Promise<WealthQuoteObservation | null> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  return readStoredQuote(db, context, instrument, dateFor(now));
}

export const readCachedWealthQuote = readWealthQuote;

export async function readWealthQuotes(db: D1Database, context: FinancialContext, instruments: readonly WealthQuoteInstrument[], now = new Date()): Promise<WealthQuoteObservation[]> {
  await assertFinancialAuthority(db, context, 'wealth:read');
  const asOf = dateFor(now);
  const quotes: WealthQuoteObservation[] = [];
  for (const instrumentInput of instruments) {
    let instrument: WealthQuoteInstrument;
    try { instrument = normalizeInstrument(instrumentInput); } catch { continue; }
    const quote = await readStoredQuote(db, context, instrument, asOf);
    if (quote) quotes.push(quote);
  }
  return quotes;
}

export const readCachedWealthQuotes = readWealthQuotes;

export interface WealthQuoteHoldingValuation {
  readonly accountId: string;
  readonly instrument: WealthQuoteInstrument;
  readonly asOf: string;
  readonly priceMinor: number;
  readonly source: 'provider';
  readonly provider: WealthQuoteProvider;
}

function validQuoteForPublication(quote: WealthQuoteObservation): boolean {
  return quote.provider === WEALTH_QUOTE_PROVIDER && Number.isSafeInteger(quote.priceMinor) && quote.priceMinor > 0;
}

export function wealthQuoteToHoldingValuation(accountId: string, quote: WealthQuoteObservation): WealthQuoteHoldingValuation {
  if (typeof accountId !== 'string' || !accountId.trim()) throw new RangeError('A wealth account is required for quote publication');
  if (!validQuoteForPublication(quote)) throw new RangeError('The cached quote is not valid for publication');
  return { accountId, instrument: quote.instrument, asOf: quote.quoteDate, priceMinor: quote.priceMinor, source: 'provider', provider: quote.provider };
}

async function storedCredential(db: D1Database, context: FinancialContext, secret: string): Promise<string | null> {
  const row = await db.prepare(`SELECT ciphertext,iv FROM wealth_quote_credentials WHERE ledger_id=? AND user_id=? AND provider=?`).bind(context.ledgerId, context.userId, WEALTH_QUOTE_PROVIDER).first<{ ciphertext: string; iv: string }>();
  return row ? openWealthCredential(row, secret, { ledgerId: context.ledgerId, provider: WEALTH_QUOTE_PROVIDER, userId: context.userId }) : null;
}

export async function listWealthQuoteCredentials(db: D1Database, context: FinancialContext): Promise<WealthQuoteCredentialMetadata[]> {
  const authority = financialAuthorityPredicate(context, 'wealth:read');
  const rows = await db.prepare(`SELECT provider,revision FROM wealth_quote_credentials
    WHERE ledger_id=? AND user_id=? AND ${authority.sql} ORDER BY provider`).bind(context.ledgerId, context.userId, ...authority.bindings).all<{ provider: WealthQuoteProvider; revision: string }>();
  return rows.results.map((row) => ({ provider: row.provider, revision: row.revision }));
}

export async function saveWealthQuoteCredential(db: D1Database, context: FinancialContext, input: WealthQuoteCredentialInput, options: WealthQuoteCredentialOptions): Promise<void> {
  const provider = input.provider ?? WEALTH_QUOTE_PROVIDER;
  if (provider !== WEALTH_QUOTE_PROVIDER) throw new RangeError('The wealth quote provider is unsupported');
  validateCredential(input.credential);
  const sealed = await sealWealthCredential(input.credential, options.secret, { ledgerId: context.ledgerId, provider, userId: context.userId });
  const authority = financialAuthorityPredicate(context, 'wealth:write');
  const result = await db.prepare(`INSERT INTO wealth_quote_credentials(ledger_id,user_id,provider,ciphertext,iv,revision)
    SELECT ?,?,?,?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,user_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,revision=excluded.revision WHERE ${authority.sql}`)
    .bind(context.ledgerId, context.userId, provider, sealed.ciphertext, sealed.iv, crypto.randomUUID(), ...authority.bindings, ...authority.bindings).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error('Wealth quote settings authority invalid');
}

export async function removeWealthQuoteCredential(db: D1Database, context: FinancialContext, provider: WealthQuoteProvider = WEALTH_QUOTE_PROVIDER): Promise<void> {
  if (provider !== WEALTH_QUOTE_PROVIDER) throw new RangeError('The wealth quote provider is unsupported');
  const authority = financialAuthorityPredicate(context, 'wealth:write');
  await db.prepare(`DELETE FROM wealth_quote_credentials WHERE ledger_id=? AND user_id=? AND provider=? AND ${authority.sql}`).bind(context.ledgerId, context.userId, provider, ...authority.bindings).run();
}

export async function reserveWealthQuoteQuota(db: D1Database, context: FinancialContext, input: { readonly instrumentKey: string; readonly now?: Date }): Promise<boolean> {
  if (!input.instrumentKey || input.instrumentKey.length > 256) throw new RangeError('The quote instrument key is not valid');
  const now = input.now ?? new Date();
  const reservedAt = now.toISOString();
  const cutoff = new Date(now.valueOf() - WEALTH_QUOTE_WINDOW_MS).toISOString();
  const authority = financialAuthorityPredicate(context, 'wealth:read');
  const result = await db.prepare(`INSERT INTO wealth_quote_quota_reservations(id,ledger_id,provider,instrument_key,reserved_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM wealth_quote_quota_reservations
      WHERE ledger_id=? AND provider=? AND reserved_at>?) < ? AND ${authority.sql}`)
    .bind(crypto.randomUUID(), context.ledgerId, WEALTH_QUOTE_PROVIDER, input.instrumentKey, reservedAt, context.ledgerId, WEALTH_QUOTE_PROVIDER, cutoff, WEALTH_QUOTE_MAX_REQUESTS, ...authority.bindings).run();
  return (result.meta?.changes ?? 0) === 1;
}

function result(status: WealthQuoteStatus, quote: WealthQuoteObservation | null, reason?: string): WealthQuoteResult {
  return { status, quote, ...(reason ? { reason } : {}) };
}

type ProviderSymbolResolution = { readonly providerSymbol: string } | { readonly failure: WealthQuoteResult };

function symbolMatches(requested: string | undefined, confirmed: string): boolean {
  return !requested || requested.toUpperCase() === confirmed.toUpperCase();
}

async function resolveProviderSymbol(
  db: D1Database,
  context: FinancialContext,
  instrument: WealthQuoteInstrument,
  request: WealthQuoteRefreshRequest,
  cached: WealthQuoteObservation | null,
  credential: string,
  fetcher: typeof fetch,
  now: Date,
): Promise<ProviderSymbolResolution> {
  if (cached) {
    return symbolMatches(request.providerSymbol, cached.providerSymbol)
      ? { providerSymbol: cached.providerSymbol }
      : { failure: result('unsupported', cached, 'The provider symbol did not match the cached instrument.') };
  }
  const lookup = await lookupAlphaVantageInstrument(instrument, credential, {
    fetcher,
    now: () => now,
    reserveRequest: () => reserveWealthQuoteQuota(db, context, { instrumentKey: wealthQuoteInstrumentKey(instrument), now }),
  });
  if (lookup.status !== 'matched') {
    const status = lookup.status === 'provider_error' ? 'provider_error' : lookup.status === 'quota_exhausted' ? 'quota_exhausted' : 'unsupported';
    return { failure: result(status, cached, lookup.reason) };
  }
  return symbolMatches(request.providerSymbol, lookup.providerSymbol)
    ? { providerSymbol: lookup.providerSymbol }
    : { failure: result('unsupported', cached, 'The provider symbol did not match the confirmed instrument.') };
}

function providerFailure(error: unknown, cached: WealthQuoteObservation | null): WealthQuoteResult {
  const reason = error instanceof WealthQuoteProviderError && error.code === 'rate_limited'
    ? 'The provider quota was reached.'
    : 'The provider quote was unavailable; the previous quote was preserved.';
  return result('provider_error', cached, reason);
}

function currentCacheResult(cached: WealthQuoteObservation | null, asOf: string): WealthQuoteResult | null {
  return cached?.quoteDate === asOf ? result('cached', cached, 'The current dated quote is already cached.') : null;
}

function quotaResult(cached: WealthQuoteObservation | null): WealthQuoteResult {
  return result('quota_exhausted', cached, 'The free provider allowance is exhausted for this rolling 24-hour window.');
}

async function publishFetchedQuote(
  db: D1Database,
  context: FinancialContext,
  instrument: WealthQuoteInstrument,
  providerSymbol: string,
  credential: string,
  cached: WealthQuoteObservation | null,
  asOf: string,
  observedAt: string,
  fetcher: typeof fetch,
): Promise<WealthQuoteResult> {
  let parsed: AlphaVantageQuote;
  try {
    parsed = await fetchAlphaVantageQuoteForSymbol(instrument, { providerSymbol, credential, asOf, fetcher });
  } catch (error) {
    return providerFailure(error, cached);
  }
  if (cached && (parsed.quoteDate < cached.quoteDate || (parsed.quoteDate === cached.quoteDate && observedAt <= cached.observedAt))) {
    return result('stale', cached, 'The provider returned an older observation; the newer cached quote was preserved.');
  }
  await assertFinancialAuthority(db, context, 'wealth:read');
  const quote: WealthQuoteObservation = {
    ledgerId: context.ledgerId,
    instrumentKey: wealthQuoteInstrumentKey(instrument),
    instrument,
    provider: WEALTH_QUOTE_PROVIDER,
    providerSymbol,
    quoteDate: parsed.quoteDate,
    priceMinor: parsed.priceMinor,
    observedAt,
    revision: crypto.randomUUID(),
  };
  const authority = financialAuthorityPredicate(context, 'wealth:read');
  const publication = await db.prepare(`INSERT INTO wealth_quote_observations(ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,instrument_key,provider) DO UPDATE SET provider_symbol=excluded.provider_symbol,quote_date=excluded.quote_date,price_minor=excluded.price_minor,observed_at=excluded.observed_at,revision=excluded.revision
    WHERE excluded.quote_date>wealth_quote_observations.quote_date OR (excluded.quote_date=wealth_quote_observations.quote_date AND excluded.observed_at>wealth_quote_observations.observed_at)`)
    .bind(context.ledgerId, quote.instrumentKey, instrument.exchange, instrument.ticker, instrument.type, instrument.currency, WEALTH_QUOTE_PROVIDER, providerSymbol, quote.quoteDate, quote.priceMinor, quote.observedAt, quote.revision, ...authority.bindings).run();
  if ((publication.meta?.changes ?? 0) !== 1) {
    await assertFinancialAuthority(db, context, 'wealth:read');
    const latest = await readStoredQuote(db, context, instrument, asOf);
    return result('stale', latest ?? cached, 'A newer quote was published concurrently; this observation was not applied.');
  }
  await appendQuoteValuationHistory(db, context, quote);
  return result('refreshed', quote);
}

async function appendQuoteValuationHistory(db: D1Database, context: FinancialContext, quote: WealthQuoteObservation): Promise<void> {
  const table = await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='wealth_valuations'").first<{present:number}>();
  if (!table) return;
  const authority = financialAuthorityPredicate(context, 'wealth:read');
  const payload = JSON.stringify({ id: `quote:${quote.revision}`, accountId: '', instrument: quote.instrument, asOf: quote.quoteDate, priceMinor: quote.priceMinor, source: 'provider', provider: quote.provider });
  await db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision)
    SELECT ?,? || ':' || a.id,a.id,?,?,?,'provider',?, ?,0
    FROM wealth_accounts a WHERE a.ledger_id=? AND a.kind='brokerage' AND a.mode='holdings'
      AND EXISTS (SELECT 1 FROM wealth_events e WHERE e.ledger_id=a.ledger_id AND (e.account_id=a.id OR json_extract(e.payload_json,'$.toAccountId')=a.id)
        AND json_extract(e.payload_json,'$.instrument.exchange')=? AND json_extract(e.payload_json,'$.instrument.ticker')=? AND json_extract(e.payload_json,'$.instrument.type')=? AND json_extract(e.payload_json,'$.instrument.currency')=?)
      AND ${authority.sql}
    ON CONFLICT(ledger_id,account_id,instrument_key,as_of) DO NOTHING`)
    .bind(context.ledgerId, `quote:${quote.revision}`, quote.instrumentKey, quote.quoteDate, quote.priceMinor, quote.provider, payload, context.ledgerId, quote.instrument.exchange, quote.instrument.ticker, quote.instrument.type, quote.instrument.currency, ...authority.bindings).run();
}

interface NormalizedRefreshInput {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly instrument: WealthQuoteInstrument;
  readonly request: WealthQuoteRefreshRequest;
  readonly options: WealthQuoteRuntimeOptions;
}

async function refreshNormalizedWealthQuote(input: NormalizedRefreshInput): Promise<WealthQuoteResult> {
  const { db, context, instrument, request, options } = input;
  await assertFinancialAuthority(db, context, 'wealth:read');
  const now = options.now?.() ?? new Date();
  const asOf = dateFor(now);
  const cached = await readStoredQuote(db, context, instrument, asOf);
  const current = currentCacheResult(cached, asOf);
  if (current) return current;
  const credential = await storedCredential(db, context, options.secret);
  if (!credential) return result('manual', cached, 'A provider key is not configured; enter a manual valuation.');
  const fetcher = options.fetcher ?? fetch;
  const symbol = await resolveProviderSymbol(db, context, instrument, request, cached, credential, fetcher, now);
  if ('failure' in symbol) return symbol.failure;
  const reserved = await reserveWealthQuoteQuota(db, context, { instrumentKey: wealthQuoteInstrumentKey(instrument), now });
  if (!reserved) return quotaResult(cached);
  return publishFetchedQuote(db, context, instrument, symbol.providerSymbol, credential, cached, asOf, now.toISOString(), fetcher);
}

export async function refreshWealthQuote(db: D1Database, context: FinancialContext, request: WealthQuoteRefreshRequest, options: WealthQuoteRuntimeOptions): Promise<WealthQuoteResult> {
  let instrument: WealthQuoteInstrument;
  try { instrument = normalizeInstrument(request.instrument); }
  catch { return result('unsupported', null, 'The instrument is not supported by the free provider.'); }
  return refreshNormalizedWealthQuote({ db, context, instrument, request, options });
}

export async function refreshWealthQuotes(db: D1Database, context: FinancialContext, requests: readonly WealthQuoteRefreshRequest[], options: WealthQuoteBatchOptions): Promise<WealthQuoteResult[]> {
  const maxCandidates = Math.max(0, Math.min(options.maxCandidates ?? 10, 25));
  const results: WealthQuoteResult[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    if (index >= maxCandidates) {
      results.push(result('skipped', null, 'The batch refresh candidate limit was reached.'));
      continue;
    }
    results.push(await refreshWealthQuote(db, context, requests[index], options));
  }
  return results;
}

export const refreshWealthQuoteBatch = refreshWealthQuotes;
