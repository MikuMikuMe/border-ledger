import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { D1Database } from '../../worker/db-types';

const migrationNames = ['0000-ledger-base.sql', '0001-plaid.sql', '0002-recurring.sql'];

function migrationStatements(sql: string) {
  return sql
    .split(/;\s*(?=\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function applyMigrations(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  for (const name of migrationNames) {
    const applied = await db.prepare('SELECT name FROM __migrations WHERE name = ?').bind(name).all<{ name: string }>();
    if (applied.results.length > 0) continue;
    const sql = await readFile(resolve(process.cwd(), 'worker', 'migrations', name), 'utf8');
    const statements = migrationStatements(sql).map((statement) => db.prepare(statement));
    await db.batch([...statements, db.prepare('INSERT INTO __migrations (name) VALUES (?)').bind(name)]);
  }
}

export async function createD1Fixture(): Promise<{ db: D1Database; dispose(): Promise<void> }> {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default {}',
    d1Databases: { DB: 'border-ledger-recurring-test' },
  }));
  const db = await miniflare.getD1Database('DB') as unknown as D1Database;
  await applyMigrations(db);
  return { db, dispose: () => miniflare.dispose() };
}
