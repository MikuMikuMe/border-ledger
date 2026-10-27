import { financialAuthorityGuard, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';
import { approvedSourceMapping, devicePublicationGuard } from './device-publication';
import type { CurrencyCode, D1Database, D1Statement } from './db-types';

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
  provider: string;
  sourceKind: string;
  displayName: string;
  parserVersion: string;
  status?: 'pending' | 'approved' | 'paused' | 'unsupported';
  config?: Record<string, unknown>;
}

export async function upsertSourceProfile(db: D1Database, authority: FinancialContext, input: SourceProfileInput) {
  const context=immutableFinancialContext(authority);
  const configJson = JSON.stringify(input.config ?? {});
  if (new TextEncoder().encode(configJson).byteLength > MAX_CONFIG_BYTES) throw new RangeError('Source profile configuration is not bounded.');
  const id=await ledgerScopedIdentifier(context,'device-record',text(input.id,'source profile id'));
  await storeBatch(db,context,[devicePublicationGuard(db,context,`NOT EXISTS (SELECT 1 FROM source_profiles WHERE (id=? AND (ledger_id<>? OR provider<>? OR source_kind<>?)) OR (ledger_id=? AND provider=? AND source_kind=? AND id<>?))`,[id,context.ledgerId,input.provider,input.sourceKind,context.ledgerId,input.provider,input.sourceKind,id]),db.prepare(`INSERT INTO source_profiles
    (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ledger_id, provider, source_kind) DO UPDATE SET
      display_name = excluded.display_name,
      parser_version = excluded.parser_version,
      status = excluded.status,
      config_json = excluded.config_json,
      updated_at = CURRENT_TIMESTAMP`).bind(
    id,
    context.ledgerId,
    text(input.provider, 'source provider', 64),
    text(input.sourceKind, 'source kind', 64),
    text(input.displayName, 'source display name', 256),
    text(input.parserVersion, 'parser version', 128),
    input.status ?? 'pending',
    configJson,
  )]);
  return id;
}

export interface DevicePairingInput {
  deviceId: string;
  pairingId: string;
  deviceName: string;
  platform: string;
  deviceVerifierHash: string;
  userCodeHash: string;
  expiresAt: string;
}

