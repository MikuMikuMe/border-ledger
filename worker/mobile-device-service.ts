import type { D1Database } from './db-types';
import { getCurrencyMeta, supportedCurrencyCodes } from '../src/domain/currencies';
import {
  createOpaqueCredential,
  hashSecret,
  isoAfter,
  now,
  requireRecentOwnerApproval,
  type MobileAuthConfig,
  type OwnerContext,
} from './mobile-auth';

const CAPTURE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CONFIG_MAPPINGS = 100;
export const MAX_ALLOWED_CURRENCIES = supportedCurrencyCodes.length;

export interface InstrumentHint {
  kind: string;
  value: string;
}

export interface SourceMappingInput {
  sourceProfileId: string;
  accountId: string;
  instrumentHint?: InstrumentHint | null;
  allowedCurrencies: string[];
}

export interface SourceConfigInput {
  expectedRevision: number;
  mappings: SourceMappingInput[];
}

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  status: string;
  credentialExpiresAt: string | null;
  revokedAt: string | null;
  sourceConfig: {
    expectedRevision: number;
    mappings: SourceMappingInput[];
  };
  revision: number;
}

export class MobileDeviceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentRevision?: number;

  constructor(code: string, message: string, status = 400, currentRevision?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.currentRevision = currentRevision;
    this.name = 'MobileDeviceError';
  }
}

interface DeviceRow {
  id: string;
  ledger_id: 'personal';
  device_name: string;
  platform: string;
  status: string;
  expires_at: string | null;
  revoked_at: string | null;
  source_config_revision: number;
}

function bounded(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new MobileDeviceError('invalid_request', `The ${field} is not valid.`);
  return value;
}

function safeRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new MobileDeviceError('invalid_request', 'The source configuration revision is not valid.');
  return value as number;
}

function sourceConfig(value: unknown): SourceConfigInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MobileDeviceError('invalid_request', 'The source configuration is not valid.');
  const body = value as Record<string, unknown>;
  const rawMappings = body.mappings;
  if (!Array.isArray(rawMappings) || rawMappings.length < 1 || rawMappings.length > MAX_CONFIG_MAPPINGS) throw new MobileDeviceError('invalid_request', 'At least one source mapping is required.');
  const seen = new Set<string>();
  const mappings = rawMappings.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MobileDeviceError('invalid_request', 'A source mapping is not valid.');
    const item = raw as Record<string, unknown>;
    const sourceProfileId = bounded(item.sourceProfileId, 'source profile', 128);
    const accountId = bounded(item.accountId, 'account', 128);
    if (!Array.isArray(item.allowedCurrencies) || item.allowedCurrencies.length < 1 || item.allowedCurrencies.length > MAX_ALLOWED_CURRENCIES) throw new MobileDeviceError('invalid_request', 'The allowed currencies are not valid.');
    const allowedCurrencies = item.allowedCurrencies.map((currency) => bounded(currency, 'currency', 12));
    if (allowedCurrencies.some((currency) => !getCurrencyMeta(currency))) throw new MobileDeviceError('invalid_request', 'The allowed currencies are not registered ISO codes.');
    const currencySet = new Set(allowedCurrencies);
    if (currencySet.size !== allowedCurrencies.length) throw new MobileDeviceError('invalid_request', 'Allowed currencies must be unique.');
    const hint = item.instrumentHint;
    let instrumentHint: InstrumentHint | null = null;
    if (hint !== undefined && hint !== null) {
      if (typeof hint !== 'object' || Array.isArray(hint)) throw new MobileDeviceError('invalid_request', 'The instrument hint is not valid.');
      const hintBody = hint as Record<string, unknown>;
      instrumentHint = { kind: bounded(hintBody.kind, 'instrument hint kind', 64), value: bounded(hintBody.value, 'instrument hint value', 256) };
    }
    const key = `${sourceProfileId}\u0000${accountId}\u0000${instrumentHint?.kind ?? ''}\u0000${instrumentHint?.value ?? ''}`;
    if (seen.has(key)) throw new MobileDeviceError('invalid_request', 'Source mappings must be unique.');
    seen.add(key);
    return { sourceProfileId, accountId, instrumentHint, allowedCurrencies };
  });
  return { expectedRevision: safeRevision(body.expectedRevision), mappings };
}

async function readDeviceRow(db: D1Database, deviceId: string) {
  return db.prepare(`SELECT id, ledger_id, device_name, platform, status, expires_at, revoked_at, source_config_revision
    FROM mobile_devices WHERE id = ? AND ledger_id = 'personal'`).bind(bounded(deviceId, 'device id', 128)).first<DeviceRow>();
}

