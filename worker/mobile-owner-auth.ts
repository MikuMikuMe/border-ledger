import type { LedgerContext } from './tenant-context';
import type { D1Database } from './db-types';
import { financialAuthorityGuard } from './financial-authority';
import { reviewStateGuard, isReviewStateConflict } from './review-publication';
import {
  OWNER_SCOPES,
  MobileAuthError,
  resolveMobileIdentity,
  accessSubjectHash,
  assertEnvironment,
  assertHttpsCallback,
  authenticateOwner,
  activeMobileLedger,
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
  userId: string;
  ledgerId: string;
  refreshExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: readonly OwnerScope[];
  revision: number;
  revocationCapability: string;
}

interface AuthRequestRow {
  id: string;
  ledger_id: string;
  user_id: string | null;
  installation_id: string | null;
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
  ledger_id: string;
  subject_hash: string;
  installation_id: string | null;
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

async function readReplay<T>(db: D1Database, lookup: { context: LedgerContext; requestKind: string; digest: string; at: Date }, config: MobileAuthConfig) {
  const { context, requestKind, digest, at } = lookup;
  const row = await db.prepare(`SELECT response_ciphertext, response_iv, expires_at
    FROM owner_replay_records WHERE ledger_id = ? AND request_kind = ? AND request_digest = ? AND expires_at > ?`).bind(context.ledgerId, requestKind, digest, at.toISOString()).first<ReplayRow>();
  if (!row) return null;
  const response = await decryptReplayResponse<T>({ ciphertext: row.response_ciphertext, iv: row.response_iv }, config);
  if (requestKind === 'owner-exchange' || requestKind === 'owner-refresh') {
    const owner = await authenticateOwner((response as OwnerTokenResponse).accessToken, db, config);
    if (owner.ledgerId !== context.ledgerId || owner.userId !== context.userId) throw new MobileAuthError('invalid_replay', 'The replay binding is not valid.', 403);
  }
  return response;
}

async function readAuthRequest(db: D1Database, requestId: string) {
  return db.prepare(`SELECT id, ledger_id, user_id, installation_id, state_hash, pkce_challenge_hash, request_digest,
      expires_at, consumed_at, revoked_at, code_hash, code_expires_at, callback_origin, callback_path,
      environment_hash, approved_subject_hash, approved_at
    FROM hosted_auth_requests WHERE id = ?`).bind(requestId).first<AuthRequestRow>();
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
  await db.prepare(`INSERT INTO hosted_auth_requests
    (id, ledger_id, installation_id, state_hash, pkce_challenge_hash, request_digest, expires_at,
      callback_origin, callback_path, environment_hash)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
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
  authorization.searchParams.set('state', input.state);
  return { requestId, authorizationUrl: authorization.toString(), expiresAt, deviceId: input.deviceId ?? null };
}

export async function approveOwnerLogin(db: D1Database, input: OwnerApprovalInput, config: MobileAuthConfig): Promise<OwnerApproval> {
  if (input.consent !== true) throw new MobileAuthError('consent_required', 'Explicit owner approval is required.', 403);
  const context = await resolveMobileIdentity(db, input.identity, config);
  const requestId = bounded(input.requestId, 'request id', 128);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const callback = assertHttpsCallback(input.callbackUrl ?? config.callbackUrl, config);
  const at = current(config);
  const subjectHash = await accessSubjectHash(input.identity);
  const digest = await requestDigest({
    flow: 'owner-approval',
    requestId,
    subjectHash,
    issuer: input.identity.issuer,
    audience: input.identity.audience,
    environmentHash,
    callback,
  });
  const replay = await readReplay<OwnerApproval>(db, { context, requestKind: 'owner-approval', digest, at }, config);
  if (replay) return replay;
  const request = await readAuthRequest(db, requestId);
  if (!request || request.revoked_at || request.consumed_at) throw new MobileAuthError('invalid_request', 'The owner login request is not available.', 400);
  expiresOrThrow(request.expires_at, at, 'The owner login request has expired.');
  if (request.environment_hash !== environmentHash || request.callback_origin !== callback.origin || request.callback_path !== callback.path) throw new MobileAuthError('environment_mismatch', 'The owner login request does not match this environment.', 400);
  const code = bytesToBase64Url(randomBytes(32));
  const codeHash = await hashSecret(code);
  // Keep the authorization code lifetime aligned with its encrypted retry record.
  const codeExpiresAt = isoAfter(at, REPLAY_TTL);
  const response = { requestId: request.id, code, callbackUrl: config.callbackUrl, expiresAt: codeExpiresAt };
  const committed = await atomicApproval(db, { context, request, digest, response, codeHash, subjectHash, at }, config);
  if (committed) return response;
  const recovered = await readReplay<OwnerApproval>(db, { context, requestKind: 'owner-approval', digest, at }, config);
  if (recovered) return recovered;
  throw new MobileAuthError('invalid_request', 'The owner login request is no longer available.', 409);
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

async function atomicApproval(db: D1Database, approval: { context: LedgerContext; request: AuthRequestRow; digest: string; response: OwnerApproval; codeHash: string; subjectHash: string; at: Date }, config: MobileAuthConfig) {
  const { context, request, digest, response, codeHash, subjectHash, at } = approval;
  const sealed = await encryptReplayResponse(response, config);
  const results = await db.batch([
    db.prepare(`UPDATE hosted_auth_requests SET ledger_id = ?, user_id = ?, code_hash = ?, code_expires_at = ?, approved_subject_hash = ?, approved_at = ?
      WHERE id = ? AND code_hash IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`).bind(
      context.ledgerId, context.userId, codeHash,
      response.expiresAt,
      subjectHash,
      at.toISOString(),
      request.id,
      at.toISOString(),
    ),
    db.prepare(`INSERT INTO owner_replay_records
      (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, ?, 'owner-approval', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), context.ledgerId, digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_TTL),
    ),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1;
}

