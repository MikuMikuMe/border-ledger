import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import {
  buildPlaidRequest,
  decryptAccessToken,
  encryptAccessToken,
  fetchAllPlaidTransactions,
  getPlaidEnvironment,
  mapPlaidTransaction,
  upsertPlaidTransaction,
} from './plaid';
import type { PlaidEnvironment, PlaidSyncPage, PlaidTransaction } from './plaid';
import type { D1Database, D1Statement } from './db-types';
import { normalizeRecurringSnapshot, type PlaidRecurringResponse } from './plaid-recurring';
import {
  publishRecurringSnapshot,
  readRecurringDetail,
  readRecurringPage,
  readRecurringSummary,
  requestRecurringSync,
  setRecurringClassification,
} from './recurring-store';
import {
  BodyTooLargeError,
  InvalidJsonBodyError,
  apiSecurityHeaders,
  isAllowedApplicationOrigin,
  isSameOriginMutation,
  readJsonBody,
  readRequestText,
  staticSecurityHeaders,
} from './security';
import {
  selectPlaidAccounts,
  validateRecurringClassification,
  validateRecurringListQuery,
  validateRecurringSummaryQuery,
  validateAlertReviewPayload,
  validateImportPayload,
  validatePlaidExchangeInput,
} from './validation';
import { handleMobileRequest, isMobileAuthConfigured } from './mobile';
import type { AccessIdentity } from './mobile-auth';
import { applyAlertReview, commitStatementRows, ReconciliationConflictError, ReconciliationReviewError } from './reconciliation-store';
import type { ValidatedImportPayload } from './validation';
import { readLedgerReport, warmFxSnapshot } from './ledger-reports';
import { isFxProviderError } from './fx-rates';
import { getCurrencyMeta, type CurrencyCode } from '../src/domain/currencies';
import { readPreferences, updatePreferences, PreferenceRevisionConflictError } from './preferences-store';
import { LunchFlowError } from './lunchflow';
import { createLunchFlowService } from './lunchflow-service';
import { parseLunchFlowQueueAccounts, parseLunchFlowSelectionAccounts } from './lunchflow-routing';

interface Queue {
  send(message: unknown): Promise<void>;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  DB: D1Database;
  ASSETS: AssetFetcher;
  SYNC_QUEUE?: Queue;
  ACCESS_AUDIENCE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  LEDGER_API_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_USER_ID?: string;
  PLAID_ANDROID_PACKAGE_NAME?: string;
  PLAID_ANDROID_REDIRECT_URI?: string;
  LEDGER_APP_ORIGIN?: string;
  PLAID_WEBHOOK_URL?: string;
  MOBILE_ENVIRONMENT?: string;
  MOBILE_CALLBACK_URL?: string;
  MOBILE_ACCESS_AUTHORIZATION_URL?: string;
  MOBILE_SESSION_ENCRYPTION_KEY?: string;
  MOBILE_APPROVED_ACCESS_ISSUERS?: string;
  MOBILE_APPROVED_ACCESS_AUDIENCES?: string;
  MOBILE_APPROVED_ACCESS_SUBJECTS?: string;
  DEPLOYMENT_REVISION?: string;
  LUNCHFLOW_API_KEY?: string;
  LUNCHFLOW_API_BASE_URL?: string;
}

type Currency = CurrencyCode;
type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
type TransactionStatus = 'confirmed' | 'provisional' | 'needs_review';

interface StoredTransaction {
  id: string;
  account_id: string;
  date: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  category: string;
  kind: TransactionKind;
  status: TransactionStatus;
  source: string;
  fingerprint: string;
  note: string | null;
  plaid_item_id: string | null;
  provider_transaction_id: string | null;
  provider_pending_transaction_id: string | null;
}

interface StoredPlaidItem {
  item_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  institution_name: string | null;
}

interface StoredPlaidAccount {
  plaid_account_id: string;
  item_id: string;
  account_id: string;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  type: string;
  subtype?: string | null;
  mask?: string | null;
  balances?: {
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
  };
}

interface PlaidLinkTokenResponse {
  link_token: string;
}

interface PlaidExchangeResponse {
  access_token: string;
  item_id: string;
}

interface PlaidItemResponse {
  item?: {
    item_id: string;
    institution_id?: string | null;
    institution_name?: string | null;
  };
}

interface PlaidAccountsResponse {
  accounts: PlaidAccount[];
}

interface PlaidInstitutionResponse {
  institution?: { name?: string | null };
}

interface PlaidVerificationKeyResponse {
  key: Record<string, unknown>;
}

interface PlaidWebhookPayload {
  item_id?: string;
  webhook_type?: string;
  webhook_code?: string;
  environment?: string;
}

type PlaidQueueMessage = {
  type: 'plaid-sync';
  itemId: string;
} | {
  type: 'plaid-recurring-sync';
  itemId: string;
  generation: number;
} | {
  type: 'lunchflow-sync';
  accounts: Array<{ providerAccountId: string; revision: number }>;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const ANDROID_ASSET_LINKS = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.lofuyu.borderledger',
    sha256_cert_fingerprints: [
      '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17',
      '1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED',
    ],
  },
}];
const PLAID_SYNC_CONNECTION_PREFIX = 'plaid:';
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

class ConfigurationError extends Error {}

class RequestValidationError extends Error {}

class PlaidApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const cachedPlaidVerificationKeys = new Map<string, { key: JsonWebKey; expiresAt: number }>();

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { ...apiSecurityHeaders(), ...JSON_HEADERS, ...init.headers } });
}

function securedAssetResponse(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(staticSecurityHeaders())) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function normalizedTeamDomain(value: string) {
  const withProtocol = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

let cachedAccessVerifier: {
  issuer: string;
  audience: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
} | null = null;

function accessVerifier(env: Env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUDIENCE) return null;
  const issuer = normalizedTeamDomain(env.ACCESS_TEAM_DOMAIN);
  if (!issuer) return null;
  if (!cachedAccessVerifier || cachedAccessVerifier.issuer !== issuer || cachedAccessVerifier.audience !== env.ACCESS_AUDIENCE) {
    cachedAccessVerifier = {
      issuer,
      audience: env.ACCESS_AUDIENCE,
      jwks: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    };
  }
  return cachedAccessVerifier;
}

