import type { D1Database, D1Statement } from './db-types';
import type { OwnerContext } from './mobile-auth';
import { requireRecentOwnerApproval } from './mobile-auth';
import { buildPlaidRequest, decryptAccessToken, encryptAccessToken, getPlaidEnvironment } from './plaid';
import { getCurrencyMeta, type CurrencyCode } from '../src/domain/currencies';
import { selectPlaidAccounts } from './validation';

export const CONNECTION_PENDING_TTL_MS = 15 * 60 * 1000;
const RECENT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const SYNC_CONNECTION_PREFIX = 'plaid:';

export interface ConnectionServiceEnv {
  DB: D1Database;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_USER_ID?: string;
  PLAID_WEBHOOK_URL?: string;
  PLAID_ANDROID_PACKAGE_NAME?: string;
  PLAID_ANDROID_REDIRECT_URI?: string;
  LEDGER_APP_ORIGIN?: string;
  SYNC_QUEUE?: { send(message: unknown): Promise<void> };
  now?: () => Date;
}

export interface NativePlaidAccount {
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

export interface NativeConnectionAccount {
  providerAccountId: string;
  name: string;
  mask: string | null;
  subtype: string | null;
  currency: CurrencyCode;
  kind: 'chequing' | 'savings' | 'credit';
}

export interface ConnectionOperation {
  operationId: string;
  state: 'pending' | 'ready' | 'syncing' | 'connected' | 'canceled' | 'failed';
  linkToken?: string;
  pendingConnectionId?: string | null;
  connectionId?: string;
  institution?: string;
  expiresAt?: string;
  queued?: boolean;
  accounts?: NativeConnectionAccount[];
  cleanupState?: 'not_required' | 'pending' | 'succeeded' | 'uncertain';
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface PlaidProvider {
  createLinkToken(payload: Record<string, unknown>): Promise<{ link_token: string }>;
  exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string }>;
  getItem(accessToken: string): Promise<{ item?: { item_id: string; institution_id?: string | null; institution_name?: string | null } }>;
  getAccounts(accessToken: string): Promise<{ accounts: NativePlaidAccount[] }>;
  removeItem(accessToken: string): Promise<void>;
}

export class ConnectionServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

function now(env: ConnectionServiceEnv) {
  return env.now?.() ?? new Date();
}

function isoAfter(at: Date, milliseconds: number) {
  return new Date(at.getTime() + milliseconds).toISOString();
}

function bounded(value: unknown, name: string, max: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ConnectionServiceError('invalid_request', `The ${name} is not valid.`);
  return value;
}

function tokenKey(env: ConnectionServiceEnv) {
  if (!env.PLAID_ENCRYPTION_KEY) throw new ConnectionServiceError('configuration', 'Plaid token encryption is not configured.', 503, true);
  return env.PLAID_ENCRYPTION_KEY;
}

function plaidConfig(env: ConnectionServiceEnv) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) throw new ConnectionServiceError('configuration', 'Plaid credentials are not configured.', 503, true);
  return { environment: getPlaidEnvironment(env.PLAID_ENV), clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET };
}

function webhook(env: Pick<ConnectionServiceEnv, 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>) {
  if (!env.PLAID_WEBHOOK_URL) {
    throw new ConnectionServiceError('configuration', 'The Plaid webhook URL is not configured.', 503, true);
  }
  try {
    const url = new URL(env.PLAID_WEBHOOK_URL);
    if (url.protocol !== 'https:' || url.pathname !== '/api/webhooks/plaid' || url.search || url.hash) throw new Error('invalid');
    if (env.LEDGER_APP_ORIGIN && url.origin !== new URL(env.LEDGER_APP_ORIGIN.split(',')[0]).origin) throw new Error('origin');
    return url.toString();
  } catch {
    throw new ConnectionServiceError('configuration', 'The Plaid webhook URL is not valid.', 503, true);
  }
}

