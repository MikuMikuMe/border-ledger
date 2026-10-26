import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { baseline, checkDeployment, fingerprint, readState, financialSnapshot } from '../scripts/hosted-users-gate.mjs';
import { activationSql, preparationSql, validateCompletion, validatePreparation } from '../scripts/hosted-users-evidence.mjs';
const revision = 'b'.repeat(40), digest = 'a'.repeat(64), completed = 'c'.repeat(64);
const target = { environment: 'production', databaseId: 'synthetic-db', revision, manifestSha256: digest };
async function setup() {
  const fixture = createSqliteD1Fixture();
  await fixture.db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
  await fixture.db.batch(baseline.map(name => fixture.db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').bind(name)));
  await fixture.db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES ('https://synthetic.test','owner','owner')").run();
  const query = async (sql: string) => (await fixture.db.prepare(sql).all()).results;
  const manifest = { version: 1, ...target, baseline: baseline.at(-1), runId: 'synthetic-run', startedAt: '2026-10-26T00:00:00Z', deadline: '2026-10-26T00:30:00Z', ownerBindingsSha256: fingerprint([{ issuer: 'https://synthetic.test', subject: 'owner', user_id: 'owner' }]) };
  return { fixture, query, manifest };
}
describe('durable cutover activation', () => {
  it('keeps interrupted preparation closed, atomically fences changed owner authority and prevents receipt replacement', async () => {
    const { fixture, query, manifest } = await setup();
    try {
      const state = await readState(query);
      await fixture.db.prepare(preparationSql(manifest, digest, state, '2026-10-26T00:01:00Z')).run();
      const prepared = await readState(query);
      expect(() => checkDeployment(prepared, target)).toThrow('activation_incomplete');
      expect(checkDeployment(prepared, target, 'bootstrap')).toBeUndefined();
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
      await fixture.db.prepare(activationSql(digest, completed, state, '2026-10-26T00:05:00Z')).run();
      expect(await fixture.db.prepare('SELECT phase FROM hosted_users_activation').first()).toEqual({ phase: 'prepared' });
      await fixture.db.prepare("UPDATE users SET status='active' WHERE id='owner'").run();
      await fixture.db.prepare(activationSql(digest, completed, state, '2026-10-26T00:05:00Z')).run();
      expect(checkDeployment(await readState(query), target)).toBeUndefined();
      await expect(fixture.db.prepare(preparationSql(manifest, 'd'.repeat(64), state, '2026-10-26T00:06:00Z')).run()).rejects.toThrow('already exists');
      await expect(fixture.db.prepare("UPDATE hosted_users_activation SET completion_sha256='replacement'").run()).rejects.toThrow('immutable');
    } finally { fixture.close(); }
  });
  it('does not prepare with failed observations or live legacy sessions and requires measured completion snapshot', async () => {
    const { fixture, query, manifest } = await setup();
    try {
      const snapshot = await financialSnapshot(query);
      const checks = ['allIngressBlocked','producersStopped','cronQuiescent','queuePaused','inFlightDrained','dlqAudited','backupAfterQuiescence','timeTravelBookmarkRecorded','legacySessionsRevoked','oldAuthFlowsRestarted','exactBackupRestored','oldCodeSchemaVerified','foreignKeysClean','serverWebAccepted','androidArtifactVerified','rollbackArtifactRetained','ownerCanReauthenticate','globalKeyConsumersRetiredOrScoped','accessAllowlistUnchanged'];
      const report = JSON.stringify({ runId: manifest.runId, revision, operator: 'synthetic', checks: Object.fromEntries(checks.map(name => [name, 'passed'])) });
      const files = { before: JSON.stringify(snapshot), after: JSON.stringify(snapshot), restored: JSON.stringify(snapshot), maintenance: report, restoreReport: report, clients: report, serviceRetirement: report };
      const input = { manifest, target, state: await readState(query), files, snapshot, now: Date.parse('2026-10-26T00:10:00Z') };
      expect(validatePreparation(input)).toBeUndefined();
      expect(() => validatePreparation({ ...input, state: { ...input.state, unrevokedSessions: 1 } })).toThrow('legacy_authorization_reset');
      expect(() => validatePreparation({ ...input, files: { ...files, maintenance: report.replace('"passed"', '"failed"') } })).toThrow('evidence_incomplete');
      const completionChecks = ['webOwnerLogin','nativeOwnerLogin','ownerExport','boundedOwnerSync','snapshotReconciled','noAdditionalUsers','maintenanceStillEnforced'];
      const completion = JSON.stringify({ runId: manifest.runId, revision, operator: 'synthetic', manifestSha256: digest, snapshot, checks: Object.fromEntries(completionChecks.map(name => [name, 'passed'])) });
      expect(validateCompletion(completion, manifest, digest, snapshot)).toHaveLength(64);
      expect(() => validateCompletion(completion, manifest, digest, { ...snapshot, totals: [{ amount_minor: 1 }] })).toThrow('completion_snapshot');
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM hosted_users_activation').first()).toEqual({ n: 0 });
    } finally { fixture.close(); }
  });
});