async function verifiedAccessJwt(request: Request, env: Env) {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  const verifier = accessVerifier(env);
  if (!assertion || !verifier) return null;

  try {
    const verified = await jwtVerify(assertion, verifier.jwks, {
      issuer: verifier.issuer,
      audience: verifier.audience,
    });
    return { ...verified, issuer: verifier.issuer };
  } catch (error) {
    console.warn('access_jwt_rejected', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

async function accessIdentity(request: Request, env: Env): Promise<AccessIdentity | null> {
  const verified = await verifiedAccessJwt(request, env);
  if (!verified) return null;
  const audience = Array.isArray(verified.payload.aud) ? verified.payload.aud[0] : verified.payload.aud;
  const subject = typeof verified.payload.sub === 'string' ? verified.payload.sub : '';
  if (!subject || typeof audience !== 'string') return null;
  const email = typeof verified.payload.email === 'string' ? verified.payload.email : null;
  return { subject, issuer: verified.issuer, audience, email };
}

async function hasValidAccessJwt(request: Request, env: Env) {
  return Boolean(await verifiedAccessJwt(request, env));
}

async function isAuthorized(request: Request, env: Env) {
  if (await hasValidAccessJwt(request, env)) return true;
  const configuredKey = env.LEDGER_API_KEY;
  const authorization = request.headers.get('authorization');
  return Boolean(configuredKey && authorization && timingSafeEqual(authorization, `Bearer ${configuredKey}`));
}

function plaidConfig(env: Env): { environment: PlaidEnvironment; clientId: string; secret: string } {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) throw new ConfigurationError('Plaid credentials are not configured.');
  return {
    environment: getPlaidEnvironment(env.PLAID_ENV),
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
  };
}

function encryptionKey(env: Env) {
  if (!env.PLAID_ENCRYPTION_KEY) throw new ConfigurationError('Plaid token encryption is not configured.');
  return env.PLAID_ENCRYPTION_KEY;
}

function plaidWebhookUrl(env: Pick<Env, 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>) {
  if (!env.PLAID_WEBHOOK_URL) {
    throw new ConfigurationError('Plaid webhook URL is not configured.');
  }
  let webhook: URL;
  try {
    webhook = new URL(env.PLAID_WEBHOOK_URL);
  } catch {
    throw new ConfigurationError('Plaid webhook URL is not valid.');
  }
  if (webhook.protocol !== 'https:' || webhook.pathname !== '/api/webhooks/plaid' || webhook.search || webhook.hash) {
    throw new ConfigurationError('Plaid webhook URL must be the HTTPS Worker webhook path.');
  }
  if (env.LEDGER_APP_ORIGIN) {
    try {
      if (webhook.origin !== new URL(env.LEDGER_APP_ORIGIN.split(',')[0]).origin) {
        throw new ConfigurationError('Plaid webhook URL must use the configured application origin.');
      }
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('The configured application origin is not valid.');
    }
  }
  return webhook.toString();
}

function linkTokenWebhookUrl(env: Pick<Env, 'PLAID_ENV' | 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>) {
  if (env.PLAID_ENV === 'sandbox' && !env.PLAID_WEBHOOK_URL) return undefined;
  return plaidWebhookUrl(env);
}

async function readPlaidResponse<T>(request: Request): Promise<T> {
  const response = await fetch(request);
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new PlaidApiError(
      response.status,
      typeof payload.error_code === 'string' ? payload.error_code : 'PLAID_REQUEST_FAILED',
      typeof payload.error_message === 'string' ? payload.error_message : undefined,
    );
  }
  return payload as T;
}

async function plaidPost<T>(env: Env, path: string, body: Record<string, unknown>) {
  const config = plaidConfig(env);
  return readPlaidResponse<T>(fetchablePlaidRequest(config, path, body));
}

async function plaidPostWithAccessToken<T>(env: Env, path: string, accessToken: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const config = plaidConfig(env);
  const request = fetchablePlaidRequest(config, path, { ...body, access_token: accessToken });
  return readPlaidResponse<T>(signal ? new Request(request, { signal }) : request);
}

function fetchablePlaidRequest(
  config: { environment: PlaidEnvironment; clientId: string; secret: string },
  path: string,
  body: Record<string, unknown>,
) {
  return buildPlaidRequest(config.environment, path, {
    ...body,
    client_id: config.clientId,
    secret: config.secret,
  });
}

function plaidAccountCurrency(account: PlaidAccount): Currency | null {
  const raw = (account.balances?.iso_currency_code ?? account.balances?.unofficial_currency_code ?? '').toUpperCase();
  return getCurrencyMeta(raw)?.code ?? null;
}

function localAccountKind(account: PlaidAccount): 'chequing' | 'savings' | 'credit' {
  if (account.type === 'credit' || account.subtype?.toLowerCase().includes('credit')) return 'credit';
  if (account.type === 'depository' && account.subtype?.toLowerCase().includes('saving')) return 'savings';
  return 'chequing';
}

function localPlaidAccountId(plaidAccountId: string) {
  return `plaid-${plaidAccountId}`;
}

function localPlaidTransactionId(accountId: string, plaidTransactionId: string) {
  return `plaid-${accountId}-${plaidTransactionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`;
}

async function enqueuePlaidSync(env: Env, itemId: string) {
  if (!env.SYNC_QUEUE) return false;
  await env.SYNC_QUEUE.send({ type: 'plaid-sync', itemId } satisfies PlaidQueueMessage);
  return true;
}

async function enqueuePlaidRecurringSync(env: Env, itemId: string) {
  if (!env.SYNC_QUEUE) return false;
  await requestRecurringSync(env.DB, env.SYNC_QUEUE, itemId);
  return true;
}

export function buildPlaidLinkTokenPayload(env: Pick<Env, 'PLAID_CLIENT_USER_ID' | 'PLAID_ENV' | 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>) {
  const webhook = linkTokenWebhookUrl(env);
  return {
    client_name: 'Border Ledger',
    user: { client_user_id: env.PLAID_CLIENT_USER_ID ?? 'border-ledger-owner' },
    products: ['transactions'],
    transactions: { days_requested: 730 },
    country_codes: ['CA'],
    language: 'en',
    account_filters: {
      depository: { account_subtypes: ['checking', 'savings'] },
      credit: { account_subtypes: ['credit card'] },
    },
    ...(webhook ? { webhook } : {}),
  };
}

async function handleCreateLinkToken(request: Request, env: Env) {
  plaidConfig(env);
  const response = await plaidPost<PlaidLinkTokenResponse>(env, '/link/token/create', buildPlaidLinkTokenPayload(env));
  return json({ link_token: response.link_token });
}

async function institutionNameFor(env: Env, institutionId: string | null | undefined, fallback: string) {
  if (!institutionId) return fallback;
  try {
    const response = await plaidPost<PlaidInstitutionResponse>(env, '/institutions/get_by_id', {
      institution_id: institutionId,
      country_codes: ['CA'],
    });
    return response.institution?.name ?? fallback;
  } catch (error) {
    console.warn('plaid_institution_lookup_failed', error instanceof PlaidApiError ? error.code : 'unknown');
    return fallback;
  }
}

async function revokePlaidAccessToken(env: Env, accessToken: string) {
  try {
    await plaidPostWithAccessToken(env, '/item/remove', accessToken, {});
  } catch (error) {
    console.warn('plaid_item_cleanup_failed', error instanceof PlaidApiError ? error.code : 'unknown');
  }
}

async function handlePlaidExchange(request: Request, env: Env) {
  const body = await readJsonBody<unknown>(request, 32 * 1024);
  const input = validatePlaidExchangeInput(body);
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const tokenKey = encryptionKey(env);
  const exchange = await plaidPost<PlaidExchangeResponse>(env, '/item/public_token/exchange', { public_token: input.publicToken });
  const itemResponse = await plaidPostWithAccessToken<PlaidItemResponse>(env, '/item/get', exchange.access_token, {});
  const accountsResponse = await plaidPostWithAccessToken<PlaidAccountsResponse>(env, '/accounts/get', exchange.access_token, {});
  const selectedAccounts = selectPlaidAccounts(accountsResponse.accounts ?? [], input.accountIds);
  if (!selectedAccounts) {
    await revokePlaidAccessToken(env, exchange.access_token);
    return json({ error: 'One or more selected accounts are no longer available from Plaid.' }, { status: 400 });
  }
  const supportedAccounts = selectedAccounts.filter((account) => plaidAccountCurrency(account));
  if (supportedAccounts.length === 0) {
    await revokePlaidAccessToken(env, exchange.access_token);
    return json({ error: 'Choose at least one registered currency account.' }, { status: 400 });
  }
  const item = itemResponse.item;
  const itemId = exchange.item_id || item?.item_id;
  if (!itemId) throw new PlaidApiError(502, 'PLAID_ITEM_ID_MISSING');

  const fallbackInstitution = item?.institution_name ?? item?.institution_id ?? 'Plaid institution';
  const institutionName = await institutionNameFor(env, item?.institution_id, fallbackInstitution);
  const sealed = await encryptAccessToken(exchange.access_token, tokenKey);
  const statements: D1Statement[] = [
    env.DB.prepare(`INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_id, institution_name)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        access_token_ciphertext = excluded.access_token_ciphertext,
        access_token_iv = excluded.access_token_iv,
        institution_id = excluded.institution_id,
        institution_name = excluded.institution_name,
        updated_at = CURRENT_TIMESTAMP`).bind(itemId, sealed.ciphertext, sealed.iv, item?.institution_id ?? null, institutionName),
    env.DB.prepare(`INSERT INTO recurring_sync_state (item_id, lifecycle, scope_version)
      VALUES (?, 'active', 0)
      ON CONFLICT(item_id) DO UPDATE SET lifecycle = 'active', updated_at = CURRENT_TIMESTAMP`).bind(itemId),
  ];
  const returnedAccounts: Array<{ id: string; name: string; currency: Currency; kind: string }> = [];

  for (const account of supportedAccounts) {
    const currency = plaidAccountCurrency(account);
    if (!currency) continue;
    const accountId = localPlaidAccountId(account.account_id);
    const kind = localAccountKind(account);
    statements.push(env.DB.prepare(`INSERT INTO accounts (id, name, institution, currency, kind, status, last_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        institution = excluded.institution,
        currency = excluded.currency,
        kind = excluded.kind,
        status = excluded.status`).bind(accountId, account.name, institutionName, currency, kind, 'connected', null));
    statements.push(env.DB.prepare(`INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name, mask, subtype)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(plaid_account_id) DO UPDATE SET
        item_id = excluded.item_id,
        account_id = excluded.account_id,
        name = excluded.name,
        mask = excluded.mask,
        subtype = excluded.subtype`).bind(account.account_id, itemId, accountId, account.name, account.mask ?? null, account.subtype ?? null));
    returnedAccounts.push({ id: accountId, name: account.name, currency, kind });
  }

  await env.DB.batch(statements);
  const queued = await enqueuePlaidSync(env, itemId);
  return json({ itemId, institution: institutionName, accounts: returnedAccounts, queued }, { status: 201 });
}

async function listPlaidItemIds(env: Env, itemId?: string) {
  if (itemId) {
    const result = await env.DB.prepare('SELECT item_id FROM plaid_items WHERE item_id = ?').bind(itemId).all<{ item_id: string }>();
    return result.results.length > 0 ? [itemId] : [];
  }
  const result = await env.DB.prepare('SELECT item_id FROM plaid_items ORDER BY created_at').all<{ item_id: string }>();
  return result.results.map((row) => row.item_id);
}

async function handlePlaidSyncRequest(request: Request, env: Env) {
  const body = request.method === 'POST' ? await readJsonBody<{ itemId?: unknown; scope?: unknown }>(request, 16 * 1024) : {};
  const itemId = typeof body.itemId === 'string' ? body.itemId : undefined;
  if (body.itemId !== undefined && !itemId) return json({ error: 'itemId must be a string.' }, { status: 400 });
  const scope = body.scope === undefined ? 'all' : body.scope;
  if (scope !== 'transactions' && scope !== 'recurring' && scope !== 'all') return json({ error: 'scope must be transactions, recurring, or all.' }, { status: 400 });
  const itemIds = await listPlaidItemIds(env, itemId);
  if (itemId && itemIds.length === 0) return json({ error: 'Plaid connection not found.' }, { status: 404 });
  const queued = [];
  const recurringQueued = [];
  for (const id of itemIds) {
    if (scope === 'transactions' || scope === 'all') {
      if (await enqueuePlaidSync(env, id)) queued.push(id);
    }
    if (scope === 'recurring' || scope === 'all') {
      if (await enqueuePlaidRecurringSync(env, id)) recurringQueued.push(id);
    }
  }
  return json({ accepted: true, itemIds, queued, recurringQueued, scope });
}

async function storedPlaidItem(env: Env, itemId: string) {
  const result = await env.DB.prepare('SELECT item_id, access_token_ciphertext, access_token_iv, institution_name FROM plaid_items WHERE item_id = ?').bind(itemId).all<StoredPlaidItem>();
  return result.results[0] ?? null;
}

async function handlePlaidDisconnect(request: Request, env: Env) {
  const body = await readJsonBody<{ itemId?: unknown }>(request, 16 * 1024);
  if (typeof body.itemId !== 'string' || body.itemId.trim().length === 0 || body.itemId.length > 160) {
    return json({ error: 'A Plaid itemId is required.' }, { status: 400 });
  }
  const itemId = body.itemId.trim();
  const item = await storedPlaidItem(env, itemId);
  if (!item) return json({ error: 'Plaid connection not found.' }, { status: 404 });

  const mappings = await env.DB.prepare('SELECT account_id FROM plaid_accounts WHERE item_id = ?').bind(itemId).all<{ account_id: string }>();
  const token = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, encryptionKey(env));

  // Fence queued recurring publications before asking Plaid to revoke the Item.
  await env.DB.prepare(`UPDATE recurring_sync_state SET lifecycle = 'disconnecting', scope_version = scope_version + 1,
    last_error = 'Disconnect requested', updated_at = CURRENT_TIMESTAMP
    WHERE item_id = ? AND lifecycle = 'active'`).bind(itemId).run();

  // Revoke Plaid's credential first. Local cleanup only runs after Plaid confirms removal.
  await plaidPostWithAccessToken(env, '/item/remove', token, {});

  const statements: D1Statement[] = [
    env.DB.prepare('DELETE FROM sync_state WHERE connection_id = ?').bind(`${PLAID_SYNC_CONNECTION_PREFIX}${itemId}`),
    env.DB.prepare('DELETE FROM recurring_sync_state WHERE item_id = ?').bind(itemId),
    env.DB.prepare('DELETE FROM plaid_accounts WHERE item_id = ?').bind(itemId),
    env.DB.prepare('DELETE FROM plaid_items WHERE item_id = ?').bind(itemId),
  ];
  for (const mapping of mappings.results) {
    statements.push(env.DB.prepare(`UPDATE accounts SET status = 'import_only', last_synced_at = NULL
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM plaid_accounts WHERE account_id = ?)`).bind(mapping.account_id, mapping.account_id));
  }
  await env.DB.batch(statements);
  return json({ disconnected: true, itemId });
}

