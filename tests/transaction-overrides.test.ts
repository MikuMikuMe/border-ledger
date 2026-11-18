import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {seedTenants,OWNER_LEDGER,SECOND_LEDGER} from './helpers/tenants';
import {readMobileTransactionPage} from '../worker/mobile-transactions';
import {appendAnnotationRevision} from '../worker/annotation-store';
import {removePlaidTransactionStatement} from '../worker/plaid-transactions';
import {previewCategoryCleanup,applyCategoryCleanup} from '../worker/category-management';
import {listCategories} from '../worker/category-store';
import {configureBudget} from '../worker/budget-store';
import {readBudgetActivity} from '../worker/budget-activity';
import {readLedgerReport} from '../worker/ledger-reports';
import {editTransaction,deleteTransaction,restoreTransaction,listDeletedTransactions,purgeExpiredTransactionOverrides} from '../worker/transaction-overrides';

const edit={requestId:'edit-operation-001',accountId:'owner-account',date:'2026-10-25',merchant:'Edited',amount:'12.34',currency:'CAD',category:'Food',kind:'expense',note:null,expectedAnnotationRevision:0};
describe('transaction overrides',()=>{
 it('allows searching and deleting the full 160-character transaction ID',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);const id='a'.repeat(160);
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES(?,'personal','owner-account','2026-01-01','Long ID',-100,'CAD','Food','expense','confirmed','manual','hash')").bind(id).run();
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({query:id}));
   expect(page.items.map(item=>item.id)).toEqual([id]);
   await deleteTransaction(f.db,OWNER_LEDGER,{id,revision:0,requestId:'long-id-delete-0001'});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({query:id}))).items).toEqual([]);
  }finally{f.close();}
 });
 it('paginates past a maximum-length Unicode transaction ID',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);const id='界'.repeat(160);
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES(?,'personal','owner-account','2099-01-01','Unicode',-100,'CAD','Food','expense','confirmed','manual','hash')").bind(id).run();
   const first=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({limit:'1'}));
   expect(first.items[0].id).toBe(id);expect(first.page.nextCursor).toBeTruthy();
   const second=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({limit:'1',cursor:first.page.nextCursor!}));
   expect(second.items).toHaveLength(1);expect(second.items[0].id).not.toBe(id);
  }finally{f.close();}
 });
 it('edits, detects stale writes, deletes and restores without changing the source',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   expect(await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit)).toEqual({revision:1});
   expect(await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit)).toEqual({revision:1});
   await expect(editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,requestId:'edit-operation-002'})).rejects.toThrow();
   expect(await f.db.prepare("SELECT merchant FROM transactions WHERE id='owner-tx-1'").first()).toEqual({merchant:'owner'});
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'delete-operation-1'});
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toEqual([expect.objectContaining({id:'owner-tx-1',merchant:'Edited',date:'2026-10-25',amountMinor:-1234,currency:'CAD'})]);
   await expect(restoreTransaction(f.db,SECOND_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-operation2'})).rejects.toThrow();
   await restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-operation1'});
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toHaveLength(0);
  }finally{f.close();}
 });
 it('moves an edited transaction only to an account in the same ledger',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status) VALUES('other-owner','personal','Other','Bank','USD','chequing','import_only')").run();
   await expect(editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,requestId:'cross-ledger-edit-1',accountId:'second-account'})).rejects.toThrow();
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,requestId:'same-ledger-edit-01',accountId:'other-owner',currency:'USD',kind:'transfer',direction:'in'});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.find(item=>item.id==='owner-tx-1')).toMatchObject({accountId:'other-owner',currency:'USD',kind:'transfer',amountMinor:1234});
   expect(await f.db.prepare("SELECT account_id FROM transactions WHERE id='owner-tx-1'").first()).toEqual({account_id:'owner-account'});
  }finally{f.close();}
 });

 it('rejects a reused request ID with a different edit and expires recovery after 365 days',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);
   await expect(editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,merchant:'Different'})).rejects.toThrow();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'delete-operation-2'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at=datetime('now','-366 days') WHERE transaction_id='owner-tx-1'").run();
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toHaveLength(0);
   await expect(restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-operation3'})).rejects.toThrow();
  }finally{f.close();}
 });

 it('reconciles an identical operation that commits concurrently',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   const batch=f.db.batch.bind(f.db);let first=true;
   f.db.batch=async statements=>{if(first){first=false;await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);}return batch(statements);};
   expect(await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit)).toEqual({revision:1});
  }finally{f.close();}
 });

 it('rejects annotations submitted after a transaction was deleted',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'deleted-annotate-1'});
   await expect(appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'stale-annotation',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Food',note:'stale'})).rejects.toThrow();
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM annotation_revisions WHERE transaction_id='owner-tx-1'").first()).toEqual({count:0});
  }finally{f.close();}
 });

 it('applies edits, deletion and restoration to activity, budget and report reads',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams());
   expect(page.items.find(item=>item.id==='owner-tx-1')).toMatchObject({date:'2026-10-25',merchant:'Edited',amountMinor:-1234});
   const budget=await readBudgetActivity(f.db,OWNER_LEDGER,{from:'2026-10-25',to:'2026-10-25',currency:'CAD'});
   expect(budget).toHaveLength(1);
   const query={from:'2026-10-25',to:'2026-10-25',currency:'CAD'};
   expect((await readLedgerReport(f.db,OWNER_LEDGER,query)).currencyTotals).toMatchObject([{confirmedMinorUnits:1234,confirmedCount:1}]);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'delete-operation-3'});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.some(item=>item.id==='owner-tx-1')).toBe(false);
   expect(await readBudgetActivity(f.db,OWNER_LEDGER,query)).toHaveLength(0);
   expect((await readLedgerReport(f.db,OWNER_LEDGER,query)).currencyTotals).toEqual([]);
   await restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-report-001'});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.some(item=>item.id==='owner-tx-1')).toBe(true);
   expect(await readBudgetActivity(f.db,OWNER_LEDGER,query)).toHaveLength(1);
   expect((await readLedgerReport(f.db,OWNER_LEDGER,query)).currencyTotals).toMatchObject([{confirmedMinorUnits:1234,confirmedCount:1}]);
  }finally{f.close();}
 });

 it('keeps a full edit newer than a prior category annotation',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'prior',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Old',note:'old note'});
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,category:'New',note:'new note',expectedAnnotationRevision:1});
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams());
   expect(page.items.find(item=>item.id==='owner-tx-1')).toMatchObject({category:'New',note:'new note'});
  }finally{f.close();}
 });

 it('rejects a concurrent annotation when a full edit commits first',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   const batch=f.db.batch.bind(f.db);let first=true;
   const racing={prepare:f.db.prepare.bind(f.db),batch:async(statements:Parameters<typeof batch>[0])=>{if(first){first=false;await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);}return batch(statements);}};
   await expect(appendAnnotationRevision(racing,OWNER_LEDGER,{id:'racing-annotation',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Stale',note:null})).rejects.toThrow();
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.find(item=>item.id==='owner-tx-1')).toMatchObject({merchant:'Edited',category:'Food'});
  }finally{f.close();}
 });

 it('rejects an edit when its annotation revision is stale',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'newer',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Newer',note:null});
   await expect(editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,expectedAnnotationRevision:0})).rejects.toThrow();
  }finally{f.close();}
 });

 it('preserves a deleted imported transaction when the provider removes it',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("UPDATE transactions SET source='plaid',plaid_item_id='item',provider_transaction_id='remote' WHERE id='owner-tx-1'").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'delete-operation-4'});
   await removePlaidTransactionStatement(f.db,OWNER_LEDGER,'item','remote').run();
   expect(await f.db.prepare("SELECT id FROM transactions WHERE id='owner-tx-1'").first()).toEqual({id:'owner-tx-1'});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.some(item=>item.id==='owner-tx-1')).toBe(false);
  }finally{f.close();}
 });

 it('includes an edited category in cleanup and applies the rename',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,category:'Hobbies'});
   expect(await listCategories(f.db,OWNER_LEDGER)).toContainEqual({name:'Hobbies',archived:false});
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Hobbies','Leisure');
   expect(preview.transactions).toBe(1);
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Hobbies',to:'Leisure',version:preview.version});
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams());
   expect(page.items.find(item=>item.id==='owner-tx-1')?.category).toBe('Leisure');
  }finally{f.close();}
 });

 it('keeps category cleanup when a deleted transaction is restored',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,category:'Hobbies'});
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'delete-operation-5'});
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Hobbies','Leisure');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Hobbies',to:'Leisure',version:preview.version});
   await restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-operation5'});
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams());
   expect(page.items.find(item=>item.id==='owner-tx-1')?.category).toBe('Leisure');
  }finally{f.close();}
 });

 it('uses a newer annotation in both Activity and budget after a full edit',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},{...edit,category:'Old'});
   await expect(appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'stale',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Stale',note:'old note'})).rejects.toThrow();
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'later',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:2,category:'New',note:'new note'});
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams());
   expect(page.items.find(item=>item.id==='owner-tx-1')).toMatchObject({category:'New',note:'new note'});
   const budget=await readBudgetActivity(f.db,OWNER_LEDGER,{from:'2026-10-25',to:'2026-10-25',currency:'CAD'});
   expect(budget[0].category).toBe('New');
  }finally{f.close();}
 });

 it('invalidates budget revisions on edit, delete, and restore',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   const revision=async()=>Number((await f.db.prepare("SELECT revision FROM budget_planning_state WHERE ledger_id='personal'").first<{revision:number}>())?.revision);
   const before=await revision();
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);const edited=await revision();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'delete-operation-6'});const deleted=await revision();
   await restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'restore-operation6'});const restored=await revision();
   expect(edited).toBeGreaterThan(before);expect(deleted).toBeGreaterThan(edited);expect(restored).toBeGreaterThan(deleted);
  }finally{f.close();}
 });

 it('rejects an edit that uses a renamed category',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO category_aliases(ledger_id,name,target) VALUES('personal','Food','Dining')").run();
   await expect(editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit)).rejects.toThrow();
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM transaction_overrides").first()).toEqual({count:0});
  }finally{f.close();}
 });

 it('permits restoration within 365 days but retains an expired tombstone',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'delete_within_365'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at=datetime('now','-364 days') WHERE transaction_id='owner-tx-1'").run();
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toHaveLength(1);
   await restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'restore_within_365'});
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:2,requestId:'delete_expired_365'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at=datetime('now','-365 days') WHERE transaction_id='owner-tx-1'").run();
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toHaveLength(0);
   await expect(restoreTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:3,requestId:'restore_expired_365'})).rejects.toThrow();
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.some(item=>item.id==='owner-tx-1')).toBe(false);
  }finally{f.close();}
 });

 it('removes expired transaction details and annotations while retaining its identity',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'private-annotation',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Private category',note:'Private note'});
   const identity=await f.db.prepare("SELECT id,account_id,source,fingerprint FROM transactions WHERE id='owner-tx-1'").first();
   await f.db.prepare("UPDATE transactions SET kind='refund',status='needs_review' WHERE id='owner-tx-1'").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'purge_private_0001'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at=datetime('now','-366 days') WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(f.db,new Date().toISOString());
   const row=await f.db.prepare("SELECT id,account_id,source,fingerprint,merchant,amount_minor,category,note,fx_lock_date,kind,status FROM transactions WHERE id='owner-tx-1'").first();
   expect(row).toMatchObject({...identity,merchant:'',amount_minor:0,category:'',note:null,fx_lock_date:null,kind:'expense',status:'confirmed'});
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM annotation_revisions WHERE transaction_id='owner-tx-1'").first()).toEqual({count:0});
   expect(await listDeletedTransactions(f.db,OWNER_LEDGER)).toHaveLength(0);
  }finally{f.close();}
 });

 it('removes a statement fingerprint that contains transaction details',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("UPDATE transactions SET source='statement',fingerprint='2025-01-01|Private merchant|-100|CAD' WHERE id='owner-tx-1'").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'statement-retention-1'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare("SELECT fingerprint FROM transactions WHERE id='owner-tx-1'").first()).toEqual({fingerprint:''});
  }finally{f.close();}
 });

 it('redacts only the expired row from its published import chunk',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   const rows=[{rowId:'expired-row',rowIndex:1,accountId:'owner-account',date:'2025-02-02',merchant:'Private merchant',amountMinor:-100,currency:'CAD',category:'Private',kind:'expense',status:'confirmed',source:'statement',fingerprint:'Private merchant',note:'Private note'},{rowId:'live-row',rowIndex:2,accountId:'owner-account',merchant:'Keep me'}];
   await f.db.prepare("INSERT INTO import_previews(id,ledger_id,account_id,filename,file_sha256,preview_digest,row_count,selected_count,status,expires_at) VALUES('preview','personal','owner-account','statement.csv','file-hash','digest',2,2,'published','2025-02-03')").run();
   await f.db.prepare("INSERT INTO import_chunks(preview_id,ledger_id,chunk_index,operation_id,chunk_digest,row_start,row_count,rows_json) VALUES('preview','personal',0,'operation','chunk',0,2,?)").bind(JSON.stringify(rows)).run();
   await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,file_sha256,row_index,content_digest) VALUES('source','personal','statement','identity','owner-tx-1','owner-account','file-hash',1,'hash')").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'import-expiry-delete'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   const chunk=await f.db.prepare("SELECT rows_json FROM import_chunks WHERE preview_id='preview'").first<{rows_json:string}>();
   const stored=JSON.parse(chunk!.rows_json);
   expect(stored[0]).not.toHaveProperty('note','Private note');
   expect(JSON.stringify(stored[0])).not.toContain('Private');
   expect(stored[0]).toMatchObject({rowId:'expired-row',rowIndex:1,accountId:'owner-account'});
   expect(stored[1]).toEqual(rows[1]);
  }finally{f.close();}
 });

 it('scrubs only expired records across ledgers at the 365-day boundary',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'boundary-owner-01'});
   await deleteTransaction(f.db,SECOND_LEDGER,{id:'second-tx-1',revision:0,requestId:'boundary-second01'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at=CASE transaction_id WHEN 'owner-tx-1' THEN '2025-01-01 00:00:00' ELSE '2025-01-01 00:00:01' END").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='owner-tx-1'").first()).toEqual({merchant:'',amount_minor:0});
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='second-tx-1'").first()).toEqual({merchant:'second',amount_minor:-900});
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='owner-tx-2'").first()).toEqual({merchant:'owner',amount_minor:-100});
  }finally{f.close();}
 });

 it('scrubs an isolated expired alert while preserving an event shared with live activity',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES ('retention-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('live-statement','personal','owner-account','2026-01-01','Live',-100,'CAD','Food','expense','confirmed','statement','live-fingerprint')").run();
   for(const [eventId,transactionId,projectionTarget] of [['isolated-event','owner-tx-1','owner-tx-1'],['shared-event','owner-tx-2','live-statement']]){
    await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,merchant,event_money_amount_minor,amounts_json,payload_digest) VALUES(?,?,?,'retention-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','Private',100,'[]','hash')").bind(eventId,eventId,eventId).run();
    await f.db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state) VALUES(?,?,?,'provisional')").bind(eventId,eventId,projectionTarget).run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES(?,'alert',?,?,'owner-account',?,'hash')").bind(eventId,eventId,transactionId,eventId).run();
    await deleteTransaction(f.db,OWNER_LEDGER,{id:transactionId,revision:0,requestId:`delete-${eventId}-123`});
   }
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00'").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare("SELECT merchant,event_money_amount_minor FROM alert_events WHERE id='isolated-event'").first()).toEqual({merchant:null,event_money_amount_minor:null});
   expect(await f.db.prepare("SELECT merchant,event_money_amount_minor FROM alert_events WHERE id='shared-event'").first()).toEqual({merchant:'Private',event_money_amount_minor:100});
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='live-statement'").first()).toEqual({merchant:'Live',amount_minor:-100});
  }finally{f.close();}
 });

 it('preserves alert evidence referenced by another live source record',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES ('shared-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
   await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,merchant,payload_digest) VALUES('shared','shared','obs','shared-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','Keep me','hash')").run();
   for(const id of ['owner-tx-1','owner-tx-2']) await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES(?,'alert',?,?,'owner-account','shared','hash')").bind(id,id,id).run();
   await f.db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state) VALUES('shared','shared','owner-tx-1','provisional')").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'shared-source-delete'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare("SELECT merchant FROM alert_events WHERE id='shared'").first()).toEqual({merchant:'Keep me'});
  }finally{f.close();}
 });

 it('keeps audit annotations and FX dates immutable outside the atomic cleanup',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'immutable-annotation',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Private',note:null});
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'immutable-delete-01'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await expect(f.db.prepare("DELETE FROM annotation_revisions WHERE id='immutable-annotation'").run()).rejects.toThrow('immutable');
   await expect(f.db.prepare("UPDATE transactions SET fx_lock_date=NULL WHERE id='owner-tx-1'").run()).rejects.toThrow('immutable');
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare('SELECT COUNT(*) AS count FROM transaction_retention_cleanup').first()).toEqual({count:0});
   await expect(f.db.prepare("UPDATE transactions SET fx_lock_date='2026-01-01' WHERE id='owner-tx-2'").run()).rejects.toThrow();
  }finally{f.close();}
 });

 it('aborts cleanup if alert match evidence changes before publication',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES ('race-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
   await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,bank_reference,payload_digest) VALUES('race-event','race-event','obs','race-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','ref','hash')").run();
   await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,bank_reference,content_digest) VALUES('race-source','alert','race-identity','owner-tx-1','owner-account','race-event','ref','hash')").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'race-expiry-delete'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   const batch=f.db.batch.bind(f.db);let raced=false;
   f.db.batch=async statements=>{if(!raced){raced=true;await f.db.prepare("UPDATE transactions SET amount_minor=-200 WHERE id='owner-tx-1'").run();}return batch(statements);};
   await expect(purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z')).rejects.toThrow();
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='owner-tx-1'").first()).toEqual({merchant:'owner',amount_minor:-200});
   expect(await f.db.prepare('SELECT COUNT(*) AS count FROM transaction_retention_evidence').first()).toEqual({count:0});
  }finally{f.close();}
 });

 it('aborts if a bank reference appears after the evidence snapshot',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES ('late-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
   await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,payload_digest) VALUES('late-event','late-event','obs','late-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','hash')").run();
   await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES('late-source','alert','late-identity','owner-tx-1','owner-account','late-event','hash')").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'late-expiry-delete'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   const batch=f.db.batch.bind(f.db);let raced=false;
   f.db.batch=async statements=>{if(!raced){raced=true;await f.db.prepare("UPDATE transaction_source_records SET bank_reference='late-ref' WHERE id='late-source'").run();}return batch(statements);};
   await expect(purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z')).rejects.toThrow();
   expect(await f.db.prepare("SELECT merchant FROM transactions WHERE id='owner-tx-1'").first()).toEqual({merchant:'owner'});
  }finally{f.close();}
 });

 it('does not invalidate budget state again on a repeated cleanup',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'budget-retention-delete'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   const first=await f.db.prepare("SELECT revision FROM budget_planning_state WHERE ledger_id='personal'").first();
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   expect(await f.db.prepare("SELECT revision FROM budget_planning_state WHERE ledger_id='personal'").first()).toEqual(first);
  }finally{f.close();}
 });

 it('rolls back all retention cleanup when a transaction scrub fails',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await appendAnnotationRevision(f.db,OWNER_LEDGER,{id:'rollback-annotation',transactionId:'owner-tx-1',authorSubjectHash:'owner',revision:1,category:'Private',note:'Keep until cleanup succeeds'});
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'retention-rollback-1'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await f.db.prepare("CREATE TRIGGER reject_retention_test BEFORE UPDATE OF merchant ON transactions WHEN OLD.id='owner-tx-1' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
   await expect(purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z')).rejects.toThrow();
   expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='owner-tx-1'").first()).toEqual({merchant:'owner',amount_minor:-100});
   expect(await f.db.prepare("SELECT category,note FROM annotation_revisions WHERE id='rollback-annotation'").first()).toEqual({category:'Private',note:'Keep until cleanup succeeds'});
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM transaction_override_operations WHERE transaction_id='owner-tx-1'").first()).toEqual({count:1});
  }finally{f.close();}
 });

 it('clears expired override details while keeping the sync tombstone',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);
   await editTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0},edit);
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:1,requestId:'purge_delete_0001'});
   await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-2',revision:0,requestId:'purge_delete_0002'});
   await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
   const expired=await f.db.prepare("SELECT merchant,note,category,has_edits,deleted_at FROM transaction_overrides WHERE transaction_id='owner-tx-1'").first();
   expect(expired).toEqual({merchant:null,note:null,category:null,has_edits:0,deleted_at:'2025-01-01 00:00:00'});
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM transaction_override_operations WHERE transaction_id='owner-tx-1'").first()).toEqual({count:0});
   expect(await f.db.prepare("SELECT deleted_at FROM transaction_overrides WHERE transaction_id='owner-tx-2'").first()).toMatchObject({deleted_at:expect.any(String)});
   expect((await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams())).items.some(item=>item.id==='owner-tx-1')).toBe(false);
  }finally{f.close();}
 });

});


