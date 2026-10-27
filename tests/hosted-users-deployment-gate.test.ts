import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkDeployment, checkAndroidPublication, fingerprint, parseWranglerResults } from '../scripts/hosted-users-gate.mjs';

const sha = 'a'.repeat(64);
const revision = 'b'.repeat(40);
const binding = { issuer: 'https://access.test', subject: 'synthetic-owner', user_id: 'owner' };
const baseline = ['0021-hosted-users.sql', '0022-unbound-auth.sql', '0023-plaid-tenant-connections.sql', '0024-alert-raw-identities.sql', '0025-lunchflow-platform.sql', '0026-lunchflow-connection-mappings.sql', '0027-hosted-users-activation.sql'];
function fixture() {
  const receipt = { singleton: 1, contract_version: 1, environment: 'production', database_id: 'test-db', revision, baseline: baseline.at(-1), manifest_sha256: sha, owner_bindings_sha256: fingerprint([binding]), maintenance_run_id: 'reviewed-run', phase: 'active', completion_sha256: sha, prepared_at: '2026-10-26T00:00:00Z', activated_at: '2026-10-26T00:05:00Z' };
  const state = { tables: ['users', 'ledgers', 'user_identities', 'd1_migrations', 'hosted_users_activation'], migrations: baseline, owner: [{ id: 'owner', status: 'active', ledger_id: 'personal' }], bindings: [binding], receipts: [receipt], users: 1, ledgers: 1 };
  const target = { environment: 'production', databaseId: 'test-db', revision, manifestSha256: sha };
  return { state, target, receipt };
}
describe('hosted deployment gate', () => {
  it('allows active cutover and subsequent unrelated migrations/revisions', () => {
    const { state, target } = fixture();
    expect(checkDeployment(state, { ...target, revision: 'c'.repeat(40) })).toBeUndefined();
  });
  it.each(['users', 'ledgers', 'user_identities', 'd1_migrations', 'hosted_users_activation'])('fails closed without %s', name => {
    const { state, target } = fixture(); state.tables = state.tables.filter(table => table !== name);
    expect(() => checkDeployment(state, target)).toThrow('cutover_required');
  });
  it.each(['environment','database_id','manifest_sha256','owner_bindings_sha256','baseline','phase','completion_sha256','activated_at'])('rejects mismatched receipt %s', field => {
    const { state, target, receipt } = fixture(); Object.assign(receipt, { [field]: '' });
    expect(() => checkDeployment(state, target)).toThrow();
  });
  it('requires the actual Wrangler migration tracker baseline', () => {
    const { state, target } = fixture(); state.migrations = state.migrations.slice(1);
    expect(() => checkDeployment(state, target)).toThrow('schema_baseline');
  });
  it.each(['missing', 'disabled', 'wrong ledger', 'different binding', 'extra binding'])('rejects owner %s', issue => {
    const { state, target } = fixture();
    if (issue === 'missing') state.owner = [];
    if (issue === 'disabled') state.owner[0].status = 'disabled';
    if (issue === 'wrong ledger') state.owner[0].ledger_id = 'other';
    if (issue === 'different binding') state.bindings = [{ ...binding, subject: 'private-do-not-print' }];
    if (issue === 'extra binding') state.bindings.push({ ...binding, subject: 'extra' });
    expect(() => checkDeployment(state, target)).toThrow(/owner/);
  });
  it('accepts prepared only for explicit bootstrap at exact revision with no extra initial users', () => {
    const { state, target, receipt } = fixture(); receipt.phase = 'prepared'; receipt.completion_sha256 = ''; receipt.activated_at = '';
    expect(() => checkDeployment(state, target)).toThrow();
    expect(checkDeployment(state, target, 'bootstrap')).toBeUndefined();
    expect(() => checkDeployment(state, { ...target, revision: 'c'.repeat(40) }, 'bootstrap')).toThrow();
    state.users = 2;
    expect(() => checkDeployment(state, target, 'bootstrap')).toThrow();
  });
  it.each(['not-json', '{}', '[{"success":false,"results":[]}]', '[{"success":true}]'])('rejects malformed/failed Wrangler result', output => {
    expect(() => parseWranglerResults(output)).toThrow('database_read_failed');
  });
  it('parses successful Wrangler JSON without echoing rows', () => {
    expect(parseWranglerResults('[{"success":true,"results":[{"name":"users"}]}]')).toEqual([{ name: 'users' }]);
  });
  it('fingerprints exact sorted issuer/subject mappings with unambiguous encoding', () => {
    expect(fingerprint([binding])).toBe(createHash('sha256').update(JSON.stringify([[binding.issuer, binding.subject, 'owner']])).digest('hex'));
  });
});

