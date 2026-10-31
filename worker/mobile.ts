import type {AiEgressBinding} from './ai-egress';
import { handleAiApi } from './ai-http';
import { handleBudgetApi } from './budget-http';
import { handlePlanApi } from './recurring-plans-http';
import { nativeCompatibilityResponse } from './client-identity';
import { handleLunchFlowHttp } from './lunchflow-http';
import { PlaidOwnershipConflictError } from './plaid-connection-store';
import { LedgerAccessError } from './tenant-context';
import type { D1Database } from './db-types';
import {
  OWNER_SCOPES,
  MobileAuthError,
  assertAccessIdentity,
  resolveMobileIdentity,
  accessSubjectHash,
  assertHttpsCallback,
  assertCaptureEventScope,
  authorizeMobileRoute,
  authenticateOwner,
  authenticateCapture,
  hashSecret,
  isMobileAuthPath,
  revokeGrantByCapability,
  type AccessIdentity,
  type MobileAuthConfig,
  type PairVerifierContext,
} from './mobile-auth';
import { readPreferences, updatePreferences, PreferenceRevisionConflictError } from './preferences-store';
import { MobileDeviceError, issueCaptureAuthorization, readDevice, readDevices, replaceDeviceSourceConfig, revokeDevice } from './mobile-device-service';
import {
  approveOwnerLogin,
  exchangeOwnerCode,
  logoutOwnerSession,
  refreshOwnerSession,
  startOwnerLogin,
} from './mobile-owner-auth';
import {
  approvePairing,
  authenticatePairVerifier,
  claimPairing,
  startPairing,
} from './device-pairing';
import { BodyTooLargeError, InvalidJsonBodyError, apiSecurityHeaders, readJsonBody, isSameOriginMutation } from './security';
import { ALERT_EVENT_ID, AlertBatchError, ingestAlertBatch, readCaptureStatus } from './alert-ingestion';
import { MAX_ALERT_BATCH_BYTES } from './alert-store';
import { readOwnerLedgerSnapshot } from './owner-ledger-snapshot';
import { readLedgerReport } from './ledger-reports';
import { readMobileTransactionPage } from './mobile-transactions';
import {
  cancelImportForOwner,
  commitImportForOwner,
  createImportPreviewForOwner,
  decideImportDuplicateForOwner,
  MobileImportError,
  MAX_IMPORT_CHUNK_BYTES,
  stageImportChunkForOwner,
} from './mobile-import';
import { createLedgerExportResponse, MobileExportError } from './mobile-export';
import { ImportStoreError } from './import-store';
import { ConnectionServiceError, createConnectionService } from './connection-service';
import { LunchFlowError } from './lunchflow';
import {
  annotateMobileTransaction,
  applyMobileAlertReview,
  MobileReviewError,
  readMobileAlertPage,
} from './mobile-review';
import {
  classifyMobileRecurring,
  readMobileRecurringDetail,
  readMobileRecurringPage,
  readMobileRecurringSummary,
  RecurringServiceError,
} from './recurring-service';

export interface MobileRouteEnv {
  DB: D1Database;
  LEDGER_APP_ORIGIN?: string;
  MOBILE_ENVIRONMENT?: string;
  MOBILE_CALLBACK_URL?: string;
  MOBILE_ACCESS_AUTHORIZATION_URL?: string;
  MOBILE_SESSION_ENCRYPTION_KEY?: string;
  MOBILE_APPROVED_ACCESS_ISSUERS?: string;
  MOBILE_APPROVED_ACCESS_AUDIENCES?: string;
  MOBILE_APPROVED_ACCESS_SUBJECTS?: string;
  now?: () => Date;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  AI_CREDENTIAL_ENCRYPTION_KEY?: string;
  AI_ALLOWED_ENDPOINT_HOSTS?: string;
  AI_EGRESS?: AiEgressBinding;
  AI_EGRESS_AUTH_KEY?: string;
  PLAID_ENCRYPTION_KEY?: string;
  PLAID_CLIENT_USER_ID?: string;
  PLAID_WEBHOOK_URL?: string;
  PLAID_ANDROID_PACKAGE_NAME?: string;
  PLAID_ANDROID_REDIRECT_URI?: string;
  LUNCHFLOW_API_KEY?: string;
  LUNCHFLOW_CLIENT_ID?:string;
  LUNCHFLOW_CLIENT_SECRET?:string;
  LUNCHFLOW_REDIRECT_URI?:string;
  LUNCHFLOW_TOKEN_ENCRYPTION_KEY?:string;
  LUNCHFLOW_API_BASE_URL?: string;
  SYNC_QUEUE?: { send(message: unknown): Promise<void> };
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MOBILE_AUTHORIZATION_PATH = '/mobile/authorize';
const MOBILE_CALLBACK_PATH = '/android/auth/callback';

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { ...apiSecurityHeaders(), ...JSON_HEADERS, ...init.headers } });
}

