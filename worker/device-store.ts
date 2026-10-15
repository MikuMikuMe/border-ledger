import type { CurrencyCode, D1Database, LedgerId } from './db-types';

const MAX_TEXT = 256;
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_CAPTURE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function text(value: string, field: string, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

function iso(value: string, field: string) {
  text(value, field, 64);
  if (Number.isNaN(Date.parse(value))) throw new RangeError(`${field} must be an ISO timestamp.`);
  return value;
}

export interface SourceProfileInput {
  id: string;
  ledgerId?: LedgerId;
  provider: string;
  sourceKind: string;
  displayName: string;
  parserVersion: string;
  status?: 'pending' | 'approved' | 'paused' | 'unsupported';
  config?: Record<string, unknown>;
}

export async function upsertSourceProfile(db: D1Database, input: SourceProfileInput) {
  const configJson = JSON.stringify(input.config ?? {});
  if (new TextEncoder().encode(configJson).byteLength > MAX_CONFIG_BYTES) throw new RangeError('Source profile configuration is not bounded.');
  await db.prepare(`INSERT INTO source_profiles
    (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ledger_id, provider, source_kind) DO UPDATE SET
      display_name = excluded.display_name,
      parser_version = excluded.parser_version,
      status = excluded.status,
      config_json = excluded.config_json,
      updated_at = CURRENT_TIMESTAMP`).bind(
    text(input.id, 'source profile id'),
    input.ledgerId ?? 'personal',
    text(input.provider, 'source provider', 64),
    text(input.sourceKind, 'source kind', 64),
    text(input.displayName, 'source display name', 256),
    text(input.parserVersion, 'parser version', 128),
    input.status ?? 'pending',
    configJson,
  ).run();
}

export interface DevicePairingInput {
  deviceId: string;
  pairingId: string;
  ledgerId?: LedgerId;
  deviceName: string;
  platform: string;
  deviceVerifierHash: string;
  userCodeHash: string;
  expiresAt: string;
}

export async function createDevicePairing(db: D1Database, input: DevicePairingInput) {
  const expiresAt = iso(input.expiresAt, 'pairing expiry');
  await db.batch([
    db.prepare(`INSERT INTO mobile_devices
      (id, ledger_id, device_name, platform, status, expires_at)
      VALUES (?, ?, ?, ?, 'pairing', ?)`).bind(
      text(input.deviceId, 'device id'),
      input.ledgerId ?? 'personal',
      text(input.deviceName, 'device name'),
      text(input.platform, 'device platform', 64),
      expiresAt,
    ),
    db.prepare(`INSERT INTO device_pairings
      (id, ledger_id, device_id, device_verifier_hash, user_code_hash, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(
      text(input.pairingId, 'pairing id'),
      input.ledgerId ?? 'personal',
      input.deviceId,
      text(input.deviceVerifierHash, 'device verifier hash', 128),
      text(input.userCodeHash, 'user code hash', 128),
      expiresAt,
    ),
  ]);
}

export interface CaptureCredentialInput {
  id: string;
  deviceId: string;
  credentialHash: string;
  generation: number;
  issuedAt: string;
  expiresAt: string;
}

export interface SecureCaptureCredentialInput extends CaptureCredentialInput {
  environmentHash: string;
  revocationCapabilityHash: string;
}

export async function issueSecureCaptureCredential(db: D1Database, input: SecureCaptureCredentialInput) {
  const issuedAt = iso(input.issuedAt, 'capture issued at');
  const expiresAt = iso(input.expiresAt, 'capture expiry');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > MAX_CAPTURE_LIFETIME_MS) throw new RangeError('Capture credentials cannot exceed 90 days.');
  if (!Number.isInteger(input.generation) || input.generation < 1) throw new RangeError('Capture credential generation must be positive.');
  await db.prepare(`INSERT INTO capture_credentials
    (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash)
    VALUES (?, ?, ?, 'capture', 'alerts:write', ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'capture credential id'),
    text(input.deviceId, 'capture device id'),
    text(input.credentialHash, 'capture credential hash', 128),
    input.generation,
    issuedAt,
    expiresAt,
    text(input.environmentHash, 'capture environment hash'),
    text(input.revocationCapabilityHash, 'capture revocation hash'),
  ).run();
}

export async function revokeCaptureCredentialsForDevice(db: D1Database, deviceId: string, revokedAt: string) {
  return db.prepare(`UPDATE capture_credentials SET revoked_at = COALESCE(revoked_at, ?)
    WHERE device_id = ?`).bind(iso(revokedAt, 'capture revocation time'), text(deviceId, 'capture device id')).run();
}

export async function issueCaptureCredential(db: D1Database, input: CaptureCredentialInput) {
  const issuedAt = iso(input.issuedAt, 'capture issued at');
  const expiresAt = iso(input.expiresAt, 'capture expiry');
  const issuedMillis = Date.parse(issuedAt);
  const expiresMillis = Date.parse(expiresAt);
  if (expiresMillis <= issuedMillis || expiresMillis - issuedMillis > MAX_CAPTURE_LIFETIME_MS) throw new RangeError('Capture credentials cannot exceed 90 days.');
  if (!Number.isInteger(input.generation) || input.generation < 1) throw new RangeError('Capture credential generation must be positive.');
  await db.prepare(`INSERT INTO capture_credentials
    (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at)
    VALUES (?, ?, ?, 'capture', 'alerts:write', ?, ?, ?)`).bind(
    text(input.id, 'capture credential id'),
    text(input.deviceId, 'capture device id'),
    text(input.credentialHash, 'capture credential hash', 128),
    input.generation,
    issuedAt,
    expiresAt,
  ).run();
}

export interface DeviceSourceScopeInput {
  id: string;
  deviceId: string;
  sourceProfileId: string;
  accountId: string;
  currency: CurrencyCode;
  expiresAt?: string | null;
}

export async function approveDeviceSourceScope(db: D1Database, input: DeviceSourceScopeInput) {
  if (input.expiresAt) iso(input.expiresAt, 'scope expiry');
  await db.prepare(`INSERT INTO device_source_scopes
    (id, device_id, source_profile_id, account_id, currency, status, expires_at)
    VALUES (?, ?, ?, ?, ?, 'approved', ?)`).bind(
    text(input.id, 'scope id'),
    text(input.deviceId, 'scope device id'),
    text(input.sourceProfileId, 'scope source profile'),
    text(input.accountId, 'scope account id'),
    text(input.currency, 'scope currency', 12),
    input.expiresAt ?? null,
  ).run();
}

export interface SourceProfileHintInput {
  id: string;
  sourceProfileId: string;
  hintKind: string;
  hintValue: string;
}

export async function addSourceProfileHint(db: D1Database, input: SourceProfileHintInput) {
  await db.prepare(`INSERT INTO source_profile_hints (id, source_profile_id, hint_kind, hint_value)
    VALUES (?, ?, ?, ?)`).bind(
    text(input.id, 'source hint id'),
    text(input.sourceProfileId, 'source hint profile'),
    text(input.hintKind, 'source hint kind', 64),
    text(input.hintValue, 'source hint value', 256),
  ).run();
}

export interface SourceAccountMappingInput {
  id: string;
  ledgerId?: LedgerId;
  sourceProfileId: string;
  hintKind?: string;
  hintValue?: string;
  accountId: string;
  approvedAt: string;
}

export async function approveSourceAccountMapping(db: D1Database, input: SourceAccountMappingInput) {
  await db.prepare(`INSERT INTO source_account_mappings
    (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)`).bind(
    text(input.id, 'source mapping id'),
    input.ledgerId ?? 'personal',
    text(input.sourceProfileId, 'mapping source profile'),
    text(input.hintKind ?? 'none', 'mapping hint kind', 64),
    input.hintValue ? text(input.hintValue, 'mapping hint value', 256) : '',
    text(input.accountId, 'mapping account id'),
    iso(input.approvedAt, 'mapping approval time'),
  ).run();
}

export async function revokeCaptureCredential(db: D1Database, credentialId: string, revokedAt: string) {
  await db.prepare(`UPDATE capture_credentials SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL`).bind(iso(revokedAt, 'revoked at'), text(credentialId, 'capture credential id')).run();
}