describe('production workflow release ordering', () => {
  it('gates both triggers before every production mutation and uses protocol 2 launch-only smoke', () => {
    const yaml = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(yaml).toContain('workflow_dispatch:'); expect(yaml).toContain('branches: [main]');
    expect(yaml).toContain('cancel-in-progress: false');
    const gate = yaml.indexOf('node scripts/hosted-users-cutover.mjs preflight');
    const migration = yaml.indexOf('npx wrangler d1 migrations apply');
    expect(gate).toBeGreaterThan(0); expect(gate).toBeLessThan(migration);
    expect(yaml.indexOf('Require production mobile authorization secrets')).toBeLessThan(migration);
    expect(yaml).not.toContain('MOBILE_APPROVED_ACCESS_SUBJECTS');
    expect(yaml).not.toContain('Verify owner login from');
    expect(yaml).toContain("'X-Ledger-Protocol': '2'");
    expect(yaml).toContain("-H 'X-Ledger-Protocol: 2'");
    expect(yaml).not.toContain('continue-on-error');
  });
});

describe('public Android release compatibility gate', () => {
  const health = () => ({ ok: true, service: 'border-ledger-api', mobileAuthConfigured: true, mobileProtocol: 2, deploymentRevision: revision });
  it('requires active DB activation and the exact live compatible server revision', () => {
    const { state, target } = fixture();
    expect(checkAndroidPublication(state, target, health())).toBeUndefined();
    state.receipts[0].phase = 'prepared';
    expect(() => checkAndroidPublication(state, target, health())).toThrow('activation_incomplete');
    state.receipts = [];
    expect(() => checkAndroidPublication(state, target, health())).toThrow('activation_required');
  });
  it.each(['mobileProtocol', 'mobileAuthConfigured', 'deploymentRevision', 'service', 'ok'])('blocks an old/missing/mismatched server %s', field => {
    const { state, target } = fixture();
    expect(() => checkAndroidPublication(state, target, { ...health(), [field]: null })).toThrow('android_backend_incompatible');
  });
  it('gates public publication for both triggers while retaining private signed artifacts', () => {
    const workflow = readFileSync('.github/workflows/android-release.yml', 'utf8');
    const signing = workflow.split('  sign-artifact:')[1].split('  publish-release:')[0];
    const publishing = workflow.split('  publish-release:')[1];
    expect(workflow).toContain('workflow_dispatch:'); expect(workflow).toContain('branches: [main]');
    expect(signing).toContain('android-signed-${{ github.run_id }}');
    expect(signing).not.toContain('hosted-users-cutover');
    const gate = publishing.indexOf('node scripts/hosted-users-cutover.mjs android-publication');
    expect(gate).toBeGreaterThan(0); expect(gate).toBeLessThan(publishing.indexOf('gh release create'));
    expect(publishing).toContain('HOSTED_USERS_ACTIVATION_SHA256');
    expect(publishing).toContain('ref: ${{ needs.build-unsigned.outputs.source_sha }}');
    expect(publishing).not.toContain('continue-on-error');
  });
});