async function approvedMappingCount(db: D1Database, mapping: SourceMappingInput) {
  const source = await db.prepare(`SELECT id FROM source_profiles WHERE id = ? AND ledger_id = 'personal' AND status = 'approved'`).bind(mapping.sourceProfileId).first<{ id: string }>();
  if (!source) throw new MobileDeviceError('forbidden', 'The source profile is not approved.', 403);
  for (const currency of mapping.allowedCurrencies) {
    const allowed = await db.prepare(`SELECT 1 AS allowed FROM account_currencies WHERE account_id = ? AND currency = ?`).bind(mapping.accountId, currency).first<{ allowed: number }>();
    if (!allowed) throw new MobileDeviceError('forbidden', 'The account currency is not approved.', 403);
  }
  const approved = await db.prepare(`SELECT account_id, hint_kind, hint_value FROM source_account_mappings
    WHERE ledger_id = 'personal' AND source_profile_id = ? AND approval_status = 'approved'`).bind(mapping.sourceProfileId).all<{ account_id: string; hint_kind: string; hint_value: string }>();
  const matches = mapping.instrumentHint
    ? approved.results.filter((item) => item.account_id === mapping.accountId && item.hint_kind === mapping.instrumentHint!.kind && item.hint_value === mapping.instrumentHint!.value)
    : approved.results.filter((item) => item.account_id === mapping.accountId && item.hint_kind === 'none' && item.hint_value === '');
  if (matches.length !== 1) throw new MobileDeviceError('forbidden', 'The source mapping is not approved for this account.', 403);
  return matches.length;
}

async function validateSourceConfig(db: D1Database, input: SourceConfigInput) {
  for (const mapping of input.mappings) await approvedMappingCount(db, mapping);
}

async function readMappings(db: D1Database, deviceId: string): Promise<SourceMappingInput[]> {
  const rows = await db.prepare(`SELECT source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value
    FROM device_source_scopes WHERE device_id = ? AND status = 'approved'
    ORDER BY source_profile_id, account_id, instrument_hint_kind, instrument_hint_value, currency`).bind(deviceId).all<{
      source_profile_id: string;
      account_id: string;
      currency: string;
      instrument_hint_kind: string;
      instrument_hint_value: string;
    }>();
  const groups = new Map<string, SourceMappingInput>();
  for (const row of rows.results) {
    const instrumentHint = row.instrument_hint_kind === 'none' && row.instrument_hint_value === ''
      ? null
      : { kind: row.instrument_hint_kind, value: row.instrument_hint_value };
    const key = `${row.source_profile_id}\u0000${row.account_id}\u0000${row.instrument_hint_kind}\u0000${row.instrument_hint_value}`;
    const existing = groups.get(key);
    if (existing) existing.allowedCurrencies.push(row.currency);
    else groups.set(key, { sourceProfileId: row.source_profile_id, accountId: row.account_id, instrumentHint, allowedCurrencies: [row.currency] });
  }
  return [...groups.values()];
}

export async function readDevice(db: D1Database, deviceId: string): Promise<DeviceView> {
  const row = await readDeviceRow(db, deviceId);
  if (!row) throw new MobileDeviceError('not_found', 'The mobile device was not found.', 404);
  const latestCredential = await db.prepare(`SELECT expires_at FROM capture_credentials
    WHERE device_id = ? AND revoked_at IS NULL ORDER BY generation DESC LIMIT 1`).bind(row.id).first<{ expires_at: string }>();
  return {
    id: row.id,
    name: row.device_name,
    platform: row.platform,
    status: row.status,
    credentialExpiresAt: latestCredential?.expires_at ?? row.expires_at,
    revokedAt: row.revoked_at,
    sourceConfig: { expectedRevision: row.source_config_revision, mappings: await readMappings(db, row.id) },
    revision: row.source_config_revision,
  };
}

export async function readDevices(db: D1Database): Promise<DeviceView[]> {
  const rows = await db.prepare(`SELECT id FROM mobile_devices WHERE ledger_id = 'personal' ORDER BY created_at, id`).all<{ id: string }>();
  return Promise.all(rows.results.map((row) => readDevice(db, row.id)));
}

