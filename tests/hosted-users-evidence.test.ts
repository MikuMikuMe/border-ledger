import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkManifest, checkSnapshots, checkAttestation, parsePrivateJson, validateCompletion, verifyEvidenceFiles } from '../scripts/hosted-users-evidence.mjs';
import { readState, sha256, baseline } from '../scripts/hosted-users-gate.mjs';
import { queryAdapter } from '../scripts/hosted-users-cutover.mjs';
const revision = 'b'.repeat(40);
const now = Date.parse('2026-10-26T01:00:00Z');
const target = { environment: 'production', databaseId: 'test-db', revision };
const manifest = () => ({ version: 1, ...target, baseline: baseline.at(-1), ownerBindingsSha256: 'a'.repeat(64), runId: 'test-run', startedAt: '2026-10-26T00:45:00Z', deadline: '2026-10-26T01:15:00Z' });
describe('private cutover evidence', () => {
  it.each(['version', 'environment', 'databaseId', 'revision', 'baseline', 'ownerBindingsSha256', 'runId', 'startedAt', 'deadline'])('rejects missing or invalid %s', field => {
    expect(() => checkManifest({ ...manifest(), [field]: '' }, target, now)).toThrow();
  });
  it('requires an unexpired bounded maintenance run', () => {
    expect(checkManifest(manifest(), target, now)).toBeUndefined();
    expect(() => checkManifest(manifest(), target, now + 20 * 60_000)).toThrow('maintenance_window');
    expect(() => checkManifest({ ...manifest(), deadline: '2026-10-26T03:00:00Z' }, target, now)).toThrow('maintenance_window');
  });
  it('compares restored and migrated financial measurements with the live database', () => {
    const value = { counts: { transactions: 4 }, totals: [{ currency: 'CAD', amount_minor: 3666 }, { currency: 'USD', amount_minor: -2500 }], foreignKeys: [] };
    const bytes = JSON.stringify(value); const files = { before: bytes, after: bytes, restored: bytes };
    expect(checkSnapshots(files, value)).toBeUndefined();
    expect(() => checkSnapshots({ ...files, restored: '{}' }, value)).toThrow('snapshot_preservation');
    expect(() => checkSnapshots(files, { ...value, totals: [] })).toThrow('snapshot_live');
  });
  it('does not accept incomplete or cross-run operator observations', () => {
    const evidence = { runId: 'test-run', revision, operator: 'test-operator', checks: { test: 'passed' } };
    expect(checkAttestation(JSON.stringify(evidence), manifest(), ['test'])).toEqual(evidence);
    expect(() => checkAttestation(JSON.stringify(evidence), manifest(), ['missing'])).toThrow('evidence_incomplete');
    expect(() => checkAttestation(JSON.stringify({ ...evidence, runId: 'stale' }), manifest(), ['test'])).toThrow('evidence_run');
    expect(() => validateCompletion(JSON.stringify(evidence), manifest(), 'a'.repeat(64))).toThrow();
    expect(() => parsePrivateJson('not-json')).toThrow('evidence_json');
  });
  it('checks every referenced private file and its exact digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cutover-test-'));
    try {
      await writeFile(join(dir, 'evidence'), 'synthetic evidence');
      const reference = { path: 'evidence', sha256: sha256('synthetic evidence') };
      const files = Object.fromEntries(['backup','maintenance','restoreReport','clients','serviceRetirement','before','after','restored'].map(name => [name, reference]));
      expect(Object.keys(await verifyEvidenceFiles({ files }, dir, process.cwd()))).toHaveLength(8);
      await expect(verifyEvidenceFiles({ files: { ...files, backup: { ...reference, sha256: 'f'.repeat(64) } } }, dir, process.cwd())).rejects.toThrow('evidence_digest');
      await expect(verifyEvidenceFiles({ files: {} }, dir, process.cwd())).rejects.toThrow('evidence_reference');
      await expect(verifyEvidenceFiles({ files: { ...files, backup: { path: join(process.cwd(), 'package.json'), sha256: 'a'.repeat(64) } } }, dir, process.cwd())).rejects.toThrow('outside_repository');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('stops after schema discovery on a legacy database', async () => {
    const calls: string[] = [];
    await expect(readState(async (sql: string) => { calls.push(sql); return [{ name: 'accounts' }]; })).rejects.toThrow('cutover_required');
    expect(calls).toHaveLength(1); expect(calls[0]).toContain('sqlite_master');
  });
  it('read adapter never invokes a migration or deployment and propagates failures safely', async () => {
    const calls: string[][] = [];
    const query = queryAdapter(target, (args: string[]) => { calls.push(args); return '[{"success":true,"results":[]}]'; });
    await query('SELECT name FROM sqlite_master');
    expect(calls[0]).toEqual(['d1','execute','test-db','--remote','--env','production','--json','--command','SELECT name FROM sqlite_master']);
    await expect(queryAdapter(target, () => 'secret bad response')('SELECT 1')).rejects.toThrow('database_read_failed');
  });
});
