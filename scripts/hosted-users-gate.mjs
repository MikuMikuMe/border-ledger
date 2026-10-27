import { createHash } from 'node:crypto';

export const baseline = ['0021-hosted-users.sql', '0022-unbound-auth.sql', '0023-plaid-tenant-connections.sql', '0024-alert-raw-identities.sql', '0025-lunchflow-platform.sql', '0026-lunchflow-connection-mappings.sql', '0027-hosted-users-activation.sql'];
const requiredTables = ['users', 'ledgers', 'user_identities', 'd1_migrations', 'hosted_users_activation'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function requireGate(condition, code) { if (!condition) throw new Error(code); }
export function fingerprint(bindings) {
  const tuples = bindings.map(row => [row.issuer, row.subject, row.user_id]);
  tuples.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return sha256(JSON.stringify(tuples));
}
export function parseWranglerResults(output) {
  try {
    const parsed = JSON.parse(output);
    requireGate(Array.isArray(parsed) && parsed.length === 1, 'database_read_failed');
    requireGate(parsed[0].success === true && Array.isArray(parsed[0].results), 'database_read_failed');
    return parsed[0].results;
  } catch { throw new Error('database_read_failed'); }
}
export function checkSchema(state) {
  requireGate(requiredTables.every(name => state.tables.includes(name)), 'cutover_required');
  requireGate(baseline.every(name => state.migrations.includes(name)), 'schema_baseline');
}
export function checkOwner(state, expectedHash, initial = false) {
  const owner = state.owner[0];
  requireGate(state.owner.length === 1 && owner.id === 'owner' && owner.status === 'active' && owner.ledger_id === 'personal', 'owner_mapping');
  requireGate(state.bindings.length > 0 && validHash(expectedHash) && fingerprint(state.bindings) === expectedHash, 'owner_bindings');
  if (initial) requireGate(state.users === 1 && state.ledgers === 1, 'initial_owner_only');
}
function checkReceipt(receipt, target) {
  requireGate(receipt?.contract_version === 1 && receipt.singleton === 1, 'activation_contract');
  requireGate(receipt.environment === target.environment && receipt.database_id === target.databaseId, 'activation_target');
  requireGate(validHash(target.manifestSha256) && receipt.manifest_sha256 === target.manifestSha256, 'activation_manifest');
  requireGate(receipt.baseline === baseline.at(-1) && /^[a-f0-9]{40}$/.test(receipt.revision), 'activation_baseline');
  requireGate(typeof receipt.maintenance_run_id === 'string' && receipt.maintenance_run_id.length > 0 && Number.isFinite(Date.parse(receipt.prepared_at)), 'activation_record');
}
export function checkDeployment(state, target, mode = 'normal') {
  checkSchema(state);
  requireGate(state.receipts.length === 1, 'activation_required');
  const receipt = state.receipts[0];
  checkReceipt(receipt, target);
  checkOwner(state, receipt.owner_bindings_sha256, mode === 'bootstrap');
  if (mode === 'bootstrap') {
    requireGate(receipt.phase === 'prepared' && receipt.revision === target.revision, 'bootstrap_revision_or_phase');
    return;
  }
  requireGate(mode === 'normal' && receipt.phase === 'active' && validHash(receipt.completion_sha256) && Number.isFinite(Date.parse(receipt.activated_at)), 'activation_incomplete');
}
export async function readState(query) {
  const tables = (await query("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
  requireGate(requiredTables.every(name => tables.includes(name)), 'cutover_required');
  const migrations = (await query('SELECT name FROM d1_migrations')).map(row => row.name);
  const owner = await query("SELECT u.id,u.status,l.id AS ledger_id FROM users u JOIN ledgers l ON l.user_id=u.id WHERE u.id='owner'");
  const bindings = await query("SELECT issuer,subject,user_id FROM user_identities WHERE user_id='owner'");
  const receipts = await query('SELECT * FROM hosted_users_activation');
  const users = (await query('SELECT COUNT(*) AS n FROM users'))[0].n;
  const ledgers = (await query('SELECT COUNT(*) AS n FROM ledgers'))[0].n;
  const unrevokedSessions = (await query("SELECT COUNT(*) AS n FROM owner_session_families WHERE revoked_at IS NULL"))[0].n;
  const legacyPending = (await query("SELECT COUNT(*) AS n FROM mobile_auth_requests WHERE consumed_at IS NULL AND revoked_at IS NULL"))[0].n;
  const legacyPairings = (await query("SELECT COUNT(*) AS n FROM device_pairings WHERE status IN ('pending','approved')"))[0].n;
  const replays = (await query('SELECT COUNT(*) AS n FROM owner_replay_records'))[0].n;
  return { tables, migrations, owner, bindings, receipts, users, ledgers, unrevokedSessions, legacyPending, legacyPairings, replays };
}

// Stable financial measures intentionally exclude session resets and newly introduced metadata.
export const financialTables = ['accounts', 'transactions', 'imports', 'transaction_source_records', 'recurring_streams', 'recurring_stream_transactions', 'import_previews', 'import_chunks', 'alert_events', 'alert_projections', 'alert_projection_provenance', 'annotation_revisions', 'alert_event_links'];
export async function financialSnapshot(query) {
  const counts = {};
  for (const table of financialTables) counts[table] = (await query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
  const totals = await query('SELECT account_id,currency,COUNT(*) AS count,SUM(amount_minor) AS amount_minor FROM transactions GROUP BY account_id,currency ORDER BY account_id,currency');
  const foreignKeys = await query('PRAGMA foreign_key_check');
  return { counts, totals, foreignKeys };
}

export function checkAndroidPublication(state, target, health) {
  checkDeployment(state, target);
  requireGate(health?.ok === true && health.service === 'border-ledger-api'
    && health.mobileAuthConfigured === true && health.mobileProtocol === 2
    && health.deploymentRevision === target.revision, 'android_backend_incompatible');
}
