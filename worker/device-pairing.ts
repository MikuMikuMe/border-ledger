import type { LedgerContext } from './tenant-context';
import type { D1Database, D1Result } from './db-types';
import {
  CAPTURE_SCOPE,
  activeMobileLedger,
  MobileAuthError,
  assertEnvironment,
  assertHttpsCallback,
  assertCaptureEventScope,
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
  type CaptureContext,
  type CaptureScopeRecord,
  type MobileAuthConfig,
  type OwnerContext,
  type PairVerifierContext,
} from './mobile-auth';
import { ownerContextForConsent } from './mobile-owner-auth';

const PAIRING_LIFETIME = 10 * 60 * 1000;
const CAPTURE_LIFETIME = 90 * 24 * 60 * 60 * 1000;
const REPLAY_LIFETIME = 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PairingStartInput {
  deviceName: string;
  platform?: string;
  verifierChallenge: string;
  environment?: string;
}

export interface PairingSession {
  pairingId: string;
  userCode: string;
  expiresAt: string;
  minPollSeconds: 5;
  deviceId: string;
}

export interface PairingScopeInput extends CaptureScopeRecord {
  /**
   * Legacy transport fields accepted while older mobile route callers are
   * still deployed. They are normalized into instrumentHint before any
   * validation or persistence.
   */
  hintKind?: string;
  hintValue?: string;
}

export interface PairingApprovalInput {
  pairingId: string;
  owner: OwnerContext & { consent: true };
  environment?: string;
  sourceScopes: readonly PairingScopeInput[];
}

export interface PairingClaimInput {
  pairingId: string;
  verifier: string;
  credentialHash: string;
  environment?: string;
}

export interface PairingClaimResult {
  state: 'pending' | 'approved' | 'claimed' | 'expired';
  deviceId: string | null;
  credentialExpiresAt: string | null;
  revocationCapability?: string;
}

interface PairingRow {
  id: string;
  ledger_id: string | null;
  user_id: string | null;
  device_name: string;
  platform: string;
  approved_family_id: string | null;
  device_id: string;
  device_verifier_hash: string;
  status: 'pending' | 'approved' | 'claimed' | 'expired' | 'revoked';
  requested_scopes_json: string;
  expires_at: string;
  approved_at: string | null;
  approved_subject_hash: string | null;
  approval_expires_at: string | null;
  environment_hash: string | null;
  credential_hash: string | null;
}

function bounded(value: string, field: string, max: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new MobileAuthError('invalid_request', `The ${field} is not valid.`, 400);
  return value;
}

function randomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function randomId() {
  return crypto.randomUUID();
}

function isExpired(value: string, at: Date) {
  const expiry = parseRfc3339Instant(value);
  return !expiry || expiry.getTime() <= at.getTime();
}

async function readPairing(db: D1Database, pairingId: string) {
  return db.prepare(`SELECT id, ledger_id, user_id, device_name, platform, approved_family_id, device_id, device_verifier_hash, status, requested_scopes_json,
      expires_at, approved_at, approved_subject_hash, approval_expires_at, environment_hash, credential_hash
    FROM hosted_device_pairings WHERE id = ?`).bind(pairingId).first<PairingRow>();
}

function validateCredentialHash(value: string) {
  if (!/^[A-Fa-f0-9]{64}$/.test(bounded(value, 'credential hash', 64))) throw new MobileAuthError('invalid_request', 'The capture credential hash is not valid.', 400);
}

function pairingInstrumentHint(scope: PairingScopeInput) {
  const legacyHintPresent = scope.hintKind !== undefined || scope.hintValue !== undefined;
  const hint = scope.instrumentHint !== undefined
    ? scope.instrumentHint
    : legacyHintPresent
      ? { kind: scope.hintKind, value: scope.hintValue }
      : null;
  if (hint === null) return null;
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) throw new MobileAuthError('invalid_request', 'The instrument hint is not valid.', 400);
  const kind = (hint as { kind?: unknown }).kind;
  const value = (hint as { value?: unknown }).value;
  if (typeof kind !== 'string' || typeof value !== 'string') throw new MobileAuthError('invalid_request', 'The instrument hint is not valid.', 400);
  return {
    kind: bounded(kind, 'instrument hint kind', 64),
    value: bounded(value, 'instrument hint value', 256),
  };
}