it('scrubs statements hidden by expired alerts while retaining shared live records',async()=>{
 const f=createSqliteD1Fixture();try{
  await seedTenants(f.db);
  await f.db.prepare("UPDATE transactions SET source='alert' WHERE id IN ('owner-tx-1','owner-tx-2')").run();
  for(const id of ['hidden-statement','shared-statement'])await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,note) VALUES(?,'personal','owner-account','2026-01-01','Private statement',-100,'CAD','Food','expense','confirmed','statement','private fingerprint','Private note')").bind(id).run();
  await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES('retention-link-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
  await f.db.prepare("INSERT INTO import_previews(id,ledger_id,account_id,filename,file_sha256,preview_digest,row_count,selected_count,status,expires_at) VALUES('linked-preview','personal','owner-account','bank.csv','linked-hash','digest',1,1,'published','2025-02-03')").run();
  await f.db.prepare("INSERT INTO import_chunks(preview_id,ledger_id,chunk_index,operation_id,chunk_digest,row_start,row_count,rows_json) VALUES('linked-preview','personal',0,'linked-operation','chunk',0,1,?)").bind(JSON.stringify([{rowId:'linked-row',rowIndex:1,accountId:'owner-account',merchant:'Private statement',note:'Private note'}])).run();
  await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,file_sha256,row_index,content_digest) VALUES('linked-source','personal','statement','linked-identity','hidden-statement','owner-account','linked-hash',1,'hash')").run();
  await f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('linked-annotation','personal','hidden-statement','owner',1,'Private','Private note')").run();
  await f.db.prepare("INSERT INTO transaction_override_operations(ledger_id,request_id,transaction_id,payload,revision) VALUES('personal','linked-prior-operation','hidden-statement','hash',1)").run();
  for(const [eventId,alertId,target] of [['hidden-event','owner-tx-1','hidden-statement'],['shared-event','owner-tx-2','shared-statement']]){
   await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,merchant,payload_digest) VALUES(?,?,?,'retention-link-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','Private alert','hash')").bind(eventId,eventId,eventId).run();
   await f.db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state) VALUES(?,?,?,'provisional')").bind(eventId,eventId,target).run();
   await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES(?,'alert',?,?,'owner-account',?,'hash')").bind(eventId,eventId,alertId,eventId).run();
   await f.db.prepare("INSERT INTO transaction_alert_links(ledger_id,alert_transaction_id,statement_transaction_id) VALUES('personal',?,?)").bind(alertId,target).run();
   await deleteTransaction(f.db,OWNER_LEDGER,{id:alertId,revision:0,requestId:`expiry-${eventId}-operation`});
  }
  await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,merchant,payload_digest) VALUES('live-event','live-event','live-obs','retention-link-profile','test','2026-01-01','notification_posted','purchase_notice','outflow','Live','hash')").run();
  await f.db.prepare("INSERT INTO alert_event_links(id,ledger_id,from_event_id,to_transaction_id,relation,evidence_basis,revision) VALUES('live-link','personal','live-event','shared-statement','confirms','user_review',1)").run();
  await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00'").run();
  await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
  expect(await f.db.prepare("SELECT merchant,amount_minor,note FROM transactions WHERE id='hidden-statement'").first()).toEqual({merchant:'',amount_minor:0,note:null});
  expect(await f.db.prepare("SELECT merchant FROM alert_events WHERE id='hidden-event'").first()).toEqual({merchant:null});
  expect(await f.db.prepare("SELECT COUNT(*) AS count FROM annotation_revisions WHERE transaction_id='hidden-statement'").first()).toEqual({count:0});
  expect(await f.db.prepare("SELECT COUNT(*) AS count FROM transaction_override_operations WHERE transaction_id='hidden-statement'").first()).toEqual({count:0});
  expect((await f.db.prepare("SELECT rows_json FROM import_chunks WHERE preview_id='linked-preview'").first<{rows_json:string}>())?.rows_json).not.toContain('Private');
  expect(await f.db.prepare("SELECT merchant,amount_minor,note FROM transactions WHERE id='shared-statement'").first()).toEqual({merchant:'Private statement',amount_minor:-100,note:'Private note'});
 }finally{f.close();}
});


