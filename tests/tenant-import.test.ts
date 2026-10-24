import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { createImportPreview, readImportPreview, stageImportChunk, cleanupExpiredImportStaging, publishImport } from '../worker/import-store';
import { createImportPreviewForOwner, stageImportChunkForOwner, commitImportForOwner, decideImportDuplicateForOwner, cancelImportForOwner } from '../worker/mobile-import';
import { commitStatementRows, type CommitStatementRowsInput } from '../worker/reconciliation-store';
const digest = 'a'.repeat(64);
function statement(user: string): CommitStatementRowsInput {
  return {importId:'same-import',operationId:'same-operation',accountId:`${user}-account`,filename:'bank.csv',fileSha256:digest,
    rows:[{id:'same-row',accountId:`${user}-account`,date:'2026-10-23',merchant:'Cafe',amountMinor:-123,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'same-fingerprint',sourceIdentity:{accountId:`${user}-account`,fileSha256:digest,rowIndex:0}}]};
}
async function preview(db: import('../worker/db-types').D1Database, id = 'owner-preview') {
  await createImportPreview(db, OWNER_LEDGER, {id,accountId:'owner-account',filename:'bank.csv',fileSha256:digest,previewDigest:digest,ownerBindingDigest:digest,rowCount:1,expiresAt:'2099-01-01'});
}
describe('import tenant boundaries', () => {
  it('rejects a guessed preview even with its known binding digest', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedTenants(fixture.db); await preview(fixture.db);
      await expect(readImportPreview(fixture.db, SECOND_LEDGER, 'owner-preview', digest)).rejects.toMatchObject({code:'not_found'});
    } finally { fixture.close(); }
  });
  it('cannot stage a guessed foreign preview chunk', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedTenants(fixture.db); await preview(fixture.db);
      await expect(stageImportChunk(fixture.db, SECOND_LEDGER, {previewId:'owner-preview',ownerBindingDigest:digest,chunkIndex:0,operationId:'same-chunk',chunkDigest:digest,rowStart:0,rowCount:1,rowsJson:'[{}]'})).rejects.toMatchObject({code:'not_found'});
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM import_chunks').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('cannot commit, cancel or decide a guessed foreign preview', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db); await preview(fixture.db);
      const owner = tenantOwner(SECOND_LEDGER);
      await expect(commitImportForOwner(fixture.db, owner, {previewId:'owner-preview',expectedRevision:0,rowIds:['same-row'],operationId:'guessed'})).rejects.toMatchObject({code:'not_found'});
      await expect(cancelImportForOwner(fixture.db, owner, {previewId:'owner-preview',expectedRevision:0})).rejects.toMatchObject({code:'not_found'});
      await expect(decideImportDuplicateForOwner(fixture.db, owner, {previewId:'owner-preview',candidateId:'guessed',expectedRevision:0,decision:'resolve'})).rejects.toMatchObject({code:'not_found'});
      expect(await fixture.db.prepare("SELECT status,revision FROM import_previews WHERE id='owner-preview'").first()).toEqual({status:'staged',revision:0});
    } finally {fixture.close();}
  });
  it('does not clean another ledger staging rows', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedTenants(fixture.db); await preview(fixture.db);
      await cleanupExpiredImportStaging(fixture.db, SECOND_LEDGER, '2100-01-01');
      expect(await fixture.db.prepare("SELECT id FROM import_previews WHERE id='owner-preview'").first()).toEqual({id:'owner-preview'});
    } finally { fixture.close(); }
  });
  it('allows both tenants to reuse operation, file, row and fingerprint identifiers independently', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedTenants(fixture.db);
      const first = await commitStatementRows(fixture.db, OWNER_LEDGER, statement('owner'));
      const second = await commitStatementRows(fixture.db, SECOND_LEDGER, statement('second'));
      expect(first.accepted).toBe(1); expect(second.accepted).toBe(1);
      expect(second.transactionIds).not.toEqual(first.transactionIds);
      expect((await commitStatementRows(fixture.db, SECOND_LEDGER, statement('second'))).duplicates).toBe(1);
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE ledger_id='second-ledger' AND source='statement'").first('count')).toBe(1);
      expect(await fixture.db.prepare("SELECT id FROM transactions WHERE id='same-row' AND ledger_id='personal'").first()).toEqual({id:'same-row'});
    } finally { fixture.close(); }
  });
  it('does not publish a legacy staging receipt after the context is disabled', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db); await preview(fixture.db);
      const racedDb = {prepare:fixture.db.prepare.bind(fixture.db),batch:async (statements: import('../worker/db-types').D1Statement[]) => {
        await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
        return fixture.db.batch(statements);
      }};
      await expect(publishImport(racedDb, OWNER_LEDGER, {previewId:'owner-preview',operationId:'operation',publishedAt:'2026-10-24T12:00:00Z'})).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT status FROM import_previews WHERE id='owner-preview'").first('status')).toBe('staged');
    } finally {fixture.close();}
  });
  it('keeps identical raw keys stable and independent across two nonowner ledgers', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const third = {userId:'third',ledgerId:'third-ledger'};
      await fixture.db.prepare("INSERT INTO users(id) VALUES ('third')").run();
      await fixture.db.prepare("INSERT INTO ledgers(id,user_id) VALUES ('third-ledger','third')").run();
      await fixture.db.prepare(`INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status)
        VALUES ('third-account','third-ledger','Third','Bank','CAD','chequing','import_only')`).run();
      const secondResult = await commitStatementRows(fixture.db, SECOND_LEDGER, statement('second'));
      const thirdResult = await commitStatementRows(fixture.db, third, statement('third'));
      expect(thirdResult.importId).not.toBe(secondResult.importId);
      expect(thirdResult.transactionIds).not.toEqual(secondResult.transactionIds);
      const replay = await commitStatementRows(fixture.db, third, statement('third'));
      expect(replay.importId).toBe(thirdResult.importId);
      expect(replay.transactionIds).toEqual(thirdResult.transactionIds);
      expect(replay.duplicates).toBe(1);
    } finally {fixture.close();}
  });
  it('allocates stable staged IDs for unrelated statements that reuse the same raw row ID', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const owner = tenantOwner(SECOND_LEDGER);
      const stagedPreviews = [];
      for (const [index, fileDigest] of [digest,'b'.repeat(64)].entries()) {
        const created = await createImportPreviewForOwner(fixture.db, owner, {accountId:'second-account',fileName:'bank.csv',fileSizeBytes:100,fileSha256:fileDigest,format:'csv',rowCount:1,idempotencyKey:`file-${index}`});
        const row = {...statement('second').rows[0],rowId:'same-row',rowIndex:0,amountMinor:-123-index*100};
        const staged = await stageImportChunkForOwner(fixture.db, owner, {previewId:created.id,chunkIndex:0,operationId:'chunk',rowStart:0,rows:[row]});
        const stored = JSON.parse((await fixture.db.prepare('SELECT rows_json FROM import_chunks WHERE preview_id=?').bind(created.id).first<string>('rows_json'))!)[0];
        stagedPreviews.push({id:created.id,revision:staged.revision,canonicalId:stored.canonicalTransactionId});
      }
      expect(stagedPreviews[0].canonicalId).not.toBe(stagedPreviews[1].canonicalId);
      for (const [index, staged] of stagedPreviews.entries()) {
        await commitImportForOwner(fixture.db, owner, {previewId:staged.id,expectedRevision:staged.revision,rowIds:['same-row'],operationId:`commit-${index}`});
        expect(await fixture.db.prepare('SELECT amount_minor FROM transactions WHERE id=? AND ledger_id=?').bind(staged.canonicalId,SECOND_LEDGER.ledgerId).first('amount_minor')).toBe(-123-index*100);
      }
    } finally {fixture.close();}
  });
  it('allows a valid native authority to publish and rejects revocation during publication', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      expect((await commitStatementRows(fixture.db, tenantOwner(OWNER_LEDGER), statement('owner'))).accepted).toBe(1);
      const racedDb = {prepare:fixture.db.prepare.bind(fixture.db),batch:async (statements: import('../worker/db-types').D1Statement[]) => {
        await fixture.db.prepare("UPDATE owner_session_families SET revoked_at='2026-10-24T00:00:00Z' WHERE id='second-family'").run();
        return fixture.db.batch(statements);
      }};
      await expect(commitStatementRows(racedDb, tenantOwner(SECOND_LEDGER), statement('second'))).rejects.toMatchObject({status:403});
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE ledger_id='second-ledger' AND source='statement'").first('count')).toBe(0);
    } finally {fixture.close();}
  });
  it('does not treat a malformed native context as a verified browser context', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const malformed = {...tenantOwner(SECOND_LEDGER),familyId:''};
      await expect(commitStatementRows(fixture.db, malformed, statement('second'))).rejects.toMatchObject({status:403});
    } finally {fixture.close();}
  });
  it('rolls back every financial publication write if disabled immediately before the batch', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const racedDb = {prepare:fixture.db.prepare.bind(fixture.db),batch:async (statements: import('../worker/db-types').D1Statement[]) => {
        await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run();
        return fixture.db.batch(statements);
      }};
      await expect(commitStatementRows(racedDb, SECOND_LEDGER, statement('second'))).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source='statement'").first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM imports').first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_source_records').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('overwrites a client canonical ID and retains the server ID in staged and published candidates', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      await fixture.db.prepare(`INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint)
        VALUES ('second-alert','second-ledger','second-account','2026-10-23','Cafe',-123,'CAD','Food','expense','confirmed','alert','alert-fp')`).run();
      await fixture.db.prepare(`INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest)
        VALUES ('second-alert-source','second-ledger','alert','alert-key','second-alert','second-account','second-event','digest')`).run();
      const owner = tenantOwner(SECOND_LEDGER);
      const created = await createImportPreviewForOwner(fixture.db, owner, {accountId:'second-account',fileName:'bank.csv',fileSizeBytes:100,fileSha256:digest,format:'csv',rowCount:1,idempotencyKey:'spoof'});
      const row = {...statement('second').rows[0],rowId:'same-row',rowIndex:0,canonicalTransactionId:'owner-tx-1'};
      const staged = await stageImportChunkForOwner(fixture.db, owner, {previewId:created.id,chunkIndex:0,operationId:'chunk',rowStart:0,rows:[row]});
      await expect(decideImportDuplicateForOwner(fixture.db, owner, {previewId:created.id,candidateId:'owner-candidate',expectedRevision:staged.revision,decision:'resolve'})).rejects.toMatchObject({code:'candidate_not_found'});
      const stored = JSON.parse((await fixture.db.prepare('SELECT rows_json FROM import_chunks WHERE preview_id=?').bind(created.id).first<string>('rows_json'))!)[0];
      expect(stored.canonicalTransactionId).not.toBe('owner-tx-1');
      expect(staged.duplicateCandidates[0].statementTransactionId).toBe(stored.canonicalTransactionId);
      const decided = await decideImportDuplicateForOwner(fixture.db, owner, {previewId:created.id,candidateId:staged.duplicateCandidates[0].id,expectedRevision:staged.revision,decision:'resolve'});
      const committed = await commitImportForOwner(fixture.db, owner, {previewId:created.id,expectedRevision:decided.revision,rowIds:['same-row'],operationId:'commit'});
      expect(committed.duplicateCandidates[0].statementTransactionId).toBe(stored.canonicalTransactionId);
      expect(await fixture.db.prepare('SELECT ledger_id FROM transactions WHERE id=?').bind(stored.canonicalTransactionId).first()).toEqual({ledger_id:'second-ledger'});
    } finally { fixture.close(); }
  });
  it('publishes no financial rows when preview state changes immediately before the write batch', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const owner = tenantOwner(SECOND_LEDGER);
      const created = await createImportPreviewForOwner(fixture.db, owner, {accountId:'second-account',fileName:'bank.csv',fileSizeBytes:100,fileSha256:digest,format:'csv',rowCount:1,idempotencyKey:'race'});
      const row = {...statement('second').rows[0],rowId:'same-row',rowIndex:0};
      const staged = await stageImportChunkForOwner(fixture.db, owner, {previewId:created.id,chunkIndex:0,operationId:'chunk',rowStart:0,rows:[row]});
      let changed = false;
      const racedDb = {prepare:fixture.db.prepare.bind(fixture.db),batch:async (statements: import('../worker/db-types').D1Statement[]) => {
        if (!changed) { changed = true; await fixture.db.prepare("UPDATE import_previews SET status='cancelled',revision=revision+1 WHERE id=?").bind(created.id).run(); }
        return fixture.db.batch(statements);
      }};
      await expect(commitImportForOwner(racedDb, owner, {previewId:created.id,expectedRevision:staged.revision,rowIds:['same-row'],operationId:'commit'})).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source='statement'").first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM imports').first('count')).toBe(0);
    } finally {fixture.close();}
  });
  it('supports the second tenant preview, chunk and commit lifecycle', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedTenants(fixture.db);
      const owner = tenantOwner(SECOND_LEDGER);
      const created = await createImportPreviewForOwner(fixture.db, owner, {accountId:'second-account',fileName:'bank.csv',fileSizeBytes:100,fileSha256:digest,format:'csv',rowCount:1,idempotencyKey:'same-key'});
      const input = statement('second').rows[0];
      const staged = await stageImportChunkForOwner(fixture.db, owner, {previewId:created.id,chunkIndex:0,operationId:'same-chunk',rowStart:0,rows:[{...input,rowId:input.id,rowIndex:0}]});
      const committed = await commitImportForOwner(fixture.db, owner, {previewId:created.id,expectedRevision:staged.revision,rowIds:['same-row'],operationId:'same-operation'});
      expect(committed.publishedRows).toBe(1);
      const replay = await commitImportForOwner(fixture.db, owner, {previewId:created.id,expectedRevision:staged.revision,rowIds:['same-row'],operationId:'same-operation'});
      expect(replay).toEqual(committed);
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE ledger_id='personal' AND source='statement'").first('count')).toBe(0);
    } finally { fixture.close(); }
  });
});
