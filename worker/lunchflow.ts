import { classifyTransaction } from '../src/domain/ledger';
import type { TransactionKind } from '../src/domain/types';
import { getCurrencyMeta } from '../src/domain/currencies';

export const LUNCHFLOW_API_BASE_URL = 'https://lunchflow.app/api/v1';
export const LUNCHFLOW_REQUEST_TIMEOUT_MS = 15_000;
export const LUNCHFLOW_RESPONSE_BYTES = 8 * 1024 * 1024;
export const LUNCHFLOW_MAX_ACCOUNTS = 25;
export const LUNCHFLOW_MAX_TRANSACTIONS = 10_000;

export interface LunchFlowApiEnv {
  LUNCHFLOW_API_KEY?: string;
  LUNCHFLOW_API_BASE_URL?: string;
}

export interface LunchFlowAccount {
  id: string;
  name: string;
  institutionName: string;
  status: string;
  currency: string | null;
}

export interface LunchFlowTransaction {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  date: string;
  merchant?: string | null;
  description?: string | null;
  isPending: boolean;
}

export interface MappedLunchFlowTransaction {
  id: string;
  accountId: string;
  providerAccountId: string;
  providerTransactionId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  category: string;
  kind: TransactionKind;
  status: 'confirmed' | 'provisional';
  source: 'lunchflow';
  fingerprint: string;
  note?: string;
  sourceIdentity: string;
  sourceRecordId: string;
  contentDigest: string;
}

export class LunchFlowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'LunchFlowError';
  }
}

function malformedResponse(field: string): never {
  throw new LunchFlowError('malformed_response', `Lunch Flow returned an invalid ${field}.`);
}

interface BoundedTextOptions {
  field: string;
  max: number;
  fallback?: string;
}

interface FieldOptions {
  field: string;
}

function boundedText(value: unknown, options: BoundedTextOptions) {
  const { field, max, fallback } = options;
  if (value === undefined) return fallback ?? malformedResponse(field);
  if (value === null) return fallback ?? malformedResponse(field);
  if (typeof value !== 'string') return malformedResponse(field);
  const trimmed = value.trim();
  if (trimmed.length === 0) return malformedResponse(field);
  if (value.length > max) return malformedResponse(field);
  return trimmed;
}

function isProviderNumber(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isSafeInteger(value)) return false;
  return value >= 0;
}

function providerId(value: unknown, { field }: FieldOptions) {
  if (isProviderNumber(value)) return String(value);
  return boundedText(value, { field, max: 256 });
}

