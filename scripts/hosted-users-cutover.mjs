// Operator-only tooling. No imports from the deployed Worker; no migrations or deployment here.
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, unlink, rmdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDeployment, checkAndroidPublication, financialSnapshot, parseWranglerResults, readState, requireGate } from './hosted-users-gate.mjs';
import { activationSql, loadManifest, preparationSql, readPrivateFile, validateCompletion, validatePreparation } from './hosted-users-evidence.mjs';

export function runWrangler(args) {
  try {
    return execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch { throw new Error('wrangler_command_failed'); }
}
export function queryAdapter(target, run = runWrangler) {
  return async sql => parseWranglerResults(run(['d1', 'execute', target.databaseId, '--remote', '--env', target.environment, '--json', '--command', sql]));
}
async function mutateReceipt(target, sql) {
  const directory = await mkdtemp(join(tmpdir(), 'border-ledger-cutover-'));
  try {
    const file = join(directory, 'receipt.sql');
    await writeFile(file, sql, { mode: 0o600 });
    runWrangler(['d1', 'execute', target.databaseId, '--remote', '--env', target.environment, '--json', '--file', file]);
  } finally { await unlink(join(directory, 'receipt.sql')).catch(() => {}); await rmdir(directory); }
}
async function targetFromConfig() {
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const database = config.env.production.d1_databases.find(item => item.binding === 'DB');
  requireGate(!database.migrations_table || database.migrations_table === 'd1_migrations', 'unsupported_migration_tracker');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { environment: 'production', databaseId: database.database_id, revision, manifestSha256: process.env.HOSTED_USERS_ACTIVATION_SHA256 };
}
async function prepareOrActivate(command, args, target, query) {
  requireGate(args.includes('--execute-authorized-maintenance'), 'explicit_maintenance_authorization_required');
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { stdio: 'pipe' });
  const path = args[0];
  requireGate(typeof path === 'string' && !path.startsWith('--'), 'private_manifest_required');
  const { manifest, files, digest } = await loadManifest(resolve(path), target, process.cwd());
  target.manifestSha256 = digest;
  const state = await readState(query);
  if (command === 'prepare') {
    validatePreparation({ manifest, target, state, files, snapshot: await financialSnapshot(query), now: Date.now() });
    if (state.receipts.length === 0) await mutateReceipt(target, preparationSql(manifest, digest, state, new Date().toISOString()));
    checkDeployment(await readState(query), target, 'bootstrap');
    return;
  }
  const completionBytes = await readPrivateFile(resolve(args[1]), process.cwd());
  const completion = validateCompletion(completionBytes, manifest, digest, await financialSnapshot(query));
  if (state.receipts[0]?.phase === 'active') {
    checkDeployment(state, target);
    requireGate(state.receipts[0].completion_sha256 === completion, 'activation_completion_conflict');
    return;
  }
  checkDeployment(state, target, 'bootstrap');
  await mutateReceipt(target, activationSql(digest, completion, state, new Date().toISOString()));
  const active = await readState(query);
  checkDeployment(active, target);
  requireGate(active.receipts[0].completion_sha256 === completion, 'activation_completion_conflict');
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  requireGate(['preflight', 'android-publication', 'bootstrap-check', 'prepare', 'activate', 'snapshot'].includes(command), 'unknown_command');
  const target = await targetFromConfig();
  const query = queryAdapter(target);
  if (command === 'snapshot') {
    requireGate(rest[0], 'private_output_required');
    // Caller chooses a private location; never emit financial data to stdout.
    const output = join(await realpath(dirname(resolve(rest[0]))), basename(rest[0]));
    const root = resolve(process.cwd());
    requireGate(!output.toLowerCase().startsWith(root.toLowerCase() + '/') && !output.toLowerCase().startsWith(root.toLowerCase() + '\\'), 'private_output_required');
    await writeFile(output, JSON.stringify(await financialSnapshot(query)), { flag: 'wx', mode: 0o600 });
  } else if (command === 'android-publication') {
    const state = await readState(query);
    checkDeployment(state, target);
    requireGate(process.env.SOURCE_SHA === target.revision, 'android_source_revision');
    const clientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
    const clientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
    requireGate(clientId && clientSecret, 'android_health_credentials');
    const response = await fetch('https://pf.lofuyu.com/api/health', {
      headers: { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    });
    requireGate(response.ok, 'android_backend_unavailable');
    checkAndroidPublication(state, target, await response.json());
  } else if (command === 'preflight') {
    checkDeployment(await readState(query), target);
  } else if (command === 'bootstrap-check') {
    const { manifest, files, digest } = await loadManifest(resolve(rest[0]), target, process.cwd());
    const state = await readState(query);
    validatePreparation({ manifest, target, state, files, snapshot: await financialSnapshot(query), now: Date.now() });
    checkDeployment(state, { ...target, manifestSha256: digest }, 'bootstrap');
  } else await prepareOrActivate(command, rest, target, query);
  console.log(`Hosted-user ${command} passed. No migrations or deployment were performed.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Hosted-user cutover gate failed; remain in maintenance. Inspect private evidence and the runbook.'); process.exitCode = 1; });
}
