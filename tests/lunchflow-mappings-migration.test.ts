import { expect,it } from 'vitest';
import { createD1Fixture,applyMigrations,task24MigrationNames } from './helpers/d1';
import { seedTenants } from './helpers/tenants';
const before=[...task24MigrationNames,'0025-lunchflow-platform.sql'],migration='0026-lunchflow-connection-mappings.sql';
it('preserves original Personal mappings, receipts, financial rows and IDs through real D1 migration',async()=>{
 const f=await createD1Fixture(before);try{
  await seedTenants(f.db);
  await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,account_id,ledger_id,name,institution,currency,kind,revision,last_error) VALUES ('raw','owner-account','personal','Owner','Bank','CAD','chequing',7,'prior error')").run();
  await f.db.prepare("INSERT INTO lunchflow_operations(id,owner_subject_hash,operation_kind,idempotency_key,response_json) VALUES ('old-receipt','subject','sync','key','{}')").run();
  const tables=['accounts','transactions','transaction_source_records','lunchflow_accounts','lunchflow_operations'];
  const snapshots=await Promise.all(tables.map(async table=>({table,rows:(await f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results})));
  await applyMigrations(f.db,[migration]);
  for(const {table,rows} of snapshots){
   const columns=rows.length?Object.keys(rows[0]):['id'];
   expect((await f.db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY 1`).all()).results).toEqual(rows);
  }
  expect(await f.db.prepare('SELECT connection_id FROM lunchflow_accounts').first()).toEqual({connection_id:'lunchflow-personal-owner'});
  expect(await f.db.prepare('SELECT connection_generation FROM lunchflow_operations').first()).toEqual({connection_generation:1});
  await expect(f.db.prepare("INSERT OR REPLACE INTO lunchflow_accounts(provider_account_id,account_id,ledger_id,name,institution) VALUES ('raw','owner-account','personal','Reset','Bank')").run()).rejects.toThrow();
  expect(await f.db.prepare('SELECT revision,last_error FROM lunchflow_accounts').first()).toEqual({revision:7,last_error:'prior error'});
  expect((await f.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 }finally{await f.dispose();}
});
it('aborts ambiguous pre-Platform nonowner mappings rather than guessing credential ownership',async()=>{
 const f=await createD1Fixture(before);try{
  await seedTenants(f.db);await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,ledger_id,name,institution) VALUES ('raw','second-ledger','Second','Bank')").run();
  await expect(applyMigrations(f.db,[migration])).rejects.toThrow();
  expect(await f.db.prepare("SELECT ledger_id FROM lunchflow_accounts WHERE provider_account_id='raw'").first()).toEqual({ledger_id:'second-ledger'});
 }finally{await f.dispose();}
});