function linkTokenWebhookUrl(env: Pick<ConnectionServiceEnv, 'PLAID_ENV' | 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>) {
  if (env.PLAID_ENV === 'sandbox' && !env.PLAID_WEBHOOK_URL) return undefined;
  return webhook(env);
}

export function buildNativePlaidLinkTokenPayload(env: Pick<ConnectionServiceEnv, 'PLAID_CLIENT_USER_ID' | 'PLAID_ENV' | 'PLAID_ANDROID_PACKAGE_NAME' | 'PLAID_ANDROID_REDIRECT_URI' | 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>, accessToken?: string) {
  const webhookUrl = linkTokenWebhookUrl(env);
  const payload: Record<string, unknown> = {
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
  };
  if (webhookUrl) payload.webhook = webhookUrl;
  if (env.PLAID_ANDROID_PACKAGE_NAME) payload.android_package_name = env.PLAID_ANDROID_PACKAGE_NAME;
  if (env.PLAID_ANDROID_REDIRECT_URI) payload.redirect_uri = env.PLAID_ANDROID_REDIRECT_URI;
  if (accessToken) payload.access_token = accessToken;
  return payload;
}

function accountCurrency(account: NativePlaidAccount): CurrencyCode | null {
  const value = (account.balances?.iso_currency_code ?? account.balances?.unofficial_currency_code ?? '').toUpperCase();
  return getCurrencyMeta(value)?.code ?? null;
}

function accountKind(account: NativePlaidAccount): NativeConnectionAccount['kind'] {
  if (account.type === 'credit' || account.subtype?.toLowerCase().includes('credit')) return 'credit';
  if (account.subtype?.toLowerCase().includes('saving')) return 'savings';
  return 'chequing';
}

export function selectVerifiedPlaidAccounts(accounts: NativePlaidAccount[], selectedIds: string[]) {
  return selectPlaidAccounts(accounts, selectedIds);
}