async function syncCursor(env: Env, itemId: string) {
  const result = await env.DB.prepare('SELECT cursor FROM sync_state WHERE connection_id = ?').bind(`${PLAID_SYNC_CONNECTION_PREFIX}${itemId}`).all<{ cursor: string | null }>();
  return result.results[0]?.cursor ?? '';
}

function apiErrorCode(error: unknown) {
  return error instanceof PlaidApiError ? error.code : error instanceof Error ? error.message.slice(0, 80) : 'SYNC_FAILED';
}

async function recordSyncError(env: Env, itemId: string, error: unknown) {
  await env.DB.prepare(`INSERT INTO sync_state (connection_id, provider, cursor, last_success_at, last_error, updated_at)
    VALUES (?, 'plaid', NULL, NULL, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(connection_id) DO UPDATE SET last_error = excluded.last_error, updated_at = CURRENT_TIMESTAMP`)
    .bind(`${PLAID_SYNC_CONNECTION_PREFIX}${itemId}`, apiErrorCode(error)).run();
}

async function fetchPlaidChanges(env: Env, accessToken: string, cursor: string) {
  const fetchPage = (pageCursor: string) => plaidPostWithAccessToken<PlaidSyncPage<PlaidTransaction>>(env, '/transactions/sync', accessToken, { cursor: pageCursor, count: 500 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAllPlaidTransactions(fetchPage, cursor);
    } catch (error) {
      if (!(error instanceof PlaidApiError) || error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt === 1) throw error;
    }
  }
  throw new Error('Plaid sync could not be restarted.');
}

