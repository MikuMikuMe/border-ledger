import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { mapPlaidTransaction,upsertPlaidTransaction } from '../worker/plaid';
import type { D1Database } from '../worker/db-types';
import { connectionPublicationStatements } from '../worker/plaid-connection-store';
import { OWNER_LEDGER } from './helpers/tenants';
import { expect,it } from 'vitest';
import { applyMigrations,createD1Fixture,task22MigrationNames } from './helpers/d1';
it('backfills raw identities and durable ownership without rewriting owner history',async()=>{
 const fixture=await createD1Fixture(task22MigrationNames);
 try {
  await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES ('plaid-raw-account','Bank','Bank','CAD','chequing','connected')").run();
  await fixture.db.prepare("INSERT INTO plaid_items(item_id,access_token_ciphertext,access_token_iv) VALUES ('raw-item','cipher','iv')").run();
  await fixture.db.prepare("INSERT INTO plaid_accounts(plaid_account_id,item_id,account_id,name) VALUES ('raw-account','raw-item','plaid-raw-account','Bank')").run();
  await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES ('historical','plaid-raw-account','2026-01-01','Original',-999,'CAD','Food','expense','confirmed','plaid','original','raw-item','raw-tx')").run();
  const before=await fixture.db.prepare('SELECT * FROM transactions').all();
  await applyMigrations(fixture.db,['0023-plaid-tenant-connections.sql']);
  expect((await fixture.db.prepare('SELECT * FROM transactions').all()).results).toEqual(before.results);
  expect(await fixture.db.prepare('SELECT item_id,provider_item_id FROM plaid_items').first()).toEqual({item_id:'raw-item',provider_item_id:'raw-item'});
  expect(await fixture.db.prepare('SELECT account_id,provider_account_id FROM plaid_account_ownership').first()).toEqual({account_id:'plaid-raw-account',provider_account_id:'raw-account'});
  expect(await fixture.db.prepare('SELECT connection_id,connection_revision,lifecycle FROM sync_state').first()).toEqual({connection_id:'plaid:raw-item',connection_revision:1,lifecycle:'active'});
 }finally{await fixture.dispose();}
});

