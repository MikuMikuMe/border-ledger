import { assertFinancialAuthority, financialAuthorityGuard, immutableFinancialContext } from './financial-authority';
import { connectionPublicationStatements, plaidItemIdentifier, plaidClientUserId, readStoredPlaidItem, beginPlaidDisconnect, disconnectPublicationStatements } from './plaid-connection-store';
import { requestPlaidSync } from './plaid-jobs';
import type { LedgerContext } from './tenant-context';
import type { D1Database, D1Statement } from './db-types';
import type { OwnerContext } from './mobile-auth';
import { requireRecentOwnerApproval } from './mobile-auth';
import { buildPlaidRequest, decryptAccessToken, encryptAccessToken, getPlaidEnvironment } from './plaid';
import { getCurrencyMeta, type CurrencyCode } from '../src/domain/currencies';
import { selectPlaidAccounts } from './validation';

export const CONNECTION_PENDING_TTL_MS = 15 * 60 * 1000;
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

export function buildNativePlaidLinkTokenPayload(env: Pick<ConnectionServiceEnv, 'PLAID_CLIENT_USER_ID' | 'PLAID_ENV' | 'PLAID_ANDROID_PACKAGE_NAME' | 'PLAID_ANDROID_REDIRECT_URI' | 'PLAID_WEBHOOK_URL' | 'LEDGER_APP_ORIGIN'>, context: LedgerContext, accessToken?: string) {
  const webhookUrl = linkTokenWebhookUrl(env);
  const payload: Record<string, unknown> = {
    client_name: 'Border Ledger',
    user: { client_user_id: plaidClientUserId(context,env.PLAID_CLIENT_USER_ID) },
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

async function requestDigest(input: unknown) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
interface ConnectionOperationIdentity {kind:string;key:string;digest:string;}
async function operationReplay(env: ConnectionServiceEnv, owner: OwnerContext, identity:ConnectionOperationIdentity) {
  const {kind,key,digest}=identity;
  await assertFinancialAuthority(env.DB,owner,'connections:manage');
  const row=await env.DB.prepare(`SELECT response_json,request_digest FROM mobile_connection_operations
    WHERE ledger_id=? AND owner_subject_hash=? AND operation_kind=? AND idempotency_key=?`)
    .bind(owner.ledgerId,owner.subjectHash,kind,key).first<{response_json:string;request_digest:string|null}>();
  if(!row)return null;
  if(row.request_digest!==digest)throw new ConnectionServiceError('idempotency_conflict','The operation key was used for a different request.',409);
  await assertFinancialAuthority(env.DB,owner,'connections:manage');
  return parseJson<ConnectionOperation|null>(row.response_json,null);
}
async function rememberOperation(env:ConnectionServiceEnv,owner:OwnerContext,response:ConnectionOperation,
  publication:ConnectionOperationIdentity & {statements?:D1Statement[]}) {
  const {kind,key,digest,statements=[]}=publication;
  const guard=env.DB.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN NOT EXISTS
    (SELECT 1 FROM mobile_connection_operations WHERE ledger_id=? AND owner_subject_hash=? AND operation_kind=? AND idempotency_key=?)
    THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`).bind(owner.ledgerId,owner.subjectHash,kind,key,owner.ledgerId);
  const receipt=env.DB.prepare(`INSERT INTO mobile_connection_operations
    (id,ledger_id,owner_subject_hash,operation_kind,idempotency_key,connection_id,state,response_json,request_digest)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),owner.ledgerId,owner.subjectHash,kind,key,
      response.connectionId??response.pendingConnectionId??null,response.state,responseJson(response),digest);
  try {await env.DB.batch([financialAuthorityGuard(env.DB,owner,'connections:manage'),guard,...statements,receipt]);}
  catch(error){const replay=await operationReplay(env,owner,{kind,key,digest});if(replay)return replay;throw error;}
  await assertFinancialAuthority(env.DB,owner,'connections:manage');
  return response;
}
async function ownedConnection(env:ConnectionServiceEnv,owner:OwnerContext,id:string) {
  await assertFinancialAuthority(env.DB,owner,'connections:manage');
  const row=await env.DB.prepare('SELECT * FROM mobile_connections WHERE id=? AND ledger_id=?').bind(id,owner.ledgerId).first<MobileConnectionRow>();
  if(!row)throw new ConnectionServiceError('not_found','The connection was not found.',404);
  return row;
}
function pendingGuard(env:ConnectionServiceEnv,owner:OwnerContext,connection:MobileConnectionRow) {
  return env.DB.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN EXISTS
    (SELECT 1 FROM mobile_connections WHERE id=? AND ledger_id=? AND state='pending' AND expires_at=? AND julianday(expires_at)>julianday(?) AND julianday(expires_at)>julianday('now'))
    THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`).bind(connection.id,owner.ledgerId,connection.expires_at,now(env).toISOString(),owner.ledgerId);
}

async function providerFailure(error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : 'The provider request failed.';
  throw new ConnectionServiceError('provider_unavailable', message.slice(0, 200), 502, true);
}

interface MobileConnectionRow {
  id: string;
  owner_subject_hash: string;
  item_id: string | null;
  provider_item_id: string | null;
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

function assertExchangedItem(exchange:{access_token:string;item_id:string},itemId:string|undefined) {
  if(!exchange.access_token)throw new ConnectionServiceError('provider_invalid_response','The provider credential is missing.',502,true);
  if(!exchange.item_id)throw new ConnectionServiceError('provider_invalid_response','The provider identity is missing.',502,true);
  if(itemId!==exchange.item_id)throw new ConnectionServiceError('provider_invalid_response','The provider identity did not match.',502,true);
}
function validateSelectionIds(accountIds:string[]) {
  if(!Array.isArray(accountIds))throw new ConnectionServiceError('invalid_request','Provider accounts are required.');
  if(accountIds.length<1||accountIds.length>100)throw new ConnectionServiceError('invalid_request','Choose 1 to 100 provider accounts.');
  if(new Set(accountIds).size!==accountIds.length)throw new ConnectionServiceError('invalid_request','Provider accounts must be unique.');
}
function selectedConnectionAccounts(connection:MobileConnectionRow,accountIds:string[]) {
  validateSelectionIds(accountIds);
  const providerAccounts=parseJson<NativePlaidAccount[]>(connection.provider_accounts_json,[]);
  const selected=selectVerifiedPlaidAccounts(providerAccounts,accountIds);
  if(!selected)throw new ConnectionServiceError('account_not_verified','One or more selected accounts were not returned by the provider.',400);
  const normalized=normalizeAccounts(selected);
  if(normalized.length!==selected.length)throw new ConnectionServiceError('unsupported_accounts','Choose only registered currency accounts.');
  return {providerAccounts,normalized};
}
function assertUpdatedItem(mode:string,previous:MobileConnectionRow|null,rawItemId:string) {
  if(mode!=='update')return;
  if(previous?.provider_item_id!==rawItemId)throw new ConnectionServiceError('provider_identity_mismatch','The provider item does not match the existing connection.',409);
}
function pendingCredential(connection:MobileConnectionRow) {
  const ciphertext=connection.pending_access_token_ciphertext;const iv=connection.pending_access_token_iv;const providerItemId=connection.provider_item_id;
  if(!ciphertext||!iv)throw new ConnectionServiceError('invalid_state','The pending provider credential is unavailable.',409);
  if(!connection.item_id||!providerItemId)throw new ConnectionServiceError('invalid_state','The provider identity is unavailable.',409);
  return {ciphertext,iv,providerItemId};
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
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const mode = input.mode ?? 'create';
    let accessToken: string | undefined;
    if (mode === 'update') {
      if (!input.connectionId) throw new ConnectionServiceError('invalid_request', 'An existing connection is required for update mode.');
      const connection = await ownedConnection(env, owner, input.connectionId);
      if (connection.state !== 'connected' || !connection.item_id) throw new ConnectionServiceError('invalid_state', 'The connection is not available for reconnect.', 409);
      const item = await readStoredPlaidItem(env.DB,owner,connection.item_id);
      if (!item) throw new ConnectionServiceError('not_found', 'The provider connection was not found.', 404);
      accessToken = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, tokenKey(env));
    }
    let linkToken: string;
    try {
      const response = await provider.createLinkToken(buildNativePlaidLinkTokenPayload(env, owner, accessToken));
      linkToken = bounded(response.link_token, 'provider link token', 4096);
    } catch (error) { return providerFailure(error); }
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    return {
      operationId: crypto.randomUUID(),
      state: 'ready',
      linkToken,
      pendingConnectionId: null,
    };
  }

  async function exchangePublicToken(owner: OwnerContext, input: { publicToken: string; idempotencyKey: string; mode?: 'create' | 'update'; connectionId?: string }) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const digest=await requestDigest(input);
    const replay = await operationReplay(env,owner,{kind:'exchange',key:input.idempotencyKey,digest});
    if (replay) return replay;
    const publicToken = bounded(input.publicToken, 'publicToken', 4096);
    const mode = input.mode ?? 'create';
    if (mode === 'update' && !input.connectionId) throw new ConnectionServiceError('invalid_request', 'An existing connection is required for update mode.');
    const previous=input.connectionId?await ownedConnection(env,owner,input.connectionId):null;
    let exchange: { access_token: string; item_id: string };
    let item: { item?: { item_id: string; institution_id?: string | null; institution_name?: string | null } };
    let accounts: { accounts: NativePlaidAccount[] };
    try {
      exchange = await provider.exchangePublicToken(publicToken);
      await assertFinancialAuthority(env.DB,owner,'connections:manage');
      item = await provider.getItem(exchange.access_token);
      await assertFinancialAuthority(env.DB,owner,'connections:manage');
      accounts = await provider.getAccounts(exchange.access_token);
    } catch (error) { return providerFailure(error); }
    assertExchangedItem(exchange,item.item?.item_id);
    assertUpdatedItem(mode,previous,exchange.item_id);
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
    const itemId=await plaidItemIdentifier(owner,exchange.item_id);
    const statement=env.DB.prepare(`INSERT INTO mobile_connections
      (id,ledger_id,owner_subject_hash,provider,item_id,provider_item_id,institution_name,mode,state,expires_at,
       cleanup_state,pending_access_token_ciphertext,pending_access_token_iv,provider_accounts_json)
      VALUES (?,?,?,'plaid',?,?,?,?,'pending',?,'not_required',?,?,?)`)
      .bind(id,owner.ledgerId,owner.subjectHash,itemId,exchange.item_id,response.institution,mode,expiresAt,sealed.ciphertext,sealed.iv,JSON.stringify(providerAccounts));
    return rememberOperation(env,owner,response,{kind:'exchange',key:input.idempotencyKey,digest,statements:[statement]});
  }

  async function selectPendingAccounts(owner: OwnerContext, input: { pendingConnectionId: string; accountIds: string[]; idempotencyKey: string }) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const digest=await requestDigest(input);
    const replay = await operationReplay(env,owner,{kind:'account-selection',key:input.idempotencyKey,digest});
    if (replay) return replay;
    const connection = await ownedConnection(env, owner, input.pendingConnectionId);
    if (connection.state !== 'pending') throw new ConnectionServiceError('invalid_state', 'The pending connection is no longer selectable.', 409);
    const expiry = connection.expires_at ? Date.parse(connection.expires_at) : 0;
    if (!expiry || expiry <= now(env).getTime()) {
      const cleanup=await cleanupPending(owner,connection);
      await env.DB.batch([financialAuthorityGuard(env.DB,owner,'connections:manage'),...cleanup.statements]);
      throw new ConnectionServiceError('expired', 'The pending connection has expired.', 409);
    }
    const {providerAccounts,normalized}=selectedConnectionAccounts(connection,input.accountIds);
    const credential=pendingCredential(connection);
    const publication=await connectionPublicationStatements(env.DB,owner,{
      ...credential,institution:connection.institution_name??'Plaid institution',
      accounts:normalized,
    });
    const statements=[pendingGuard(env,owner,connection),...publication.statements];
    const response: ConnectionOperation = {
      operationId: crypto.randomUUID(),
      state: 'connected',
      connectionId: connection.id,
      institution: connection.institution_name ?? 'Plaid institution',
      accounts: normalized,
    };
    statements.push(env.DB.prepare(`UPDATE mobile_connections SET state = 'connected', expires_at = NULL,
      selected_account_ids_json = ?, pending_access_token_ciphertext = NULL, pending_access_token_iv = NULL,
      provider_accounts_json = ?, cleanup_state = 'not_required', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ledger_id = ?`)
      .bind(JSON.stringify(input.accountIds), JSON.stringify(providerAccounts), connection.id,owner.ledgerId));
    return rememberOperation(env,owner,response,{kind:'account-selection',key:input.idempotencyKey,digest,statements});
  }

  async function cleanupPending(owner:OwnerContext,connection:MobileConnectionRow) {
    await env.DB.batch([financialAuthorityGuard(env.DB,owner,'connections:manage'),
      env.DB.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN EXISTS
        (SELECT 1 FROM mobile_connections WHERE id=? AND ledger_id=? AND state IN ('pending','canceled'))
        THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`).bind(connection.id,owner.ledgerId,owner.ledgerId),
      env.DB.prepare("UPDATE mobile_connections SET state='canceled',cleanup_state='pending' WHERE id=? AND ledger_id=?").bind(connection.id,owner.ledgerId)]);
    try {
      if(connection.pending_access_token_ciphertext && connection.pending_access_token_iv){
        const token=await decryptAccessToken({ciphertext:connection.pending_access_token_ciphertext,iv:connection.pending_access_token_iv},tokenKey(env));
        await assertFinancialAuthority(env.DB,owner,'connections:manage');await provider.removeItem(token);
      }
    } catch {
      return {cleanupState:'uncertain' as const,statements:[env.DB.prepare(`UPDATE mobile_connections
        SET cleanup_state='uncertain',cleanup_attempts=cleanup_attempts+1,last_cleanup_error='Provider cleanup failed.',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND ledger_id=? AND state='canceled'`).bind(connection.id,owner.ledgerId)]};
    }
    return {cleanupState:'succeeded' as const,statements:[env.DB.prepare("DELETE FROM mobile_connections WHERE id=? AND ledger_id=? AND state='canceled'").bind(connection.id,owner.ledgerId)]};
  }

  async function cancelPending(owner: OwnerContext, pendingConnectionId: string, idempotencyKey: string) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const digest=await requestDigest({pendingConnectionId});
    const replay = await operationReplay(env,owner,{kind:'cancel',key:idempotencyKey,digest});
    if (replay) return replay;
    const connection = await ownedConnection(env, owner, pendingConnectionId);
    if (connection.state === 'connected') throw new ConnectionServiceError('invalid_state', 'A confirmed connection cannot be canceled as pending.', 409);
    const {cleanupState,statements} = await cleanupPending(owner, connection);
    const response: ConnectionOperation = { operationId: crypto.randomUUID(), state: 'canceled', pendingConnectionId, cleanupState };
    return rememberOperation(env,owner,response,{kind:'cancel',key:idempotencyKey,digest,statements});
  }

  async function requestSync(owner:OwnerContext,idempotencyKey:string) {
    owner=immutableFinancialContext(owner);
    const digest=await requestDigest({});
    const replay=await operationReplay(env,owner,{kind:'sync',key:idempotencyKey,digest});if(replay)return replay;
    const rows=await env.DB.prepare(`SELECT DISTINCT p.item_id FROM plaid_items p JOIN sync_state s
      ON s.connection_id='plaid:'||p.item_id AND s.ledger_id=p.ledger_id WHERE p.ledger_id=? AND s.lifecycle='active'`)
      .bind(owner.ledgerId).all<{item_id:string}>();
    let queued=false;
    for(const row of rows.results)queued=await requestPlaidSync(env.DB,owner,env.SYNC_QUEUE,row.item_id)||queued;
    const response:ConnectionOperation={operationId:crypto.randomUUID(),state:rows.results.length?'syncing':'ready',queued};
    return rememberOperation(env,owner,response,{kind:'sync',key:idempotencyKey,digest});
  }

  async function disconnect(owner: OwnerContext, connectionId: string, idempotencyKey: string, confirmed: boolean) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const digest=await requestDigest({connectionId,confirmed});
    const replay = await operationReplay(env,owner,{kind:'disconnect',key:idempotencyKey,digest});
    if (replay) return replay;
    if (!confirmed) throw new ConnectionServiceError('confirmation_required', 'Explicit native disconnect confirmation is required.', 400);
    const family = await env.DB.prepare('SELECT created_at FROM owner_session_families WHERE id = ? AND ledger_id = ? AND subject_hash = ?')
      .bind(owner.familyId, owner.ledgerId, owner.subjectHash).first<{ created_at: string }>();
    if (!family) throw new ConnectionServiceError('recent_approval_required', 'A recent owner approval is required.', 403);
    requireRecentOwnerApproval(family.created_at, { now: () => now(env) });
    const connection = await ownedConnection(env, owner, connectionId);
    if (connection.state === 'canceled') return { operationId: crypto.randomUUID(), state: 'canceled', connectionId } satisfies ConnectionOperation;
    if (!connection.item_id) throw new ConnectionServiceError('invalid_state', 'The connection has no provider Item.', 409);
    const item=await readStoredPlaidItem(env.DB,owner,connection.item_id);
    if(!item)throw new ConnectionServiceError('not_found','The provider credential was not found.',404);
    const fence=await beginPlaidDisconnect(env.DB,owner,connection.item_id);
    if(!fence)throw new ConnectionServiceError('not_found','The provider connection was not found.',404);
    let token: string;
    try {
      token = await decryptAccessToken({ ciphertext: item.access_token_ciphertext, iv: item.access_token_iv }, tokenKey(env));
      await assertFinancialAuthority(env.DB,owner,'connections:manage');
      await provider.removeItem(token);
    } catch (error) {
      throw new ConnectionServiceError('provider_revoke_failed', error instanceof Error ? error.message.slice(0, 200) : 'Provider revocation failed.', 502, true);
    }
    const statements=disconnectPublicationStatements(env.DB,owner,connection.item_id,fence.revision);
    const response:ConnectionOperation={operationId:crypto.randomUUID(),state:'canceled',connectionId};
    return rememberOperation(env,owner,response,{kind:'disconnect',key:idempotencyKey,digest,statements});
  }

  async function readConnections(owner: OwnerContext) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
    const rows = await env.DB.prepare(`SELECT c.id, c.item_id, c.institution_name, c.state, c.expires_at, c.cleanup_state,
      c.last_cleanup_error, s.last_success_at, s.last_error
      FROM mobile_connections c LEFT JOIN sync_state s ON s.connection_id = ? || c.item_id AND s.ledger_id=c.ledger_id
      WHERE c.ledger_id = ? AND c.state != 'canceled' ORDER BY c.created_at`)
      .bind(SYNC_CONNECTION_PREFIX, owner.ledgerId).all<{
        id: string; item_id: string | null; institution_name: string | null; state: MobileConnectionRow['state']; expires_at: string | null;
        cleanup_state: MobileConnectionRow['cleanup_state']; last_cleanup_error: string | null; last_success_at: string | null; last_error: string | null;
      }>();
    await assertFinancialAuthority(env.DB,owner,'connections:manage');
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

  async function listAccounts(owner:OwnerContext,limit = 50, cursor?: string) {
    owner=immutableFinancialContext(owner);
    await assertFinancialAuthority(env.DB,owner,'ledger:read');
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await env.DB.prepare(`SELECT a.id, a.name, a.institution, a.kind, a.status, a.currency AS default_currency,
      a.last_synced_at, GROUP_CONCAT(DISTINCT ac.currency) AS allowed_currencies
      FROM accounts a LEFT JOIN account_currencies ac ON ac.account_id = a.id AND ac.ledger_id=a.ledger_id
      WHERE a.ledger_id=? AND a.id > COALESCE(?, '') GROUP BY a.id ORDER BY a.id LIMIT ?`).bind(owner.ledgerId,cursor ?? null, boundedLimit + 1).all<{
        id: string; name: string; institution: string; kind: string; status: string; default_currency: CurrencyCode; last_synced_at: string | null; allowed_currencies: string | null;
      }>();
    await assertFinancialAuthority(env.DB,owner,'ledger:read');
    const page = rows.results.slice(0, boundedLimit);
    return {
      accounts: page.map((row) => ({ id: row.id, name: row.name, institution: row.institution, kind: row.kind, status: row.status, defaultCurrency: row.default_currency, allowedCurrencies: (row.allowed_currencies ?? row.default_currency).split(','), lastSyncedAt: row.last_synced_at })),
      nextCursor: rows.results.length > boundedLimit ? page.at(-1)?.id ?? null : null,
      limit: boundedLimit,
    };
  }

  return { createLinkToken, exchangePublicToken, selectPendingAccounts, cancelPending, requestSync, disconnect, readConnections, listAccounts };
}

