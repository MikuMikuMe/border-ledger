import type { D1Database, LedgerId } from './db-types.ts';

export const OWNER_SCOPES = [
  'ledger:read',
  'ledger:review',
  'imports:write',
  'exports:read',
  'recurring:classify',
  'connections:manage',
  'preferences:write',
  'devices:manage',
] as const;

export type OwnerScope = typeof OWNER_SCOPES[number];
export const CAPTURE_SCOPE = 'alerts:write' as const;
export type CaptureScope = typeof CAPTURE_SCOPE;
export type LedgerScope = LedgerId;

export type MobileCredentialType = 'owner' | 'capture' | 'revocation' | 'pair-verifier';
export type RevocationGrantType = 'owner-family' | 'capture-credential';

export interface MobileAuthConfig {
  canonicalOrigin: string;
  callbackUrl: string;
  environment: string;
  accessAuthorizationUrl: string;
  sessionEncryptionKey: string;
  approvedAccessIssuers?: readonly string[];
  approvedAccessAudiences?: readonly string[];
  approvedAccessSubjects?: readonly string[];
  now?: () => Date;
}

export interface AccessIdentity {
  subject: string;
  issuer: string;
  audience: string;
  email?: string | null;
}

export interface OwnerContext {
  credentialType: 'owner';
  ledgerId: 'personal';
  familyId: string;
  subjectHash: string;
  deviceId: string | null;
  accessGeneration: number;
  scopes: readonly OwnerScope[];
  expiresAt: string;
  environmentHash: string;
}

export interface CaptureInstrumentHint {
  kind: string;
  value: string;
}

export interface CaptureScopeRecord {
  sourceProfileId: string;
  accountId: string;
  currency: string;
  instrumentHint?: CaptureInstrumentHint | null;
}

export interface CaptureContext {
  credentialType: 'capture';
  ledgerId: 'personal';
  credentialId: string;
  deviceId: string;
  generation: number;
  scope: CaptureScope;
  expiresAt: string;
  sourceScopes: readonly CaptureScopeRecord[];
  environmentHash: string;
}

export interface RevocationContext {
  credentialType: 'revocation';
  grantType: RevocationGrantType;
  grantId: string;
  generation: number;
  expiresAt: string;
  environmentHash: string;
}

export interface PairVerifierContext {
  credentialType: 'pair-verifier';
  pairingId: string;
  deviceId: string;
  expiresAt: string;
  environmentHash: string;
}

export type MobileContext = OwnerContext | CaptureContext | RevocationContext | PairVerifierContext;

export class MobileAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'MobileAuthError';
  }
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX_RE = /^[A-Fa-f0-9]+$/;

function encoder() {
  return new TextEncoder();
}