it('restores only demonstrable disconnected owner bindings through migration and reconnect',async()=>{
 const fixture=await createD1Fixture(task22MigrationNames);const db=fixture.db;
 try {
  for(const [raw,item,source] of [['known','old-item','plaid'],['ambiguous','first-item','plaid'],['manual','old-item','manual'],['legacy','legacy-item','plaid'],['mismatch','old-item','plaid']]){
   await db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES (?,'Original','Bank','CAD','chequing','import_only')").bind(`plaid-${raw}`).run();
   await db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES (?,?,'2026-01-01','Original',-999,'CAD','Food','expense','confirmed',?,'original',?,?)").bind(`history-${raw}`,`plaid-${raw}`,source,item,`raw-tx-${raw}`).run();
  }
  await db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES ('other-history','plaid-ambiguous','2026-01-01','Other',-100,'CAD','Food','expense','confirmed','plaid','other','second-item','other-tx')").run();
  await db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,provider_item_id,provider_transaction_id,content_digest) VALUES ('old-source','plaid','plaid:old-item:raw-tx-known','history-known','plaid-known','old-item','raw-tx-known','original-digest')").run();
  await db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,provider_item_id,provider_transaction_id,content_digest) VALUES ('wrong-source','plaid','plaid:wrong-item:raw-tx-mismatch','history-mismatch','plaid-mismatch','wrong-item','raw-tx-mismatch','original-digest')").run();
  const history=(await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
  const sources=(await db.prepare('SELECT * FROM transaction_source_records').all()).results;
  await applyMigrations(db,['0023-plaid-tenant-connections.sql']);
  expect((await db.prepare('SELECT * FROM plaid_account_ownership ORDER BY account_id').all()).results).toEqual([{account_id:'plaid-known',ledger_id:'personal',item_id:'old-item',provider_account_id:'known'},{account_id:'plaid-legacy',ledger_id:'personal',item_id:'legacy-item',provider_account_id:'legacy'}]);
  const publication=(raw:string,item:string)=>connectionPublicationStatements(db,OWNER_LEDGER,{providerItemId:item,institution:'Bank',ciphertext:'cipher',iv:'iv',accounts:[{providerAccountId:raw,name:'Bank',currency:'CAD',kind:'chequing',mask:null,subtype:null}]});
  const reconnect=await publication('known','old-item');await db.batch(reconnect.statements);
  const oldReconnect=await publication('legacy','legacy-item');await db.batch(oldReconnect.statements);
  for(const [raw,item] of [['ambiguous','first-item'],['manual','old-item'],['known','unrelated-item'],['mismatch','old-item']]){
   await expect(publication(raw,item).then(value=>db.batch(value.statements))).rejects.toMatchObject({code:'plaid_ownership_recovery_required',status:409});
  }
  expect((await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(history);
  expect((await db.prepare('SELECT * FROM transaction_source_records').all()).results).toEqual(sources);
  expect((await db.prepare('SELECT item_id FROM plaid_items ORDER BY item_id').all()).results).toEqual([{item_id:'legacy-item'},{item_id:'old-item'}]);
 }finally{await fixture.dispose();}
});

async function copyRetainedHistory(source:D1Database,target:D1Database) {
 for(const table of ['accounts','transactions','transaction_source_records']) {
  const rows=await source.prepare(`SELECT * FROM ${table}`).all<Record<string,unknown>>();
  for(const row of rows.results) {
   const initial=table==='transactions'?{...row,date:row.fx_lock_date}:row;
   const columns=Object.keys(initial);
   await target.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...Object.values(initial)).run();
   if(table==='transactions')await target.prepare('UPDATE transactions SET date=?,updated_at=? WHERE id=?').bind(row.date,row.updated_at,row.id).run();
  }
 }
}
it('recovers exact pending-to-posted lineage while rejecting contradictory provider evidence',async()=>{
 const source=createSqliteD1Fixture();const fixture=await createD1Fixture(task22MigrationNames);const db=fixture.db;
 try {
  for(const raw of ['valid','wrong-pending','wrong-current','current-wrong-pending']) {
   const published=await connectionPublicationStatements(source.db,OWNER_LEDGER,{providerItemId:`${raw}-item`,institution:'Bank',ciphertext:'cipher',iv:'iv',accounts:[{providerAccountId:raw,name:'Bank',currency:'CAD',kind:'chequing',mask:null,subtype:null}]});
   await source.db.batch(published.statements);
   const pending={transaction_id:`pending-${raw}`,account_id:raw,amount:12,iso_currency_code:'CAD',date:'2026-01-01',name:'Pending purchase',pending:true};
   const pendingId=await upsertPlaidTransaction(source.db,OWNER_LEDGER,mapPlaidTransaction(pending,`plaid-${raw}`,`${raw}-item`)!);
   const posted={...pending,transaction_id:`posted-${raw}`,pending_transaction_id:`pending-${raw}`,date:'2026-01-03',name:'Posted purchase',pending:false};
   expect(await upsertPlaidTransaction(source.db,OWNER_LEDGER,mapPlaidTransaction(posted,`plaid-${raw}`,`${raw}-item`)!)).toBe(pendingId);
  }
  await source.db.prepare("UPDATE transaction_source_records SET provider_pending_transaction_id='unrelated-pending' WHERE account_id='plaid-wrong-pending' AND provider_transaction_id IS NULL").run();
  await source.db.prepare("UPDATE transaction_source_records SET provider_transaction_id='unrelated-current' WHERE account_id='plaid-wrong-current' AND provider_transaction_id IS NOT NULL").run();
  await source.db.prepare("UPDATE transaction_source_records SET provider_pending_transaction_id='unrelated-pending' WHERE account_id='plaid-current-wrong-pending' AND provider_transaction_id IS NOT NULL").run();
  await source.db.prepare("UPDATE accounts SET status='import_only'").run();
  // Transfer only the rows retained by pre0023 disconnect: no credentials, mappings or new ownership table.
  await copyRetainedHistory(source.db,db);
  const transactions=(await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
  const sources=(await db.prepare('SELECT * FROM transaction_source_records ORDER BY id').all()).results;
  expect((await db.prepare("SELECT provider_transaction_id,provider_pending_transaction_id FROM transaction_source_records WHERE account_id='plaid-valid' ORDER BY provider_transaction_id").all()).results).toEqual([
   {provider_transaction_id:null,provider_pending_transaction_id:'pending-valid'},
   {provider_transaction_id:'posted-valid',provider_pending_transaction_id:'pending-valid'},
  ]);
  await applyMigrations(db,['0023-plaid-tenant-connections.sql']);
  expect((await db.prepare('SELECT account_id FROM plaid_account_ownership').all()).results).toEqual([{account_id:'plaid-valid'}]);
  for(const raw of ['valid','wrong-pending','wrong-current','current-wrong-pending']) {
   const reconnect=()=>connectionPublicationStatements(db,OWNER_LEDGER,{providerItemId:`${raw}-item`,institution:'Bank',ciphertext:'new-cipher',iv:'new-iv',accounts:[{providerAccountId:raw,name:'Bank',currency:'CAD',kind:'chequing',mask:null,subtype:null}]}).then(value=>db.batch(value.statements));
   if(raw==='valid')await reconnect();else await expect(reconnect()).rejects.toMatchObject({code:'plaid_ownership_recovery_required',status:409});
  }
  expect((await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(transactions);
  expect((await db.prepare('SELECT * FROM transaction_source_records ORDER BY id').all()).results).toEqual(sources);
  expect(await db.prepare("SELECT fx_lock_date FROM transactions WHERE account_id='plaid-valid'").first()).toEqual({fx_lock_date:'2026-01-01'});
  expect((await db.prepare('SELECT item_id FROM plaid_items').all()).results).toEqual([{item_id:'valid-item'}]);
 }finally{source.close();await fixture.dispose();}
});