function assertMobileAuthorizationUrl(value: string, canonicalOrigin: string) {
  let authorization: URL;
  let canonical: URL;
  try {
    authorization = new URL(value);
    canonical = new URL(canonicalOrigin);
  } catch {
    throw new Error('invalid mobile authorization URL');
  }
  if (
    authorization.protocol !== 'https:'
    || canonical.protocol !== 'https:'
    || authorization.origin !== canonical.origin
    || authorization.pathname !== MOBILE_AUTHORIZATION_PATH
    || authorization.search
    || authorization.hash
    || authorization.username
    || authorization.password
  ) {
    throw new Error('invalid mobile authorization URL');
  }
}

function assertMobileCallbackUrl(value: string, canonicalOrigin: string) {
  let callback: URL;
  let canonical: URL;
  try {
    callback = new URL(value);
    canonical = new URL(canonicalOrigin);
  } catch {
    throw new Error('invalid mobile callback URL');
  }
  if (
    callback.protocol !== 'https:'
    || canonical.protocol !== 'https:'
    || callback.origin !== canonical.origin
    || callback.pathname !== MOBILE_CALLBACK_PATH
    || callback.search
    || callback.hash
    || callback.username
    || callback.password
  ) {
    throw new Error('invalid mobile callback URL');
  }
}

function configFromEnv(env: MobileRouteEnv): MobileAuthConfig {
  const canonicalOrigin = env.LEDGER_APP_ORIGIN?.split(',')[0]?.trim();
  if (!canonicalOrigin || !env.MOBILE_ACCESS_AUTHORIZATION_URL || !env.MOBILE_SESSION_ENCRYPTION_KEY || env.MOBILE_SESSION_ENCRYPTION_KEY.length < 16) throw new MobileAuthError('configuration', 'Mobile authorization is not configured.', 503);
  try {
    assertMobileAuthorizationUrl(env.MOBILE_ACCESS_AUTHORIZATION_URL, canonicalOrigin);
  } catch {
    throw new MobileAuthError('configuration', 'Mobile authorization is not configured.', 503);
  }
  const callbackUrl = env.MOBILE_CALLBACK_URL ?? `${canonicalOrigin}/android/auth/callback`;
  const approvedAccessIssuers = splitEnv(env.MOBILE_APPROVED_ACCESS_ISSUERS);
  const approvedAccessAudiences = splitEnv(env.MOBILE_APPROVED_ACCESS_AUDIENCES);
  const approvedAccessSubjects = splitEnv(env.MOBILE_APPROVED_ACCESS_SUBJECTS);
  assertMobileCallbackUrl(callbackUrl, canonicalOrigin);
  assertHttpsCallback(callbackUrl, { canonicalOrigin, callbackUrl, environment: env.MOBILE_ENVIRONMENT ?? '', accessAuthorizationUrl: env.MOBILE_ACCESS_AUTHORIZATION_URL, sessionEncryptionKey: env.MOBILE_SESSION_ENCRYPTION_KEY });
  return {
    canonicalOrigin,
    callbackUrl,
    environment: env.MOBILE_ENVIRONMENT ?? 'production',
    accessAuthorizationUrl: env.MOBILE_ACCESS_AUTHORIZATION_URL,
    sessionEncryptionKey: env.MOBILE_SESSION_ENCRYPTION_KEY,
    approvedAccessIssuers,
    approvedAccessAudiences,
    approvedAccessSubjects,
    now: env.now,
  };
}

export function isMobileAuthConfigured(env: MobileRouteEnv) {
  try {
    const config = configFromEnv(env);
    return Boolean(
      config.approvedAccessIssuers?.length
      && config.approvedAccessAudiences?.length
    );
  } catch {
    return false;
  }
}

function splitEnv(value: string | undefined) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function bearer(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length <= 7) throw new MobileAuthError('unauthorized', 'A mobile bearer credential is required.');
  return header.slice(7);
}

function requestId() {
  return crypto.randomUUID();
}

function typedServiceErrorResponse(error: unknown, id: string) {
  const supported = [ConnectionServiceError, LunchFlowError, LedgerAccessError, PlaidOwnershipConflictError].some(type => error instanceof type);
  if (!supported) return null;
  const serviceError = error as ConnectionServiceError | LunchFlowError | LedgerAccessError | PlaidOwnershipConflictError;
  return json({ code: serviceError.code, message: serviceError.message, requestId: id, retryable: serviceError.retryable }, { status: serviceError.status });
}