async function syncPlaidItem(env: Env, itemId: string) {
  const item = await storedPlaidItem(env, itemId);
  if (!item) throw new Error('Plaid connection not found.');
  const token = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, encryptionKey(env));
  const mappingsResult = await env.DB.prepare('SELECT plaid_account_id, item_id, account_id FROM plaid_accounts WHERE item_id = ?').bind(itemId).all<StoredPlaidAccount>();
  const accountIds = new Map(mappingsResult.results.map((mapping) => [mapping.plaid_account_id, mapping.account_id]));
  const cursor = await syncCursor(env, itemId);
  let changes;
  try {
    changes = await fetchPlaidChanges(env, token, cursor);
  } catch (error) {
    await recordSyncError(env, itemId, error);
    await env.DB.prepare(`UPDATE mobile_connections SET state = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE item_id = ? AND state = 'syncing'`).bind(itemId).run();
    throw error;
  }

  const statements: D1Statement[] = [];
  const changedAccountIds = new Set<string>();
  for (const transaction of [...changes.added, ...changes.modified]) {
    const accountId = accountIds.get(transaction.account_id);
    if (!accountId) continue;
    const mapped = mapPlaidTransaction(transaction, accountId, itemId);
    if (!mapped) continue;
    changedAccountIds.add(accountId);
    await upsertPlaidTransaction(env.DB, mapped);
  }

  for (const removed of changes.removed) {
    statements.push(env.DB.prepare(`DELETE FROM transactions
      WHERE plaid_item_id = ? AND (
        provider_transaction_id = ?
        OR (provider_transaction_id IS NULL AND provider_pending_transaction_id = ?)
      )`).bind(itemId, removed.transaction_id, removed.transaction_id));
  }
  for (const accountId of changedAccountIds) {
    statements.push(env.DB.prepare('UPDATE accounts SET last_synced_at = CURRENT_TIMESTAMP, status = ? WHERE id = ?').bind('connected', accountId));
  }
  statements.push(env.DB.prepare(`INSERT INTO sync_state (connection_id, provider, cursor, last_success_at, last_error, updated_at)
    VALUES (?, 'plaid', ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(connection_id) DO UPDATE SET
      cursor = excluded.cursor,
      last_success_at = excluded.last_success_at,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP`).bind(`${PLAID_SYNC_CONNECTION_PREFIX}${itemId}`, changes.nextCursor));
  statements.push(env.DB.prepare(`UPDATE mobile_connections SET state = 'connected', updated_at = CURRENT_TIMESTAMP
    WHERE item_id = ? AND state = 'syncing'`).bind(itemId));
  await env.DB.batch(statements);
  if (env.SYNC_QUEUE) await enqueuePlaidRecurringSync(env, itemId);
  return { added: changes.added.length, modified: changes.modified.length, removed: changes.removed.length, nextCursor: changes.nextCursor };
}

