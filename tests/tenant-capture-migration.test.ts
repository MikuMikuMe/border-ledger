import { expect,it } from 'vitest';
import { applyMigrations,createD1Fixture,task23MigrationNames } from './helpers/d1';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database } from '../worker/db-types';
const RAW='00000000-0000-4000-8000-000000000099';
async function seedHistory(db:D1Database){
 await db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES ('history-account','History','Bank','CAD','chequing','import_only')").run();
 await db.prepare("INSERT INTO source_profiles(id,provider,source_kind,display_name,parser_version,status) VALUES ('history-profile','bank','email','Bank','v1','approved')").run();
 await db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES ('history-tx','history-account','2026-01-01','Original',-500,'CAD','Food','expense','confirmed','statement','history')").run();
 await db.prepare("INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,account_id,payload_digest) VALUES (?,?,'observation','history-profile','v1','2026-01-01T00:00:00Z','notification_posted','purchase_notice','outflow','history-account','same-digest')").bind(RAW,RAW).run();
 await db.prepare("INSERT INTO alert_event_digests(event_id,algorithm,digest) VALUES (?,'payload-sha256','same-digest')").bind(RAW).run();
 await db.prepare("INSERT INTO alert_projections(id,event_id,transaction_id,state,revision) VALUES ('history-projection',?,'history-tx','superseded',2)").bind(RAW).run();
 await db.prepare("INSERT INTO alert_projection_provenance(id,projection_id,source_kind,source_id,basis,revision) VALUES ('history-provenance','history-projection','alert',?,'alert_event',1)").bind(RAW).run();
 await db.prepare("INSERT INTO alert_event_links(id,from_event_id,to_transaction_id,relation,evidence_basis,revision) VALUES ('history-link',?,'history-tx','confirms','bank_reference',2)").bind(RAW).run();
 await db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,event_id,content_digest) VALUES ('history-source','alert',?,'history-tx','history-account',?,'same-digest')").bind(`alert:personal:${RAW}`,RAW).run();
}
async function equalRawIdentity(db:D1Database){
 await db.prepare("INSERT INTO users(id) VALUES ('other')").run();await db.prepare("INSERT INTO ledgers(id,user_id) VALUES ('other-ledger','other')").run();
 await db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version) VALUES ('other-profile','other-ledger','bank','email','Other','v1')").run();
 await db.prepare("INSERT INTO alert_events(id,event_id,raw_event_id,ledger_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,payload_digest) VALUES ('internal-other','internal-other',?,'other-ledger','observation','other-profile','v1','2026-01-01T00:00:00Z','notification_posted','purchase_notice','outflow','same-digest')").bind(RAW).run();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events WHERE COALESCE(raw_event_id,event_id)=?').bind(RAW).first()).toEqual({n:2});
 const before=(await db.prepare('SELECT * FROM alert_events ORDER BY id').all()).results;
 await expect(db.prepare("UPDATE alert_events SET raw_event_id='changed' WHERE id='internal-other'").run()).rejects.toThrow(/immutable/i);
 await expect(db.prepare("UPDATE alert_events SET raw_event_id=NULL WHERE id='internal-other'").run()).rejects.toThrow(/immutable/i);
 for(const raw of ['', ' ', RAW]) {
  await expect(db.prepare("INSERT OR REPLACE INTO alert_events(id,event_id,raw_event_id,ledger_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,payload_digest) VALUES ('collision','collision',?,'other-ledger','observation','other-profile','v1','2026-01-01T00:00:00Z','unresolved','unknown','unknown','digest')").bind(raw).run()).rejects.toThrow();
 }
 await expect(db.prepare("INSERT OR REPLACE INTO alert_events(id,event_id,raw_event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,payload_digest) VALUES (?,?,NULL,'observation','history-profile','v1','2026-01-01T00:00:00Z','unresolved','unknown','unknown','digest')").bind(RAW,RAW).run()).rejects.toThrow();
 await expect(db.prepare("INSERT OR REPLACE INTO alert_event_digests(event_id,algorithm,digest) VALUES (?,'payload-sha256','changed')").bind(RAW).run()).rejects.toThrow();
 expect(await db.prepare('SELECT digest FROM alert_event_digests WHERE event_id=?').bind(RAW).first()).toEqual({digest:'same-digest'});

 await expect(db.prepare("INSERT OR REPLACE INTO alert_events SELECT id,ledger_id,device_id,event_id,observation_id,source_profile_id,parser_version,notification_posted_at,captured_at,event_time_basis,event_type,direction,instrument_hint_kind,instrument_hint_value,account_id,event_money_currency,event_money_amount_minor,primary_money_role,amounts_json,fee_treatment,bank_reference,bank_displayed_time,bank_displayed_zone,bank_displayed_precision,bank_year_provenance,'Overwritten',completeness_json,payload_digest,created_at,raw_event_id FROM alert_events WHERE id='internal-other'").run()).rejects.toThrow();
 expect((await db.prepare('SELECT * FROM alert_events ORDER BY id').all()).results).toEqual(before);
}
it('migrates raw alert identities without changing owner IDs, balances, digests, links or provenance',async()=>{
 const fixture=await createD1Fixture(task23MigrationNames);try{
  await seedHistory(fixture.db);
  const tables=['transactions','alert_event_digests','alert_projections','alert_projection_provenance','alert_event_links','transaction_source_records'];
  const before=await Promise.all(tables.map(async table=>(await fixture.db.prepare(`SELECT * FROM ${table}`).all()).results));
  const eventBefore=await fixture.db.prepare('SELECT * FROM alert_events').first();
  await applyMigrations(fixture.db,['0024-alert-raw-identities.sql']);
  expect(await fixture.db.prepare('SELECT * FROM alert_events').first()).toEqual({...eventBefore,raw_event_id:RAW});
  for(const [index,table] of tables.entries())expect((await fixture.db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(before[index]);
  await equalRawIdentity(fixture.db);expect((await fixture.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
 }finally{await fixture.dispose();}
});
it('fresh schema supports equal tenant raw identities and rejects replacement of immutable evidence',async()=>{
 const fixture=createSqliteD1Fixture();try{await seedHistory(fixture.db);await equalRawIdentity(fixture.db);}finally{fixture.close();}
});