function decoder() {
  return new TextDecoder();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  if (!BASE64URL_RE.test(value)) throw new MobileAuthError('invalid_credential', 'The mobile credential is not valid.');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function utf8(value: string) {
  return encoder().encode(value);
}

function digestBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function hashSecret(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new MobileAuthError('invalid_request', 'The credential input is not valid.', 400);
  const digest = await crypto.subtle.digest('SHA-256', digestBuffer(utf8(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashBytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', digestBuffer(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pkceChallenge(verifier: string) {
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128 || !BASE64URL_RE.test(verifier)) {
    throw new MobileAuthError('invalid_request', 'The PKCE verifier is not valid.', 400);
  }
  const digest = await crypto.subtle.digest('SHA-256', digestBuffer(utf8(verifier)));
  return bytesToBase64Url(new Uint8Array(digest));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

export async function requestDigest(value: unknown) {
  return hashSecret(JSON.stringify(canonicalValue(value)));
}

export function now(config: Pick<MobileAuthConfig, 'now'>, override?: Date | string) {
  if (override instanceof Date) return new Date(override.getTime());
  if (typeof override === 'string') return new Date(override);
  return new Date(config.now?.() ?? Date.now());
}

export function isoAfter(base: Date, milliseconds: number) {
  return new Date(base.getTime() + milliseconds).toISOString();
}

export function assertEnvironment(environment: string | undefined, config: MobileAuthConfig) {
  if (environment !== config.environment) throw new MobileAuthError('environment_mismatch', 'The mobile environment is not valid.', 400);
  return hashSecret(config.environment);
}

export function assertHttpsCallback(callbackUrl: string | undefined, config: MobileAuthConfig) {
  if (!callbackUrl) throw new MobileAuthError('callback_mismatch', 'The callback is not valid.', 400);
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(config.callbackUrl);
    actual = new URL(callbackUrl);
  } catch {
    throw new MobileAuthError('callback_mismatch', 'The callback is not valid.', 400);
  }
  const exact = expected.protocol === 'https:' && actual.protocol === 'https:' && expected.origin === actual.origin && expected.pathname === actual.pathname && expected.search === actual.search && expected.hash === actual.hash;
  if (!exact || actual.origin !== config.canonicalOrigin) throw new MobileAuthError('callback_mismatch', 'The callback is not valid.', 400);
  return { origin: actual.origin, path: actual.pathname };
}

export function assertAccessIdentity(identity: AccessIdentity, config: MobileAuthConfig) {
  const issuerOkay = (config.approvedAccessIssuers ?? []).includes(identity.issuer);
  const audienceOkay = (config.approvedAccessAudiences ?? []).includes(identity.audience);
  const subjectOkay = (config.approvedAccessSubjects ?? []).includes(identity.subject) || (identity.email ? (config.approvedAccessSubjects ?? []).includes(identity.email) : false);
  if (!identity.subject || !issuerOkay || !audienceOkay || !subjectOkay) throw new MobileAuthError('identity_not_approved', 'The Access identity is not approved for this ledger.', 403);
}

export function validateScope(scope: string): scope is OwnerScope {
  return (OWNER_SCOPES as readonly string[]).includes(scope);
}

export function isMobileCredential(value: string, _config?: Pick<MobileAuthConfig, 'sessionEncryptionKey'>) {
  return typeof value === 'string' && value.startsWith('v1.');
}

function sessionKeyInput(config: MobileAuthConfig) {
  if (!config.sessionEncryptionKey || config.sessionEncryptionKey.length < 16) throw new MobileAuthError('configuration', 'Mobile session encryption is not configured.', 503);
  return utf8(config.sessionEncryptionKey);
}

async function sessionKey(config: MobileAuthConfig) {
  const material = await crypto.subtle.digest('SHA-256', sessionKeyInput(config));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

interface SealedValue {
  iv: string;
  ciphertext: string;
}

async function sealValue(value: unknown, config: MobileAuthConfig): Promise<SealedValue> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(config), utf8(JSON.stringify(value)));
  return { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(encrypted)) };
}

async function openValue<T>(sealed: SealedValue, config: MobileAuthConfig): Promise<T> {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(sealed.iv) }, await sessionKey(config), base64UrlToBytes(sealed.ciphertext));
    return JSON.parse(decoder().decode(plaintext)) as T;
  } catch {
    throw new MobileAuthError('invalid_credential', 'The mobile credential is not valid.');
  }
}

export async function createOpaqueCredential(payload: Record<string, unknown>, config: MobileAuthConfig) {
  const sealed = await sealValue({ version: 1, ...payload }, config);
  return `v1.${sealed.iv}.${sealed.ciphertext}`;
}

export async function readOpaqueCredential<T extends Record<string, unknown>>(credential: string, config: MobileAuthConfig) {
  const parts = credential.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new MobileAuthError('invalid_credential', 'The mobile credential is not valid.');
  const payload = await openValue<T>({ iv: parts[1], ciphertext: parts[2] }, config);
  if (payload.version !== 1) throw new MobileAuthError('invalid_credential', 'The mobile credential is not valid.');
  return payload;
}

export async function encryptReplayResponse(value: unknown, config: MobileAuthConfig) {
  return sealValue(value, config);
}

export async function decryptReplayResponse<T>(sealed: SealedValue, config: MobileAuthConfig) {
  return openValue<T>(sealed, config);
}

function bearer(value: Request | string) {
  if (typeof value === 'string') return value;
  const header = value.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length <= 7) throw new MobileAuthError('unauthorized', 'A mobile bearer credential is required.');
  return header.slice(7);
}

const RFC3339_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

export function parseRfc3339Instant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = RFC3339_INSTANT.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
}

export function normalizeRfc3339Instant(value: string) {
  return parseRfc3339Instant(value)?.toISOString() ?? null;
}

function validExpiry(expiresAt: string, current: Date) {
  const expiry = parseRfc3339Instant(expiresAt);
  if (!expiry || expiry.getTime() <= current.getTime()) throw new MobileAuthError('expired', 'The mobile credential has expired.', 401);
}