async function recurringState(env: Env, itemId: string) {
  const result = await env.DB.prepare(`SELECT requested_generation, scope_version, lifecycle
    FROM recurring_sync_state WHERE item_id = ?`).bind(itemId).all<{ requested_generation: number; scope_version: number; lifecycle: 'active' | 'disconnecting' | 'disconnected' }>();
  return result.results[0] ?? null;
}

async function syncPlaidRecurring(env: Env, itemId: string, requestedGeneration?: number) {
  const item = await storedPlaidItem(env, itemId);
  const state = await recurringState(env, itemId);
  if (!item || !state || state.lifecycle !== 'active') return 'disconnected' as const;
  const mappingsResult = await env.DB.prepare('SELECT plaid_account_id, account_id FROM plaid_accounts WHERE item_id = ?').bind(itemId).all<{ plaid_account_id: string; account_id: string }>();
  const accountMappings = new Map(mappingsResult.results.map((mapping) => [mapping.plaid_account_id, mapping.account_id]));
  if (accountMappings.size === 0) return 'superseded' as const;
  const token = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, encryptionKey(env));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await plaidPostWithAccessToken<PlaidRecurringResponse>(env, '/transactions/recurring/get', token, {
      account_ids: [...accountMappings.keys()],
    }, controller.signal);
    const snapshot = normalizeRecurringSnapshot(response, itemId, accountMappings);
    return await publishRecurringSnapshot(env.DB, itemId, requestedGeneration ?? state.requested_generation, state.scope_version, snapshot, new Date().toISOString());
  } catch (error) {
    await env.DB.prepare(`UPDATE recurring_sync_state SET last_error = ?, last_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE item_id = ? AND lifecycle = 'active'`).bind(apiErrorCode(error), itemId).run();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function bodySha256(body: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return bytesToBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function plaidVerificationKey(env: Env, keyId: string) {
  const cached = cachedPlaidVerificationKeys.get(keyId);
  if (cached && cached.expiresAt > Date.now()) return cached.key;
  const keyResponse = await plaidPost<PlaidVerificationKeyResponse>(env, '/webhook_verification_key/get', { key_id: keyId });
  const key = keyResponse.key as JsonWebKey;
  cachedPlaidVerificationKeys.set(keyId, { key, expiresAt: Date.now() + 5 * 60 * 1000 });
  if (cachedPlaidVerificationKeys.size > 50) {
    const oldestKey = cachedPlaidVerificationKeys.keys().next().value;
    if (oldestKey) cachedPlaidVerificationKeys.delete(oldestKey);
  }
  return key;
}

async function verifyPlaidWebhook(request: Request, env: Env): Promise<PlaidWebhookPayload | null> {
  const verification = request.headers.get('Plaid-Verification');
  if (!verification) return null;
  const body = await readRequestText(request, MAX_WEBHOOK_BODY_BYTES);
  try {
    const header = decodeProtectedHeader(verification);
    if (header.alg !== 'ES256' || typeof header.kid !== 'string') return null;
    const verified = await jwtVerify(verification, await plaidVerificationKey(env, header.kid), { algorithms: ['ES256'] });
    const issuedAt = typeof verified.payload.iat === 'number' ? verified.payload.iat : 0;
    const now = Date.now() / 1000;
    if (!issuedAt || issuedAt > now + 30 || now - issuedAt > 300) return null;
    const expectedHash = await bodySha256(body);
    if (typeof verified.payload.request_body_sha256 !== 'string' || !timingSafeEqual(verified.payload.request_body_sha256, expectedHash)) return null;
    return JSON.parse(body) as PlaidWebhookPayload;
  } catch (error) {
    console.warn('plaid_webhook_rejected', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

async function handlePlaidWebhook(request: Request, env: Env) {
  const payload = await verifyPlaidWebhook(request, env);
  if (!payload) return json({ error: 'Invalid Plaid webhook.' }, { status: 401 });
  if (payload.environment && payload.environment.toLowerCase() !== getPlaidEnvironment(env.PLAID_ENV)) {
    return json({ accepted: true, queued: false }, { status: 200 });
  }
  const knownItem = payload.item_id ? (await listPlaidItemIds(env, payload.item_id)).length > 0 : false;
  const isTransactionUpdate = payload.webhook_type === 'TRANSACTIONS';
  const isRecurringUpdate = payload.webhook_type === 'RECURRING_TRANSACTIONS' || payload.webhook_code === 'RECURRING_TRANSACTIONS_UPDATE';
  let queued = false;
  if (knownItem && payload.item_id && isTransactionUpdate) queued = await enqueuePlaidSync(env, payload.item_id);
  if (knownItem && payload.item_id && isRecurringUpdate) queued = await enqueuePlaidRecurringSync(env, payload.item_id);
  return json({ accepted: true, queued }, { status: 200 });
}

function counted(transaction: StoredTransaction, includeProvisional: boolean) {
  const statusOkay = transaction.status === 'confirmed' || (includeProvisional && transaction.status === 'provisional');
  const kindOkay = transaction.kind === 'expense' || transaction.kind === 'refund' || transaction.kind === 'fee';
  return statusOkay && kindOkay;
}

async function registeredCurrencyCodes(env: Env) {
  const result = await env.DB.prepare('SELECT code FROM currencies ORDER BY code').all<{ code: string }>();
  return result.results.map((row) => row.code);
}

function summarize(transactions: StoredTransaction[], includeProvisional: boolean, currencyCodes: readonly string[]) {
  const totals = Object.fromEntries(currencyCodes.map((code) => [code, 0])) as Record<string, number>;
  return transactions.reduce((result, transaction) => {
    if (!counted(transaction, includeProvisional)) return result;
    const amount = Math.abs(transaction.amount_minor) * (transaction.kind === 'refund' ? -1 : 1);
    result[transaction.currency] = (result[transaction.currency] ?? 0) + amount;
    return result;
  }, totals);
}

async function readTransactions(env: Env, url: URL) {
  const clauses: string[] = [`NOT (t.source = 'alert' AND EXISTS (
    SELECT 1
    FROM alert_projections superseded_alert
    WHERE superseded_alert.state = 'superseded'
      AND (superseded_alert.transaction_id = t.id OR EXISTS (
        SELECT 1
        FROM transaction_source_records alert_source
        WHERE alert_source.transaction_id = t.id
          AND alert_source.source_kind = 'alert'
          AND alert_source.event_id = superseded_alert.event_id
      ))
  ))`];
  const bindings: string[] = [];
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const currency = url.searchParams.get('currency');
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (from && !validDate(from)) throw new RequestValidationError('The from date is not valid.');
  if (to && !validDate(to)) throw new RequestValidationError('The to date is not valid.');
  if (from && to && from > to) throw new RequestValidationError('The transaction date range is not valid.');
  const currencyCodes = await registeredCurrencyCodes(env);
  if (currency && currency !== 'all' && !currencyCodes.includes(currency)) throw new RequestValidationError('The currency filter is not valid.');
  if (from) { clauses.push('t.date >= ?'); bindings.push(from); }
  if (to) { clauses.push('t.date <= ?'); bindings.push(to); }
  if (currency && currency !== 'all') { clauses.push('currency = ?'); bindings.push(currency); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const statement = env.DB.prepare(`SELECT t.* FROM transactions t ${where} ORDER BY t.date DESC, t.created_at DESC LIMIT 500`).bind(...bindings);
  const result = await statement.all<StoredTransaction>();
  return result.results;
}

async function handleImportCommit(request: Request, env: Env) {
  const body = await readJsonBody<unknown>(request, MAX_JSON_BODY_BYTES);
  const input = validateImportPayload(body);
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const fileSha256 = input.fileSha256 ?? await derivedImportFileHash(input);
  const importId = input.operationId ?? `statement-import:${fileSha256}`;
  let result: Awaited<ReturnType<typeof commitStatementRows>>;
  try {
    result = await commitStatementRows(env.DB, {
      importId,
      operationId: input.operationId,
      accountId: input.accountId,
      filename: input.filename,
      fileSha256,
      rows: input.transactions.map((transaction, rowIndex) => ({
        ...transaction,
        accountId: input.accountId,
        sourceIdentity: {
          accountId: input.accountId,
          fileSha256,
          rowIndex: transaction.sourceIdentity?.rowIndex ?? rowIndex,
          bankSourceId: transaction.sourceIdentity?.bankSourceId ?? null,
          bankRowId: transaction.sourceIdentity?.bankRowId ?? null,
        },
      })),
    });
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
    if (error instanceof ReconciliationConflictError) return json({ code: error.code, error: error.message }, { status: 409 });
    throw error;
  }
  return json(result, { status: result.duplicates === input.transactions.length ? 200 : 201 });
}

async function handleImportReview(request: Request, env: Env) {
  const body = await readJsonBody<unknown>(request, 16 * 1024);
  const input = validateAlertReviewPayload(body);
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  try {
    const result = await applyAlertReview(env.DB, input);
    return json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
    if (error instanceof ReconciliationConflictError || error instanceof ReconciliationReviewError) return json({ code: error.code, error: error.message }, { status: 409 });
    throw error;
  }
}

async function derivedImportFileHash(input: ValidatedImportPayload) {
  const canonical = JSON.stringify({
    accountId: input.accountId,
    filename: input.filename,
    transactions: input.transactions,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function handleRecurringListRequest(env: Env, url: URL) {
  const query = validateRecurringListQuery(url.searchParams);
  if ('error' in query) return json({ error: query.error }, { status: 400 });
  return json(await readRecurringPage(env.DB, query));
}

async function handleRecurringSummaryRequest(env: Env, url: URL) {
  const query = validateRecurringSummaryQuery(url.searchParams);
  if ('error' in query) return json({ error: query.error }, { status: 400 });
  return json(await readRecurringSummary(env.DB, query));
}

function recurringPathId(pathname: string) {
  const encoded = pathname.slice('/api/recurring/'.length);
  if (!encoded || encoded.includes('/')) return null;
  try {
    const id = decodeURIComponent(encoded);
    return id.length > 0 && id.length <= 256 ? id : null;
  } catch {
    return null;
  }
}

async function handleRecurringDetailRequest(env: Env, url: URL, id: string) {
  const query = validateRecurringListQuery(url.searchParams);
  if ('error' in query) return json({ error: query.error }, { status: 400 });
  const detail = await readRecurringDetail(env.DB, id, query.cursor);
  return detail ? json(detail) : json({ error: 'Recurring stream not found.' }, { status: 404 });
}

async function handleRecurringClassification(request: Request, env: Env, id: string) {
  const body = await readJsonBody<unknown>(request, 16 * 1024);
  const input = validateRecurringClassification(body);
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const updated = await setRecurringClassification(env.DB, id, input.classification);
  return updated
    ? json({ id, classification: input.classification })
    : json({ error: 'Recurring stream not found.' }, { status: 404 });
}

function validationErrorResponse(error: unknown) {
  if (error instanceof BodyTooLargeError) return json({ error: 'The request body is too large.' }, { status: 413 });
  if (error instanceof InvalidJsonBodyError) return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  if (error instanceof RequestValidationError) return json({ error: error.message }, { status: 400 });
  if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
  return null;
}

function serviceErrorResponse(error: unknown) {
  if (error instanceof PreferenceRevisionConflictError) return json({ error: error.message, currentRevision: error.currentRevision }, { status: 409 });
  if (error instanceof LunchFlowError) return json({ error: error.message }, { status: error.status });
  if (error instanceof ConfigurationError) return json({ error: 'Plaid is not fully configured on the Worker yet.' }, { status: 503 });
  if (error instanceof PlaidApiError && error.status >= 400 && error.status < 500) return json({ error: 'Plaid rejected the request. Check the connection and try again.' }, { status: 400 });
  return null;
}

function knownErrorResponse(error: unknown) {
  return validationErrorResponse(error) ?? serviceErrorResponse(error);
}

function errorResponse(error: unknown) {
  const response = knownErrorResponse(error);
  if (response) return response;
  console.error('api_error', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'The ledger could not complete that request.' }, { status: 500 });
}

function preferencesInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestValidationError('The request body is not valid.');
  const body = value as Record<string, unknown>;
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new RequestValidationError('The expectedRevision is not valid.');
  }
  return {
    expectedRevision: body.expectedRevision as number,
    reportingTimezone: body.reportingTimezone as string,
    weekStart: body.weekStart as number,
    preferredCurrency: body.preferredCurrency as CurrencyCode | null,
  };
}

async function handlePreferencesRequest(request: Request, env: Env) {
  if (request.method === 'GET') return json(await readPreferences(env.DB));
  if (request.method === 'PATCH') {
    const body = preferencesInput(await readJsonBody<unknown>(request, 16 * 1024));
    return json(await updatePreferences(env.DB, body.expectedRevision, {
      reportingTimezone: body.reportingTimezone,
      weekStart: body.weekStart,
      preferredCurrency: body.preferredCurrency,
    }));
  }
  return json({ error: 'Not found' }, { status: 404 });
}

function lunchFlowSelectionBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestValidationError('The Lunch Flow selection body is not valid.');
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.accounts)) throw new RequestValidationError('The Lunch Flow account selection is required.');
  const accounts = parseLunchFlowSelectionAccounts(body.accounts);
  if (!accounts) throw new RequestValidationError('The Lunch Flow account selection is not valid.');
  return accounts;
}

function optionalIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim();
  if (value && value.length > 256) throw new RequestValidationError('The idempotency key is not valid.');
  return value || undefined;
}

function lunchFlowQueueAccounts(value: unknown) {
  const accounts = parseLunchFlowQueueAccounts(value);
  if (!accounts) throw new LunchFlowError('invalid_queue_message', 'The Lunch Flow sync message is invalid.', 400, false);
  return accounts;
}

async function handleLunchFlowRequest(request: Request, env: Env) {
  const service = createLunchFlowService(env);
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/lunchflow/accounts') {
    const result = url.searchParams.get('status') === 'local' ? await service.readStatus() : await service.readAccounts();
    return json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  }
  if (request.method === 'POST' && url.pathname === '/api/lunchflow/account-selection') {
    const body = lunchFlowSelectionBody(await readJsonBody<unknown>(request, 32 * 1024));
    return json(await service.selectAccounts({ accounts: body, idempotencyKey: optionalIdempotencyKey(request) }), { status: 200 });
  }
  if (request.method === 'POST' && url.pathname === '/api/lunchflow/sync') {
    return json(await service.requestSync('web-owner', optionalIdempotencyKey(request)), { status: 202 });
  }
  return null;
}

type AuthorizedRouteDispatch = () => Promise<Response | null>;

async function dispatchAuthorizedRoutes(handlers: readonly AuthorizedRouteDispatch[]) {
  for (const handler of handlers) {
    const response = await handler();
    if (response) return response;
  }
  return null;
}

async function handleAccountsListRoute(_request: Request, env: Env, _url: URL) {
  const result = await env.DB.prepare(`SELECT accounts.*,
    (SELECT item_id FROM plaid_accounts WHERE account_id = accounts.id LIMIT 1) AS plaid_item_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM lunchflow_accounts WHERE account_id = accounts.id) THEN 'lunchflow'
      WHEN EXISTS (SELECT 1 FROM plaid_accounts WHERE account_id = accounts.id) THEN 'plaid'
      ELSE NULL
    END AS provider
    FROM accounts ORDER BY institution, name`).all();
  return json({ accounts: result.results });
}

async function handleTransactionsRoute(_request: Request, env: Env, url: URL) {
  return json({ transactions: await readTransactions(env, url) });
}

type AuthorizedRouteHandler = (request: Request, env: Env, url: URL) => Promise<Response | null>;

const accountRouteHandlers: ReadonlyMap<string, AuthorizedRouteHandler> = new Map([
  ['GET /api/accounts', handleAccountsListRoute],
  ['GET /api/preferences', (request, env) => handlePreferencesRequest(request, env)],
  ['PATCH /api/preferences', (request, env) => handlePreferencesRequest(request, env)],
  ['GET /api/transactions', handleTransactionsRoute],
]);

async function handleAccountRoutes(request: Request, env: Env, url: URL) {
  const handler = accountRouteHandlers.get(`${request.method} ${url.pathname}`);
  return handler ? handler(request, env, url) : null;
}

async function reportResponse(env: Env, url: URL) {
  const requestedCurrency = url.searchParams.get('currency');
  const reportingCurrency = url.searchParams.get('reportingCurrency');
  const currencyCodes = await registeredCurrencyCodes(env);
  if (requestedCurrency && requestedCurrency !== 'all' && !currencyCodes.includes(requestedCurrency)) throw new RequestValidationError('The currency filter is not valid.');
  if (reportingCurrency !== null && getCurrencyMeta(reportingCurrency) === null) throw new RequestValidationError('The reporting currency is not valid.');
  const report = await readLedgerReport(env.DB, {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    currency: requestedCurrency && requestedCurrency !== 'all' ? requestedCurrency : null,
    reportingCurrency,
    includeProvisional: url.searchParams.get('includeProvisional') === 'true',
    timeZone: url.searchParams.get('timeZone') ?? undefined,
  });
  const summary = Object.fromEntries(currencyCodes.map((code) => [code, 0])) as Record<string, number>;
  for (const total of report.currencyTotals) summary[total.currency] = total.confirmedMinorUnits + (report.includeProvisional ? total.provisionalMinorUnits : 0);
  const transactionCount = Object.values(report.sourceCoverage).reduce((count, sourceCount) => count + sourceCount, 0);
  return json({ ...report, summary, transactionCount });
}

async function handleReportRoutes(request: Request, env: Env, url: URL) {
  if (request.method !== 'GET' || url.pathname !== '/api/reports/summary') return null;
  return reportResponse(env, url);
}

const recurringRouteHandlers: ReadonlyMap<string, AuthorizedRouteHandler> = new Map([
  ['GET /api/recurring', (_request, env, url) => handleRecurringListRequest(env, url)],
  ['GET /api/recurring/summary', (_request, env, url) => handleRecurringSummaryRequest(env, url)],
]);

async function handleRecurringItemRoutes(request: Request, env: Env, url: URL) {
  if (url.pathname.startsWith('/api/recurring/') && url.pathname.endsWith('/classification') && request.method === 'PATCH') {
    const id = recurringPathId(url.pathname.slice(0, -'/classification'.length));
    return id ? handleRecurringClassification(request, env, id) : json({ error: 'Recurring stream id is not valid.' }, { status: 400 });
  }
  if (url.pathname.startsWith('/api/recurring/') && request.method === 'GET') {
    const id = recurringPathId(url.pathname);
    return id ? handleRecurringDetailRequest(env, url, id) : json({ error: 'Recurring stream id is not valid.' }, { status: 400 });
  }
  return null;
}

async function handleRecurringRoutes(request: Request, env: Env, url: URL) {
  const handler = recurringRouteHandlers.get(`${request.method} ${url.pathname}`);
  return handler ? handler(request, env, url) : handleRecurringItemRoutes(request, env, url);
}

const importAndPlaidRouteHandlers: ReadonlyMap<string, AuthorizedRouteHandler> = new Map([
  ['POST /api/imports/commit', handleImportCommit],
  ['POST /api/imports/review', handleImportReview],
  ['POST /api/plaid/link-token', handleCreateLinkToken],
  ['POST /api/plaid/exchange', handlePlaidExchange],
  ['POST /api/plaid/sync', handlePlaidSyncRequest],
  ['POST /api/plaid/disconnect', handlePlaidDisconnect],
]);

async function handleImportAndPlaidRoutes(request: Request, env: Env, url: URL) {
  const handler = importAndPlaidRouteHandlers.get(`${request.method} ${url.pathname}`);
  return handler ? handler(request, env, url) : null;
}

async function handleAuthorizedApiRequest(request: Request, env: Env, url: URL) {
  try {
    const response = await dispatchAuthorizedRoutes([
      () => handleLunchFlowRequest(request, env),
      () => handleAccountRoutes(request, env, url),
      () => handleReportRoutes(request, env, url),
      () => handleRecurringRoutes(request, env, url),
      () => handleImportAndPlaidRoutes(request, env, url),
    ]);
    return response ?? json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}

type QueueMessageBody = { type?: unknown; itemId?: unknown; generation?: unknown; accounts?: unknown };
type QueueBodyHandler = (body: QueueMessageBody, env: Env) => Promise<void>;

async function handlePlaidQueueBody(body: QueueMessageBody, env: Env) {
  if (typeof body.itemId !== 'string') return;
  await syncPlaidItem(env, body.itemId);
}

async function handlePlaidRecurringQueueBody(body: QueueMessageBody, env: Env) {
  if (typeof body.itemId !== 'string') return;
  if (typeof body.generation !== 'number') return;
  await syncPlaidRecurring(env, body.itemId, body.generation);
}

async function handleLunchFlowQueueBody(body: QueueMessageBody, env: Env) {
  await createLunchFlowService(env).sync(lunchFlowQueueAccounts(body.accounts));
}

const queueBodyHandlers: ReadonlyMap<string, QueueBodyHandler> = new Map([
  ['plaid-sync', handlePlaidQueueBody],
  ['plaid-recurring-sync', handlePlaidRecurringQueueBody],
  ['lunchflow-sync', handleLunchFlowQueueBody],
]);

async function handleQueueBody(body: QueueMessageBody, env: Env) {
  const handler = queueBodyHandlers.get(typeof body.type === 'string' ? body.type : '');
  if (handler) await handler(body, env);
}

function retryQueueMessage(message: { ack(): void; retry(): void }, error: unknown) {
  console.error('queue_message_failed', error instanceof Error ? error.name : 'unknown');
  if (error instanceof LunchFlowError && !error.retryable) message.ack();
  else message.retry();
}

async function handleQueueMessage(message: { body: unknown; ack(): void; retry(): void }, env: Env) {
  try {
    const body = message.body as QueueMessageBody;
    await handleQueueBody(body, env);
    message.ack();
  } catch (error) {
    retryQueueMessage(message, error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/.well-known/assetlinks.json') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, {
          status: 405,
          headers: { ...staticSecurityHeaders(), allow: 'GET, HEAD' },
        });
      }
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(ANDROID_ASSET_LINKS), {
        status: 200,
        headers: {
          ...staticSecurityHeaders(),
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    const isApplicationOrigin = isAllowedApplicationOrigin(request, env.LEDGER_APP_ORIGIN);
    if (!url.pathname.startsWith('/api/')) {
      if (env.LEDGER_APP_ORIGIN && !isApplicationOrigin) {
        try {
          const target = new URL(`${url.pathname}${url.search}`, env.LEDGER_APP_ORIGIN.split(',')[0]).toString();
          return Response.redirect(target, 308);
        } catch {
          return new Response('Not found', { status: 404, headers: staticSecurityHeaders() });
        }
      }
      return securedAssetResponse(await env.ASSETS.fetch(request));
    }
    if (!isApplicationOrigin) return json({ error: 'Not found' }, { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...apiSecurityHeaders(), 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,cf-access-jwt-assertion' } });
    if (url.pathname === '/api/health' && request.method === 'GET') return json({
      ok: true,
      service: 'border-ledger-api',
      deploymentRevision: env.DEPLOYMENT_REVISION ?? null,
      mobileAuthConfigured: isMobileAuthConfigured(env),
      time: new Date().toISOString(),
    });
    if (url.pathname === '/api/webhooks/plaid' && request.method === 'POST') {
      try {
        return await handlePlaidWebhook(request, env);
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname.startsWith('/api/mobile/v1/')) {
      return (await handleMobileRequest(request, env)) ?? json({ error: 'Not found' }, { status: 404 });
    }
    if (url.pathname.startsWith('/api/mobile-auth/') || url.pathname.startsWith('/api/device-pairings/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOriginMutation(request, env.LEDGER_APP_ORIGIN)) {
        return json({ error: 'A same-origin request is required.' }, { status: 403 });
      }
      return (await handleMobileRequest(request, env, await accessIdentity(request, env))) ?? json({ error: 'Not found' }, { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOriginMutation(request, env.LEDGER_APP_ORIGIN)) {
      return json({ error: 'A same-origin request is required.' }, { status: 403 });
    }
    if (!(await isAuthorized(request, env))) return json({ error: 'Ledger API access is not configured.' }, { status: 401 });

    return handleAuthorizedApiRequest(request, env, url);
  },

  async scheduled(controller: { scheduledTime: number }, env: Env) {
    const requestedDate = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    try {
      await warmFxSnapshot(env.DB, requestedDate, { now: () => new Date(controller.scheduledTime) });
    } catch (error) {
      if (!isFxProviderError(error)) throw error;
      console.error('fx_snapshot_refresh_failed', error.name);
    }
    if (env.LUNCHFLOW_API_KEY?.trim()) {
      try {
        await createLunchFlowService(env).requestSync('scheduled-sync');
      } catch (error) {
        console.error('lunchflow_schedule_failed', error instanceof Error ? error.name : 'unknown');
      }
    }
  },

  async queue(batch: { messages: Array<{ body: unknown; ack(): void; retry(): void }> }, env: Env) {
    for (const message of batch.messages) await handleQueueMessage(message, env);
  },
};
