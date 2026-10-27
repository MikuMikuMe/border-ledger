import { describe, expect, it } from 'vitest';
import type { D1Database, D1Statement } from '../worker/db-types';
import { beginImportPublication, readImportPreview } from '../worker/import-store';
import { createImportPreviewForOwner, stageImportChunkForOwner, commitImportForOwner } from '../worker/mobile-import';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedTenants, SECOND_LEDGER, tenantOwner } from './helpers/tenants';

async function stagedImport(db: D1Database) {
  await seedTenants(db);
  const owner = tenantOwner(SECOND_LEDGER);
  const created = await createImportPreviewForOwner(db, owner, {accountId:'second-account',fileName:'bank.csv',fileSizeBytes:100,fileSha256:'a'.repeat(64),format:'csv',rowCount:1,idempotencyKey:'expiry'});
  const staged = await stageImportChunkForOwner(db, owner, {previewId:created.id,chunkIndex:0,operationId:'chunk',rowStart:0,rows:[{
    rowId:'row',rowIndex:0,accountId:'second-account',date:'2026-10-23',merchant:'Cafe',amountMinor:-123,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'fp',
  }]});
  return {owner,id:created.id,input:{previewId:created.id,expectedRevision:staged.revision,rowIds:['row'],operationId:'publish'}};
}

async function afterDeadline(deadline: number) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline-Date.now()+30)));
}

function pausedPreviewReader(db: D1Database, onRead: () => Promise<void>): D1Database {
  let paused = false;
  return {batch:db.batch.bind(db),prepare(sql: string): D1Statement {
    const statement = db.prepare(sql);
    return {
      bind(...values: unknown[]) {statement.bind(...values);return this;},
      all:statement.all.bind(statement),run:statement.run.bind(statement),
      async first<T>(column?: string) {
        const result = await statement.first<T>(column);
        if (!paused && sql.includes('revision, selected_row_ids_json')) {paused=true;await onRead();}
        return result;
      },
    };
  }};
}

describe('import expiry publication races', () => {
  it('preserves a published receipt and chunks when an old publishing reader resumes after expiry', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const staged = await stagedImport(fixture.db);
      const binding = (await fixture.db.prepare('SELECT owner_binding_digest FROM import_previews WHERE id=?').bind(staged.id).first<string>('owner_binding_digest'))!;
      await beginImportPublication(fixture.db, SECOND_LEDGER, {previewId:staged.id,ownerBindingDigest:binding,operationId:'publish',selectedRowIds:['row']});
      const deadline = Date.now()+500;
      await fixture.db.prepare('UPDATE import_previews SET expires_at=? WHERE id=?').bind(new Date(deadline).toISOString(),staged.id).run();
      let committed: Awaited<ReturnType<typeof commitImportForOwner>> | undefined;
      const reader = pausedPreviewReader(fixture.db, async () => {
        committed = await commitImportForOwner(fixture.db, staged.owner, staged.input);
        await afterDeadline(deadline);
      });
      const observed = await readImportPreview(reader, SECOND_LEDGER, staged.id, binding);
      expect(observed.state).toBe('published');
      expect(observed.preview.receipt_id).toBe(committed!.receiptId);
      expect(observed.preview.revision).toBe(committed!.revision);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM import_chunks WHERE preview_id=?').bind(staged.id).first('count')).toBe(1);
      expect(await commitImportForOwner(fixture.db, staged.owner, staged.input)).toEqual(committed);
    } finally {fixture.close();}
  });

  it.each(['family','preview'] as const)('rolls back financial writes when the %s expires while the batch waits', async target => {
    const fixture = createSqliteD1Fixture();
    try {
      const staged = await stagedImport(fixture.db);
      const deadline = Date.now()+500;
      if (target === 'family') await fixture.db.prepare("UPDATE owner_session_families SET access_expires_at=? WHERE id='second-family'").bind(new Date(deadline).toISOString()).run();
      else await fixture.db.prepare('UPDATE import_previews SET expires_at=? WHERE id=?').bind(new Date(deadline).toISOString(),staged.id).run();
      const delayed: D1Database = {prepare:fixture.db.prepare.bind(fixture.db),async batch(statements) {
        await afterDeadline(deadline);
        return fixture.db.batch(statements);
      }};
      await expect(commitImportForOwner(delayed, staged.owner, staged.input)).rejects.toMatchObject({status:target === 'family' ? 403:410});
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source='statement'").first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM imports').first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_source_records').first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT receipt_id FROM import_previews WHERE id=?').bind(staged.id).first('receipt_id')).toBeNull();
    } finally {fixture.close();}
  });
});
