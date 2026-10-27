import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { baseline, checkOwner, checkSchema, requireGate, sha256, validHash } from './hosted-users-gate.mjs';

const preparationFiles = ['backup', 'maintenance', 'restoreReport', 'clients', 'serviceRetirement', 'before', 'after', 'restored'];
export function parsePrivateJson(bytes) {
  try { return JSON.parse(bytes); } catch { throw new Error('evidence_json'); }
}
export function checkWindow(manifest, now) {
  const start = Date.parse(manifest.startedAt);
  const deadline = Date.parse(manifest.deadline);
  requireGate(Number.isFinite(start) && Number.isFinite(deadline) && start <= now && deadline > now && deadline - start <= 45 * 60_000, 'maintenance_window');
}
export function checkManifest(manifest, target, now = Date.now()) {
  requireGate(manifest.version === 1 && manifest.environment === target.environment && manifest.databaseId === target.databaseId, 'manifest_target');
  requireGate(/^[a-f0-9]{40}$/.test(manifest.revision) && manifest.revision === target.revision, 'manifest_revision');
  requireGate(manifest.baseline === baseline.at(-1) && validHash(manifest.ownerBindingsSha256), 'manifest_baseline');
  requireGate(typeof manifest.runId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(manifest.runId), 'manifest_run');
  checkWindow(manifest, now);
}
export async function readPrivateFile(path, repository) {
  const [actual, root] = await Promise.all([realpath(path), realpath(repository)]);
  const rel = relative(root, actual);
  requireGate(rel.startsWith('..') || isAbsolute(rel), 'evidence_must_be_outside_repository');
  return readFile(actual);
}
export async function verifyEvidenceFiles(manifest, directory, repository) {
  const files = {};
  for (const name of preparationFiles) {
    const reference = manifest.files?.[name];
    requireGate(reference && validHash(reference.sha256) && typeof reference.path === 'string', 'evidence_reference');
    const bytes = await readPrivateFile(resolve(directory, reference.path), repository);
    requireGate(sha256(bytes) === reference.sha256, 'evidence_digest');
    files[name] = bytes;
  }
  return files;
}
export function checkSnapshots(files, live) {
  const before = parsePrivateJson(files.before);
  const after = parsePrivateJson(files.after);
  const restored = parsePrivateJson(files.restored);
  const canonical = value => JSON.stringify(value);
  requireGate(Array.isArray(before.foreignKeys) && before.foreignKeys.length === 0, 'snapshot_foreign_keys');
  requireGate(canonical(before) === canonical(after) && canonical(before) === canonical(restored), 'snapshot_preservation');
  requireGate(canonical(after) === canonical(live), 'snapshot_live');
}
export function checkAttestation(bytes, manifest, checks) {
  const evidence = parsePrivateJson(bytes);
  requireGate(evidence.runId === manifest.runId && evidence.revision === manifest.revision, 'evidence_run');
  requireGate(typeof evidence.operator === 'string' && evidence.operator.trim().length > 0, 'operator_attestation');
  requireGate(checks.every(name => evidence.checks?.[name] === 'passed'), 'evidence_incomplete');
  return evidence;
}
export function validatePreparation({ manifest, target, state, files, snapshot, now }) {
  checkManifest(manifest, target, now);
  checkSchema(state); checkOwner(state, manifest.ownerBindingsSha256, true);
  checkSnapshots(files, snapshot);
  requireGate(state.unrevokedSessions === 0 && state.legacyPending === 0 && state.legacyPairings === 0 && state.replays === 0, 'legacy_authorization_reset');
  checkAttestation(files.maintenance, manifest, ['allIngressBlocked', 'producersStopped', 'cronQuiescent', 'queuePaused', 'inFlightDrained', 'dlqAudited', 'backupAfterQuiescence', 'timeTravelBookmarkRecorded', 'legacySessionsRevoked', 'oldAuthFlowsRestarted']);
  checkAttestation(files.restoreReport, manifest, ['exactBackupRestored', 'oldCodeSchemaVerified', 'foreignKeysClean']);
  checkAttestation(files.clients, manifest, ['serverWebAccepted', 'androidArtifactVerified', 'rollbackArtifactRetained', 'ownerCanReauthenticate']);
  checkAttestation(files.serviceRetirement, manifest, ['globalKeyConsumersRetiredOrScoped', 'accessAllowlistUnchanged']);
}
export async function loadManifest(path, target, repository) {
  const bytes = await readPrivateFile(path, repository);
  const manifest = parsePrivateJson(bytes);
  checkManifest(manifest, target);
  const files = await verifyEvidenceFiles(manifest, dirname(path), repository);
  return { manifest, files, digest: sha256(bytes) };
}
export function validateCompletion(bytes, manifest, digest, liveSnapshot) {
  const evidence = checkAttestation(bytes, manifest, ['webOwnerLogin', 'nativeOwnerLogin', 'ownerExport', 'boundedOwnerSync', 'snapshotReconciled', 'noAdditionalUsers', 'maintenanceStillEnforced']);
  requireGate(evidence.manifestSha256 === digest, 'completion_manifest');
  requireGate(JSON.stringify(evidence.snapshot) === JSON.stringify(liveSnapshot) && liveSnapshot?.foreignKeys?.length === 0, 'completion_snapshot');
  return sha256(bytes);
}
export const sqlValue = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export function ownerGuard(state) {
  const predicates = state.bindings.map(row => `(issuer=${sqlValue(row.issuer)} AND subject=${sqlValue(row.subject)} AND user_id='owner')`);
  return `(SELECT COUNT(*) FROM users)=1 AND (SELECT COUNT(*) FROM ledgers)=1 AND EXISTS(SELECT 1 FROM users u JOIN ledgers l ON l.user_id=u.id WHERE u.id='owner' AND u.status='active' AND l.id='personal') AND (SELECT COUNT(*) FROM user_identities WHERE user_id='owner')=${state.bindings.length} AND (SELECT COUNT(*) FROM user_identities WHERE ${predicates.join(' OR ')})=${state.bindings.length}`;
}
export function preparationSql(manifest, digest, state, now) {
  const values = [1, 1, manifest.environment, manifest.databaseId, manifest.revision, manifest.baseline, digest, manifest.ownerBindingsSha256, manifest.runId, 'prepared', now];
  return `INSERT INTO hosted_users_activation (singleton,contract_version,environment,database_id,revision,baseline,manifest_sha256,owner_bindings_sha256,maintenance_run_id,phase,prepared_at) SELECT ${values.map(sqlValue).join(',')} WHERE ${ownerGuard(state)};`;
}
export function activationSql(digest, completion, state, now) {
  return `UPDATE hosted_users_activation SET phase='active',completion_sha256=${sqlValue(completion)},activated_at=${sqlValue(now)} WHERE singleton=1 AND phase='prepared' AND manifest_sha256=${sqlValue(digest)} AND ${ownerGuard(state)};`;
}
