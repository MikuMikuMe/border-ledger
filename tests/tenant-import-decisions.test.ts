import { describe, expect, it } from 'vitest';
import type { D1Database } from '../worker/db-types';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

async function seedPreview(db: D1Database, id: string, ledger: string, account: string) {
  await db.prepare(`INSERT INTO import_previews (id,ledger_id,account_id,filename,file_sha256,preview_digest,row_count,expires_at)
    VALUES (?,?,?,'statement.csv',?,?,1,'2099-01-01')`).bind(id, ledger, account, id, id).run();
  await db.prepare(`INSERT INTO import_chunks (preview_id,ledger_id,chunk_index,operation_id,chunk_digest,row_start,row_count,rows_json)
    VALUES (?,?,0,?,?,0,1,?)`).bind(id, ledger, id, id, JSON.stringify([{ rowId: `${id}-row`, accountId: account }])).run();
}

async function seed(db: D1Database) {
  await db.prepare("INSERT INTO users (id) VALUES ('second')").run();
  await db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('second-ledger','second')").run();
  for (const [account, ledger] of [['owner-account','personal'], ['other-account','personal'], ['foreign-account','second-ledger']]) {
    await db.prepare(`INSERT INTO accounts (id,ledger_id,name,institution,currency,kind,status)
      VALUES (?,?,'Account','Bank','CAD','chequing','connected')`).bind(account, ledger).run();
    await db.prepare(`INSERT INTO transactions (id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint)
      VALUES (?,?,?,'2026-10-24','Shop',-100,'CAD','Food','expense','confirmed','statement',?)`)
      .bind(`${account}-tx`, ledger, account, account).run();
  }
  await seedPreview(db, 'owner-preview', 'personal', 'owner-account');
  await seedPreview(db, 'other-preview', 'personal', 'owner-account');
  await seedPreview(db, 'foreign-preview', 'second-ledger', 'foreign-account');
}

function insertDecision(db: D1Database, statement: string, candidate = 'owner-account-tx') {
  return db.prepare(`INSERT INTO import_duplicate_decisions
    (preview_id,ledger_id,candidate_id,statement_transaction_id,candidate_transaction_id,status)
    VALUES ('owner-preview','personal','decision',?,?,'accepted')`).bind(statement, candidate).run();
}

describe('import duplicate decision ownership', () => {
  it('accepts exact staged rows without publishing a statement and retains valid published references', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seed(fixture.db);
      await insertDecision(fixture.db, 'owner-preview-row');
      expect(await fixture.db.prepare("SELECT id FROM transactions WHERE id='owner-preview-row'").first()).toBeNull();
      await fixture.db.prepare("UPDATE import_duplicate_decisions SET statement_transaction_id='owner-account-tx' WHERE candidate_id='decision'").run();
      expect(await fixture.db.prepare('SELECT statement_transaction_id FROM import_duplicate_decisions').first())
        .toEqual({ statement_transaction_id: 'owner-account-tx' });
    } finally { fixture.close(); }
  });

  it.each([
    ['absent-row', 'owner-account-tx'],
    ['other-preview-row', 'owner-account-tx'],
    ['foreign-preview-row', 'owner-account-tx'],
    ['other-account-tx', 'owner-account-tx'],
    ['foreign-account-tx', 'owner-account-tx'],
    ['owner-account-tx', 'other-account-tx'],
    ['owner-account-tx', 'foreign-account-tx'],
  ])('rejects statement %s or candidate %s outside the exact preview scope', async (statement, candidate) => {
    const fixture = createSqliteD1Fixture();
    try {
      await seed(fixture.db);
      await expect(insertDecision(fixture.db, statement, candidate)).rejects.toThrow('ledger mismatch');
      await insertDecision(fixture.db, 'owner-account-tx');
      await expect(fixture.db.prepare(`UPDATE import_duplicate_decisions SET statement_transaction_id=?,candidate_transaction_id=?
        WHERE candidate_id='decision'`).bind(statement, candidate).run()).rejects.toThrow('ledger mismatch');
    } finally { fixture.close(); }
  });

  it('rejects a staged row whose embedded account differs from its preview account', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seed(fixture.db);
      await fixture.db.prepare(`UPDATE import_chunks SET rows_json=? WHERE preview_id='owner-preview'`)
        .bind(JSON.stringify([{rowId:'owner-preview-row', accountId:'foreign-account'}])).run();
      await expect(insertDecision(fixture.db, 'owner-preview-row')).rejects.toThrow('ledger mismatch');
    } finally { fixture.close(); }
  });
});