export async function replaceDeviceSourceConfig(db: D1Database, deviceId: string, input: unknown): Promise<DeviceView> {
  const config = sourceConfig(input);
  const row = await readDeviceRow(db, deviceId);
  if (!row) throw new MobileDeviceError('not_found', 'The mobile device was not found.', 404);
  if (row.status === 'revoked') throw new MobileDeviceError('revoked', 'The mobile device is revoked.', 409);
  if (config.expectedRevision !== row.source_config_revision) throw new MobileDeviceError('revision_conflict', 'The source configuration revision is stale.', 409, row.source_config_revision);
  await validateSourceConfig(db, config);
  const updated = await db.prepare(`UPDATE mobile_devices SET source_config_revision = source_config_revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND ledger_id = 'personal' AND status <> 'revoked' AND source_config_revision = ?`).bind(deviceId, config.expectedRevision).run();
  if (updated.meta?.changes !== 1) {
    const current = await readDeviceRow(db, deviceId);
    throw new MobileDeviceError('revision_conflict', 'The source configuration revision is stale.', 409, current?.source_config_revision);
  }
  await db.batch([
    db.prepare(`DELETE FROM device_source_scopes WHERE device_id = ?`).bind(deviceId),
    ...config.mappings.flatMap((mapping) => mapping.allowedCurrencies.map((currency) => db.prepare(`INSERT INTO device_source_scopes
      (id, device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NULL)`).bind(
      crypto.randomUUID(), deviceId, mapping.sourceProfileId, mapping.accountId, currency,
      mapping.instrumentHint?.kind ?? 'none', mapping.instrumentHint?.value ?? '',
    ))),
  ]);
  return readDevice(db, deviceId);
}

export async function issueCaptureAuthorization(db: D1Database, owner: OwnerContext, input: unknown, config: MobileAuthConfig) {
  if (!owner.deviceId) throw new MobileDeviceError('device_required', 'The owner session is not bound to a device.', 403);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MobileDeviceError('invalid_request', 'The capture authorization is not valid.');
  const body = input as Record<string, unknown>;
  if (body.consent !== true) throw new MobileDeviceError('consent_required', 'Explicit capture consent is required.', 403);
  const credentialHash = bounded(body.credentialHash, 'credential hash', 128);
  if (!/^[A-Fa-f0-9]{64}$/.test(credentialHash)) throw new MobileDeviceError('invalid_request', 'The capture credential hash is not valid.');
  const device = await readDevice(db, owner.deviceId);
  const updated = await replaceDeviceSourceConfig(db, owner.deviceId, body.sourceConfig);
  const at = now(config);
  const expiresAt = isoAfter(at, CAPTURE_LIFETIME_MS);
  const current = await db.prepare(`SELECT generation FROM capture_credentials WHERE device_id = ? ORDER BY generation DESC LIMIT 1`).bind(owner.deviceId).first<{ generation: number }>();
  const generation = (current?.generation ?? 0) + 1;
  const credentialId = crypto.randomUUID();
  const revocationCapability = await createOpaqueCredential({ kind: 'revocation', grantType: 'capture-credential', grantId: credentialId, generation, expiresAt, environmentHash: await hashSecret(config.environment) }, config);
  const environmentHash = await hashSecret(config.environment);
  await db.batch([
    db.prepare(`UPDATE capture_credentials SET revoked_at = COALESCE(revoked_at, ?)
      WHERE device_id = ? AND revoked_at IS NULL`).bind(at.toISOString(), owner.deviceId),
    db.prepare(`UPDATE mobile_devices SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(expiresAt, owner.deviceId),
    db.prepare(`INSERT INTO capture_credentials
      (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash)
      VALUES (?, ?, ?, 'capture', 'alerts:write', ?, ?, ?, ?, ?)`).bind(credentialId, owner.deviceId, credentialHash, generation, at.toISOString(), expiresAt, environmentHash, await hashSecret(revocationCapability)),
  ]);
  return { ...updated, deviceId: device.id, generation, credentialExpiresAt: expiresAt, revocationCapability };
}

export async function revokeDevice(db: D1Database, owner: OwnerContext, deviceId: string, config: MobileAuthConfig) {
  const row = await readDeviceRow(db, deviceId);
  if (!row) throw new MobileDeviceError('not_found', 'The mobile device was not found.', 404);
  if (owner.deviceId !== deviceId) {
    const family = await db.prepare(`SELECT created_at FROM owner_session_families WHERE id = ? AND ledger_id = 'personal'`).bind(owner.familyId).first<{ created_at: string }>();
    if (!family) throw new MobileDeviceError('recent_approval_required', 'A recent owner approval is required.', 403);
    try {
      requireRecentOwnerApproval(family.created_at, config);
    } catch {
      throw new MobileDeviceError('recent_approval_required', 'A recent owner approval is required.', 403);
    }
  }
  const revokedAt = now(config).toISOString();
  await db.batch([
    db.prepare(`UPDATE mobile_devices SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ledger_id = 'personal'`).bind(revokedAt, deviceId),
    db.prepare(`UPDATE capture_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?`).bind(revokedAt, deviceId),
  ]);
}

