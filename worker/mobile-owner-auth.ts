import type { D1Database } from './db-types';
import {
  OWNER_SCOPES,
  MobileAuthError,
  assertAccessIdentity,
  assertEnvironment,
  assertHttpsCallback,
  authenticateOwner,
  constantTimeEqual,
  createOpaqueCredential,
  decryptReplayResponse,
  encryptReplayResponse,
  hashSecret,
  isoAfter,
  now,
  parseRfc3339Instant,
  pkceChallenge,
  readOpaqueCredential,
  requestDigest,
  type AccessIdentity,
  type MobileAuthConfig,
  type OwnerContext,
  type OwnerScope,
} from './mobile-auth';

const TEN_MINUTES = 10 * 60 * 1000;
const TWO_MINUTES = 2 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * DAY;
const REPLAY_TTL = 60 * 1000;
const HEX_RE = /^[A-Fa-f0-9]{64}$/;

export interface OwnerLoginStart {
  codeChallenge: string;
  state: string;
  deviceId?: string | null;
  environment?: string;
  callbackUrl?: string;
}

export interface OwnerLoginRequest {
  requestId: string;
  authorizationUrl: string;
  expiresAt: string;
  deviceId: string | null;
}

export interface OwnerApprovalInput {
  requestId: string;
  identity: AccessIdentity;
  environment?: string;
  callbackUrl?: string;
  consent: true;
}

export interface OwnerApproval {
  requestId: string;
  code: string;
  callbackUrl: string;
  expiresAt: string;
}

export interface OwnerCodeExchange {
  requestId: string;
  code: string;
  verifier: string;
  state: string;
  deviceId?: string | null;
  environment?: string;
  callbackUrl?: string;
  idempotencyKey?: string;
  staySignedIn?: boolean;
}

export interface OwnerRefreshInput {
  refreshToken: string;
  environment?: string;
  idempotencyKey: string;
}

export interface OwnerTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: readonly OwnerScope[];
  revision: number;
  revocationCapability: string;
}

interface AuthRequestRow {
  id: string;
  ledger_id: 'personal';
  device_id: string | null;
  state_hash: string;
  pkce_challenge_hash: string;
  request_digest: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  code_hash: string | null;
  code_expires_at: string | null;
  callback_origin: string | null;
  callback_path: string | null;
  environment_hash: string | null;
  approved_subject_hash: string | null;
  approved_at: string | null;
}

interface SessionFamilyRow {
  id: string;
  ledger_id: 'personal';
  subject_hash: string;
  device_id: string | null;
  access_generation: number;
  refresh_generation: number;
  access_expires_at: string;
  refresh_expires_at: string;
  stay_signed_in_until: string | null;
  revoked_at: string | null;
  scope_json: string;
  environment_hash: string;
  revocation_capability_hash: string;
  revocation_generation: number;
}

interface RefreshGenerationRow {
  family_id: string;
  generation: number;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

interface ReplayRow {
  response_ciphertext: string;
  response_iv: string;
  expires_at: string;
}

function bounded(value: string, name: string, max: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new MobileAuthError('invalid_request', `The ${name} is not valid.`, 400);
  return value;
}

function validState(value: string) {
  return bounded(value, 'state', 128).length >= 32;
}

function validChallenge(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(bounded(value, 'PKCE challenge', 128));
}

function current(config: MobileAuthConfig) {
  return now(config);
}

function expiresOrThrow(value: string | null, at: Date, message: string) {
  const expiry = value ? parseRfc3339Instant(value) : null;
  if (!expiry || expiry.getTime() <= at.getTime()) throw new MobileAuthError('expired', message, 401);
}

function responseFromJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new MobileAuthError('invalid_replay', 'The replay response is not available.', 409);
  }
}