function normalizeCaptureInstrumentHint(value: CaptureInstrumentHint | null | undefined): CaptureInstrumentHint | null {
  if (!value || (value.kind === 'none' && value.value === '')) return null;
  return { kind: value.kind, value: value.value };
}

function storedCaptureInstrumentHint(kind: string, value: string): CaptureInstrumentHint | null {
  return normalizeCaptureInstrumentHint({ kind, value });
}

function sameCaptureInstrumentHint(left: CaptureInstrumentHint | null | undefined, right: CaptureInstrumentHint | null | undefined) {
  const leftHint = normalizeCaptureInstrumentHint(left);
  const rightHint = normalizeCaptureInstrumentHint(right);
  return leftHint?.kind === rightHint?.kind && leftHint?.value === rightHint?.value;
}

export async function authenticateOwner(credential: Request | string, db: D1Database, config: MobileAuthConfig, requiredScope?: OwnerScope): Promise<OwnerContext> {
  const raw = bearer(credential);
  const payload = await readOpaqueCredential<{
    kind?: unknown;
    familyId?: unknown;
    generation?: unknown;
    expiresAt?: unknown;
    environmentHash?: unknown;
  }>(raw, config);
  if (payload.kind !== 'owner-access' || typeof payload.familyId !== 'string' || typeof payload.generation !== 'number' || typeof payload.expiresAt !== 'string' || typeof payload.environmentHash !== 'string') {
    throw new MobileAuthError('wrong_credential_type', 'An owner credential is required.', 403);
  }
  const current = now(config);
  validExpiry(payload.expiresAt, current);
  const expectedEnvironmentHash = await hashSecret(config.environment);
  if (!constantTimeEqual(payload.environmentHash, expectedEnvironmentHash)) throw new MobileAuthError('environment_mismatch', 'The mobile environment is not valid.', 401);
  const family = await db.prepare(`SELECT id, ledger_id, subject_hash, device_id, access_generation, access_expires_at,
      refresh_expires_at, revoked_at, scope_json, environment_hash
    FROM owner_session_families WHERE id = ?`).bind(payload.familyId).first<{
    id: string;
    ledger_id: LedgerId;
    subject_hash: string;
    device_id: string | null;
    access_generation: number;
    access_expires_at: string;
    refresh_expires_at: string;
    revoked_at: string | null;
    scope_json: string;
    environment_hash: string;
  }>();
  if (!family || family.revoked_at || family.ledger_id !== 'personal' || family.access_generation !== payload.generation || family.environment_hash !== expectedEnvironmentHash) {
    throw new MobileAuthError('revoked', 'The owner session is not active.', 401);
  }
  validExpiry(family.access_expires_at, current);
  let scopes: OwnerScope[];
  try {
    scopes = JSON.parse(family.scope_json) as OwnerScope[];
  } catch {
    throw new MobileAuthError('invalid_session', 'The owner session is not valid.', 401);
  }
  if (!scopes.every(validateScope)) throw new MobileAuthError('invalid_session', 'The owner session is not valid.', 401);
  if (requiredScope && !scopes.includes(requiredScope)) throw new MobileAuthError('forbidden', 'The owner session lacks the required scope.', 403);
  return {
    credentialType: 'owner',
    ledgerId: 'personal',
    familyId: family.id,
    subjectHash: family.subject_hash,
    deviceId: family.device_id,
    accessGeneration: family.access_generation,
    scopes,
    expiresAt: family.access_expires_at,
    environmentHash: expectedEnvironmentHash,
  };
}