function normalizeAccounts(accounts: NativePlaidAccount[]) {
  return accounts.flatMap((account) => {
    const currency = accountCurrency(account);
    if (!currency) return [];
    return [{
      providerAccountId: account.account_id,
      name: account.name,
      mask: account.mask ?? null,
      subtype: account.subtype ?? null,
      currency,
      kind: accountKind(account),
    } satisfies NativeConnectionAccount];
  });
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function responseJson(response: ConnectionOperation) {
  return JSON.stringify(response);
}

async function operationReplay(env: ConnectionServiceEnv, owner: OwnerContext, kind: string, key: string) {
  const row = await env.DB.prepare(`SELECT response_json FROM mobile_connection_operations
    WHERE ledger_id = 'personal' AND owner_subject_hash = ? AND operation_kind = ? AND idempotency_key = ?`)
    .bind(owner.subjectHash, kind, key).first<{ response_json: string }>();
  return row ? parseJson<ConnectionOperation | null>(row.response_json, null) : null;
}

async function rememberOperation(env: ConnectionServiceEnv, owner: OwnerContext, kind: string, key: string, response: ConnectionOperation, connectionId?: string) {
  await env.DB.prepare(`INSERT OR IGNORE INTO mobile_connection_operations
    (id, ledger_id, owner_subject_hash, operation_kind, idempotency_key, connection_id, state, response_json)
    VALUES (?, 'personal', ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), owner.subjectHash, kind, key, connectionId ?? response.connectionId ?? response.pendingConnectionId ?? null, response.state, responseJson(response)).run();
  const replay = await operationReplay(env, owner, kind, key);
  return replay ?? response;
}

async function ownedConnection(env: ConnectionServiceEnv, owner: OwnerContext, id: string) {
  const row = await env.DB.prepare(`SELECT * FROM mobile_connections
    WHERE id = ? AND ledger_id = 'personal' AND owner_subject_hash = ?`).bind(id, owner.subjectHash).first<MobileConnectionRow>();
  if (!row) throw new ConnectionServiceError('not_found', 'The connection was not found.', 404);
  return row;
}

async function providerFailure(error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : 'The provider request failed.';
  throw new ConnectionServiceError('provider_unavailable', message.slice(0, 200), 502, true);
}

interface MobileConnectionRow {
  id: string;
  owner_subject_hash: string;
  item_id: string | null;
  institution_name: string | null;
  mode: 'create' | 'update';
  state: 'pending' | 'connected' | 'syncing' | 'canceled' | 'failed' | 'disconnecting';
  expires_at: string | null;
  cleanup_state: 'not_required' | 'pending' | 'succeeded' | 'uncertain';
  cleanup_attempts: number;
  last_cleanup_error: string | null;
  selected_account_ids_json: string;
  pending_access_token_ciphertext: string | null;
  pending_access_token_iv: string | null;
  provider_accounts_json: string;
  created_at: string;
  updated_at: string;
}

export function createPlaidProvider(env: ConnectionServiceEnv): PlaidProvider {
  const call = async <T>(path: string, body: Record<string, unknown>) => {
    const config = plaidConfig(env);
    const request = buildPlaidRequest(config.environment, path, { ...body, client_id: config.clientId, secret: config.secret });
    const response = await fetch(request);
    let payload: Record<string, unknown> = {};
    try { payload = await response.json() as Record<string, unknown>; } catch { /* provider error below */ }
    if (!response.ok) throw new Error(typeof payload.error_message === 'string' ? payload.error_message : `Plaid request failed (${response.status}).`);
    return payload as T;
  };
  return {
    createLinkToken: (payload) => call('/link/token/create', payload),
    exchangePublicToken: (publicToken) => call('/item/public_token/exchange', { public_token: publicToken }),
    getItem: (accessToken) => call('/item/get', { access_token: accessToken }),
    getAccounts: (accessToken) => call('/accounts/get', { access_token: accessToken }),
    removeItem: async (accessToken) => { await call('/item/remove', { access_token: accessToken }); },
  };
}

export function createConnectionService(env: ConnectionServiceEnv, provider: PlaidProvider = createPlaidProvider(env)) {
  async function createLinkToken(owner: OwnerContext, input: { connectionId?: string; mode?: 'create' | 'update' } = {}): Promise<ConnectionOperation> {
    const mode = input.mode ?? 'create';
    let accessToken: string | undefined;
    if (mode === 'update') {
      if (!input.connectionId) throw new ConnectionServiceError('invalid_request', 'An existing connection is required for update mode.');
      const connection = await ownedConnection(env, owner, input.connectionId);
      if (connection.state !== 'connected' || !connection.item_id) throw new ConnectionServiceError('invalid_state', 'The connection is not available for reconnect.', 409);
      const item = await env.DB.prepare('SELECT access_token_ciphertext, access_token_iv FROM plaid_items WHERE item_id = ?').bind(connection.item_id).first<{ access_token_ciphertext: string; access_token_iv: string }>();
      if (!item) throw new ConnectionServiceError('not_found', 'The provider connection was not found.', 404);
      accessToken = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, tokenKey(env));
    }
    let linkToken: string;
    try {
      const response = await provider.createLinkToken(buildNativePlaidLinkTokenPayload(env, accessToken));
      linkToken = bounded(response.link_token, 'provider link token', 4096);
    } catch (error) { return providerFailure(error); }
    return {
      operationId: crypto.randomUUID(),
      state: 'ready',
      linkToken,
      pendingConnectionId: null,
    };
  }

  async function exchangePublicToken(owner: OwnerContext, input: { publicToken: string; idempotencyKey: string; mode?: 'create' | 'update'; connectionId?: string }) {
    const replay = await operationReplay(env, owner, 'exchange', input.idempotencyKey);
    if (replay) return replay;
    const publicToken = bounded(input.publicToken, 'publicToken', 4096);
    const mode = input.mode ?? 'create';
    if (mode === 'update' && !input.connectionId) throw new ConnectionServiceError('invalid_request', 'An existing connection is required for update mode.');
    if (input.connectionId) await ownedConnection(env, owner, input.connectionId);
    let exchange: { access_token: string; item_id: string };
    let item: { item?: { item_id: string; institution_id?: string | null; institution_name?: string | null } };
    let accounts: { accounts: NativePlaidAccount[] };
    try {
      exchange = await provider.exchangePublicToken(publicToken);
      item = await provider.getItem(exchange.access_token);
      accounts = await provider.getAccounts(exchange.access_token);
    } catch (error) { return providerFailure(error); }
    if (!exchange.access_token || !exchange.item_id) throw new ConnectionServiceError('provider_invalid_response', 'The provider did not return a usable connection.', 502, true);
    const providerAccounts = accounts.accounts ?? [];
    const normalized = normalizeAccounts(providerAccounts);
    if (normalized.length === 0) {
      try { await provider.removeItem(exchange.access_token); } catch { /* cleanup remains provider-owned */ }
      throw new ConnectionServiceError('unsupported_accounts', 'Choose at least one registered currency account.', 400);
    }
    const id = crypto.randomUUID();
    const expiresAt = isoAfter(now(env), CONNECTION_PENDING_TTL_MS);
    const sealed = await encryptAccessToken(exchange.access_token, tokenKey(env));
    const response: ConnectionOperation = {
      operationId: id,
      state: 'pending',
      pendingConnectionId: id,
      institution: item.item?.institution_name ?? item.item?.institution_id ?? 'Plaid institution',
      expiresAt,
      accounts: normalized,
    };
    await env.DB.prepare(`INSERT INTO mobile_connections
      (id, ledger_id, owner_subject_hash, provider, item_id, institution_name, mode, state, expires_at,
       cleanup_state, pending_access_token_ciphertext, pending_access_token_iv, provider_accounts_json)
      VALUES (?, 'personal', ?, 'plaid', ?, ?, ?, 'pending', ?, 'not_required', ?, ?, ?)`)
      .bind(id, owner.subjectHash, exchange.item_id, response.institution, mode, expiresAt, sealed.ciphertext, sealed.iv, JSON.stringify(providerAccounts)).run();
    return rememberOperation(env, owner, 'exchange', input.idempotencyKey, response, id);
  }

  async function selectPendingAccounts(owner: OwnerContext, input: { pendingConnectionId: string; accountIds: string[]; idempotencyKey: string }) {
    const replay = await operationReplay(env, owner, 'account-selection', input.idempotencyKey);
    if (replay) return replay;
    const connection = await ownedConnection(env, owner, input.pendingConnectionId);
    if (connection.state !== 'pending') throw new ConnectionServiceError('invalid_state', 'The pending connection is no longer selectable.', 409);
    const expiry = connection.expires_at ? Date.parse(connection.expires_at) : 0;
    if (!expiry || expiry <= now(env).getTime()) {
      await cleanupPending(owner, connection);
      throw new ConnectionServiceError('expired', 'The pending connection has expired.', 409);
    }
    if (!Array.isArray(input.accountIds) || input.accountIds.length < 1 || input.accountIds.length > 100 || new Set(input.accountIds).size !== input.accountIds.length) throw new ConnectionServiceError('invalid_request', 'At least one unique provider account is required.');
    const providerAccounts = parseJson<NativePlaidAccount[]>(connection.provider_accounts_json, []);
    const selected = selectVerifiedPlaidAccounts(providerAccounts, input.accountIds);
    if (!selected) throw new ConnectionServiceError('account_not_verified', 'One or more selected accounts were not returned by the provider.', 400);
    const normalized = normalizeAccounts(selected);
    if (normalized.length !== selected.length) throw new ConnectionServiceError('unsupported_accounts', 'Choose only registered currency accounts.');
    if (!connection.pending_access_token_ciphertext || !connection.pending_access_token_iv || !connection.item_id) throw new ConnectionServiceError('invalid_state', 'The pending provider credential is unavailable.', 409);
    const statements: D1Statement[] = [
      env.DB.prepare(`INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_id, institution_name)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET access_token_ciphertext = excluded.access_token_ciphertext,
          access_token_iv = excluded.access_token_iv, institution_name = excluded.institution_name, updated_at = CURRENT_TIMESTAMP`)
        .bind(connection.item_id, connection.pending_access_token_ciphertext, connection.pending_access_token_iv, null, connection.institution_name),
      env.DB.prepare(`INSERT INTO recurring_sync_state (item_id, lifecycle, scope_version) VALUES (?, 'active', 0)
        ON CONFLICT(item_id) DO UPDATE SET lifecycle = 'active', updated_at = CURRENT_TIMESTAMP`).bind(connection.item_id),
      env.DB.prepare('DELETE FROM plaid_accounts WHERE item_id = ?').bind(connection.item_id),
    ];
    for (const account of normalized) {
      const localId = `plaid-${account.providerAccountId}`;
      statements.push(env.DB.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status, last_synced_at)
        VALUES (?, ?, ?, ?, 'single', ?, 'connected', NULL)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, institution = excluded.institution,
          currency = excluded.currency, kind = excluded.kind, status = 'connected'`)
        .bind(localId, account.name, connection.institution_name ?? 'Plaid institution', account.currency, account.kind));
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind(localId, account.currency));
      statements.push(env.DB.prepare(`INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name, mask, subtype)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(plaid_account_id) DO UPDATE SET item_id = excluded.item_id, account_id = excluded.account_id,
          name = excluded.name, mask = excluded.mask, subtype = excluded.subtype, updated_at = CURRENT_TIMESTAMP`)
        .bind(account.providerAccountId, connection.item_id, localId, account.name, account.mask, account.subtype));
    }
    const response: ConnectionOperation = {
      operationId: crypto.randomUUID(),
      state: 'connected',
      connectionId: connection.id,
      institution: connection.institution_name ?? 'Plaid institution',
      accounts: normalized,
    };
    statements.push(env.DB.prepare(`UPDATE mobile_connections SET state = 'connected', expires_at = NULL,
      selected_account_ids_json = ?, pending_access_token_ciphertext = NULL, pending_access_token_iv = NULL,
      provider_accounts_json = ?, cleanup_state = 'not_required', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(JSON.stringify(input.accountIds), JSON.stringify(providerAccounts), connection.id));
    await env.DB.batch(statements);
    return rememberOperation(env, owner, 'account-selection', input.idempotencyKey, response, connection.id);
  }

  async function cleanupPending(owner: OwnerContext, connection: MobileConnectionRow) {
    if (!connection.pending_access_token_ciphertext || !connection.pending_access_token_iv) return 'succeeded' as const;
    let token: string;
    try {
      token = await decryptAccessToken({ ciphertext: connection.pending_access_token_ciphertext, iv: connection.pending_access_token_iv }, tokenKey(env));
      await provider.removeItem(token);
    } catch (error) {
      await env.DB.prepare(`UPDATE mobile_connections SET state = 'canceled', cleanup_state = 'uncertain', cleanup_attempts = cleanup_attempts + 1,
        last_cleanup_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_subject_hash = ?`)
        .bind(error instanceof Error ? error.message.slice(0, 200) : 'Provider cleanup failed.', connection.id, owner.subjectHash).run();
      return 'uncertain' as const;
    }
    await env.DB.prepare(`DELETE FROM mobile_connections WHERE id = ? AND owner_subject_hash = ?`).bind(connection.id, owner.subjectHash).run();
    return 'succeeded' as const;
  }

  async function cancelPending(owner: OwnerContext, pendingConnectionId: string, idempotencyKey: string) {
    const replay = await operationReplay(env, owner, 'cancel', idempotencyKey);
    if (replay) return replay;
    const connection = await ownedConnection(env, owner, pendingConnectionId);
    if (connection.state === 'connected') throw new ConnectionServiceError('invalid_state', 'A confirmed connection cannot be canceled as pending.', 409);
    const cleanupState = await cleanupPending(owner, connection);
    const response: ConnectionOperation = { operationId: crypto.randomUUID(), state: 'canceled', pendingConnectionId, cleanupState };
    return rememberOperation(env, owner, 'cancel', idempotencyKey, response, pendingConnectionId);
  }

  async function requestSync(owner: OwnerContext, idempotencyKey: string) {
    const replay = await operationReplay(env, owner, 'sync', idempotencyKey);
    if (replay) return replay;
    const rows = await env.DB.prepare(`SELECT id, item_id FROM mobile_connections WHERE ledger_id = 'personal' AND owner_subject_hash = ? AND state = 'connected' ORDER BY created_at`)
      .bind(owner.subjectHash).all<{ id: string; item_id: string | null }>();
    for (const row of rows.results) {
      if (!row.item_id) continue;
      await env.DB.prepare(`UPDATE mobile_connections SET state = 'syncing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(row.id).run();
      if (env.SYNC_QUEUE) await env.SYNC_QUEUE.send({ type: 'plaid-sync', itemId: row.item_id });
    }
    const response: ConnectionOperation = { operationId: crypto.randomUUID(), state: rows.results.length > 0 ? 'syncing' : 'ready', queued: Boolean(env.SYNC_QUEUE) };
    return rememberOperation(env, owner, 'sync', idempotencyKey, response);
  }

  async function disconnect(owner: OwnerContext, connectionId: string, idempotencyKey: string, confirmed: boolean) {
    const replay = await operationReplay(env, owner, 'disconnect', idempotencyKey);
    if (replay) return replay;
    if (!confirmed) throw new ConnectionServiceError('confirmation_required', 'Explicit native disconnect confirmation is required.', 400);
    const family = await env.DB.prepare('SELECT created_at FROM owner_session_families WHERE id = ? AND ledger_id = \'personal\' AND subject_hash = ?')
      .bind(owner.familyId, owner.subjectHash).first<{ created_at: string }>();
    if (!family) throw new ConnectionServiceError('recent_approval_required', 'A recent owner approval is required.', 403);
    const approvedAt = Date.parse(family.created_at);
    if (!Number.isFinite(approvedAt) || now(env).getTime() - approvedAt > RECENT_APPROVAL_TTL_MS) throw new ConnectionServiceError('recent_approval_required', 'A recent owner approval is required.', 403);
    requireRecentOwnerApproval(family.created_at, { now: () => now(env) });
    const connection = await ownedConnection(env, owner, connectionId);
    if (connection.state === 'canceled') return { operationId: crypto.randomUUID(), state: 'canceled', connectionId } satisfies ConnectionOperation;
    if (!connection.item_id) throw new ConnectionServiceError('invalid_state', 'The connection has no provider Item.', 409);
    const item = await env.DB.prepare('SELECT access_token_ciphertext, access_token_iv FROM plaid_items WHERE item_id = ?').bind(connection.item_id).first<{ access_token_ciphertext: string; access_token_iv: string }>();
    if (!item) throw new ConnectionServiceError('not_found', 'The provider credential was not found.', 404);
    await env.DB.prepare(`UPDATE mobile_connections SET state = 'disconnecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(connection.id).run();
    let token: string;
    try {
      token = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, tokenKey(env));
      await provider.removeItem(token);
    } catch (error) {
      throw new ConnectionServiceError('provider_revoke_failed', error instanceof Error ? error.message.slice(0, 200) : 'Provider revocation failed.', 502, true);
    }
    const mappings = await env.DB.prepare('SELECT account_id FROM plaid_accounts WHERE item_id = ?').bind(connection.item_id).all<{ account_id: string }>();
    const statements: D1Statement[] = [
      env.DB.prepare('DELETE FROM sync_state WHERE connection_id = ?').bind(`${SYNC_CONNECTION_PREFIX}${connection.item_id}`),
      env.DB.prepare('DELETE FROM recurring_sync_state WHERE item_id = ?').bind(connection.item_id),
      env.DB.prepare('DELETE FROM plaid_accounts WHERE item_id = ?').bind(connection.item_id),
      env.DB.prepare('DELETE FROM plaid_items WHERE item_id = ?').bind(connection.item_id),
      env.DB.prepare(`UPDATE mobile_connections SET state = 'canceled', cleanup_state = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(connection.id),
    ];
    for (const mapping of mappings.results) statements.push(env.DB.prepare(`UPDATE accounts SET status = 'import_only', last_synced_at = NULL
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM plaid_accounts WHERE account_id = ? AND item_id != ?)`)
      .bind(mapping.account_id, mapping.account_id, connection.item_id));
    await env.DB.batch(statements);
    const response: ConnectionOperation = { operationId: crypto.randomUUID(), state: 'canceled', connectionId };
    return rememberOperation(env, owner, 'disconnect', idempotencyKey, response, connectionId);
  }

  async function readConnections(owner: OwnerContext) {
    const rows = await env.DB.prepare(`SELECT c.id, c.item_id, c.institution_name, c.state, c.expires_at, c.cleanup_state,
      c.last_cleanup_error, s.last_success_at, s.last_error
      FROM mobile_connections c LEFT JOIN sync_state s ON s.connection_id = ? || c.item_id
      WHERE c.ledger_id = 'personal' AND c.owner_subject_hash = ? AND c.state != 'canceled' ORDER BY c.created_at`)
      .bind(SYNC_CONNECTION_PREFIX, owner.subjectHash).all<{
        id: string; item_id: string | null; institution_name: string | null; state: MobileConnectionRow['state']; expires_at: string | null;
        cleanup_state: MobileConnectionRow['cleanup_state']; last_cleanup_error: string | null; last_success_at: string | null; last_error: string | null;
      }>();
    return rows.results.map((row) => ({
      connectionId: row.id,
      itemId: row.item_id,
      institution: row.institution_name,
      state: row.state === 'connected' || row.state === 'syncing' ? row.state : row.state,
      expiresAt: row.expires_at,
      cleanupState: row.cleanup_state,
      lastSyncedAt: row.last_success_at,
      lastError: row.last_error ?? row.last_cleanup_error,
    }));
  }

  async function listAccounts(limit = 50, cursor?: string) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await env.DB.prepare(`SELECT a.id, a.name, a.institution, a.kind, a.status, a.currency AS default_currency,
      a.last_synced_at, GROUP_CONCAT(DISTINCT ac.currency) AS allowed_currencies
      FROM accounts a LEFT JOIN account_currencies ac ON ac.account_id = a.id
      WHERE a.id > COALESCE(?, '') GROUP BY a.id ORDER BY a.id LIMIT ?`).bind(cursor ?? null, boundedLimit + 1).all<{
        id: string; name: string; institution: string; kind: string; status: string; default_currency: CurrencyCode; last_synced_at: string | null; allowed_currencies: string | null;
      }>();
    const page = rows.results.slice(0, boundedLimit);
    return {
      accounts: page.map((row) => ({ id: row.id, name: row.name, institution: row.institution, kind: row.kind, status: row.status, defaultCurrency: row.default_currency, allowedCurrencies: (row.allowed_currencies ?? row.default_currency).split(','), lastSyncedAt: row.last_synced_at })),
      nextCursor: rows.results.length > boundedLimit ? page.at(-1)?.id ?? null : null,
      limit: boundedLimit,
    };
  }

  return { createLinkToken, exchangePublicToken, selectPendingAccounts, cancelPending, requestSync, disconnect, readConnections, listAccounts };
}

