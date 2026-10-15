import type { D1Database, LedgerId } from './db-types';

function text(value: string, field: string, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

function timestamp(value: string, field: string) {
  text(value, field, 64);
  if (Number.isNaN(Date.parse(value))) throw new RangeError(`${field} must be an ISO timestamp.`);
  return value;
}

export interface OwnerAuthRequestInput {
  id: string;
  ledgerId?: LedgerId;
  deviceId?: string | null;
  stateHash: string;
  pkceChallengeHash: string;
  requestDigest: string;
  expiresAt: string;
}

export interface OwnerAuthRequestRow {
  id: string;
  ledger_id: LedgerId;
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

export interface SecureOwnerAuthRequestInput extends OwnerAuthRequestInput {
  callbackOrigin: string;
  callbackPath: string;
  environmentHash: string;
}

export async function createSecureOwnerAuthRequest(db: D1Database, input: SecureOwnerAuthRequestInput) {
  await db.prepare(`INSERT INTO mobile_auth_requests
    (id, ledger_id, device_id, state_hash, pkce_challenge_hash, request_digest, expires_at, callback_origin, callback_path, environment_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'auth request id'),
    input.ledgerId ?? 'personal',
    input.deviceId ? text(input.deviceId, 'auth device id') : null,
    text(input.stateHash, 'state hash'),
    text(input.pkceChallengeHash, 'PKCE challenge hash'),
    text(input.requestDigest, 'request digest'),
    timestamp(input.expiresAt, 'auth request expiry'),
    text(input.callbackOrigin, 'callback origin', 256),
    text(input.callbackPath, 'callback path', 256),
    text(input.environmentHash, 'environment hash'),
  ).run();
}

export async function readOwnerAuthRequest(db: D1Database, requestId: string) {
  return db.prepare(`SELECT id, ledger_id, device_id, state_hash, pkce_challenge_hash, request_digest,
      expires_at, consumed_at, revoked_at, code_hash, code_expires_at, callback_origin, callback_path,
      environment_hash, approved_subject_hash, approved_at
    FROM mobile_auth_requests WHERE id = ?`).bind(text(requestId, 'auth request id')).first<OwnerAuthRequestRow>();
}

export async function approveOwnerAuthRequest(db: D1Database, input: {
  requestId: string;
  codeHash: string;
  codeExpiresAt: string;
  approvedSubjectHash: string;
  approvedAt: string;
}) {
  return db.prepare(`UPDATE mobile_auth_requests SET code_hash = ?, code_expires_at = ?, approved_subject_hash = ?, approved_at = ?
    WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`).bind(
    text(input.codeHash, 'code hash'),
    timestamp(input.codeExpiresAt, 'code expiry'),
    text(input.approvedSubjectHash, 'approved subject hash'),
    timestamp(input.approvedAt, 'approval time'),
    text(input.requestId, 'auth request id'),
    timestamp(input.approvedAt, 'approval comparison time'),
  ).run();
}

export async function createOwnerAuthRequest(db: D1Database, input: OwnerAuthRequestInput) {
  await db.prepare(`INSERT INTO mobile_auth_requests
    (id, ledger_id, device_id, state_hash, pkce_challenge_hash, request_digest, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'auth request id'),
    input.ledgerId ?? 'personal',
    input.deviceId ? text(input.deviceId, 'auth device id') : null,
    text(input.stateHash, 'state hash'),
    text(input.pkceChallengeHash, 'PKCE challenge hash'),
    text(input.requestDigest, 'request digest'),
    timestamp(input.expiresAt, 'auth request expiry'),
  ).run();
}

export interface OwnerSessionFamilyInput {
  id: string;
  ledgerId?: LedgerId;
  subjectHash: string;
  accessGeneration?: number;
  refreshGeneration?: number;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  staySignedInUntil?: string | null;
  refreshTokenHash: string;
}

export async function createOwnerSessionFamily(db: D1Database, input: OwnerSessionFamilyInput) {
  const accessGeneration = input.accessGeneration ?? 1;
  const refreshGeneration = input.refreshGeneration ?? 1;
  if (!Number.isInteger(accessGeneration) || accessGeneration < 1 || !Number.isInteger(refreshGeneration) || refreshGeneration < 1) throw new RangeError('Session generations must be positive.');
  const familyId = text(input.id, 'session family id');
  const accessExpiresAt = timestamp(input.accessExpiresAt, 'access expiry');
  const refreshExpiresAt = timestamp(input.refreshExpiresAt, 'refresh expiry');
  await db.batch([
    db.prepare(`INSERT INTO owner_session_families
      (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, stay_signed_in_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      familyId,
      input.ledgerId ?? 'personal',
      text(input.subjectHash, 'subject hash'),
      accessGeneration,
      refreshGeneration,
      accessExpiresAt,
      refreshExpiresAt,
      input.staySignedInUntil ? timestamp(input.staySignedInUntil, 'stay signed-in expiry') : null,
    ),
    db.prepare(`INSERT INTO owner_refresh_generations
      (family_id, generation, token_hash, issued_at, expires_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`).bind(
      familyId,
      refreshGeneration,
      text(input.refreshTokenHash, 'refresh token hash'),
      refreshExpiresAt,
    ),
  ]);
}

export interface ReplayRecordInput {
  id: string;
  ledgerId?: LedgerId;
  requestKind: string;
  requestDigest: string;
  responseCiphertext: string;
  responseIv: string;
  expiresAt: string;
  ttlSeconds: number;
}

export async function putReplayRecord(db: D1Database, input: ReplayRecordInput) {
  if (input.ttlSeconds !== 60) throw new RangeError('Replay records must use the 60 second TTL.');
  await db.prepare(`INSERT INTO owner_replay_records
    (id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'replay id'),
    input.ledgerId ?? 'personal',
    text(input.requestKind, 'replay request kind', 128),
    text(input.requestDigest, 'replay request digest'),
    text(input.responseCiphertext, 'replay ciphertext', 64 * 1024),
    text(input.responseIv, 'replay IV', 256),
    input.ttlSeconds,
    timestamp(input.expiresAt, 'replay expiry'),
  ).run();
}

export async function readReplayRecord(db: D1Database, input: { ledgerId?: LedgerId; requestKind: string; requestDigest: string; now: string }) {
  return db.prepare(`SELECT id, ledger_id, request_kind, request_digest, response_ciphertext, response_iv, ttl_seconds, expires_at
    FROM owner_replay_records WHERE ledger_id = ? AND request_kind = ? AND request_digest = ? AND expires_at > ?`).bind(
    input.ledgerId ?? 'personal',
    text(input.requestKind, 'replay request kind', 128),
    text(input.requestDigest, 'replay request digest'),
    timestamp(input.now, 'replay lookup time'),
  ).first<ReplayRecordInput & { ledger_id: LedgerId }>();
}

export async function cleanupExpiredReplayRecords(db: D1Database, now: string) {
  await db.prepare('DELETE FROM owner_replay_records WHERE expires_at <= ?').bind(timestamp(now, 'replay cleanup time')).run();
}

export async function revokeOwnerSessionFamily(db: D1Database, familyId: string, revokedAt: string) {
  await db.prepare(`UPDATE owner_session_families SET revoked_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revoked_at IS NULL`).bind(timestamp(revokedAt, 'session revocation time'), text(familyId, 'session family id')).run();
}