function optionalCurrency(value: unknown) {
  if (value === null) return null;
  if (value === undefined) return null;
  if (value === '') return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return getCurrencyMeta(normalized)?.code ?? null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function dateValue(value: unknown) {
  const date = boundedText(value, { field: 'transaction date', max: 10 });
  if (!isCalendarDate(date)) throw new LunchFlowError('malformed_response', 'Lunch Flow returned an invalid transaction date.');
  return date;
}

function numberValue(value: unknown, { field }: FieldOptions) {
  if (typeof value !== 'number') return malformedResponse(field);
  if (!Number.isFinite(value)) return malformedResponse(field);
  return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}

function objectValue(value: unknown, { message }: { message: string }): Record<string, unknown> {
  if (isObjectRecord(value)) return value;
  throw new LunchFlowError('malformed_response', message);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function oversizedResponse(): never {
  throw new LunchFlowError('response_too_large', 'Lunch Flow returned an oversized response.', 502, true);
}

function hasOversizedContentLength(contentLength: string | null, maxBytes: number) {
  if (contentLength === null) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  return Number(contentLength) > maxBytes;
}

async function readUnstreamedResponse(response: Response, maxBytes: number) {
  const contentLength = response.headers.get('content-length');
  if (hasOversizedContentLength(contentLength, maxBytes)) oversizedResponse();
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) oversizedResponse();
  return text;
}

async function readStreamedResponse(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        oversizedResponse();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function boundedResponseText(response: Response, maxBytes: number) {
  if (response.body) return readStreamedResponse(response.body, maxBytes);
  return readUnstreamedResponse(response, maxBytes);
}

async function boundedJson(response: Response, maxBytes: number) {
  const text = await boundedResponseText(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LunchFlowError('malformed_response', 'Lunch Flow returned invalid JSON.');
  }
}

function configurationError(): never {
  throw new LunchFlowError('configuration', 'Lunch Flow is not configured on the Worker.', 503, false);
}

function providerApiKey(env: LunchFlowApiEnv) {
  const key = env.LUNCHFLOW_API_KEY?.trim();
  if (key) return key;
  return configurationError();
}

function providerBaseUrl(env: LunchFlowApiEnv) {
  const configured = env.LUNCHFLOW_API_BASE_URL;
  if (!configured) return LUNCHFLOW_API_BASE_URL;
  let configuredBaseUrl: URL;
  try {
    configuredBaseUrl = new URL(configured);
  } catch {
    return configurationError();
  }
  const normalized = configuredBaseUrl.toString().replace(/\/$/, '');
  if (normalized !== LUNCHFLOW_API_BASE_URL) return configurationError();
  return normalized;
}

function providerConfiguration(env: LunchFlowApiEnv) {
  return { key: providerApiKey(env), baseUrl: providerBaseUrl(env) };
}

function providerRejection(response: Response): never {
  const retryable = response.status >= 500 || response.status === 429;
  throw new LunchFlowError(
    'provider_rejected',
    retryable ? 'Lunch Flow is temporarily unavailable.' : 'Lunch Flow rejected the request.',
    retryable ? 503 : 502,
    retryable,
  );
}

function releaseProviderErrorBody(response: Response) {
  if (!response.body) return;
  void response.body.cancel().catch(() => undefined);
}

async function providerGet<T>(env: LunchFlowApiEnv, path: string, fetcher: typeof fetch, query?: Record<string, string>) {
  const config = providerConfiguration(env);
  const url = new URL(`${config.baseUrl}/${path.replace(/^\//, '')}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LUNCHFLOW_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-api-key': config.key },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      releaseProviderErrorBody(response);
      return providerRejection(response);
    }
    const payload = await boundedJson(response, LUNCHFLOW_RESPONSE_BYTES);
    return payload as T;
  } catch (error) {
    if (error instanceof LunchFlowError) throw error;
    const timedOut = controller.signal.aborted || error instanceof Error && error.name === 'AbortError';
    throw new LunchFlowError(timedOut ? 'timeout' : 'provider_unavailable', 'Lunch Flow is temporarily unavailable.', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

function accountLimitError(): never {
  throw new LunchFlowError('too_many_accounts', 'Lunch Flow returned more than 25 accounts. Narrow the Lunch Flow Personal API scope before syncing.', 422, false);
}

function snapshotRows(object: Record<string, unknown>, field: 'accounts' | 'transactions', max: number) {
  const rows = object[field];
  if (!Array.isArray(rows)) throw new LunchFlowError('malformed_response', `Lunch Flow returned an invalid ${field} response.`);
  if (rows.length <= max) return rows;
  if (field === 'accounts') return accountLimitError();
  throw new LunchFlowError('malformed_response', `Lunch Flow returned an invalid ${field} response.`);
}

function exactTotal(object: Record<string, unknown>, rows: unknown[], field: 'accounts' | 'transactions') {
  if (!Number.isSafeInteger(object.total)) throw new LunchFlowError('incomplete_snapshot', `Lunch Flow returned an incomplete ${field} snapshot.`);
  if ((object.total as number) < 0) throw new LunchFlowError('incomplete_snapshot', `Lunch Flow returned an incomplete ${field} snapshot.`);
  if ((object.total as number) !== rows.length) throw new LunchFlowError('incomplete_snapshot', `Lunch Flow returned an incomplete ${field} snapshot.`);
}

function requireTransactionTotal(object: Record<string, unknown>, rows: unknown[]) {
  exactTotal(object, rows, 'transactions');
}

function checkOptionalAccountTotal(object: Record<string, unknown>, rows: unknown[]) {
  if (object.total === undefined) return;
  exactTotal(object, rows, 'accounts');
}

function parseAccount(value: unknown, ids: Set<string>) {
  const account = objectValue(value, { message: 'Lunch Flow returned an invalid account.' });
  const id = providerId(account.id, { field: 'account ID' });
  if (ids.has(id)) throw new LunchFlowError('malformed_response', 'Lunch Flow returned duplicate accounts.');
  ids.add(id);
  return {
    id,
    name: boundedText(account.name, { field: 'account name', max: 256, fallback: 'Lunch Flow account' }),
    institutionName: boundedText(account.institution_name, { field: 'institution name', max: 256, fallback: 'Lunch Flow institution' }),
    status: accountStatus(account.status),
    currency: optionalCurrency(account.currency),
  } satisfies LunchFlowAccount;
}

function accountStatus(value: unknown) {
  if (typeof value !== 'string') return 'UNKNOWN';
  if (value.length > 64) return 'UNKNOWN';
  return value;
}

function parseAccounts(payload: unknown) {
  const object = objectValue(payload, { message: 'Lunch Flow returned an invalid accounts response.' });
  const accounts = snapshotRows(object, 'accounts', LUNCHFLOW_MAX_ACCOUNTS);
  checkOptionalAccountTotal(object, accounts);
  const ids = new Set<string>();
  return accounts.map((value) => parseAccount(value, ids));
}

function transactionCurrency(value: unknown) {
  const currency = optionalCurrency(value);
  if (currency) return currency;
  throw new LunchFlowError('unsupported_currency', 'Lunch Flow returned an unsupported transaction currency.');
}

function optionalBoundedText(value: unknown, options: BoundedTextOptions) {
  if (value === null) return null;
  if (value === undefined) return null;
  return boundedText(value, options);
}

function parseTransaction(value: unknown, providerAccountId: string, ids: Set<string>) {
  const transaction = objectValue(value, { message: 'Lunch Flow returned an invalid transaction.' });
  const id = providerId(transaction.id, { field: 'transaction ID' });
  const accountId = providerId(transaction.accountId, { field: 'transaction account ID' });
  if (accountId !== providerAccountId) throw new LunchFlowError('ownership_mismatch', 'Lunch Flow returned a transaction for a different account.');
  if (ids.has(id)) throw new LunchFlowError('malformed_response', 'Lunch Flow returned duplicate transactions.');
  ids.add(id);
  if (typeof transaction.isPending !== 'boolean') throw new LunchFlowError('malformed_response', 'Lunch Flow returned an invalid pending flag.');
  return {
    id,
    accountId,
    amount: numberValue(transaction.amount, { field: 'transaction amount' }),
    currency: transactionCurrency(transaction.currency),
    date: dateValue(transaction.date),
    merchant: optionalBoundedText(transaction.merchant, { field: 'transaction merchant', max: 256 }),
    description: optionalBoundedText(transaction.description, { field: 'transaction description', max: 512 }),
    isPending: transaction.isPending,
  } satisfies LunchFlowTransaction;
}

function parseTransactions(payload: unknown, providerAccountId: string) {
  const object = objectValue(payload, { message: 'Lunch Flow returned an invalid transactions response.' });
  const transactions = snapshotRows(object, 'transactions', LUNCHFLOW_MAX_TRANSACTIONS);
  requireTransactionTotal(object, transactions);
  const ids = new Set<string>();
  return transactions.map((value) => parseTransaction(value, providerAccountId, ids));
}

export function createLunchFlowProvider(env: LunchFlowApiEnv, fetcher: typeof fetch = fetch) {
  return {
    async listAccounts() {
      return parseAccounts(await providerGet(env, '/accounts', fetcher));
    },
    async listTransactions(providerAccountId: string) {
      const id = providerId(providerAccountId, { field: 'account ID' });
      return parseTransactions(await providerGet(env, `/accounts/${encodeURIComponent(id)}/transactions`, fetcher, { include_pending: 'true' }), id);
    },
  };
}

function mappedCurrency(value: unknown) {
  const currency = optionalCurrency(value);
  if (!currency) throw new LunchFlowError('unsupported_currency', 'Lunch Flow returned an unsupported transaction currency.');
  const metadata = getCurrencyMeta(currency);
  if (!metadata) throw new LunchFlowError('unsupported_currency', 'Lunch Flow returned an unsupported transaction currency.');
  return { currency, metadata };
}

function amountMinorValue(value: unknown, currency: ReturnType<typeof getCurrencyMeta>) {
  const amount = numberValue(value, { field: 'transaction amount' });
  const scaled = amount * 10 ** (currency?.minorUnitDigits ?? 0);
  const amountMinor = Math.round(scaled);
  if (!Number.isSafeInteger(amountMinor)) throw new LunchFlowError('malformed_response', 'Lunch Flow returned an amount with unsupported precision.');
  if (Math.abs(scaled - amountMinor) > 1e-6) throw new LunchFlowError('malformed_response', 'Lunch Flow returned an amount with unsupported precision.');
  return amountMinor;
}

function mappedMerchant(transaction: LunchFlowTransaction) {
  const merchantValue = optionalBoundedText(transaction.merchant, { field: 'transaction merchant', max: 256 });
  const descriptionValue = optionalBoundedText(transaction.description, { field: 'transaction description', max: 512 });
  const merchant = merchantValue ?? descriptionValue ?? 'Unknown merchant';
  if (merchant.length > 256) throw new LunchFlowError('malformed_response', 'Lunch Flow returned an invalid transaction merchant.');
  const description = `${merchant} ${descriptionValue ?? ''}`.trim();
  return { merchant, description };
}

function mappedTransactionFields(transaction: LunchFlowTransaction, sourceAccountId: string) {
  const accountId = providerId(transaction.accountId, { field: 'transaction account ID' });
  if (accountId !== sourceAccountId) throw new LunchFlowError('ownership_mismatch', 'Lunch Flow returned a transaction for a different account.');
  const id = providerId(transaction.id, { field: 'transaction ID' });
  const { currency, metadata } = mappedCurrency(transaction.currency);
  const amountMinor = amountMinorValue(transaction.amount, metadata);
  if (typeof transaction.isPending !== 'boolean') throw new LunchFlowError('malformed_response', 'Lunch Flow returned an invalid pending flag.');
  const date = dateValue(transaction.date);
  const { merchant, description } = mappedMerchant(transaction);
  return { id, currency, amountMinor, isPending: transaction.isPending, date, merchant, description };
}

function mappedTransactionId(sourceAccountId: string, transactionId: string) {
  return `lunchflow:${sourceAccountId}:${transactionId}`;
}

export async function mapLunchFlowTransaction(
  transaction: LunchFlowTransaction,
  providerAccountId: string,
  localAccountId = providerAccountId,
): Promise<MappedLunchFlowTransaction> {
  const sourceAccountId = providerId(providerAccountId, { field: 'account ID' });
  const fields = mappedTransactionFields(transaction, sourceAccountId);
  const sourceIdentity = mappedTransactionId(sourceAccountId, fields.id);
  const digestInput = JSON.stringify({
    sourceIdentity,
    date: fields.date,
    merchant: fields.merchant,
    amountMinor: fields.amountMinor,
    currency: fields.currency,
    pending: fields.isPending,
  });
  const identityHash = await sha256(`${sourceAccountId}\u0000${fields.id}`);
  const contentDigest = await sha256(digestInput);
  return {
    id: `lunchflow-${identityHash}`,
    accountId: localAccountId,
    providerAccountId: sourceAccountId,
    providerTransactionId: fields.id,
    date: fields.date,
    merchant: fields.merchant,
    amountMinor: fields.amountMinor,
    currency: fields.currency,
    category: 'Uncategorized',
    kind: classifyTransaction({ amountMinor: fields.amountMinor, description: fields.description }),
    status: fields.isPending ? 'provisional' : 'confirmed',
    source: 'lunchflow',
    fingerprint: sourceIdentity,
    ...(fields.isPending ? { note: 'Pending in Lunch Flow' } : {}),
    sourceIdentity,
    sourceRecordId: `lunchflow-source-${identityHash}`,
    contentDigest,
  };
}