function errorResponse(error: unknown) {
  const id = requestId();
  if (error instanceof RangeError) return json({ code: 'invalid_request', message: error.message, requestId: id, retryable: false }, { status: 400 });
  if (error instanceof BodyTooLargeError) return json({ code: 'payload_too_large', message: 'The request body is too large.', requestId: id, retryable: false }, { status: 413 });
  if (error instanceof InvalidJsonBodyError) return json({ code: 'invalid_request', message: 'The request body must be valid JSON.', requestId: id, retryable: false }, { status: 400 });
  if (error instanceof PreferenceRevisionConflictError) return json({ code: 'revision_conflict', message: error.message, currentRevision: error.currentRevision, requestId: id, retryable: false }, { status: 409 });
  if (error instanceof MobileReviewError) return json({
    code: error.code,
    message: error.message,
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    requestId: id,
    retryable: false,
  }, { status: error.status });
  if (error instanceof MobileDeviceError) return json({ code: error.code, message: error.message, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }), requestId: id, retryable: false }, { status: error.status });
  if (error instanceof AlertBatchError) return json({ code: error.code, message: error.message, requestId: id, retryable: false }, { status: error.code === 'payload_too_large' ? 413 : 400 });
  if (error instanceof MobileImportError || error instanceof MobileExportError || error instanceof ImportStoreError) return json({ code: error.code, message: error.message, requestId: id, retryable: error.retryable ?? false }, { status: error.status });
  const typedServiceResponse = typedServiceErrorResponse(error, id);
  if (typedServiceResponse) return typedServiceResponse;
  if (error instanceof RecurringServiceError) return json({
    code: error.code,
    message: error.message,
    requestId: id,
    retryable: error.retryable,
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
  }, { status: error.status });
  if (error instanceof MobileAuthError) return json({ code: error.code, message: error.message, requestId: id, retryable: error.status >= 500 }, { status: error.status });
  return json({ code: 'temporarily_unavailable', message: 'The mobile request could not be completed.', requestId: id, retryable: true }, { status: 500 });
}

function bodyRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MobileAuthError('invalid_request', 'The request body is not valid.', 400);
  return value as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string, max: number) {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new MobileAuthError('invalid_request', `The ${name} is not valid.`, 400);
  return value;
}

function optionalString(body: Record<string, unknown>, name: string, max: number) {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value.length <= max ? value : (() => { throw new MobileAuthError('invalid_request', `The ${name} is not valid.`, 400); })();
}

function requiredIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim();
  if (!value || value.length > 256) throw new MobileAuthError('invalid_request', 'An idempotency key is required.', 400);
  return value;
}

function safeIntegerField(body: Record<string, unknown>, name: string) {
  const value = body[name];
  if (!Number.isSafeInteger(value)) throw new MobileAuthError('invalid_request', `The ${name} is not a safe integer.`, 400);
  return value as number;
}

function pathId(value: string, name: string) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 256) throw new Error('bounded');
    return decoded;
  } catch {
    throw new MobileAuthError('invalid_request', `The ${name} is not valid.`, 400);
  }
}

function routeRows(body: Record<string, unknown>) {
  if (!Array.isArray(body.rows)) throw new MobileAuthError('invalid_request', 'The chunk rows are required.', 400);
  return body.rows;
}

function sourceScopes(body: Record<string, unknown>) {
  if (!Array.isArray(body.sourceScopes)) throw new MobileAuthError('invalid_request', 'Source scopes are required.', 400);
  return body.sourceScopes as Array<{ sourceProfileId: string; accountId: string; currency: string; hintKind?: string; hintValue?: string }>;
}

async function authorizedLunchFlowOwner(request:Request,env:MobileRouteEnv,config:MobileAuthConfig) {
  const owner=await authenticateOwner(bearer(request),env.DB,config,'connections:manage');
  authorizeMobileRoute(owner,new URL(request.url).pathname,'connections:manage');
  return owner;
}
async function handleLunchFlowMobileRequest(request:Request,env:MobileRouteEnv,config:MobileAuthConfig) {
  if(!new URL(request.url).pathname.startsWith('/api/mobile/v1/lunchflow/'))return null;
  return handleLunchFlowHttp(request,env,await authorizedLunchFlowOwner(request,env,config));
}

type ConnectionRouteContext = {
  request: Request;
  env: MobileRouteEnv;
  config: MobileAuthConfig;
  url: URL;
  service: ReturnType<typeof createConnectionService>;
};

type ConnectionRouteHandler = (context: ConnectionRouteContext) => Promise<Response | null>;

function connectionMode(value: string | null): 'create' | 'update' {
  const mode = value ?? 'create';
  if (!new Set(['create', 'update']).has(mode)) throw new MobileAuthError('invalid_request', 'The connection mode is not valid.', 400);
  return mode as 'create' | 'update';
}

function isProviderAccountId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 1) return false;
  return value.length <= 128;
}

function providerAccountIdList(value: unknown) {
  if (!Array.isArray(value)) throw new MobileAuthError('invalid_request', 'The selected provider accounts are not valid.', 400);
  if (value.length < 1) throw new MobileAuthError('invalid_request', 'The selected provider accounts are not valid.', 400);
  if (value.length > 100) throw new MobileAuthError('invalid_request', 'The selected provider accounts are not valid.', 400);
  return value;
}