export async function authenticateCapture(credential: Request | string, db: D1Database, config: MobileAuthConfig): Promise<CaptureContext> {
  const raw = bearer(credential);
  if (isMobileCredential(raw)) throw new MobileAuthError('wrong_credential_type', 'A capture credential is required.', 403);
  const credentialHash = await hashSecret(raw);
  const current = now(config);
  const row = await db.prepare(`SELECT c.id, c.device_id, c.credential_type, c.scope, c.generation, c.expires_at, c.revoked_at, c.environment_hash,
      d.ledger_id, d.status
    FROM capture_credentials c JOIN mobile_devices d ON d.id = c.device_id
    WHERE c.credential_hash = ?`).bind(credentialHash).first<{
    id: string;
    device_id: string;
    credential_type: string;
    scope: string;
    generation: number;
    expires_at: string;
    revoked_at: string | null;
    environment_hash: string;
    ledger_id: LedgerId;
    status: string;
  }>();
  const environmentHash = await hashSecret(config.environment);
  if (!row || row.credential_type !== 'capture' || row.scope !== CAPTURE_SCOPE || row.ledger_id !== 'personal' || row.environment_hash !== environmentHash) throw new MobileAuthError('unauthorized', 'The capture credential is not valid.');
  validExpiry(row.expires_at, current);
  if (row.revoked_at || row.status === 'revoked') throw new MobileAuthError('revoked', 'The capture credential is revoked.', 401);
  const scopes = await db.prepare(`SELECT source_profile_id AS sourceProfileId, account_id AS accountId, currency,
      instrument_hint_kind AS instrumentHintKind, instrument_hint_value AS instrumentHintValue
    FROM device_source_scopes WHERE device_id = ? AND status = 'approved'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY source_profile_id, account_id, instrument_hint_kind, instrument_hint_value, currency`).bind(row.device_id, current.toISOString()).all<{
      sourceProfileId: string;
      accountId: string;
      currency: string;
      instrumentHintKind: string;
      instrumentHintValue: string;
    }>();
  return {
    credentialType: 'capture',
    ledgerId: 'personal',
    credentialId: row.id,
    deviceId: row.device_id,
    generation: row.generation,
    scope: CAPTURE_SCOPE,
    expiresAt: row.expires_at,
    sourceScopes: scopes.results.map((scope) => ({
      sourceProfileId: scope.sourceProfileId,
      accountId: scope.accountId,
      currency: scope.currency,
      instrumentHint: storedCaptureInstrumentHint(scope.instrumentHintKind, scope.instrumentHintValue),
    })),
    environmentHash,
  };
}

export async function authenticateRevocation(credential: Request | string, db: D1Database, config: MobileAuthConfig): Promise<RevocationContext> {
  const raw = bearer(credential);
  const payload = await readOpaqueCredential<{
    kind?: unknown;
    grantType?: unknown;
    grantId?: unknown;
    generation?: unknown;
    expiresAt?: unknown;
    environmentHash?: unknown;
  }>(raw, config);
  if (payload.kind !== 'revocation' || (payload.grantType !== 'owner-family' && payload.grantType !== 'capture-credential') || typeof payload.grantId !== 'string' || typeof payload.generation !== 'number' || typeof payload.expiresAt !== 'string' || typeof payload.environmentHash !== 'string') throw new MobileAuthError('wrong_credential_type', 'A revocation capability is required.', 403);
  const current = now(config);
  validExpiry(payload.expiresAt, current);
  const environmentHash = await hashSecret(config.environment);
  if (!constantTimeEqual(payload.environmentHash, environmentHash)) throw new MobileAuthError('environment_mismatch', 'The mobile environment is not valid.', 401);
  const capabilityHash = await hashSecret(raw);
  if (payload.grantType === 'owner-family') {
    const family = await db.prepare(`SELECT id, revoked_at, revocation_generation, revocation_capability_hash, refresh_expires_at
      FROM owner_session_families WHERE id = ?`).bind(payload.grantId).first<{ id: string; revoked_at: string | null; revocation_generation: number; revocation_capability_hash: string; refresh_expires_at: string }>();
    if (!family || family.revocation_generation !== payload.generation || !constantTimeEqual(family.revocation_capability_hash, capabilityHash)) throw new MobileAuthError('revocation_not_current', 'The revocation capability is no longer current.', 409);
  } else {
    const capture = await db.prepare(`SELECT id, revoked_at, generation, revocation_capability_hash, expires_at
      FROM capture_credentials WHERE id = ?`).bind(payload.grantId).first<{ id: string; revoked_at: string | null; generation: number; revocation_capability_hash: string; expires_at: string }>();
    if (!capture || capture.generation !== payload.generation || !constantTimeEqual(capture.revocation_capability_hash, capabilityHash)) throw new MobileAuthError('revocation_not_current', 'The revocation capability is no longer current.', 409);
  }
  return {
    credentialType: 'revocation',
    grantType: payload.grantType,
    grantId: payload.grantId,
    generation: payload.generation,
    expiresAt: payload.expiresAt,
    environmentHash,
  };
}

export async function revokeGrantByCapability(credential: string, db: D1Database, config: MobileAuthConfig) {
  const context = await authenticateRevocation(credential, db, config);
  const revokedAt = now(config).toISOString();
  if (context.grantType === 'owner-family') {
    await db.prepare(`UPDATE owner_session_families SET revoked_at = COALESCE(revoked_at, ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revocation_generation = ?`).bind(revokedAt, context.grantId, context.generation).run();
  } else {
    await db.prepare(`UPDATE capture_credentials SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ? AND generation = ?`).bind(revokedAt, context.grantId, context.generation).run();
  }
}

