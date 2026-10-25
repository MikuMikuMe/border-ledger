import { assertFinancialAuthority, financialAuthorityGuard, financialAuthorityPredicate, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { approvedSourceMapping, devicePublicationGuard, sourceConfigStatements } from './device-publication';
import type { D1Database, D1Statement } from './db-types';
import { prepareConsentedCaptureDevice } from './mobile-capture-device-binding';
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
  ledger_id: string;
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

async function readDeviceRow(db: D1Database, context: FinancialContext, deviceId: string) {
  return db.prepare(`SELECT id, ledger_id, device_name, platform, status, expires_at, revoked_at, source_config_revision
    FROM mobile_devices WHERE id = ? AND ledger_id = ?`).bind(bounded(deviceId, 'device id', 128), context.ledgerId).first<DeviceRow>();
}

async function validateSourceConfig(db:D1Database, context:FinancialContext, input:SourceConfigInput) {
  for(const mapping of input.mappings) for(const currency of mapping.allowedCurrencies) {
    const allowed=approvedSourceMapping(context,mapping,currency);
    if(!await db.prepare(`SELECT 1 WHERE ${allowed.sql}`).bind(...allowed.bindings).first())
      throw new MobileDeviceError('forbidden','The source mapping, hint or account currency is not approved.',403);
  }
}

async function readMappings(db: D1Database, context: FinancialContext, deviceId: string): Promise<SourceMappingInput[]> {
  const rows = await db.prepare(`SELECT source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value
    FROM device_source_scopes WHERE device_id = ? AND ledger_id = ? AND status = 'approved'
    ORDER BY source_profile_id, account_id, instrument_hint_kind, instrument_hint_value, currency`).bind(deviceId, context.ledgerId).all<{
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

export async function readDevice(db: D1Database, input: FinancialContext, deviceId: string): Promise<DeviceView> {
  const context=immutableFinancialContext(input);
  await assertFinancialAuthority(db,context,'devices:manage');
  const row = await readDeviceRow(db, context, deviceId);
  if (!row) throw new MobileDeviceError('not_found', 'The mobile device was not found.', 404);
  const latestCredential = await db.prepare(`SELECT expires_at FROM capture_credentials
    WHERE device_id = ? AND ledger_id = ? AND revoked_at IS NULL ORDER BY generation DESC LIMIT 1`).bind(row.id, context.ledgerId).first<{ expires_at: string }>();
  const mappings=await readMappings(db,context,row.id);
  await assertFinancialAuthority(db,context,'devices:manage');
  return {
    id: row.id,
    name: row.device_name,
    platform: row.platform,
    status: row.status,
    credentialExpiresAt: latestCredential?.expires_at ?? row.expires_at,
    revokedAt: row.revoked_at,
    sourceConfig: { expectedRevision: row.source_config_revision, mappings },
    revision: row.source_config_revision,
  };
}

export async function readDevices(db:D1Database,input:FinancialContext):Promise<DeviceView[]> {
  const context=immutableFinancialContext(input);
  await assertFinancialAuthority(db,context,'devices:manage');
  const rows=await db.prepare('SELECT id FROM mobile_devices WHERE ledger_id=? ORDER BY created_at,id').bind(context.ledgerId).all<{id:string}>();
  const devices=await Promise.all(rows.results.map(row=>readDevice(db,context,row.id)));
  await assertFinancialAuthority(db,context,'devices:manage');
  return devices;
}

export async function replaceDeviceSourceConfig(db:D1Database,input:FinancialContext,deviceId:string,body:unknown):Promise<DeviceView> {
  const context=immutableFinancialContext(input);
  const config=sourceConfig(body);
  await assertFinancialAuthority(db,context,'devices:manage');
  requireWritableDevice(await readDeviceRow(db,context,deviceId),config);
  await validateSourceConfig(db,context,config);
  await publishDeviceConfiguration(db,context,{deviceId,config},[financialAuthorityGuard(db,context,'devices:manage'),...sourceConfigStatements(db,context,deviceId,config)]);
  return readDevice(db,context,deviceId);
}

function isDeviceGuardFailure(error:unknown) {
  const cause=error instanceof Error?error.cause:undefined;
  return [error,cause].some(value=>/NOT NULL constraint failed: ledger_preferences\.ledger_id|ledger_preferences ledger mismatch/.test(String(value)));
}

async function publishDeviceConfiguration(db:D1Database,context:FinancialContext,update:{deviceId:string;config:SourceConfigInput},statements:D1Statement[]) {
  try {await db.batch(statements);} catch(error) {
    await assertFinancialAuthority(db,context,'devices:manage');
    if(!isDeviceGuardFailure(error))throw error;
    const current=await readDeviceRow(db,context,update.deviceId);
    await assertFinancialAuthority(db,context,'devices:manage');
    if(current && current.source_config_revision!==update.config.expectedRevision)
      throw new MobileDeviceError('revision_conflict','The source configuration revision is stale.',409,current.source_config_revision);
    throw error;
  }
}

function requireWritableDevice(row: DeviceRow | null, config: SourceConfigInput): DeviceRow {
  if (!row) throw new MobileDeviceError('not_found', 'The mobile device was not found.', 404);
  if (row.status === 'revoked') throw new MobileDeviceError('revoked', 'The mobile device is revoked.', 409);
  if (config.expectedRevision !== row.source_config_revision) throw new MobileDeviceError('revision_conflict', 'The source configuration revision is stale.', 409, row.source_config_revision);
  return row;
}

function isCaptureAuthorizationBody(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function captureAuthorizationInput(input: unknown) {
  if (!isCaptureAuthorizationBody(input)) throw new MobileDeviceError('invalid_request', 'The capture authorization is not valid.');
  const body = input;
  if (body.consent !== true) throw new MobileDeviceError('consent_required', 'Explicit capture consent is required.', 403);
  const credentialHash = bounded(body.credentialHash, 'credential hash', 128);
  if (!/^[A-Fa-f0-9]{64}$/.test(credentialHash)) throw new MobileDeviceError('invalid_request', 'The capture credential hash is not valid.');
  const captureConfig = sourceConfig(body.sourceConfig);
  return { credentialHash, captureConfig };
}

export async function issueCaptureAuthorization(db:D1Database,inputOwner:OwnerContext,input:unknown,config:MobileAuthConfig) {
  const owner=immutableFinancialContext(inputOwner);
  const {credentialHash,captureConfig}=captureAuthorizationInput(input);
  await assertFinancialAuthority(db,owner,'devices:manage');
  await validateSourceConfig(db,owner,captureConfig);
  const plan=await prepareConsentedCaptureDevice(db,{...owner,consent:true},config);
  const deviceId=plan.deviceId;
  if(plan.newDevice && captureConfig.expectedRevision!==0)throw new MobileDeviceError('revision_conflict','A new capture device must start at revision zero.',409,0);
  if(!plan.newDevice)requireWritableDevice(await readDeviceRow(db,owner,deviceId),captureConfig);
  const current=await db.prepare('SELECT generation FROM capture_credentials WHERE device_id=? AND ledger_id=? ORDER BY generation DESC LIMIT 1').bind(deviceId,owner.ledgerId).first<{generation:number}>();
  const generation=(current?.generation??0)+1;
  const at=now(config);const expiresAt=isoAfter(at,CAPTURE_LIFETIME_MS);
  const credentialId=crypto.randomUUID();const environmentHash=await hashSecret(config.environment);
  const revocationCapability=await createOpaqueCredential({kind:'revocation',grantType:'capture-credential',grantId:credentialId,generation,expiresAt,environmentHash},config);
  const capabilityHash=await hashSecret(revocationCapability);
  await publishDeviceConfiguration(db,owner,{deviceId,config:captureConfig},[
    ...plan.statements,
    devicePublicationGuard(db,owner,'COALESCE((SELECT MAX(generation) FROM capture_credentials WHERE device_id=? AND ledger_id=?),0)=?',[deviceId,owner.ledgerId,generation-1]),
    ...sourceConfigStatements(db,owner,deviceId,captureConfig),
    db.prepare('UPDATE capture_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND ledger_id=?').bind(at.toISOString(),deviceId,owner.ledgerId),
    db.prepare('UPDATE mobile_devices SET expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=?').bind(expiresAt,deviceId,owner.ledgerId),
    db.prepare(`INSERT INTO capture_credentials(id,ledger_id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at,environment_hash,revocation_capability_hash)
      VALUES (?,?,?,?,'capture','alerts:write',?,?,?,?,?)`).bind(credentialId,owner.ledgerId,deviceId,credentialHash,generation,at.toISOString(),expiresAt,environmentHash,capabilityHash),
  ]);
  const updated=await readDevice(db,owner,deviceId);
  await assertIssuedCaptureAuthorization(db,owner,{credentialId,deviceId,generation,revision:captureConfig.expectedRevision+1});
  return {...updated,deviceId,generation,credentialExpiresAt:expiresAt,revocationCapability};
}

async function assertIssuedCaptureAuthorization(db:D1Database,owner:OwnerContext,binding:{credentialId:string;deviceId:string;generation:number;revision:number}) {
  const authority=financialAuthorityPredicate(owner,'devices:manage');
  const active=await db.prepare(`SELECT 1 FROM capture_credentials c JOIN mobile_devices d ON d.id=c.device_id AND d.ledger_id=c.ledger_id
    WHERE c.id=? AND c.ledger_id=? AND c.device_id=? AND c.generation=? AND c.environment_hash=? AND c.revoked_at IS NULL
    AND julianday(c.expires_at)>julianday('now') AND d.status='paired' AND d.revoked_at IS NULL AND d.source_config_revision=? AND ${authority.sql}`)
    .bind(binding.credentialId,owner.ledgerId,binding.deviceId,binding.generation,owner.environmentHash,binding.revision,...authority.bindings).first();
  if(!active)throw new MobileDeviceError('capture_changed','The capture authorization changed before delivery. Retry with the current device configuration.',409);
}

async function recentDeviceApproval(db:D1Database,owner:OwnerContext,deviceId:string,config:MobileAuthConfig) {
  const family=await db.prepare('SELECT device_id,created_at FROM owner_session_families WHERE id=? AND ledger_id=?').bind(owner.familyId,owner.ledgerId).first<{created_at:string;device_id:string|null}>();
  if(!family)throw new MobileDeviceError('recent_approval_required','A recent owner approval is required.',403);
  if(family.device_id===deviceId)return;
  try {requireRecentOwnerApproval(family.created_at,config);} catch {throw new MobileDeviceError('recent_approval_required','A recent owner approval is required.',403);}
}

export async function revokeDevice(db:D1Database,inputOwner:OwnerContext,deviceId:string,config:MobileAuthConfig) {
  const owner=immutableFinancialContext(inputOwner);
  await assertFinancialAuthority(db,owner,'devices:manage');
  if(!await readDeviceRow(db,owner,deviceId))throw new MobileDeviceError('not_found','The mobile device was not found.',404);
  await recentDeviceApproval(db,owner,deviceId,config);
  const revokedAt=now(config).toISOString();
  await db.batch([
    financialAuthorityGuard(db,owner,'devices:manage'),
    devicePublicationGuard(db,owner,`EXISTS (SELECT 1 FROM owner_session_families WHERE id=? AND ledger_id=? AND (device_id=? OR (julianday(created_at)<=julianday('now') AND julianday(created_at)>=julianday('now','-10 minutes'))))`,[owner.familyId,owner.ledgerId,deviceId]),
    db.prepare("UPDATE mobile_devices SET status='revoked',revoked_at=COALESCE(revoked_at,?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=?").bind(revokedAt,deviceId,owner.ledgerId),
    db.prepare('UPDATE capture_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND ledger_id=?').bind(revokedAt,deviceId,owner.ledgerId),
  ]);
}