function selectedProviderAccountIds(body: Record<string, unknown>) {
  const value = providerAccountIdList(body.accountIds);
  if (!value.every(isProviderAccountId)) throw new MobileAuthError('invalid_request', 'The selected provider accounts are not valid.', 400);
  return value as string[];
}

function accountListLimit(value: string | null) {
  const limit = Number(value ?? '50');
  if (!Number.isSafeInteger(limit)) throw new MobileAuthError('invalid_request', 'The account limit is not valid.', 400);
  if (limit < 1) throw new MobileAuthError('invalid_request', 'The account limit is not valid.', 400);
  if (limit > 100) throw new MobileAuthError('invalid_request', 'The account limit is not valid.', 400);
  return limit;
}

async function handleConnectionLinkToken(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'POST') return null;
  if (url.pathname !== '/api/mobile/v1/connections/link-tokens') return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  const mode = connectionMode(url.searchParams.get('mode'));
  const connectionId = url.searchParams.get('connectionId') ?? undefined;
  return json(await service.createLinkToken(owner, { mode, connectionId }), { status: 200 });
}

async function handleConnectionExchange(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'POST') return null;
  if (url.pathname !== '/api/mobile/v1/connections/exchanges') return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
  const mode = connectionMode(request.headers.get('x-connection-mode'));
  return json(await service.exchangePublicToken(owner, {
    publicToken: stringField(body, 'publicToken', 4096),
    idempotencyKey: requiredIdempotencyKey(request),
    mode,
    connectionId: request.headers.get('x-connection-id') ?? undefined,
  }), { status: 200 });
}

async function handleConnectionSync(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'POST') return null;
  if (url.pathname !== '/api/mobile/v1/connections/sync') return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  return json(await service.requestSync(owner, requiredIdempotencyKey(request)), { status: 202 });
}

async function handlePendingSelection(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'POST') return null;
  const match = url.pathname.match(/^\/api\/mobile\/v1\/connections\/pending\/([^/]+)\/account-selection$/);
  if (!match) return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
  const accountIds = selectedProviderAccountIds(body);
  return json(await service.selectPendingAccounts(owner, {
    pendingConnectionId: pathId(match[1], 'pendingConnectionId'),
    accountIds,
    idempotencyKey: requiredIdempotencyKey(request),
  }), { status: 200 });
}

async function handleConnectionDeleteRoutes(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'DELETE') return null;
  const pendingMatch = url.pathname.match(/^\/api\/mobile\/v1\/connections\/pending\/([^/]+)$/);
  if (pendingMatch) {
    const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
    authorizeMobileRoute(owner, url.pathname, 'connections:manage');
    const pendingId = pathId(pendingMatch[1], 'pendingConnectionId');
    await service.cancelPending(owner, pendingId, request.headers.get('idempotency-key')?.trim() || `cancel:${pendingId}`);
    return new Response(null, { status: 204, headers: apiSecurityHeaders() });
  }
  const connectionMatch = url.pathname.match(/^\/api\/mobile\/v1\/connections\/([^/]+)$/);
  if (!connectionMatch) return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  const connectionId = pathId(connectionMatch[1], 'connectionId');
  const confirmed = request.headers.get('x-confirm-disconnect') === 'true';
  await service.disconnect(owner, connectionId, request.headers.get('idempotency-key')?.trim() || `disconnect:${connectionId}`, confirmed);
  return new Response(null, { status: 204, headers: apiSecurityHeaders() });
}

async function handleAccountsList(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'GET') return null;
  if (url.pathname !== '/api/mobile/v1/accounts') return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
  authorizeMobileRoute(owner, url.pathname, 'ledger:read');
  const limit = accountListLimit(url.searchParams.get('limit'));
  return json(await service.listAccounts(owner,limit, url.searchParams.get('cursor') ?? undefined), { status: 200, headers: { 'cache-control': 'no-store' } });
}

async function handleConnectionsList(context: ConnectionRouteContext) {
  const { request, env, config, url, service } = context;
  if (request.method !== 'GET') return null;
  if (url.pathname !== '/api/mobile/v1/connections') return null;
  const owner = await authenticateOwner(bearer(request), env.DB, config, 'connections:manage');
  authorizeMobileRoute(owner, url.pathname, 'connections:manage');
  return json({ connections: await service.readConnections(owner) }, { status: 200, headers: { 'cache-control': 'no-store' } });
}

const connectionRouteHandlers: readonly ConnectionRouteHandler[] = [
  handleConnectionLinkToken,
  handleConnectionExchange,
  handleConnectionSync,
  handlePendingSelection,
  handleConnectionDeleteRoutes,
  handleAccountsList,
  handleConnectionsList,
];

async function handleConnectionMobileRequest(
  request: Request,
  env: MobileRouteEnv,
  config: MobileAuthConfig,
  url: URL,
): Promise<Response | null> {
  const context: ConnectionRouteContext = { request, env, config, url, service: createConnectionService(env) };
  for (const handler of connectionRouteHandlers) {
    const response = await handler(context);
    if (response) return response;
  }
  return null;
}

