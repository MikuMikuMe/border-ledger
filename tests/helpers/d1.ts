import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { D1Database } from '../../worker/db-types';

const legacyMigrationNames = ['0000-ledger-base.sql', '0001-plaid.sql', '0002-recurring.sql'] as const;
export const task3MigrationNames = ['0003-multicurrency.sql', '0004-mobile-alerts.sql', '0005-native-parity.sql'] as const;
export const task4MigrationNames = [...task3MigrationNames, '0006-mobile-auth-hardening.sql', '0007-mobile-receipt-device-ownership.sql', '0019-owner-installation-binding.sql'] as const;
export const task10MigrationNames = [...legacyMigrationNames, ...task4MigrationNames, '0008-statement-reconciliation.sql', '0009-statement-reconciliation-target-uniqueness.sql'] as const;
export const task10PreUniquenessMigrationNames = [...task10MigrationNames.slice(0, -1), '0010-mobile-import-export.sql', '0012-recurring-classification-revision.sql', '0013-mobile-settings-devices.sql', '0014-mobile-capture-scope-instrument-hints.sql', '0015-currency-registry.sql'] as const;
export const task12MigrationNames = [...task10MigrationNames, '0010-mobile-import-export.sql'] as const;
export const task13MigrationNames = [...task12MigrationNames, '0012-recurring-classification-revision.sql'] as const;
export const task15MigrationNames = [...task13MigrationNames, '0013-mobile-settings-devices.sql', '0014-mobile-capture-scope-instrument-hints.sql'] as const;
export const task15CurrencyMigrationNames = [...task15MigrationNames, '0015-currency-registry.sql'] as const;
export const task16MigrationNames = [...task15MigrationNames, '0015-currency-registry.sql', '0016-recurring-currency-registry.sql'] as const;
export const task17MigrationNames = [...task16MigrationNames, '0017-import-duplicate-decisions.sql'] as const;
export const task18MigrationNames = [...task17MigrationNames, '0018-fx-snapshots.sql'] as const;

function migrationStatements(sql: string) {
  return sql
    .split(/;\s*(?=\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function applyMigrations(db: D1Database, migrationNames: readonly string[] = legacyMigrationNames) {
  await db.prepare('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  for (const name of migrationNames) {
    const applied = await db.prepare('SELECT name FROM __migrations WHERE name = ?').bind(name).all<{ name: string }>();
    if (applied.results.length > 0) continue;
    const sql = await readFile(new URL(`../../worker/migrations/${name}`, import.meta.url), 'utf8');
    const statements = migrationStatements(sql).map((statement) => db.prepare(statement));
    await db.batch([...statements, db.prepare('INSERT INTO __migrations (name) VALUES (?)').bind(name)]);
  }
}

export async function createD1Fixture(migrationNames: readonly string[] = legacyMigrationNames): Promise<{ db: D1Database; dispose(): Promise<void> }> {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default {}',
    d1Databases: { DB: 'border-ledger-recurring-test' },
  }));
  const db = await miniflare.getD1Database('DB') as unknown as D1Database;
  await applyMigrations(db, migrationNames);
  return { db, dispose: () => miniflare.dispose() };
}
