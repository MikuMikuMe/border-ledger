import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { D1Database, D1Result, D1RunResult, D1Statement } from '../../worker/db-types';

class SqliteStatement implements D1Statement {
  private values: unknown[] = [];
  private readonly database: DatabaseSync;
  private readonly sql: string;

  constructor(database: DatabaseSync, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: this.database.prepare(this.sql).all(...this.values as never[]) as T[] };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.values as never[]) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run(): Promise<D1RunResult> {
    const result = this.database.prepare(this.sql).run(...this.values as never[]) as { changes?: number; lastInsertRowid?: number | bigint };
    return { meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
}

class SqliteD1 implements D1Database {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(query: string) {
    return new SqliteStatement(this.database, query);
  }

  async batch(statements: D1Statement[]) {
    this.database.exec('BEGIN');
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        const result = await statement.run();
        results.push({ results: [], success: true, meta: result.meta });
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createSqliteD1Fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(resolve(process.cwd(), 'worker/schema.sql'), 'utf8'));
  return {
    db: new SqliteD1(database) as D1Database,
    close() {
      database.close();
    },
  };
}