function isAccessApprovalPath(pathname: string) {
  return /^\/api\/mobile-auth\/requests\/[^/]+\/approval$/.test(pathname) || /^\/api\/device-pairings\/[^/]+\/approval$/.test(pathname);
}

async function handleMobileBudgetRequest(request:Request,env:MobileRouteEnv,config:MobileAuthConfig,url:URL) {
  const root='/api/mobile/v1/budget';
  if(url.pathname!==root && !url.pathname.startsWith(`${root}/`)) return null;
  const scope=request.method==='GET' ? 'ledger:read' : 'preferences:write';
  const owner=await authenticateOwner(bearer(request),env.DB,config,scope);
  authorizeMobileRoute(owner,url.pathname,scope);
  return handleBudgetApi(request,env.DB,owner,root);
}
async function handleMobileAiRequest(request:Request,env:MobileRouteEnv,config:MobileAuthConfig,url:URL) {
  const root='/api/mobile/v1/analysis';
  if(url.pathname!==root && !url.pathname.startsWith(`${root}/`)) return null;
  const scope=request.method==='PUT' || request.method==='DELETE' ? 'preferences:write' : 'ledger:read';
  const owner=await authenticateOwner(bearer(request),env.DB,config,scope);
  authorizeMobileRoute(owner,url.pathname,scope);
  return handleAiApi(request,{db:env.DB,context:owner,root,env:{secret:env.AI_CREDENTIAL_ENCRYPTION_KEY??'',origin:env.LEDGER_APP_ORIGIN??'',allowedHosts:env.AI_ALLOWED_ENDPOINT_HOSTS,egress:env.AI_EGRESS,egressSecret:env.AI_EGRESS_AUTH_KEY}});
}
async function handleMobilePlanRequest(request: Request, env: MobileRouteEnv, config: MobileAuthConfig, url: URL) {
  const root = '/api/mobile/v1/recurring-plans';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
  const scope = request.method === 'GET' ? 'ledger:read' : 'recurring:manage';
  const owner = await authenticateOwner(bearer(request), env.DB, config, scope);
  authorizeMobileRoute(owner, url.pathname, scope);
  return handlePlanApi(request, env.DB, owner, root);
}

