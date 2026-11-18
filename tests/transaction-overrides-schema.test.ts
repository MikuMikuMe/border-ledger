import {describe,it,expect} from 'vitest';
import {createD1Fixture,currentMigrationNames} from './helpers/d1';
import {commitStatementRows} from '../worker/reconciliation-store';
import {seedTenants,OWNER_LEDGER} from './helpers/tenants';
import {deleteTransaction,purgeExpiredTransactionOverrides} from '../worker/transaction-overrides';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';

describe('transaction override storage',()=>{
 it('applies expiry cleanup using the migrated D1 schema',async()=>{
  const fixture=await createD1Fixture(currentMigrationNames);try{
   await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES('migration-acct','Account','Bank','CAD','chequing','connected')").run();
   await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('migration-tx','migration-acct','2026-01-01','Private',-123,'CAD','Food','expense','confirmed','manual','hash')").run();
   await fixture.db.prepare("INSERT INTO annotation_revisions(id,transaction_id,author_subject_hash,revision,category,note) VALUES('migration-annotation','migration-tx','owner',1,'Private','Private note')").run();
   await deleteTransaction(fixture.db,{userId:'owner',ledgerId:'personal'},{id:'migration-tx',revision:0,requestId:'migration-cleanup-delete'});
   await fixture.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='migration-tx'").run();
   await purgeExpiredTransactionOverrides(fixture.db,'2026-01-01T00:00:00.000Z');
   expect(await fixture.db.prepare("SELECT merchant,amount_minor,fx_lock_date FROM transactions WHERE id='migration-tx'").first()).toEqual({merchant:'',amount_minor:0,fx_lock_date:null});
   expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM annotation_revisions WHERE transaction_id='migration-tx'").first('count')).toBe(0);
  }finally{await fixture.dispose();}
 });
 it('matches an expired alert to a later statement using migrated D1 evidence',async()=>{
  const fixture=await createD1Fixture(currentMigrationNames);try{
   await seedTenants(fixture.db);
   await fixture.db.prepare("UPDATE transactions SET source='alert' WHERE id='owner-tx-1'").run();
   await fixture.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status,config_json) VALUES('d1-profile','personal','bank','credit_alert','Bank','test','approved','{}')").run();
   await fixture.db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,bank_reference,payload_digest) VALUES('d1-event','d1-event','obs','d1-profile','test','2026-10-24','notification_posted','purchase_notice','outflow','d1-reference','hash')").run();
   await fixture.db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state) VALUES('d1-projection','d1-event','owner-tx-1','provisional')").run();
   await fixture.db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,bank_reference,content_digest) VALUES('d1-source','alert','d1-identity','owner-tx-1','owner-account','d1-event','d1-reference','hash')").run();
   await deleteTransaction(fixture.db,OWNER_LEDGER,{id:'owner-tx-1',revision:0,requestId:'d1-alert-delete-0001'});
   await fixture.db.prepare("UPDATE transaction_overrides SET deleted_at='2025-01-01 00:00:00' WHERE transaction_id='owner-tx-1'").run();
   await purgeExpiredTransactionOverrides(fixture.db,'2026-01-01T00:00:00.000Z');
   const result=await commitStatementRows(fixture.db,OWNER_LEDGER,{importId:'d1-import',accountId:'owner-account',filename:'bank.csv',fileSha256:'a'.repeat(64),rows:[{id:'d1-statement',accountId:'owner-account',date:'2026-10-24',merchant:'owner',amountMinor:-100,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'d1-fingerprint',bankReference:'d1-reference',sourceIdentity:{accountId:'owner-account',fileSha256:'a'.repeat(64),rowIndex:0}}]});
   expect(await fixture.db.prepare('SELECT id FROM effective_transactions WHERE id=?').bind(result.transactionIds[0]).first()).toBeNull();
  }finally{await fixture.dispose();}
 });
 it('rejects overrides for nonexistent transactions',async()=>{
  const fixture=createSqliteD1Fixture();
  try {
   await expect(fixture.db.prepare("INSERT INTO transaction_overrides(ledger_id,transaction_id,revision) VALUES('personal','missing',1)").run()).rejects.toThrow();
   const row=await fixture.db.prepare("SELECT COUNT(*) AS count FROM transaction_overrides").first<{count:number}>();
   expect(row?.count).toBe(0);
  } finally {fixture.close();}
 });
 it('indexes linked statements for ledger reads',async()=>{
  const fixture=createSqliteD1Fixture();try{
   const plan=await fixture.db.prepare('EXPLAIN QUERY PLAN SELECT alert_transaction_id FROM transaction_alert_links WHERE ledger_id=? AND statement_transaction_id=?').bind('personal','statement').all<{detail:string}>();
   expect(plan.results.some(row=>row.detail.includes('statement_transaction_id=?'))).toBe(true);
  }finally{fixture.close();}
 });

 it('indexes deleted transactions by ledger and deletion time',async()=>{
  const fixture=createSqliteD1Fixture();try{
   const plan=await fixture.db.prepare('EXPLAIN QUERY PLAN SELECT transaction_id FROM transaction_overrides WHERE ledger_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').bind('personal').all<{detail:string}>();
   expect(plan.results.some(row=>row.detail.includes('transaction_overrides_deleted_idx'))).toBe(true);
  }finally{fixture.close();}
 });

});