it('keeps a linked statement recoverable until its alert reaches 365 days',async()=>{
 const f=createSqliteD1Fixture();try{
  await seedTenants(f.db);
  await f.db.prepare("UPDATE transactions SET source='alert' WHERE id='owner-tx-1'").run();
  await f.db.prepare("UPDATE transactions SET source='statement' WHERE id='owner-tx-2'").run();
  await f.db.prepare("INSERT INTO transaction_alert_links(ledger_id,alert_transaction_id,statement_transaction_id) VALUES('personal','owner-tx-1','owner-tx-2')").run();
  await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'linked-boundary-delete'});
  await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:01' WHERE transaction_id='owner-tx-1'").run();
  await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
  expect(await f.db.prepare("SELECT merchant FROM transactions WHERE id='owner-tx-2'").first()).toEqual({merchant:'owner'});
  await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:01.000Z');
  expect(await f.db.prepare("SELECT merchant FROM transactions WHERE id='owner-tx-2'").first()).toEqual({merchant:''});
 }finally{f.close();}
});


it('retains a linked statement needed by a live related alert',async()=>{
 const f=createSqliteD1Fixture();try{
  await seedTenants(f.db);
  await f.db.prepare("UPDATE transactions SET source='alert' WHERE id='owner-tx-1'").run();
  await f.db.prepare("UPDATE transactions SET source='statement' WHERE id='owner-tx-2'").run();
  await f.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES('related-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
  for(const id of ['expired-event','live-related-event'])await f.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,payload_digest) VALUES(?,?,?,'related-profile','test','2025-01-01','notification_posted','purchase_notice','outflow','hash')").bind(id,id,id).run();
  await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('live-related','personal','owner-account','2026-01-01','Live',-100,'CAD','Food','expense','confirmed','alert','live')").run();
  await f.db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state) VALUES('expired-projection','expired-event','owner-tx-2','superseded'),('live-projection','live-related-event','live-related','provisional')").run();
  await f.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES('expired-source','alert','expired-source','owner-tx-1','owner-account','expired-event','hash')").run();
  await f.db.prepare("INSERT INTO transaction_alert_links(ledger_id,alert_transaction_id,statement_transaction_id) VALUES('personal','owner-tx-1','owner-tx-2')").run();
  await f.db.prepare("INSERT INTO alert_event_links(id,ledger_id,from_event_id,to_event_id,relation,evidence_basis,revision) VALUES('related-event-link','personal','live-related-event','expired-event','refund_of','user_review',1)").run();
  await deleteTransaction(f.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'related-alert-delete'});
  await f.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00'").run();
  await purgeExpiredTransactionOverrides(f.db,'2026-01-01T00:00:00.000Z');
  expect(await f.db.prepare("SELECT merchant,amount_minor FROM transactions WHERE id='owner-tx-2'").first()).toEqual({merchant:'owner',amount_minor:-100});
 }finally{f.close();}
});