export async function createDevicePairing(db: D1Database, authority: FinancialContext, input: DevicePairingInput) {
  const context=immutableFinancialContext(authority);
  const expiresAt = iso(input.expiresAt, 'pairing expiry');
  const deviceId=await ledgerScopedIdentifier(context,'device',text(input.deviceId,'device id'));
  const pairingId=await ledgerScopedIdentifier(context,'pairing',text(input.pairingId,'pairing id'));
  await storeBatch(db,context,[
    db.prepare(`INSERT INTO mobile_devices
      (id, ledger_id, device_name, platform, status, expires_at)
      VALUES (?, ?, ?, ?, 'pairing', ?)`).bind(
      deviceId,
      context.ledgerId,
      text(input.deviceName, 'device name'),
      text(input.platform, 'device platform', 64),
      expiresAt,
    ),
    db.prepare(`INSERT INTO device_pairings
      (id, ledger_id, device_id, device_verifier_hash, user_code_hash, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(
      pairingId,
      context.ledgerId,
      deviceId,
      text(input.deviceVerifierHash, 'device verifier hash', 128),
      text(input.userCodeHash, 'user code hash', 128),
      expiresAt,
    ),
  ]);
  return {deviceId,pairingId};
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

export async function issueSecureCaptureCredential(db:D1Database,authority:FinancialContext,input:SecureCaptureCredentialInput) {
  const security={environmentHash:text(input.environmentHash,'capture environment hash'),revocationCapabilityHash:text(input.revocationCapabilityHash,'capture revocation hash')};
  return storeCaptureCredential(db,immutableFinancialContext(authority),input,security);
}

export async function revokeCaptureCredentialsForDevice(db:D1Database,authority:FinancialContext,deviceId:string,revokedAt:string) {
  const context=immutableFinancialContext(authority);
  await storeBatch(db,context,[db.prepare(`UPDATE capture_credentials SET revoked_at=COALESCE(revoked_at,?)
    WHERE device_id=? AND ledger_id=?`).bind(iso(revokedAt,'capture revocation time'),text(deviceId,'capture device id'),context.ledgerId)]);
}

/** Operator/test bootstrap for legacy credentials; foreground issuance uses the consent service. */
export async function issueCaptureCredential(db:D1Database,authority:FinancialContext,input:CaptureCredentialInput) {
  return storeCaptureCredential(db,immutableFinancialContext(authority),input,{environmentHash:'',revocationCapabilityHash:''});
}

async function storeCaptureCredential(db:D1Database,context:FinancialContext,input:CaptureCredentialInput,security:{environmentHash:string;revocationCapabilityHash:string}) {
  const issuedAt=iso(input.issuedAt,'capture issued at');
  const expiresAt=iso(input.expiresAt,'capture expiry');
  const lifetime=Date.parse(expiresAt)-Date.parse(issuedAt);
  if(lifetime<=0 || lifetime>MAX_CAPTURE_LIFETIME_MS)throw new RangeError('Capture credentials cannot exceed 90 days.');
  if(!Number.isInteger(input.generation) || input.generation<1)throw new RangeError('Capture credential generation must be positive.');
  const id=await ledgerScopedIdentifier(context,'device-record',text(input.id,'capture credential id'));
  await storeBatch(db,context,[pairedDeviceGuard(db,context,input.deviceId),db.prepare(`INSERT INTO capture_credentials
    (id,ledger_id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at,environment_hash,revocation_capability_hash)
    VALUES (?,?,?,?,'capture','alerts:write',?,?,?,?,?)`).bind(id,context.ledgerId,text(input.deviceId,'capture device id'),text(input.credentialHash,'capture credential hash',128),input.generation,issuedAt,expiresAt,security.environmentHash,security.revocationCapabilityHash)]);
  return id;
}

export interface DeviceSourceScopeInput {
  id: string;
  deviceId: string;
  sourceProfileId: string;
  accountId: string;
  currency: CurrencyCode;
  expiresAt?: string | null;
  instrumentHint?: {kind:string;value:string};
}

export async function approveDeviceSourceScope(db: D1Database, authority: FinancialContext, input: DeviceSourceScopeInput) {
  const context=immutableFinancialContext(authority);
  if (input.expiresAt) iso(input.expiresAt, 'scope expiry');
  const mapping=approvedSourceMapping(context,{...input,allowedCurrencies:[input.currency]},input.currency);
  await storeBatch(db,context,[pairedDeviceGuard(db,context,input.deviceId),devicePublicationGuard(db,context,mapping.sql,mapping.bindings),db.prepare(`INSERT INTO device_source_scopes
    (id, ledger_id, device_id, source_profile_id, account_id, currency, status, expires_at, instrument_hint_kind, instrument_hint_value)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`).bind(
    await ledgerScopedIdentifier(context, 'device-record', text(input.id, 'scope id')),
    context.ledgerId,
    text(input.deviceId, 'scope device id'),
    text(input.sourceProfileId, 'scope source profile'),
    text(input.accountId, 'scope account id'),
    text(input.currency, 'scope currency', 12),
    input.expiresAt ?? null,
    input.instrumentHint?.kind ?? 'none', input.instrumentHint?.value ?? '',
  )]);
}

export interface SourceProfileHintInput {
  id: string;
  sourceProfileId: string;
  hintKind: string;
  hintValue: string;
}

export async function addSourceProfileHint(db: D1Database, authority: FinancialContext, input: SourceProfileHintInput) {
  const context=immutableFinancialContext(authority);
  await storeBatch(db,context,[db.prepare(`INSERT INTO source_profile_hints (id, ledger_id, source_profile_id, hint_kind, hint_value)
    VALUES (?, ?, ?, ?, ?)`).bind(
    await ledgerScopedIdentifier(context, 'device-record', text(input.id, 'source hint id')),
    context.ledgerId,
    text(input.sourceProfileId, 'source hint profile'),
    text(input.hintKind, 'source hint kind', 64),
    text(input.hintValue, 'source hint value', 256),
  )]);
}

export interface SourceAccountMappingInput {
  id: string;
  sourceProfileId: string;
  hintKind?: string;
  hintValue?: string;
  accountId: string;
  approvedAt: string;
}

export async function approveSourceAccountMapping(db: D1Database, authority: FinancialContext, input: SourceAccountMappingInput) {
  const context=immutableFinancialContext(authority);
  const hintKind=input.hintKind??'none';const hintValue=input.hintValue??'';
  const allowed=devicePublicationGuard(db,context,`EXISTS (SELECT 1 FROM source_profiles p JOIN accounts a ON a.ledger_id=p.ledger_id
    WHERE p.id=? AND p.ledger_id=? AND p.status='approved' AND a.id=? AND
    ((?='none' AND ?='') OR EXISTS (SELECT 1 FROM source_profile_hints h WHERE h.ledger_id=p.ledger_id AND h.source_profile_id=p.id AND h.hint_kind=? AND h.hint_value=?)))`,
    [input.sourceProfileId,context.ledgerId,input.accountId,hintKind,hintValue,hintKind,hintValue]);
  await storeBatch(db,context,[allowed,db.prepare(`INSERT INTO source_account_mappings
    (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)`).bind(
    await ledgerScopedIdentifier(context, 'device-record', text(input.id, 'source mapping id')),
    context.ledgerId,
    text(input.sourceProfileId, 'mapping source profile'),
    text(input.hintKind ?? 'none', 'mapping hint kind', 64),
    input.hintValue ? text(input.hintValue, 'mapping hint value', 256) : '',
    text(input.accountId, 'mapping account id'),
    iso(input.approvedAt, 'mapping approval time'),
  )]);
}

export async function revokeCaptureCredential(db:D1Database,authority:FinancialContext,credentialId:string,revokedAt:string) {
  const context=immutableFinancialContext(authority);
  await storeBatch(db,context,[db.prepare('UPDATE capture_credentials SET revoked_at=? WHERE id=? AND ledger_id=? AND revoked_at IS NULL')
    .bind(iso(revokedAt,'revoked at'),text(credentialId,'capture credential id'),context.ledgerId)]);
}

function storeBatch(db:D1Database,context:FinancialContext,statements:D1Statement[]) {
  return db.batch([financialAuthorityGuard(db,context,'devices:manage'),...statements]);
}
function pairedDeviceGuard(db:D1Database,context:FinancialContext,deviceId:string) {
  return devicePublicationGuard(db,context,"EXISTS (SELECT 1 FROM mobile_devices WHERE id=? AND ledger_id=? AND status='paired' AND revoked_at IS NULL)",[deviceId,context.ledgerId]);
}