async function readReplay(db: D1Database, requestKind: string, digest: string, at: Date, config: MobileAuthConfig) {
  const row = await db.prepare(`SELECT response_ciphertext, response_iv, expires_at
    FROM owner_replay_records WHERE ledger_id = 'personal' AND request_kind = ? AND request_digest = ? AND expires_at > ?`).bind(requestKind, digest, at.toISOString()).first<ReplayRow>();
  if (!row) return null;
  return decryptReplayResponse<OwnerTokenResponse>({ ciphertext: row.response_ciphertext, iv: row.response_iv }, config);
}

async function readAuthRequest(db: D1Database, requestId: string) {
  return db.prepare(`SELECT id, ledger_id, device_id, state_hash, pkce_challenge_hash, request_digest,
      expires_at, consumed_at, revoked_at, code_hash, code_expires_at, callback_origin, callback_path,
      environment_hash, approved_subject_hash, approved_at
    FROM mobile_auth_requests WHERE id = ?`).bind(requestId).first<AuthRequestRow>();
}

function verifyConfigUrl(config: MobileAuthConfig) {
  try {
    const url = new URL(config.accessAuthorizationUrl);
    if (url.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new MobileAuthError('configuration', 'Mobile owner authorization is not configured.', 503);
  }
}

export async function startOwnerLogin(db: D1Database, input: OwnerLoginStart, config: MobileAuthConfig): Promise<OwnerLoginRequest> {
  verifyConfigUrl(config);
  if (!validChallenge(input.codeChallenge) || !validState(input.state)) throw new MobileAuthError('invalid_request', 'The owner login challenge is not valid.', 400);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const callback = assertHttpsCallback(input.callbackUrl ?? config.callbackUrl, config);
  const requestId = crypto.randomUUID();
  const at = current(config);
  const expiresAt = isoAfter(at, TEN_MINUTES);
  const stateHash = await hashSecret(input.state);
  const pkceChallengeHash = await hashSecret(input.codeChallenge);
  const digest = await requestDigest({ flow: 'owner-login', requestId, stateHash, pkceChallengeHash, deviceId: input.deviceId ?? null, environmentHash, callback });
  await db.prepare(`INSERT INTO mobile_auth_requests
    (id, ledger_id, device_id, state_hash, pkce_challenge_hash, request_digest, expires_at,
      callback_origin, callback_path, environment_hash)
    VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    requestId,
    input.deviceId ?? null,
    stateHash,
    pkceChallengeHash,
    digest,
    expiresAt,
    callback.origin,
    callback.path,
    environmentHash,
  ).run();
  const authorization = new URL(config.accessAuthorizationUrl);
  authorization.searchParams.set('request_id', requestId);
  return { requestId, authorizationUrl: authorization.toString(), expiresAt, deviceId: input.deviceId ?? null };
}

export async function approveOwnerLogin(db: D1Database, input: OwnerApprovalInput, config: MobileAuthConfig): Promise<OwnerApproval> {
  if (input.consent !== true) throw new MobileAuthError('consent_required', 'Explicit owner approval is required.', 403);
  assertAccessIdentity(input.identity, config);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const callback = assertHttpsCallback(input.callbackUrl ?? config.callbackUrl, config);
  const at = current(config);
  const request = await readAuthRequest(db, bounded(input.requestId, 'request id', 128));
  if (!request || request.ledger_id !== 'personal' || request.revoked_at || request.consumed_at) throw new MobileAuthError('invalid_request', 'The owner login request is not available.', 400);
  expiresOrThrow(request.expires_at, at, 'The owner login request has expired.');
  if (request.environment_hash !== environmentHash || request.callback_origin !== callback.origin || request.callback_path !== callback.path) throw new MobileAuthError('environment_mismatch', 'The owner login request does not match this environment.', 400);
  const code = bytesToBase64Url(randomBytes(32));
  const codeHash = await hashSecret(code);
  const codeExpiresAt = isoAfter(at, TWO_MINUTES);
  const result = await db.prepare(`UPDATE mobile_auth_requests SET code_hash = ?, code_expires_at = ?, approved_subject_hash = ?, approved_at = ?
    WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`).bind(
    codeHash,
    codeExpiresAt,
    await hashSecret(input.identity.subject),
    at.toISOString(),
    request.id,
    at.toISOString(),
  ).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new MobileAuthError('invalid_request', 'The owner login request is no longer available.', 409);
  return { requestId: request.id, code, callbackUrl: config.callbackUrl, expiresAt: codeExpiresAt };
}

function randomBytes(length: number) {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function ownerResponse(config: MobileAuthConfig, familyId: string, generation: number, subjectHash: string, deviceId: string | null, refreshExpiresAt: string, accessExpiresAt: string, revocationCapability: string, revision: number): Promise<OwnerTokenResponse> {
  const environmentHash = await hashSecret(config.environment);
  const accessToken = await createOpaqueCredential({ kind: 'owner-access', familyId, generation, subjectHash, deviceId, expiresAt: accessExpiresAt, environmentHash }, config);
  const refreshToken = await createOpaqueCredential({ kind: 'owner-refresh', familyId, generation, expiresAt: refreshExpiresAt, environmentHash }, config);
  return { accessToken, refreshToken, expiresAt: accessExpiresAt, scopes: [...OWNER_SCOPES], revision, revocationCapability };
}

async function revocationCapability(config: MobileAuthConfig, grantId: string, generation: number, expiresAt: string) {
  return createOpaqueCredential({ kind: 'revocation', grantType: 'owner-family', grantId, generation, expiresAt, environmentHash: await hashSecret(config.environment) }, config);
}

async function atomicExchange(db: D1Database, request: AuthRequestRow, input: OwnerCodeExchange, digest: string, response: OwnerTokenResponse, config: MobileAuthConfig, at: Date, familyId: string, subjectHash: string, refreshHash: string, revocationHash: string, accessExpiresAt: string, refreshExpiresAt: string, staySignedInUntil: string | null) {
  const sealed = await encryptReplayResponse(response, config);
  const results = await db.batch([
    db.prepare(`UPDATE mobile_auth_requests SET consumed_at = ?
      WHERE id = ? AND code_hash = ? AND code_expires_at > ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(at.toISOString(), request.id, await hashSecret(input.code), at.toISOString()),
    db.prepare(`INSERT INTO owner_session_families
      (id, ledger_id, subject_hash, device_id, access_generation, refresh_generation, access_expires_at,
       refresh_expires_at, stay_signed_in_until, scope_json, environment_hash, revocation_capability_hash, revocation_generation)
      SELECT ?, 'personal', ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, 1 WHERE changes() = 1`).bind(
      familyId, subjectHash, request.device_id, accessExpiresAt, refreshExpiresAt, staySignedInUntil,
      JSON.stringify(OWNER_SCOPES), await hashSecret(config.environment), revocationHash,
    ),
    db.prepare(`INSERT INTO owner_refresh_generations (family_id, generation, token_hash, issued_at, expires_at)
      SELECT ?, 1, ?, ?, ? WHERE changes() = 1`).bind(familyId, refreshHash, at.toISOString(), refreshExpiresAt),
    db.prepare(`INSERT INTO owner_replay_records
      (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, 'personal', 'owner-exchange', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_TTL),
    ),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1;
}

export async function exchangeOwnerCode(db: D1Database, input: OwnerCodeExchange, config: MobileAuthConfig): Promise<OwnerTokenResponse> {
  bounded(input.code, 'authorization code', 256);
  bounded(input.verifier, 'PKCE verifier', 128);
  if (!validState(input.state)) throw new MobileAuthError('invalid_request', 'The owner login state is not valid.', 400);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const callback = assertHttpsCallback(input.callbackUrl ?? config.callbackUrl, config);
  const at = current(config);
  const stateHash = await hashSecret(input.state);
  const verifierHash = await hashSecret(input.verifier);
  const digest = await requestDigest({ flow: 'owner-exchange', requestId: input.requestId, codeHash: await hashSecret(input.code), verifierHash, stateHash, deviceId: input.deviceId ?? null, environmentHash, callback, idempotencyKey: input.idempotencyKey ?? null, staySignedIn: input.staySignedIn === true });
  const replay = await readReplay(db, 'owner-exchange', digest, at, config);
  if (replay) return replay;
  const request = await readAuthRequest(db, bounded(input.requestId, 'request id', 128));
  if (!request || request.ledger_id !== 'personal') throw new MobileAuthError('invalid_request', 'The owner login request is not valid.', 400);
  expiresOrThrow(request.expires_at, at, 'The owner login request has expired.');
  expiresOrThrow(request.code_expires_at, at, 'The owner authorization code has expired.');
  if (request.revoked_at || request.consumed_at) throw new MobileAuthError('consumed', 'The owner authorization code has already been consumed.', 409);
  if (!request.code_hash || !constantTimeEqual(request.code_hash, await hashSecret(input.code))) throw new MobileAuthError('invalid_code', 'The owner authorization code is not valid.', 401);
  if (!constantTimeEqual(request.state_hash, stateHash)) throw new MobileAuthError('state_mismatch', 'The owner login state is not valid.', 401);
  if (!constantTimeEqual(request.pkce_challenge_hash, await hashSecret(await pkceChallenge(input.verifier)))) throw new MobileAuthError('pkce_mismatch', 'The PKCE verifier is not valid.', 401);
  if (request.environment_hash !== environmentHash || request.callback_origin !== callback.origin || request.callback_path !== callback.path) throw new MobileAuthError('environment_mismatch', 'The owner login request does not match this environment.', 401);
  if (request.device_id !== (input.deviceId ?? null) || !request.approved_subject_hash) throw new MobileAuthError('device_mismatch', 'The owner login device binding is not valid.', 401);
  const refreshLifetime = input.staySignedIn === true ? THIRTY_DAYS : DAY;
  const refreshExpiresAt = isoAfter(at, refreshLifetime);
  const accessExpiresAt = isoAfter(at, Math.min(FIFTEEN_MINUTES, refreshLifetime));
  const familyId = crypto.randomUUID();
  const refreshTokenPlaceholder = await createOpaqueCredential({ kind: 'owner-refresh', familyId, generation: 1, expiresAt: refreshExpiresAt, environmentHash }, config);
  const refreshHash = await hashSecret(refreshTokenPlaceholder);
  const capabilityPlaceholder = await revocationCapability(config, familyId, 1, refreshExpiresAt);
  const revocationHash = await hashSecret(capabilityPlaceholder);
  const response = await ownerResponse(config, familyId, 1, request.approved_subject_hash, request.device_id, refreshExpiresAt, accessExpiresAt, capabilityPlaceholder, 1);
  // The refresh token hash must describe the token returned to the client.
  const exactRefreshHash = await hashSecret(response.refreshToken);
  const committed = await atomicExchange(db, request, input, digest, response, config, at, familyId, request.approved_subject_hash, exactRefreshHash, revocationHash, accessExpiresAt, refreshExpiresAt, input.staySignedIn === true ? refreshExpiresAt : null);
  if (committed) return response;
  const recovered = await readReplay(db, 'owner-exchange', digest, at, config);
  if (recovered) return recovered;
  throw new MobileAuthError('consumed', 'The owner authorization code has already been consumed.', 409);
}

async function readFamily(db: D1Database, familyId: string) {
  return db.prepare(`SELECT id, ledger_id, subject_hash, device_id, access_generation, refresh_generation,
      access_expires_at, refresh_expires_at, stay_signed_in_until, revoked_at, scope_json,
      environment_hash, revocation_capability_hash, revocation_generation
    FROM owner_session_families WHERE id = ?`).bind(familyId).first<SessionFamilyRow>();
}

async function readRefresh(db: D1Database, familyId: string, generation: number) {
  return db.prepare(`SELECT family_id, generation, token_hash, issued_at, expires_at, consumed_at, revoked_at
    FROM owner_refresh_generations WHERE family_id = ? AND generation = ?`).bind(familyId, generation).first<RefreshGenerationRow>();
}

async function atomicRefresh(db: D1Database, family: SessionFamilyRow, input: OwnerRefreshInput, digest: string, oldGeneration: number, nextGeneration: number, nextAccessGeneration: number, accessExpiresAt: string, refreshExpiresAt: string, refreshHash: string, revocationHash: string, response: OwnerTokenResponse, config: MobileAuthConfig, at: Date, nextCapabilityExpiry: string) {
  const sealed = await encryptReplayResponse(response, config);
  const results = await db.batch([
    db.prepare(`UPDATE owner_refresh_generations SET consumed_at = ?
      WHERE family_id = ? AND generation = ? AND token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(at.toISOString(), family.id, oldGeneration, await hashSecret(input.refreshToken)),
    db.prepare(`UPDATE owner_session_families SET refresh_generation = ?, access_generation = ?, access_expires_at = ?,
       refresh_expires_at = ?, revocation_capability_hash = ?, revocation_generation = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND refresh_generation = ? AND revoked_at IS NULL AND refresh_expires_at >= ? AND changes() = 1`).bind(
      nextGeneration, nextAccessGeneration, accessExpiresAt, refreshExpiresAt, revocationHash, nextGeneration, family.id, oldGeneration, at.toISOString(),
    ),
    db.prepare(`INSERT INTO owner_refresh_generations (family_id, generation, token_hash, issued_at, expires_at)
      SELECT ?, ?, ?, ?, ? WHERE changes() = 1`).bind(family.id, nextGeneration, refreshHash, at.toISOString(), refreshExpiresAt),
    db.prepare(`INSERT INTO owner_replay_records
      (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, 'personal', 'owner-refresh', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_TTL),
    ),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1;
}

export async function refreshOwnerSession(db: D1Database, input: OwnerRefreshInput, config: MobileAuthConfig): Promise<OwnerTokenResponse> {
  bounded(input.refreshToken, 'refresh credential', 4096);
  bounded(input.idempotencyKey, 'idempotency key', 256);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const at = current(config);
  const tokenHash = await hashSecret(input.refreshToken);
  const digest = await requestDigest({ flow: 'owner-refresh', tokenHash, environmentHash, idempotencyKey: input.idempotencyKey });
  const replay = await readReplay(db, 'owner-refresh', digest, at, config);
  if (replay) return replay;
  const payload = await readOpaqueCredential<{ kind?: unknown; familyId?: unknown; generation?: unknown; expiresAt?: unknown; environmentHash?: unknown }>(input.refreshToken, config);
  if (payload.kind !== 'owner-refresh' || typeof payload.familyId !== 'string' || typeof payload.generation !== 'number' || typeof payload.expiresAt !== 'string' || payload.environmentHash !== environmentHash) throw new MobileAuthError('wrong_credential_type', 'A refresh credential is required.', 401);
  expiresOrThrow(payload.expiresAt, at, 'The refresh credential has expired.');
  const family = await readFamily(db, payload.familyId);
  const generation = await readRefresh(db, payload.familyId, payload.generation);
  if (!family || !generation || family.ledger_id !== 'personal' || family.revoked_at || family.environment_hash !== environmentHash) throw new MobileAuthError('revoked', 'The owner session is not active.', 401);
  expiresOrThrow(family.refresh_expires_at, at, 'The owner session has expired.');
  if (!constantTimeEqual(generation.token_hash, tokenHash)) throw new MobileAuthError('invalid_credential', 'The refresh credential is not valid.', 401);
  if (generation.consumed_at || generation.revoked_at || family.refresh_generation !== payload.generation) {
    await db.prepare(`UPDATE owner_session_families SET revoked_at = COALESCE(revoked_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(at.toISOString(), family.id).run();
    throw new MobileAuthError('refresh_reuse', 'The refresh credential was reused.', 409);
  }
  const nextGeneration = payload.generation + 1;
  const nextAccessGeneration = family.access_generation + 1;
  const accessExpiresAt = isoAfter(at, Math.min(FIFTEEN_MINUTES, Date.parse(family.refresh_expires_at) - at.getTime()));
  const refreshExpiresAt = family.refresh_expires_at;
  const nextCapability = await revocationCapability(config, family.id, nextGeneration, refreshExpiresAt);
  const response = await ownerResponse(config, family.id, nextGeneration, family.subject_hash, family.device_id, refreshExpiresAt, accessExpiresAt, nextCapability, nextAccessGeneration);
  const committed = await atomicRefresh(db, family, input, digest, payload.generation, nextGeneration, nextAccessGeneration, accessExpiresAt, refreshExpiresAt, await hashSecret(response.refreshToken), await hashSecret(nextCapability), response, config, at, refreshExpiresAt);
  if (committed) return response;
  const recovered = await readReplay(db, 'owner-refresh', digest, at, config);
  if (recovered) return recovered;
  await db.prepare(`UPDATE owner_session_families SET revoked_at = COALESCE(revoked_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(at.toISOString(), family.id).run();
  throw new MobileAuthError('refresh_reuse', 'The refresh credential was reused.', 409);
}

export async function logoutOwnerSession(db: D1Database, input: { accessToken: string }, config: MobileAuthConfig) {
  let owner: OwnerContext;
  try {
    owner = await authenticateOwner(input.accessToken, db, config, 'devices:manage');
  } catch (error) {
    if (!(error instanceof MobileAuthError) || error.code !== 'revoked') throw error;
    const payload = await readOpaqueCredential<{ kind?: unknown; familyId?: unknown; generation?: unknown; expiresAt?: unknown; environmentHash?: unknown }>(input.accessToken, config);
    const environmentHash = await hashSecret(config.environment);
    if (payload.kind !== 'owner-access' || typeof payload.familyId !== 'string' || typeof payload.generation !== 'number' || typeof payload.expiresAt !== 'string' || typeof payload.environmentHash !== 'string' || !constantTimeEqual(payload.environmentHash, environmentHash)) throw error;
    expiresOrThrow(payload.expiresAt, current(config), 'The owner credential has expired.');
    const family = await readFamily(db, payload.familyId);
    if (!family || family.ledger_id !== 'personal' || !family.revoked_at || family.access_generation !== payload.generation || !constantTimeEqual(family.environment_hash, environmentHash)) throw error;
    return;
  }
  const at = current(config).toISOString();
  const statements = [db.prepare(`UPDATE owner_session_families SET revoked_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND access_generation = ? AND environment_hash = ? AND revoked_at IS NULL`).bind(at, owner.familyId, owner.accessGeneration, owner.environmentHash)];
  if (owner.deviceId) statements.push(db.prepare(`UPDATE capture_credentials SET revoked_at = COALESCE(revoked_at, ?)
    WHERE device_id = ? AND EXISTS (
      SELECT 1 FROM owner_session_families
      WHERE id = ? AND access_generation = ? AND environment_hash = ? AND revoked_at = ?
    )`).bind(at, owner.deviceId, owner.familyId, owner.accessGeneration, owner.environmentHash, at));
  await db.batch(statements);
}

export function ownerContextForConsent(context: OwnerContext): OwnerContext {
  if (!context.scopes.includes('devices:manage')) throw new MobileAuthError('forbidden', 'Device management scope is required.', 403);
  return context;
}