async function ownerResponse(config: MobileAuthConfig, familyId: string, generation: number, subjectHash: string, deviceId: string | null, refreshExpiresAt: string, accessExpiresAt: string, revocationCapability: string, revision: number, context: { userId: string; ledgerId: string }): Promise<OwnerTokenResponse> {
  const environmentHash = await hashSecret(config.environment);
  const accessToken = await createOpaqueCredential({ kind: 'owner-access', familyId, generation, subjectHash, deviceId, expiresAt: accessExpiresAt, environmentHash }, config);
  const refreshToken = await createOpaqueCredential({ kind: 'owner-refresh', familyId, generation, expiresAt: refreshExpiresAt, environmentHash }, config);
  return { userId: context.userId, ledgerId: context.ledgerId, refreshExpiresAt, accessToken, refreshToken, expiresAt: accessExpiresAt, scopes: [...OWNER_SCOPES], revision, revocationCapability };
}

async function revocationCapability(config: MobileAuthConfig, grantId: string, generation: number, expiresAt: string) {
  return createOpaqueCredential({ kind: 'revocation', grantType: 'owner-family', grantId, generation, expiresAt, environmentHash: await hashSecret(config.environment) }, config);
}

async function atomicExchange(db: D1Database, request: AuthRequestRow, input: OwnerCodeExchange, digest: string, response: OwnerTokenResponse, config: MobileAuthConfig, at: Date, familyId: string, subjectHash: string, refreshHash: string, revocationHash: string, accessExpiresAt: string, refreshExpiresAt: string, staySignedInUntil: string | null) {
  const sealed = await encryptReplayResponse(response, config);
  const results = await db.batch([
    db.prepare(`UPDATE hosted_auth_requests SET consumed_at = ?
      WHERE id = ? AND code_hash = ? AND code_expires_at > ? AND consumed_at IS NULL AND revoked_at IS NULL`).bind(at.toISOString(), request.id, await hashSecret(input.code), at.toISOString()),
    db.prepare(`INSERT INTO owner_session_families
      (id, ledger_id, subject_hash, installation_id, access_generation, refresh_generation, access_expires_at,
       refresh_expires_at, stay_signed_in_until, scope_json, environment_hash, revocation_capability_hash, revocation_generation)
      SELECT ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, 1 WHERE changes() = 1`).bind(
      familyId, request.ledger_id, subjectHash, request.installation_id, accessExpiresAt, refreshExpiresAt, staySignedInUntil,
      JSON.stringify(OWNER_SCOPES), await hashSecret(config.environment), revocationHash,
    ),
    db.prepare(`INSERT INTO owner_refresh_generations (ledger_id, family_id, generation, token_hash, issued_at, expires_at)
      SELECT ?, ?, 1, ?, ?, ? WHERE changes() = 1`).bind(request.ledger_id, familyId, refreshHash, at.toISOString(), refreshExpiresAt),
    db.prepare(`INSERT INTO owner_replay_records
      (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, ?, 'owner-exchange', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), request.ledger_id, digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_TTL),
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
  const request = await readAuthRequest(db, bounded(input.requestId, 'request id', 128));
  if (!request?.ledger_id) throw new MobileAuthError('invalid_request', 'The owner login request is not valid.', 400);
  const context = await activeMobileLedger(db, request.ledger_id);
  const replay = await readReplay<OwnerTokenResponse>(db, { context, requestKind: 'owner-exchange', digest, at }, config);
  if (replay) return replay;
  expiresOrThrow(request.expires_at, at, 'The owner login request has expired.');
  expiresOrThrow(request.code_expires_at, at, 'The owner authorization code has expired.');
  if (request.revoked_at || request.consumed_at) throw new MobileAuthError('consumed', 'The owner authorization code has already been consumed.', 409);
  if (!request.code_hash || !constantTimeEqual(request.code_hash, await hashSecret(input.code))) throw new MobileAuthError('invalid_code', 'The owner authorization code is not valid.', 401);
  if (!constantTimeEqual(request.state_hash, stateHash)) throw new MobileAuthError('state_mismatch', 'The owner login state is not valid.', 401);
  if (!constantTimeEqual(request.pkce_challenge_hash, await hashSecret(await pkceChallenge(input.verifier)))) throw new MobileAuthError('pkce_mismatch', 'The PKCE verifier is not valid.', 401);
  if (request.environment_hash !== environmentHash || request.callback_origin !== callback.origin || request.callback_path !== callback.path) throw new MobileAuthError('environment_mismatch', 'The owner login request does not match this environment.', 401);
  if (request.installation_id !== (input.deviceId ?? null) || !request.approved_subject_hash) throw new MobileAuthError('device_mismatch', 'The owner login device binding is not valid.', 401);
  const refreshLifetime = input.staySignedIn === true ? THIRTY_DAYS : DAY;
  const refreshExpiresAt = isoAfter(at, refreshLifetime);
  const accessExpiresAt = isoAfter(at, Math.min(FIFTEEN_MINUTES, refreshLifetime));
  const familyId = crypto.randomUUID();
  const refreshTokenPlaceholder = await createOpaqueCredential({ kind: 'owner-refresh', familyId, generation: 1, expiresAt: refreshExpiresAt, environmentHash }, config);
  const refreshHash = await hashSecret(refreshTokenPlaceholder);
  const capabilityPlaceholder = await revocationCapability(config, familyId, 1, refreshExpiresAt);
  const revocationHash = await hashSecret(capabilityPlaceholder);
  const response = await ownerResponse(config, familyId, 1, request.approved_subject_hash, request.installation_id, refreshExpiresAt, accessExpiresAt, capabilityPlaceholder, 1, context);
  // The refresh token hash must describe the token returned to the client.
  const exactRefreshHash = await hashSecret(response.refreshToken);
  const committed = await atomicExchange(db, request, input, digest, response, config, at, familyId, request.approved_subject_hash, exactRefreshHash, revocationHash, accessExpiresAt, refreshExpiresAt, input.staySignedIn === true ? refreshExpiresAt : null);
  if (committed) return response;
  const recovered = await readReplay<OwnerTokenResponse>(db, { context, requestKind: 'owner-exchange', digest, at }, config);
  if (recovered) return recovered;
  throw new MobileAuthError('consumed', 'The owner authorization code has already been consumed.', 409);
}

async function readFamily(db: D1Database, familyId: string) {
  return db.prepare(`SELECT id, ledger_id, subject_hash, COALESCE(installation_id, device_id) AS installation_id, access_generation, refresh_generation,
      access_expires_at, refresh_expires_at, stay_signed_in_until, revoked_at, scope_json,
      environment_hash, revocation_capability_hash, revocation_generation
    FROM owner_session_families WHERE id = ?`).bind(familyId).first<SessionFamilyRow>();
}

async function readRefresh(db: D1Database, familyId: string, generation: number) {
  return db.prepare(`SELECT family_id, generation, token_hash, issued_at, expires_at, consumed_at, revoked_at
    FROM owner_refresh_generations WHERE family_id = ? AND generation = ?`).bind(familyId, generation).first<RefreshGenerationRow>();
}

function refreshPublicationGuard(db: D1Database, binding: { context: LedgerContext; family: SessionFamilyRow; tokenHash: string }) {
  const { context, family, tokenHash } = binding;
  return reviewStateGuard(db, context, `EXISTS (SELECT 1 FROM owner_session_families f
    JOIN owner_refresh_generations r ON r.family_id=f.id AND r.ledger_id=f.ledger_id
    WHERE f.id=? AND f.ledger_id=? AND f.subject_hash=? AND f.environment_hash=?
      AND f.access_generation=? AND f.refresh_generation=? AND f.scope_json=?
      AND f.access_expires_at=? AND f.refresh_expires_at=? AND f.stay_signed_in_until IS ?
      AND COALESCE(f.installation_id,f.device_id) IS ?
      AND f.revocation_generation=? AND f.revocation_capability_hash IS ?
      AND f.revoked_at IS NULL AND julianday(f.refresh_expires_at)>julianday('now')
      AND r.generation=? AND r.token_hash=? AND r.consumed_at IS NULL AND r.revoked_at IS NULL
      AND julianday(r.expires_at)>julianday('now'))`, [
    family.id, context.ledgerId, family.subject_hash, family.environment_hash,
    family.access_generation, family.refresh_generation, family.scope_json,
    family.access_expires_at, family.refresh_expires_at, family.stay_signed_in_until,
    family.installation_id, family.revocation_generation, family.revocation_capability_hash,
    family.refresh_generation, tokenHash,
  ]);
}

function assertRefreshPolicyUnchanged(latest: SessionFamilyRow, family: SessionFamilyRow) {
  const policyUnchanged = latest.environment_hash === family.environment_hash
    && latest.scope_json === family.scope_json
    && latest.refresh_expires_at === family.refresh_expires_at
    && latest.stay_signed_in_until === family.stay_signed_in_until;
  if (!policyUnchanged) throw new MobileAuthError('revoked', 'The refresh authority changed.', 401);
}

async function recoverRefreshPublication(db: D1Database, binding: { context: LedgerContext; family: SessionFamilyRow; digest: string }, config: MobileAuthConfig) {
  const { context, family, digest } = binding;
  const latest = await readFamily(db, family.id);
  if (!latest || latest.revoked_at) throw new MobileAuthError('revoked', 'The owner session is not active.', 401);
  assertRefreshPolicyUnchanged(latest, family);
  const recovered = await readReplay<OwnerTokenResponse>(db, {
    context, requestKind: 'owner-refresh', digest, at: current(config),
  }, config);
  if (recovered) return recovered;
  if (latest.refresh_generation !== family.refresh_generation) return null;
  throw new MobileAuthError('revoked', 'The refresh authority changed.', 401);
}

async function atomicRefresh(db: D1Database, family: SessionFamilyRow, input: OwnerRefreshInput, digest: string, oldGeneration: number, nextGeneration: number, nextAccessGeneration: number, accessExpiresAt: string, refreshExpiresAt: string, refreshHash: string, revocationHash: string, response: OwnerTokenResponse, config: MobileAuthConfig, at: Date, nextCapabilityExpiry: string) {
  const sealed = await encryptReplayResponse(response, config);
  const tokenHash = await hashSecret(input.refreshToken);
  const context = await activeMobileLedger(db, family.ledger_id);
  const statements = [
    financialAuthorityGuard(db, context, 'ledger:read'),
    refreshPublicationGuard(db, { context, family, tokenHash }),
    db.prepare(`UPDATE owner_refresh_generations SET consumed_at = ?
      WHERE family_id = ? AND ledger_id = ? AND generation = ? AND token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL`)
      .bind(at.toISOString(), family.id, context.ledgerId, oldGeneration, tokenHash),
    db.prepare(`UPDATE owner_session_families SET refresh_generation = ?, access_generation = ?, access_expires_at = ?,
       refresh_expires_at = ?, revocation_capability_hash = ?, revocation_generation = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ledger_id = ? AND refresh_generation = ? AND revoked_at IS NULL AND julianday(refresh_expires_at)>julianday('now') AND changes() = 1`).bind(
      nextGeneration, nextAccessGeneration, accessExpiresAt, refreshExpiresAt, revocationHash, nextGeneration,
      family.id, context.ledgerId, oldGeneration,
    ),
    db.prepare(`INSERT INTO owner_refresh_generations (ledger_id, family_id, generation, token_hash, issued_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`).bind(family.ledger_id, family.id, nextGeneration, refreshHash, at.toISOString(), refreshExpiresAt),
    db.prepare(`INSERT INTO owner_replay_records
      (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, ?, 'owner-refresh', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), family.ledger_id, digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_TTL),
    ),
  ];
  try {
    const results = await db.batch(statements);
    return results.slice(2).every(result => Number(result.meta?.changes ?? 0) === 1) ? response : null;
  } catch (error) {
    await activeMobileLedger(db, context.ledgerId);
    if (isReviewStateConflict(error)) {
      return recoverRefreshPublication(db, { context, family, digest }, config);
    }
    throw error;
  }
}

export async function refreshOwnerSession(db: D1Database, input: OwnerRefreshInput, config: MobileAuthConfig): Promise<OwnerTokenResponse> {
  bounded(input.refreshToken, 'refresh credential', 4096);
  bounded(input.idempotencyKey, 'idempotency key', 256);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const at = current(config);
  const tokenHash = await hashSecret(input.refreshToken);
  const digest = await requestDigest({ flow: 'owner-refresh', tokenHash, environmentHash, idempotencyKey: input.idempotencyKey });
  const payload = await readOpaqueCredential<{ kind?: unknown; familyId?: unknown; generation?: unknown; expiresAt?: unknown; environmentHash?: unknown }>(input.refreshToken, config);
  if (payload.kind !== 'owner-refresh' || typeof payload.familyId !== 'string' || typeof payload.generation !== 'number' || typeof payload.expiresAt !== 'string' || payload.environmentHash !== environmentHash) throw new MobileAuthError('wrong_credential_type', 'A refresh credential is required.', 401);
  expiresOrThrow(payload.expiresAt, at, 'The refresh credential has expired.');
  const family = await readFamily(db, payload.familyId);
  const generation = await readRefresh(db, payload.familyId, payload.generation);
  if (!family || !generation || family.revoked_at || family.environment_hash !== environmentHash) throw new MobileAuthError('revoked', 'The owner session is not active.', 401);
  const context = await activeMobileLedger(db, family.ledger_id);
  expiresOrThrow(family.refresh_expires_at, at, 'The owner session has expired.');
  if (!constantTimeEqual(generation.token_hash, tokenHash)) throw new MobileAuthError('invalid_credential', 'The refresh credential is not valid.', 401);
  const replay = await readReplay<OwnerTokenResponse>(db, { context, requestKind: 'owner-refresh', digest, at }, config);
  if (replay) return replay;
  if (generation.consumed_at || generation.revoked_at || family.refresh_generation !== payload.generation) {
    await db.prepare(`UPDATE owner_session_families SET revoked_at = COALESCE(revoked_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(at.toISOString(), family.id).run();
    throw new MobileAuthError('refresh_reuse', 'The refresh credential was reused.', 409);
  }
  const nextGeneration = payload.generation + 1;
  const nextAccessGeneration = family.access_generation + 1;
  const accessExpiresAt = isoAfter(at, Math.min(FIFTEEN_MINUTES, Date.parse(family.refresh_expires_at) - at.getTime()));
  const refreshExpiresAt = family.refresh_expires_at;
  const nextCapability = await revocationCapability(config, family.id, nextGeneration, refreshExpiresAt);
  const response = await ownerResponse(config, family.id, nextGeneration, family.subject_hash, family.installation_id, refreshExpiresAt, accessExpiresAt, nextCapability, nextAccessGeneration, context);
  const committed = await atomicRefresh(db, family, input, digest, payload.generation, nextGeneration, nextAccessGeneration, accessExpiresAt, refreshExpiresAt, await hashSecret(response.refreshToken), await hashSecret(nextCapability), response, config, at, refreshExpiresAt);
  if (committed) {
    const acknowledged = await authenticateOwner(committed.accessToken, db, config);
    if (acknowledged.ledgerId !== context.ledgerId) throw new MobileAuthError('invalid_credential', 'The refresh binding changed.', 403);
    return committed;
  }
  const recovered = await readReplay<OwnerTokenResponse>(db, { context, requestKind: 'owner-refresh', digest, at: current(config) }, config);
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
    if (!family || !family.revoked_at || family.access_generation !== payload.generation || !constantTimeEqual(family.environment_hash, environmentHash)) throw error;
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