export async function assertCaptureEventScope(db: D1Database, context: CaptureContext, scope: CaptureScopeRecord, config?: Pick<MobileAuthConfig, 'now'>) {
  if (context.credentialType !== 'capture' || context.scope !== CAPTURE_SCOPE) throw new MobileAuthError('forbidden', 'The capture credential cannot write this resource.', 403);
  const allowed = context.sourceScopes.some((candidate) => candidate.sourceProfileId === scope.sourceProfileId && candidate.accountId === scope.accountId && candidate.currency === scope.currency && sameCaptureInstrumentHint(candidate.instrumentHint, scope.instrumentHint));
  if (!allowed) throw new MobileAuthError('forbidden', 'The capture credential is outside the approved source scope.', 403);
  const instrumentHint = normalizeCaptureInstrumentHint(scope.instrumentHint);
  const current = await db.prepare(`SELECT 1 AS allowed FROM device_source_scopes
    WHERE device_id = ? AND source_profile_id = ? AND account_id = ? AND currency = ? AND status = 'approved'
      AND instrument_hint_kind = ? AND instrument_hint_value = ?
      AND (expires_at IS NULL OR expires_at > ?)`).bind(
    context.deviceId, scope.sourceProfileId, scope.accountId, scope.currency,
    instrumentHint?.kind ?? 'none', instrumentHint?.value ?? '',
    config ? now(config).toISOString() : new Date().toISOString(),
  ).first<{ allowed: number }>();
  if (!current) throw new MobileAuthError('forbidden', 'The capture credential is outside the approved source scope.', 403);
}

export function authorizeMobileRoute(context: MobileContext, pathname: string, requiredScope?: OwnerScope | CaptureScope) {
  if (!pathname.startsWith('/api/mobile/v1/')) throw new MobileAuthError('forbidden', 'The credential cannot access this route.', 403);
  if (context.credentialType === 'owner') {
    if (pathname.startsWith('/api/mobile/v1/auth/') || pathname.startsWith('/api/mobile/v1/pairings') || pathname === '/api/mobile/v1/status') throw new MobileAuthError('forbidden', 'The owner credential cannot access this route.', 403);
    if (requiredScope && !context.scopes.includes(requiredScope as OwnerScope)) throw new MobileAuthError('forbidden', 'The owner session lacks the required scope.', 403);
    return context;
  }
  if (context.credentialType === 'capture') {
    if (pathname !== '/api/mobile/v1/status' && pathname !== '/api/mobile/v1/alerts') throw new MobileAuthError('forbidden', 'The capture credential cannot access this route.', 403);
    if (requiredScope !== undefined && requiredScope !== CAPTURE_SCOPE) throw new MobileAuthError('forbidden', 'The capture credential cannot access this scope.', 403);
    return context;
  }
  if (context.credentialType === 'revocation') {
    if (pathname !== '/api/mobile/v1/auth/revocations') throw new MobileAuthError('forbidden', 'The revocation capability cannot access this route.', 403);
    return context;
  }
  if (!/^\/api\/mobile\/v1\/pairings\/[^/]+\/claim$/.test(pathname)) throw new MobileAuthError('forbidden', 'The pairing verifier cannot access this route.', 403);
  return context;
}

export function requireRecentOwnerApproval(approvedAt: string, config: Pick<MobileAuthConfig, 'now'>) {
  const current = now(config).getTime();
  const approval = Date.parse(approvedAt);
  if (!Number.isFinite(approval) || approval > current || current - approval > 10 * 60 * 1000) throw new MobileAuthError('recent_approval_required', 'A recent owner approval is required.', 403);
}

export function isAllowedMobileOrigin(request: Request, config: Pick<MobileAuthConfig, 'canonicalOrigin'>) {
  try {
    const url = new URL(request.url);
    return url.protocol === 'https:' && url.origin === config.canonicalOrigin;
  } catch {
    return false;
  }
}

export function isMobileAuthPath(pathname: string) {
  return pathname === '/api/mobile/v1' || pathname.startsWith('/api/mobile/v1/') || pathname.startsWith('/api/mobile-auth/') || pathname.startsWith('/api/device-pairings/');
}

export { constantTimeEqual };