export async function startPairing(db: D1Database, input: PairingStartInput, config: MobileAuthConfig): Promise<PairingSession> {
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  bounded(input.deviceName, 'device name', 80);
  const platform = bounded(input.platform ?? 'android', 'device platform', 64);
  const verifierChallenge = bounded(input.verifierChallenge, 'pairing verifier challenge', 128);
  if (!/^[A-Za-z0-9_-]{43}$/.test(verifierChallenge)) throw new MobileAuthError('invalid_request', 'The pairing verifier challenge is not valid.', 400);
  const at = now(config);
  const expiresAt = isoAfter(at, PAIRING_LIFETIME);
  const deviceVerifierHash = await hashSecret(verifierChallenge);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const deviceId = randomId();
    const pairingId = randomId();
    const userCode = randomCode();
    const userCodeHash = await hashSecret(userCode);
    try {
      await db.prepare(`INSERT INTO hosted_device_pairings
        (id, device_id, device_name, platform, device_verifier_hash, user_code_hash, expires_at, environment_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(pairingId, deviceId, input.deviceName, platform, deviceVerifierHash, userCodeHash, expiresAt, environmentHash).run();
      return { pairingId, userCode, expiresAt, minPollSeconds: 5, deviceId };
    } catch (error) {
      if (attempt === 4) throw new MobileAuthError('temporarily_unavailable', 'The pairing session could not be created.', 503);
      // Unique code collisions are retried without logging the code or verifier.
      if (!(error instanceof Error)) continue;
    }
  }
  throw new MobileAuthError('temporarily_unavailable', 'The pairing session could not be created.', 503);
}

async function validateSourceScopes(db: D1Database, context: LedgerContext, scopes: readonly PairingScopeInput[]) {
  if (scopes.length === 0 || scopes.length > 100) throw new MobileAuthError('invalid_request', 'At least one capture source scope is required.', 400);
  const seen = new Set<string>();
  for (const scope of scopes) {
    bounded(scope.sourceProfileId, 'source profile', 128);
    bounded(scope.accountId, 'account', 128);
    bounded(scope.currency, 'currency', 12);
    const hint = pairingInstrumentHint(scope);
    const key = `${scope.sourceProfileId}\u0000${scope.accountId}\u0000${scope.currency}\u0000${hint?.kind ?? 'none'}\u0000${hint?.value ?? ''}`;
    if (seen.has(key)) throw new MobileAuthError('invalid_request', 'Capture source scopes must be unique.', 400);
    seen.add(key);
    const source = await db.prepare(`SELECT id FROM source_profiles WHERE id = ? AND ledger_id = ? AND status = 'approved'`).bind(scope.sourceProfileId, context.ledgerId).first<{ id: string }>();
    if (!source) throw new MobileAuthError('forbidden', 'The source profile is not approved.', 403);
    const currency = await db.prepare(`SELECT 1 AS allowed FROM account_currencies WHERE ledger_id = ? AND account_id = ? AND currency = ?`).bind(context.ledgerId, scope.accountId, scope.currency).first<{ allowed: number }>();
    if (!currency) throw new MobileAuthError('forbidden', 'The selected account currency is not approved.', 403);
    const mappings = await db.prepare(`SELECT account_id, hint_kind, hint_value FROM source_account_mappings
      WHERE ledger_id = ? AND source_profile_id = ? AND approval_status = 'approved'`).bind(context.ledgerId, scope.sourceProfileId).all<{ account_id: string; hint_kind: string; hint_value: string }>();
    if (hint) {
      const matchingAccounts = new Set(mappings.results
        .filter((mapping) => mapping.hint_kind === hint.kind && mapping.hint_value === hint.value)
        .map((mapping) => mapping.account_id));
      if (matchingAccounts.size === 0) throw new MobileAuthError('forbidden', 'The source hint is not approved for this account.', 403);
      if (matchingAccounts.size !== 1 || !matchingAccounts.has(scope.accountId)) throw new MobileAuthError('ambiguous_scope', 'The source hint is ambiguous across approved accounts.', 409);
    } else {
      const distinctAccounts = new Set(mappings.results.map((mapping) => mapping.account_id));
      if (distinctAccounts.size !== 1 || !distinctAccounts.has(scope.accountId)) throw new MobileAuthError('ambiguous_scope', 'An explicit source hint is required for this mapping.', 409);
    }
  }
}

export async function approvePairing(db: D1Database, input: PairingApprovalInput, config: MobileAuthConfig) {
  if (input.owner.consent !== true) throw new MobileAuthError('consent_required', 'Explicit capture consent is required.', 403);
  const owner = ownerContextForConsent(input.owner);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  if (owner.environmentHash !== environmentHash) throw new MobileAuthError('environment_mismatch', 'The pairing environment is not valid.', 403);
  const normalizedScopes = input.sourceScopes.map((scope) => ({
    ...scope,
    instrumentHint: pairingInstrumentHint(scope),
  }));
  const context = await activePairingOwner(db, owner);
  await validateSourceScopes(db, context, normalizedScopes);
  const at = now(config);
  const pairing = await readPairing(db, bounded(input.pairingId, 'pairing id', 128));
  if (!pairing) throw new MobileAuthError('not_found', 'The pairing session was not found.', 404);
  await validatePairingApprovalState(db, pairing, owner, at);
  const scopesJson = JSON.stringify(normalizedScopes.map(({ sourceProfileId, accountId, currency, instrumentHint }) => ({ sourceProfileId, accountId, currency, instrumentHint })));
  if (sameApprovedPairing(pairing, owner, scopesJson)) return;
  const pairingExpiry = parseRfc3339Instant(pairing.expires_at);
  if (!pairingExpiry) throw new MobileAuthError('expired', 'The pairing session has expired.', 409);
  const approvalExpiresAt = new Date(Math.min(pairingExpiry.getTime(), at.getTime() + 10 * 60 * 1000)).toISOString();
  const statements = [
    db.prepare(`UPDATE hosted_device_pairings SET ledger_id = ?, user_id = ?, status = 'approved', requested_scopes_json = ?, approved_at = ?, approved_subject_hash = ?, approved_family_id = ?, approval_expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ledger_id IS NULL AND status = 'pending' AND expires_at > ?`).bind(owner.ledgerId, owner.userId, scopesJson, at.toISOString(), owner.subjectHash, owner.familyId === 'access-approval' ? null : owner.familyId, approvalExpiresAt, pairing.id, at.toISOString()),
    db.prepare(`INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status, paired_at, expires_at)
      SELECT ?, ?, ?, ?, 'paired', ?, ? WHERE changes() = 1`).bind(pairing.device_id, owner.ledgerId, pairing.device_name, pairing.platform, at.toISOString(), isoAfter(at, CAPTURE_LIFETIME)),
  ];
  for (const scope of normalizedScopes) {
    statements.push(db.prepare(`INSERT INTO device_source_scopes
      (id, ledger_id, device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value, status, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?
      WHERE EXISTS (SELECT 1 FROM hosted_device_pairings WHERE id = ? AND ledger_id = ? AND approved_subject_hash = ? AND requested_scopes_json = ? AND status = 'approved')
      ON CONFLICT(device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value)
      DO UPDATE SET status = 'approved', expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`).bind(
      randomId(), owner.ledgerId, pairing.device_id, scope.sourceProfileId, scope.accountId, scope.currency,
      scope.instrumentHint?.kind ?? 'none', scope.instrumentHint?.value ?? '', isoAfter(at, CAPTURE_LIFETIME), pairing.id, owner.ledgerId, owner.subjectHash, scopesJson,
    ));
  }
  const committed = await db.batch(statements);
  if (committed[0]?.meta?.changes !== 1) throw new MobileAuthError('approval_conflict', 'The pairing approval changed.', 409);
}

async function claimReplay(db: D1Database, lookup: { context: LedgerContext; digest: string; at: Date }, config: MobileAuthConfig) {
  const { context, digest, at } = lookup;
  const row = await db.prepare(`SELECT response_ciphertext, response_iv, expires_at FROM owner_replay_records
    WHERE ledger_id = ? AND request_kind = 'pairing-claim' AND request_digest = ? AND expires_at > ?`).bind(context.ledgerId, digest, at.toISOString()).first<{ response_ciphertext: string; response_iv: string; expires_at: string }>();
  if (!row) return null;
  return decryptReplayResponse<PairingClaimResult>({ ciphertext: row.response_ciphertext, iv: row.response_iv }, config);
}

async function captureRevocationCapability(config: MobileAuthConfig, credentialId: string, generation: number, expiresAt: string) {
  return createOpaqueCredential({ kind: 'revocation', grantType: 'capture-credential', grantId: credentialId, generation, expiresAt, environmentHash: await hashSecret(config.environment) }, config);
}

export async function authenticatePairVerifier(credential: string, db: D1Database, pairingId: string, config: MobileAuthConfig): Promise<PairVerifierContext> {
  const pairing = await readPairing(db, bounded(pairingId, 'pairing id', 128));
  if (!pairing) throw new MobileAuthError('unauthorized', 'The pairing verifier is not valid.');
  const verifierHash = await hashSecret(await pkceChallenge(credential));
  if (verifierHash !== pairing.device_verifier_hash) throw new MobileAuthError('unauthorized', 'The pairing verifier is not valid.');
  if (isExpired(pairing.expires_at, now(config))) throw new MobileAuthError('expired', 'The pairing session has expired.', 409);
  return { credentialType: 'pair-verifier', pairingId: pairing.id, deviceId: pairing.device_id, expiresAt: pairing.expires_at, environmentHash: pairing.environment_hash ?? await hashSecret(config.environment) };
}

export async function claimPairing(db: D1Database, input: PairingClaimInput, config: MobileAuthConfig): Promise<PairingClaimResult> {
  validateCredentialHash(input.credentialHash);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  const at = now(config);
  const digest = await requestDigest({ flow: 'pairing-claim', pairingId: input.pairingId, verifierHash: await hashSecret(input.verifier), credentialHash: input.credentialHash, environmentHash });
  const pairing = await readPairing(db, bounded(input.pairingId, 'pairing id', 128));
  if (!pairing) throw new MobileAuthError('not_found', 'The pairing session was not found.', 404);
  const verifierHash = await hashSecret(await pkceChallenge(input.verifier));
  if (verifierHash !== pairing.device_verifier_hash || pairing.environment_hash !== environmentHash) throw new MobileAuthError('unauthorized', 'The pairing verifier is not valid.');
  if (isExpired(pairing.expires_at, at)) {
    await db.prepare(`UPDATE hosted_device_pairings SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'claimed'`).bind(pairing.id).run();
    return { state: 'expired', deviceId: pairing.device_id, credentialExpiresAt: null };
  }
  if (pairing.status === 'pending') return { state: 'pending', deviceId: null, credentialExpiresAt: null };
  const context = await activePairingLedger(db, pairing, at);
  const replay = await claimReplay(db, { context, digest, at }, config);
  if (replay) return replay;
  if (pairing.status === 'revoked') throw new MobileAuthError('revoked', 'The pairing session is revoked.', 409);
  if (pairing.status === 'claimed') {
    if (pairing.credential_hash !== input.credentialHash) throw new MobileAuthError('claim_conflict', 'The pairing claim conflicts with an existing credential.', 409);
    const existing = await db.prepare(`SELECT id, expires_at FROM capture_credentials WHERE device_id = ? AND credential_hash = ?`).bind(pairing.device_id, input.credentialHash).first<{ id: string; expires_at: string }>();
    if (!existing) throw new MobileAuthError('claim_conflict', 'The pairing credential is not available.', 409);
    return { state: 'claimed', deviceId: pairing.device_id, credentialExpiresAt: existing.expires_at };
  }
  if (pairing.status !== 'approved' || !pairing.approved_subject_hash) throw new MobileAuthError('not_approved', 'The pairing is awaiting explicit owner approval.', 202);
  const credentialId = randomId();
  const credentialExpiresAt = isoAfter(at, CAPTURE_LIFETIME);
  const revocation = await captureRevocationCapability(config, credentialId, 1, credentialExpiresAt);
  const sealed = await encryptReplayResponse({ state: 'claimed', deviceId: pairing.device_id, credentialExpiresAt, revocationCapability: revocation }, config);
  const results = await db.batch([
    db.prepare(`UPDATE hosted_device_pairings SET status = 'claimed', credential_hash = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'approved' AND expires_at > ? AND credential_hash IS NULL`).bind(input.credentialHash, at.toISOString(), pairing.id, at.toISOString()),
    db.prepare(`INSERT INTO capture_credentials (id, ledger_id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash)
      SELECT ?, ?, ?, ?, 'capture', ?, 1, ?, ?, ?, ? WHERE changes() = 1`).bind(credentialId, context.ledgerId, pairing.device_id, input.credentialHash, CAPTURE_SCOPE, at.toISOString(), credentialExpiresAt, await hashSecret(config.environment), await hashSecret(revocation)),
    db.prepare(`INSERT INTO owner_replay_records (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
      SELECT ?, ?, 'pairing-claim', ?, ?, ?, 60, ? WHERE changes() = 1`).bind(crypto.randomUUID(), context.ledgerId, digest, sealed.ciphertext, sealed.iv, isoAfter(at, REPLAY_LIFETIME)),
  ]);
  if ((results[0]?.meta?.changes ?? 0) === 1) return { state: 'claimed', deviceId: pairing.device_id, credentialExpiresAt, revocationCapability: revocation };
  const recovered = await claimReplay(db, { context, digest, at }, config);
  if (recovered) return recovered;
  const after = await readPairing(db, pairing.id);
  if (after?.status === 'claimed' && after.credential_hash === input.credentialHash) return { state: 'claimed', deviceId: pairing.device_id, credentialExpiresAt: credentialExpiresAt };
  throw new MobileAuthError('claim_conflict', 'The pairing claim conflicts with an existing credential.', 409);
}

export async function renewCaptureCredential(db: D1Database, input: { owner: OwnerContext & { consent: true }; deviceId: string; credentialHash: string; environment?: string }, config: MobileAuthConfig): Promise<PairingClaimResult> {
  validateCredentialHash(input.credentialHash);
  if (input.owner.consent !== true) throw new MobileAuthError('consent_required', 'Explicit capture consent is required.', 403);
  const owner = ownerContextForConsent(input.owner);
  const environmentHash = await assertEnvironment(input.environment ?? config.environment, config);
  if (owner.environmentHash !== environmentHash) throw new MobileAuthError('environment_mismatch', 'The capture environment is not valid.', 403);
  await activePairingOwner(db, owner);
  const at = now(config);
  const current = await currentCaptureCredential(db, owner, input.deviceId);
  const id = randomId();
  const generation = current.generation + 1;
  const expiresAt = isoAfter(at, CAPTURE_LIFETIME);
  const revocation = await captureRevocationCapability(config, id, generation, expiresAt);
  const results = await db.batch([
    db.prepare(`UPDATE capture_credentials SET revoked_at = ?
      WHERE id = ? AND ledger_id = ? AND device_id = ? AND generation = ? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM owner_session_families f JOIN ledgers l ON l.id = f.ledger_id JOIN users u ON u.id = l.user_id
          WHERE f.id = ? AND f.ledger_id = ? AND u.id = ? AND u.status = 'active'
            AND f.subject_hash = ? AND f.access_generation = ? AND f.environment_hash = ?
            AND f.revoked_at IS NULL AND f.access_expires_at > ?
            AND EXISTS (SELECT 1 FROM json_each(f.scope_json) WHERE value = 'devices:manage'))
        AND EXISTS (SELECT 1 FROM mobile_devices d WHERE d.id = ? AND d.ledger_id = ? AND d.status = 'paired')`)
      .bind(at.toISOString(), current.id, owner.ledgerId, input.deviceId, current.generation,
        owner.familyId, owner.ledgerId, owner.userId, owner.subjectHash, owner.accessGeneration, environmentHash, at.toISOString(), input.deviceId, owner.ledgerId),
    db.prepare(`INSERT INTO capture_credentials (id, ledger_id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash)
      SELECT ?, ?, ?, ?, 'capture', ?, ?, ?, ?, ?, ? WHERE changes() = 1`).bind(id, owner.ledgerId, input.deviceId, input.credentialHash, CAPTURE_SCOPE, generation, at.toISOString(), expiresAt, environmentHash, await hashSecret(revocation)),
  ]);
  requireRenewalPublished(results[0]);
  return { state: 'claimed', deviceId: input.deviceId, credentialExpiresAt: expiresAt, revocationCapability: revocation };
}

async function currentCaptureCredential(db: D1Database, owner: OwnerContext, deviceId: string) {
  const current = await db.prepare(`SELECT id, generation FROM capture_credentials WHERE ledger_id = ? AND device_id = ? AND revoked_at IS NULL ORDER BY generation DESC LIMIT 1`)
    .bind(owner.ledgerId, deviceId).first<{ id: string; generation: number }>();
  if (!current) throw new MobileAuthError('not_found', 'The capture credential was not found.', 404);
  return current;
}

function requireRenewalPublished(result: D1Result | undefined) {
  if (result?.meta?.changes !== 1) throw new MobileAuthError('revoked', 'The approving session is no longer active.', 403);
}

export { assertCaptureEventScope };

async function activePairingOwner(db: D1Database, owner: OwnerContext) {
  const context = await activeMobileLedger(db, owner.ledgerId);
  if (context.userId !== owner.userId) throw new MobileAuthError('forbidden', 'The owner binding is not valid.', 403);
  return context;
}

async function requireActivePairingCredential(db: D1Database, pairing: PairingRow, at: Date) {
  if (!pairing.credential_hash) return;
  const credential = await db.prepare(`SELECT id FROM capture_credentials WHERE ledger_id = ? AND device_id = ? AND credential_hash = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(pairing.ledger_id, pairing.device_id, pairing.credential_hash, at.toISOString()).first();
  if (!credential) throw new MobileAuthError('revoked', 'The capture credential is revoked.', 403);
}

async function requireActiveApprovingFamily(db: D1Database, pairing: PairingRow) {
  if (!pairing.approved_family_id) return;
  const family = await db.prepare(`SELECT id FROM owner_session_families WHERE id = ? AND ledger_id = ? AND revoked_at IS NULL`)
    .bind(pairing.approved_family_id, pairing.ledger_id).first();
  if (!family) throw new MobileAuthError('revoked', 'The approving session is revoked.', 403);
}

async function activePairingLedger(db: D1Database, pairing: PairingRow, at: Date) {
  if (!pairing.ledger_id) throw new MobileAuthError('not_approved', 'The pairing is awaiting approval.', 403);
  if (pairing.status === 'revoked') throw new MobileAuthError('revoked', 'The pairing is revoked.', 403);
  const context = await activeMobileLedger(db, pairing.ledger_id);
  await requireActivePairingCredential(db, pairing, at);
  await requireActiveApprovingFamily(db, pairing);
  const device = await db.prepare(`SELECT id FROM mobile_devices WHERE id = ? AND ledger_id = ? AND status = 'paired'`)
    .bind(pairing.device_id, context.ledgerId).first();
  if (!device) throw new MobileAuthError('revoked', 'The paired device is revoked.', 403);
  return context;
}

async function validatePairingApprovalState(db: D1Database, pairing: PairingRow, owner: OwnerContext, at: Date) {
  if (isExpired(pairing.expires_at, at)) {
    await db.prepare(`UPDATE hosted_device_pairings SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'approved')`).bind(pairing.id).run();
    throw new MobileAuthError('expired', 'The pairing session has expired.', 409);
  }
  if (![null, owner.ledgerId].includes(pairing.ledger_id)) throw new MobileAuthError('not_found', 'The pairing session was not found.', 404);
  const unavailable: Partial<Record<PairingRow['status'], string>> = { claimed: 'The pairing session has already been claimed.', revoked: 'The pairing session is revoked.' };
  const reason = unavailable[pairing.status];
  if (reason) throw new MobileAuthError(pairing.status, reason, 409);
}

function sameApprovedPairing(pairing: PairingRow, owner: OwnerContext, scopesJson: string) {
  if (pairing.status !== 'approved') return false;
  if (pairing.approved_subject_hash !== owner.subjectHash) throw new MobileAuthError('approval_conflict', 'The pairing approval changed.', 409);
  if (pairing.requested_scopes_json !== scopesJson) throw new MobileAuthError('approval_conflict', 'The pairing approval changed.', 409);
  return true;
}
