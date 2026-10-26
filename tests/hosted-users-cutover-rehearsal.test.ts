import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture } from './helpers/d1';
import { captureHistory, quoteIdentifier, seedAdditionalHistory, seedOwnerHistory, syntheticExport } from './helpers/cutover-history';
import { financialSnapshot, readState, checkDeployment } from '../scripts/hosted-users-gate.mjs';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { provisionOwnerIdentityBindings, resolveLedgerContext } from '../worker/tenant-context';
const migrations = readdirSync('worker/migrations').filter(name => /^\d{4}-.*\.sql$/.test(name)).sort();
const legacy = migrations.filter(name => name < '0021');
const cutover = migrations.filter(name => name >= '0021');

describe('complete owner cutover and recovery rehearsal', () => {
  it('preserves full synthetic history through every migration and restores the exact captured pre-cutover export', async () => {
    expect(legacy).toHaveLength(21); expect(legacy).toContain('0011-native-connections.sql');
    const original = await createD1Fixture(legacy);
    const restored = await createD1Fixture([]);
    try {
      await seedOwnerHistory(original.db); await seedAdditionalHistory(original.db);
      const before = await captureHistory(original.db);
      const exportStatements = await syntheticExport(original.db, before);
      const query = async (sql: string) => (await original.db.prepare(sql).all()).results;
      const beforeFinancial = await financialSnapshot(query);
      expect(beforeFinancial.totals).toEqual([
        { account_id: 'old-account', currency: 'CAD', count: 2, amount_minor: 3766 },
        { account_id: 'statement-account', currency: 'CAD', count: 1, amount_minor: -100 },
        { account_id: 'usd-account', currency: 'USD', count: 1, amount_minor: -2500 },
      ]);
      expect(beforeFinancial.counts).toMatchObject({ accounts: 3, transactions: 4, imports: 1, transaction_source_records: 2, recurring_streams: 1, recurring_stream_transactions: 1, import_previews: 1, import_chunks: 1, alert_events: 1, alert_projections: 1, alert_projection_provenance: 1, annotation_revisions: 1, alert_event_links: 1 });
      expect(beforeFinancial.foreignKeys).toEqual([]);
      await applyMigrations(original.db, cutover);
      for (const [table, { columns, rows }] of Object.entries(before)) {
        const actual = (await original.db.prepare(`SELECT ${columns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(table)}`).all()).results;
        expect(actual.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), table).toEqual(rows);
      }
      expect(await financialSnapshot(query)).toEqual(beforeFinancial);
      expect(await original.db.prepare("SELECT id,user_id FROM ledgers").first()).toEqual({ id: 'personal', user_id: 'owner' });
      expect(await original.db.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).toEqual({ n: 0 });
      expect(await original.db.prepare('SELECT COUNT(*) AS n FROM hosted_users_activation').first()).toEqual({ n: 0 });
      expect(await original.db.prepare("SELECT connection_id FROM lunchflow_accounts").first()).toEqual({ connection_id: 'lunchflow-personal-owner' });
      expect(await original.db.prepare('SELECT currency,SUM(amount_minor) AS amount_minor FROM transactions GROUP BY currency ORDER BY currency').all()).toMatchObject({ results: [{ currency: 'CAD', amount_minor: 3666 }, { currency: 'USD', amount_minor: -2500 }] });
      await provisionOwnerIdentityBindings(original.db, [{ issuer: 'https://synthetic.test', subject: 'owner' }]);
      expect(await resolveLedgerContext(original.db, { issuer: 'https://synthetic.test', subject: 'owner' })).toEqual({ userId: 'owner', ledgerId: 'personal' });
      await expect(resolveLedgerContext(original.db, { issuer: 'https://synthetic.test', subject: 'unknown' })).rejects.toThrow('Access is not enabled');
      // Recover the captured artifact, never re-run the seed as a substitute for restoration.
      await restored.db.batch(exportStatements.map(sql => restored.db.prepare(sql)));
      expect(await captureHistory(restored.db)).toEqual(before);
      expect(await financialSnapshot(async (sql: string) => (await restored.db.prepare(sql).all()).results)).toEqual(beforeFinancial);
      await expect(readState(async (sql: string) => (await restored.db.prepare(sql).all()).results)).rejects.toThrow('cutover_required');
    } finally { await original.dispose(); await restored.dispose(); }
  }, 60_000);

  it('creates an inert receipt table on fresh schema and rejects replacement/deletion of activation evidence', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM hosted_users_activation').first()).toEqual({ n: 0 });
      const sql = "INSERT INTO hosted_users_activation VALUES (1,1,'production','synthetic-db','revision','baseline','manifest','bindings','run','prepared','now',NULL,NULL)";
      await fixture.db.prepare(sql).run();
      await expect(fixture.db.prepare(sql.replace('INSERT INTO','INSERT OR REPLACE INTO')).run()).rejects.toThrow('already exists');
      await expect(fixture.db.prepare("UPDATE hosted_users_activation SET manifest_sha256='other'").run()).rejects.toThrow('immutable');
      await expect(fixture.db.prepare('DELETE FROM hosted_users_activation').run()).rejects.toThrow('cannot be deleted');
      const receipt = await fixture.db.prepare('SELECT * FROM hosted_users_activation').first();
      expect(() => checkDeployment({ tables: [], receipts: [receipt] }, {})).toThrow('cutover_required');
    } finally { fixture.close(); }
  });
});