export async function handleMobileRequest(request: Request, env: MobileRouteEnv, accessIdentity: AccessIdentity | null = null): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isMobileAuthPath(url.pathname)) return null;
  const compatibility = nativeCompatibilityResponse(request);
  if (compatibility) return compatibility;
  const config = configFromEnv(env);
  try {
    if (isAccessApprovalPath(url.pathname)) {
      if (request.method !== 'POST') return json({ code: 'not_found', message: 'Not found.', requestId: requestId(), retryable: false }, { status: 404 });
      if (!isSameOriginMutation(request, env.LEDGER_APP_ORIGIN)) return json({ code: 'forbidden', message: 'A same-origin request is required.', requestId: requestId(), retryable: false }, { status: 403 });
      if (!accessIdentity) throw new MobileAuthError('unauthorized', 'An approved Access identity is required.');
      assertAccessIdentity(accessIdentity, config);
      const match = url.pathname.match(/^\/api\/mobile-auth\/requests\/([^/]+)\/approval$/);
      if (match) {
        const result = await approveOwnerLogin(env.DB, {
          requestId: decodeURIComponent(match[1]),
          identity: accessIdentity,
          consent: true,
          environment: config.environment,
          callbackUrl: config.callbackUrl,
        }, config);
        return json({ approved: true, expiresAt: result.expiresAt, code: result.code, callbackUrl: result.callbackUrl }, { status: 200 });
      }
      const pairingMatch = url.pathname.match(/^\/api\/device-pairings\/([^/]+)\/approval$/);
      if (!pairingMatch) return json({ code: 'not_found', message: 'Not found.', requestId: requestId(), retryable: false }, { status: 404 });
      const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
      const subjectHash = await accessSubjectHash(accessIdentity);
      const owner = {
        ...await resolveMobileIdentity(env.DB, accessIdentity, config),
        subjectHash,
        environmentHash: await hashSecret(config.environment),
        consent: true as const,
      };
      await approvePairing(env.DB, {
        pairingId: decodeURIComponent(pairingMatch[1]),
        owner,
        environment: config.environment,
        sourceScopes: sourceScopes(body),
      }, config);
      return json({ approved: true }, { status: 200 });
    }

    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/auth/requests') {
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      const result = await startOwnerLogin(env.DB, {
        codeChallenge: stringField(body, 'codeChallenge', 128),
        state: stringField(body, 'state', 128),
        deviceId: optionalString(body, 'deviceId', 128) ?? null,
        environment: config.environment,
        callbackUrl: config.callbackUrl,
      }, config);
      return json({ requestId: result.requestId, authorizationUrl: result.authorizationUrl, expiresAt: result.expiresAt }, { status: 201 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/auth/exchanges') {
      const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
      const result = await exchangeOwnerCode(env.DB, {
        requestId: stringField(body, 'requestId', 128),
        code: stringField(body, 'code', 256),
        verifier: stringField(body, 'verifier', 128),
        state: stringField(body, 'state', 128),
        deviceId: optionalString(body, 'deviceId', 128) ?? null,
        environment: config.environment,
        callbackUrl: config.callbackUrl,
        idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
        staySignedIn: body.staySignedIn === true,
      }, config);
      return json(result, { status: 200 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/auth/refresh') {
      const result = await refreshOwnerSession(env.DB, {
        refreshToken: bearer(request),
        environment: config.environment,
        idempotencyKey: request.headers.get('idempotency-key') ?? (() => { throw new MobileAuthError('invalid_request', 'An idempotency key is required.', 400); })(),
      }, config);
      return json(result, { status: 200 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/auth/logout') {
      await logoutOwnerSession(env.DB, { accessToken: bearer(request) }, config);
      return new Response(null, { status: 204, headers: apiSecurityHeaders() });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/auth/revocations') {
      await revokeGrantByCapability(bearer(request), env.DB, config);
      return new Response(null, { status: 204, headers: apiSecurityHeaders() });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/pairings') {
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      const result = await startPairing(env.DB, {
        deviceName: stringField(body, 'deviceName', 80),
        platform: optionalString(body, 'platform', 64) ?? 'android',
        verifierChallenge: stringField(body, 'verifierChallenge', 128),
        environment: config.environment,
      }, config);
      return json(result, { status: 201 });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/preferences') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readPreferences(env.DB, owner), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/mobile/v1/preferences') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'preferences:write');
      authorizeMobileRoute(owner, url.pathname, 'preferences:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      const preferredCurrency = body.preferredCurrency === null ? null : stringField(body, 'preferredCurrency', 12);
      return json(await updatePreferences(env.DB, owner, safeIntegerField(body, 'expectedRevision'), {
        reportingTimezone: stringField(body, 'reportingTimezone', 128),
        weekStart: safeIntegerField(body, 'weekStart'),
        preferredCurrency,
      }), { status: 200 });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/devices') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'devices:manage');
      authorizeMobileRoute(owner, url.pathname, 'devices:manage');
      return json({ devices: await readDevices(env.DB, owner) }, { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    const deviceMatch = url.pathname.match(/^\/api\/mobile\/v1\/devices\/([^/]+)$/);
    if (request.method === 'GET' && deviceMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'devices:manage');
      authorizeMobileRoute(owner, url.pathname, 'devices:manage');
      return json(await readDevice(env.DB, owner, pathId(deviceMatch[1], 'deviceId')), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'DELETE' && deviceMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'devices:manage');
      authorizeMobileRoute(owner, url.pathname, 'devices:manage');
      await revokeDevice(env.DB, owner, pathId(deviceMatch[1], 'deviceId'), config);
      return new Response(null, { status: 204, headers: apiSecurityHeaders() });
    }
    if (request.method === 'PUT' && url.pathname === '/api/mobile/v1/devices/self/source-config') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'devices:manage');
      authorizeMobileRoute(owner, url.pathname, 'devices:manage');
      if (!owner.deviceId) throw new MobileDeviceError('device_required', 'The owner session is not bound to a device.', 403);
      return json(await replaceDeviceSourceConfig(env.DB, owner, owner.deviceId, await readJsonBody<unknown>(request, 32 * 1024)), { status: 200 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/devices/self/capture-authorization') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'devices:manage');
      authorizeMobileRoute(owner, url.pathname, 'devices:manage');
      return json(await issueCaptureAuthorization(env.DB, owner, await readJsonBody<unknown>(request, 32 * 1024), config), { status: 200 });
    }
    const claimMatch = url.pathname.match(/^\/api\/mobile\/v1\/pairings\/([^/]+)\/claim$/);
    if (request.method === 'POST' && claimMatch) {
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      const pairingId = decodeURIComponent(claimMatch[1]);
      const pairVerifier = await authenticatePairVerifier(bearer(request), env.DB, pairingId, config);
      authorizeMobileRoute(pairVerifier, url.pathname);
      const result = await claimPairing(env.DB, {
        pairingId,
        verifier: bearer(request),
        credentialHash: stringField(body, 'credentialHash', 64),
        environment: config.environment,
      }, config);
      return json(result, { status: result.state === 'pending' ? 202 : 200 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/imports/previews') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'imports:write');
      authorizeMobileRoute(owner, url.pathname, 'imports:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
      const format = body.format;
      if (format !== 'csv' && format !== 'verified_boc') throw new MobileAuthError('invalid_request', 'The import format is not valid.', 400);
      const result = await createImportPreviewForOwner(env.DB, owner, {
        accountId: stringField(body, 'accountId', 128),
        fileName: stringField(body, 'fileName', 255),
        fileSizeBytes: safeIntegerField(body, 'fileSizeBytes'),
        fileSha256: stringField(body, 'fileSha256', 128),
        format,
        rowCount: safeIntegerField(body, 'rowCount'),
        idempotencyKey: requiredIdempotencyKey(request),
      });
      return json(result, { status: 201 });
    }
    const chunkMatch = url.pathname.match(/^\/api\/mobile\/v1\/imports\/([^/]+)\/chunks\/(\d+)$/);
    if ((request.method === 'PUT' || request.method === 'POST') && chunkMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'imports:write');
      authorizeMobileRoute(owner, url.pathname, 'imports:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, MAX_IMPORT_CHUNK_BYTES));
      const chunkIndex = Number(chunkMatch[2]);
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 159) throw new MobileAuthError('invalid_request', 'The chunk index is not valid.', 400);
      const rows = routeRows(body);
      return json(await stageImportChunkForOwner(env.DB, owner, {
        previewId: pathId(chunkMatch[1], 'previewId'),
        chunkIndex,
        operationId: requiredIdempotencyKey(request),
        rowStart: safeIntegerField(body, 'rowStart'),
        rows,
      }), { status: 200 });
    }
    const duplicateDecisionMatch = url.pathname.match(/^\/api\/mobile\/v1\/imports\/([^/]+)\/duplicates\/([^/]+)$/);
    if (request.method === 'PATCH' && duplicateDecisionMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'imports:write');
      authorizeMobileRoute(owner, url.pathname, 'imports:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      const decision = body.decision;
      if (decision !== 'resolve' && decision !== 'keep_separate') throw new MobileAuthError('invalid_request', 'The duplicate decision is not supported.', 400);
      requiredIdempotencyKey(request);
      return json(await decideImportDuplicateForOwner(env.DB, owner, {
        previewId: pathId(duplicateDecisionMatch[1], 'previewId'),
        candidateId: pathId(duplicateDecisionMatch[2], 'candidateId'),
        expectedRevision: safeIntegerField(body, 'expectedRevision'),
        decision,
      }), { status: 200 });
    }
    const commitMatch = url.pathname.match(/^\/api\/mobile\/v1\/imports\/([^/]+)\/commit$/);
    if (request.method === 'POST' && commitMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'imports:write');
      authorizeMobileRoute(owner, url.pathname, 'imports:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, 32 * 1024));
      if (!Array.isArray(body.rowIds) || body.rowIds.length < 1 || body.rowIds.length > 500 || !body.rowIds.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 160)) {
        throw new MobileAuthError('invalid_request', 'The selected import rows are not valid.', 400);
      }
      return json(await commitImportForOwner(env.DB, owner, {
        previewId: pathId(commitMatch[1], 'previewId'),
        expectedRevision: safeIntegerField(body, 'expectedRevision'),
        rowIds: body.rowIds,
        operationId: requiredIdempotencyKey(request),
      }), { status: 200 });
    }
    const cancelMatch = url.pathname.match(/^\/api\/mobile\/v1\/imports\/([^/]+)$/);
    if (request.method === 'DELETE' && cancelMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'imports:write');
      authorizeMobileRoute(owner, url.pathname, 'imports:write');
      const body = bodyRecord(await readJsonBody<unknown>(request, 16 * 1024));
      return json(await cancelImportForOwner(env.DB, owner, {
        previewId: pathId(cancelMatch[1], 'previewId'),
        expectedRevision: safeIntegerField(body, 'expectedRevision'),
      }), { status: 200 });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/exports/transactions') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'exports:read');
      authorizeMobileRoute(owner, url.pathname, 'exports:read');
      const selection = url.searchParams.get('selection');
      if (selection !== 'all' && selection !== 'current_filter') throw new MobileAuthError('invalid_request', 'The export selection is not valid.', 400);
      return await createLedgerExportResponse(env.DB, owner, config, {
        selection,
        filters: {
          currency: url.searchParams.get('currency') ?? undefined,
          startDate: url.searchParams.get('startDate') ?? undefined,
          endDate: url.searchParams.get('endDate') ?? undefined,
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/ledger/snapshot') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readOwnerLedgerSnapshot(env.DB, owner), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    const lunchFlowResponse = await handleLunchFlowMobileRequest(request, env, config);
    if (lunchFlowResponse) return lunchFlowResponse;
    const connectionResponse = await handleMobileBudgetRequest(request, env, config, url) ?? await handleMobileAiRequest(request, env, config, url) ?? await handleMobilePlanRequest(request, env, config, url) ?? await handleConnectionMobileRequest(request, env, config, url);
    if (connectionResponse) return connectionResponse;
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/transactions') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readMobileTransactionPage(env.DB, owner, url.searchParams), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/recurring') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readMobileRecurringPage(env.DB, owner, url.searchParams), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/recurring/summary') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readMobileRecurringSummary(env.DB, owner, url.searchParams), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    const recurringClassificationMatch = url.pathname.match(/^\/api\/mobile\/v1\/recurring\/([^/]+)\/classification$/);
    if (request.method === 'PATCH' && recurringClassificationMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'recurring:classify');
      authorizeMobileRoute(owner, url.pathname, 'recurring:classify');
      const body = await readJsonBody<unknown>(request, 16 * 1024);
      return json(await classifyMobileRecurring(env.DB, owner, pathId(recurringClassificationMatch[1], 'recurringId'), body), { status: 200 });
    }
    const recurringDetailMatch = url.pathname.match(/^\/api\/mobile\/v1\/recurring\/([^/]+)$/);
    if (request.method === 'GET' && recurringDetailMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readMobileRecurringDetail(env.DB, owner, pathId(recurringDetailMatch[1], 'recurringId'), url.searchParams), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/reports/summary') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');
      if (!startDate || !endDate) throw new MobileAuthError('invalid_request', 'startDate and endDate are required.', 400);
      const report = await readLedgerReport(env.DB, owner, {
        from: startDate,
        to: endDate,
        includeProvisional: url.searchParams.get('includeProvisional') === 'true',
        currency: url.searchParams.get('currency'),
        reportingCurrency: url.searchParams.get('reportingCurrency'),
        timeZone: url.searchParams.get('timeZone') ?? undefined,
      }, { now: env.now });
      return json({
        startDate: report.from,
        endDate: report.to,
        confirmedByCurrency: Object.fromEntries(report.currencyTotals.map((row) => [row.currency, row.confirmedMinorUnits])),
        provisionalByCurrency: Object.fromEntries(report.currencyTotals.map((row) => [row.currency, row.provisionalMinorUnits])),
        checkedAt: report.asOf,
        timeBasis: report.timeBasis,
        timeZone: report.timeZone,
        dailyTotals: report.dailyTotals,
        reviewCount: report.reviewCount,
        excludedCount: report.excludedCount,
        sourceCoverage: report.sourceCoverage,
        reportingCurrency: report.reportingCurrency,
        convertedTotals: report.convertedTotals,
        convertedDailyTotals: report.convertedDailyTotals,
        fx: report.fx,
        coverageWarnings: report.reviewCount > 0 ? ['Some records need owner review and are not included in confirmed totals.'] : [],
        report,
      }, { status: 200 });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/alerts') {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:read');
      authorizeMobileRoute(owner, url.pathname, 'ledger:read');
      return json(await readMobileAlertPage(env.DB, owner, url.searchParams), { status: 200, headers: { 'cache-control': 'no-store' } });
    }
    const mobileAlertReviewMatch = url.pathname.match(/^\/api\/mobile\/v1\/alerts\/([^/]+)\/review$/);
    if (request.method === 'PATCH' && mobileAlertReviewMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:review');
      authorizeMobileRoute(owner, url.pathname, 'ledger:review');
      const body = await readJsonBody<unknown>(request, 16 * 1024);
      return json(await applyMobileAlertReview(env.DB, owner, pathId(mobileAlertReviewMatch[1], 'eventId'), body), { status: 200 });
    }
    const mobileAnnotationMatch = url.pathname.match(/^\/api\/mobile\/v1\/transactions\/([^/]+)\/annotation$/);
    if (request.method === 'PATCH' && mobileAnnotationMatch) {
      const owner = await authenticateOwner(bearer(request), env.DB, config, 'ledger:review');
      authorizeMobileRoute(owner, url.pathname, 'ledger:review');
      const body = await readJsonBody<unknown>(request, 16 * 1024);
      return json(await annotateMobileTransaction(env.DB, owner, pathId(mobileAnnotationMatch[1], 'transactionId'), body), { status: 200 });
    }
    if (request.method === 'GET' && url.pathname === '/api/mobile/v1/status') {
      const capture = await authenticateCapture(bearer(request), env.DB, config);
      authorizeMobileRoute(capture, url.pathname, 'alerts:write');
      const eventId = url.searchParams.get('eventId');
      if (eventId !== null && !ALERT_EVENT_ID.test(eventId)) throw new MobileAuthError('invalid_request', 'The event ID is not valid.', 400);
      return json(await readCaptureStatus(env.DB, capture, eventId), { status: 200 });
    }
    if (request.method === 'POST' && url.pathname === '/api/mobile/v1/alerts') {
      const capture = await authenticateCapture(bearer(request), env.DB, config);
      authorizeMobileRoute(capture, url.pathname, 'alerts:write');
      const body = await readJsonBody<unknown>(request, MAX_ALERT_BATCH_BYTES);
      return json(await ingestAlertBatch(env.DB, capture, body), { status: 200 });
    }
    return json({ code: 'not_found', message: 'Not found.', requestId: requestId(), retryable: false }, { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
}
