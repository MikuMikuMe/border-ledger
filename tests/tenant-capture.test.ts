import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedTenants, OWNER_LEDGER, SECOND_LEDGER } from './helpers/tenants';
import { authenticateCapture, hashSecret } from '../worker/mobile-auth';
import { ingestAlertBatch, readCaptureStatus } from '../worker/alert-ingestion';
import { commitStatementRows } from '../worker/reconciliation-store';
import { appendAlertEventBatch } from '../worker/alert-store';
import { event } from './helpers/alerts';
import type { D1Database, D1Statement } from '../worker/db-types';

const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))f.close();});
const config={canonicalOrigin:'https://pf.example.com',callbackUrl:'https://pf.example.com/android/auth/callback',environment:'sandbox',accessAuthorizationUrl:'https://pf.example.com/mobile/authorize',sessionEncryptionKey:'synthetic-capture-isolation-key'};
async function setup(){
 const fixture=createSqliteD1Fixture();fixtures.push(fixture);const db=fixture.db;await seedTenants(db);
 const contexts=[];
 for(const ledger of [OWNER_LEDGER,SECOND_LEDGER]){
  const user=ledger.userId;
  await db.prepare("INSERT INTO mobile_devices(id,ledger_id,device_name,platform,status) VALUES (?,?,'Phone','android','paired')").bind(`${user}-device`,ledger.ledgerId).run();
  await db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES (?,?,'bank','notification','Bank','v1','approved')").bind(`${user}-profile`,ledger.ledgerId).run();
  await db.prepare("INSERT INTO source_account_mappings(id,ledger_id,source_profile_id,account_id,approval_status,approved_at) VALUES (?,?,?,?,'approved',CURRENT_TIMESTAMP)").bind(`${user}-map`,ledger.ledgerId,`${user}-profile`,`${user}-account`).run();
  await db.prepare("INSERT INTO device_source_scopes(id,ledger_id,device_id,source_profile_id,account_id,currency) VALUES (?,?,?,?,?,'CAD')").bind(`${user}-scope`,ledger.ledgerId,`${user}-device`,`${user}-profile`,`${user}-account`).run();
  await db.prepare("INSERT INTO capture_credentials(id,ledger_id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at,environment_hash) VALUES (?,?,?,?,'capture','alerts:write',1,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z',?)").bind(`${user}-capture`,ledger.ledgerId,`${user}-device`,await hashSecret(`secret-${user}`),await hashSecret(config.environment)).run();
  contexts.push(await authenticateCapture(`secret-${user}`,db,config));
 }
 return {db,contexts};
}
function input(user:string){return event({sourceProfileId:`${user}-profile`,parserVersion:'v1'});}
function race(db:D1Database,change:()=>Promise<unknown>):D1Database{return {prepare:sql=>db.prepare(sql),batch:async statements=>{await change();return db.batch(statements);}};}
it('accepts the same raw UUID independently in two ledgers and returns raw UUID receipts',async()=>{
 const {db,contexts}=await setup();
 for(const context of contexts){const ack=(await ingestAlertBatch(db,context,{events:[input(context.userId)]})).acks[0];expect(ack).toMatchObject({eventId:event().eventId,receiptId:event().eventId,status:'accepted'});}
 const rows=(await db.prepare('SELECT id,event_id,raw_event_id,ledger_id FROM alert_events ORDER BY ledger_id').all()).results;
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({id:event().eventId,event_id:event().eventId,raw_event_id:event().eventId,ledger_id:'personal'});
 expect(rows[1].id).not.toBe(event().eventId);expect(rows[1].raw_event_id).toBe(event().eventId);
 for(const context of contexts)expect((await readCaptureStatus(db,context,event().eventId)).receipt?.eventId).toBe(event().eventId);
});
it.each(['user','device','credential','generation','environment','config','profile','mapping'] as const)('rejects %s changes at publication without partial alert rows',async change=>{
 const {db,contexts}=await setup();
 const sql={user:"UPDATE users SET status='disabled' WHERE id='owner'",device:"UPDATE mobile_devices SET status='revoked' WHERE id='owner-device'",credential:"UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-capture'",generation:"UPDATE capture_credentials SET generation=2 WHERE id='owner-capture'",environment:"UPDATE capture_credentials SET environment_hash='other' WHERE id='owner-capture'",config:"UPDATE mobile_devices SET source_config_revision=1 WHERE id='owner-device'",profile:"UPDATE source_profiles SET status='paused' WHERE id='owner-profile'",mapping:"UPDATE source_account_mappings SET approval_status='revoked' WHERE id='owner-map'"}[change];
 await expect(ingestAlertBatch(race(db,()=>db.prepare(sql).run()),contexts[0],{events:[input('owner')]})).rejects.toThrow();
 for(const table of ['alert_events','alert_projections','alert_event_digests','transaction_source_records'])expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({n:0});
 expect(await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE source='alert'").first()).toEqual({n:0});
});
it('revalidates revocation before replay or status can disclose an old receipt',async()=>{
 const {db,contexts}=await setup();await ingestAlertBatch(db,contexts[0],{events:[input('owner')]});
 await db.prepare("UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-capture'").run();
 await expect(ingestAlertBatch(db,contexts[0],{events:[input('owner')]})).rejects.toThrow();
 await expect(readCaptureStatus(db,contexts[0],event().eventId)).rejects.toThrow();
});
it('does not require an active owner session for a separately active capture credential',async()=>{
 const {db,contexts}=await setup();await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP").run();
 expect((await ingestAlertBatch(db,contexts[0],{events:[input('owner')]})).acks[0].status).toBe('accepted');
});
it('preserves per-device replay and changed-payload conflict within its ledger',async()=>{
 const {db,contexts}=await setup();const body={events:[input('owner')]};
 const first=(await ingestAlertBatch(db,contexts[0],body)).acks[0];
 expect((await ingestAlertBatch(db,contexts[0],body)).acks[0]).toEqual({...first,status:'replayed'});
 expect((await ingestAlertBatch(db,contexts[0],{events:[{...input('owner'),merchant:'Changed'}]})).acks[0].status).toBe('conflict');
 expect((await readCaptureStatus(db,contexts[1],event().eventId)).receipt).toBeNull();
});
it('rolls back alert evidence when a same-ledger financial ID is already occupied',async()=>{
 const {db,contexts}=await setup();await db.prepare("UPDATE transactions SET id=? WHERE id='owner-tx-1'").bind(event().eventId).run();
 const before=(await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
 const result=await ingestAlertBatch(db,contexts[0],{events:[input('owner')]}).catch(()=>null);
 expect(result?.acks[0].status).not.toBe('accepted');expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
 expect((await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(before);
});

it.each([
  ["credential expiry", "UPDATE capture_credentials SET expires_at='2000-01-01T00:00:00Z' WHERE id='owner-capture'"],
  ["scope expiry", "UPDATE device_source_scopes SET expires_at='2000-01-01T00:00:00Z' WHERE id='owner-scope'"],
  ["scope revocation", "UPDATE device_source_scopes SET status='revoked' WHERE id='owner-scope'"],
  ["account currency", "DELETE FROM account_currencies WHERE account_id='owner-account' AND currency='CAD'"],
])('rejects changed %s at publication',async(_label,sql)=>{
 const {db,contexts}=await setup();
 await expect(ingestAlertBatch(race(db,()=>db.prepare(sql).run()),contexts[0],{events:[input('owner')]})).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
});
async function enableHint(db:D1Database) {
 await db.prepare("INSERT INTO source_profile_hints(id,source_profile_id,hint_kind,hint_value) VALUES ('owner-hint','owner-profile','card_suffix','1234')").run();
 await db.prepare("UPDATE source_account_mappings SET hint_kind='card_suffix',hint_value='1234' WHERE id='owner-map'").run();
 await db.prepare("UPDATE device_source_scopes SET instrument_hint_kind='card_suffix',instrument_hint_value='1234' WHERE id='owner-scope'").run();
 return authenticateCapture('secret-owner',db,config);
}
it('deeply snapshots the approved hint before crypto awaits and rejects later hint removal',async()=>{
 const {db}=await setup();const granted=await enableHint(db);
 expect(Object.isFrozen(granted.sourceScopes[0].instrumentHint)).toBe(true);
 const mutable=structuredClone(granted);const digest=crypto.subtle.digest.bind(crypto.subtle);
 vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{mutable.sourceScopes[0].instrumentHint!.value='9999';return digest(...args);});
 const body={events:[{...input('owner'),instrumentHint:{kind:'card_suffix' as const,value:'1234'}}]};
 expect((await ingestAlertBatch(db,mutable,body)).acks[0].status).toBe('accepted');
 const racing=race(db,()=>db.prepare("DELETE FROM source_profile_hints WHERE id='owner-hint'").run());
 await expect(ingestAlertBatch(racing,granted,{events:[{...body.events[0],eventId:'00000000-0000-4000-8000-000000000002'}]})).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:1});
});
it('rejects revocation during the payload digest await and never promotes capture to owner authority',async()=>{
 const {db,contexts}=await setup();
 await expect(appendAlertEventBatch(db,contexts[0] as never,[])).rejects.toThrow();
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{await db.prepare("UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-capture'").run();return digest(...args);});
 await expect(ingestAlertBatch(db,contexts[0],{events:[input('owner')]})).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
});
function afterReceiptRead(db:D1Database,change:()=>Promise<unknown>):D1Database {
 let changed=false;
 function wrap(statement:D1Statement):D1Statement {
  return {bind:(...args)=>wrap(statement.bind(...args)),all:()=>statement.all(),run:()=>statement.run(),first:async<T>()=>{const row=await statement.first<T>();if(!changed){changed=true;await change();}return row;}};
 }
 return {prepare:sql=>sql.includes('FROM alert_events e LEFT JOIN alert_projections')?wrap(db.prepare(sql)):db.prepare(sql),batch:statements=>db.batch(statements)};
}
it.each(['replay','status'] as const)('does not disclose a %s receipt after revocation at its read boundary',async mode=>{
 const {db,contexts}=await setup();await ingestAlertBatch(db,contexts[0],{events:[input('owner')]});
 const racing=afterReceiptRead(db,()=>db.prepare("UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-capture'").run());
 await expect(mode==='replay'?ingestAlertBatch(racing,contexts[0],{events:[input('owner')]}):readCaptureStatus(racing,contexts[0],event().eventId)).rejects.toThrow();
});
it('preserves each ledger statement history and provenance for equal bank references and raw alert IDs',async()=>{
 const {db,contexts}=await setup();
 for(const context of contexts){
  const accountId=`${context.userId}-account`;
  await commitStatementRows(db,context.ledgerId==='personal'?OWNER_LEDGER:SECOND_LEDGER,{importId:'shared-import',accountId,filename:'bank.csv',fileSha256:'a'.repeat(64),rows:[{id:'shared-statement',accountId,date:'2026-10-13',merchant:'Synthetic merchant',amountMinor:-1234,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'shared-fingerprint',sourceIdentity:{accountId,fileSha256:'a'.repeat(64),rowIndex:0},bankReference:'shared-bank-reference'}]});
  const before=(await db.prepare("SELECT * FROM transactions WHERE ledger_id=? AND source='statement'").bind(context.ledgerId).all()).results;
  const ack=(await ingestAlertBatch(db,context,{events:[{...input(context.userId),bankReference:'shared-bank-reference'}]})).acks[0];
  expect(ack).toMatchObject({status:'accepted',eventId:event().eventId,projectionState:'superseded'});
  expect((await db.prepare("SELECT id,account_id,amount_minor,category,source FROM transactions WHERE ledger_id=? AND source='statement'").bind(context.ledgerId).all()).results).toEqual(before.map(({id,account_id,amount_minor,category,source})=>({id,account_id,amount_minor,category,source})));
  expect(await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE ledger_id=? AND source='alert'").bind(context.ledgerId).first()).toEqual({n:0});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM alert_projection_provenance p JOIN transaction_source_records s ON p.source_id=s.id AND p.ledger_id=s.ledger_id WHERE p.ledger_id=? AND p.source_kind='statement'").bind(context.ledgerId).first()).toEqual({n:1});
 }
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

const OTHER_RAW='00000000-0000-4000-8000-000000000088';
async function prepareCollision(db:D1Database,kind:string) {
 const raw=event().eventId;
 if(kind==='source') {
  await db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES (?,'manual','occupied-source','owner-tx-1','owner-account','manual','original')").bind(`source-record:${raw}`).run();return;
 }
 if(kind==='projection') {
  await appendAlertEventBatch(db,OWNER_LEDGER,[{id:'bare-event',eventId:'bare-event',observationId:'bare',sourceProfileId:'owner-profile',parserVersion:'v1',notificationPostedAt:null,capturedAt:'2026-10-13T00:00:00Z',eventTimeBasis:'unresolved',eventType:'unknown',direction:'unknown',accountId:'owner-account',amountsJson:'[]',feeTreatment:'unknown',completenessJson:'{}',payloadDigest:'bare'}]);
  await db.prepare("INSERT INTO alert_projections(id,event_id,state,revision) VALUES (?,'bare-event','needs_review',1)").bind(raw).run();return;
 }
 if(kind==='provenance') {
  await db.prepare("INSERT INTO alert_projection_provenance(id,projection_id,source_kind,source_id,basis,revision) VALUES (?,?,'alert',?,'alert_event',2)").bind(`${raw}:alert:${raw}:1`,OTHER_RAW,OTHER_RAW).run();return;
 }
 await db.prepare("UPDATE transactions SET source='statement',amount_minor=-1234,date='2026-10-13' WHERE id='owner-tx-1'").run();
 await db.prepare("INSERT INTO transaction_source_records(id,source_kind,identity_key,transaction_id,account_id,file_sha256,row_index,bank_reference,content_digest) VALUES ('collision-statement-source','statement','statement-identity','owner-tx-1','owner-account','file',0,'collision-ref','original')").run();
 if(kind==='candidate') {
  await db.prepare("INSERT INTO statement_reconciliation_candidates(id,source_record_id,statement_transaction_id,candidate_transaction_id,score,reason_codes_json,evidence_basis) VALUES (?,'collision-statement-source','owner-tx-1','owner-tx-2',10,'[]','candidate_rank')").bind(`statement-candidate:${encodeURIComponent(`collision-statement-source:${raw}`)}`).run();return;
 }
 await db.prepare("INSERT INTO alert_event_links(id,from_event_id,to_transaction_id,relation,evidence_basis,revision) VALUES (?,?,'owner-tx-2','possible_duplicate','user_review',1)").bind(`alert-review:${encodeURIComponent(`${raw}:owner-tx-1`)}`,OTHER_RAW).run();
}
it.each(['source','projection','provenance','candidate','link'])('rolls back every new alert row on a same-ledger %s ID collision',async kind=>{
 const {db,contexts}=await setup();await ingestAlertBatch(db,contexts[0],{events:[{...input('owner'),eventId:OTHER_RAW}]});
 await prepareCollision(db,kind);
 const tables=['alert_events','alert_event_digests','alert_projections','alert_projection_provenance','alert_event_links','transaction_source_records','statement_reconciliation_candidates','transactions'];
 const snapshot=async()=>Promise.all(tables.map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
 const before=await snapshot();
 const result=await ingestAlertBatch(db,contexts[0],{events:[{...input('owner'),bankReference:'collision-ref'}]}).catch(()=>null);
 expect(result?.acks[0].status).not.toBe('accepted');expect(await snapshot()).toEqual(before);
});

it('rejects a foreign profile guess without creating any alert evidence',async()=>{
 const {db,contexts}=await setup();
 expect((await ingestAlertBatch(db,contexts[0],{events:[input('second')]})).acks[0]).toMatchObject({status:'rejected',reasonCodes:['out_of_scope']});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
});
it('rechecks wall-clock expiry in the publication batch without a credential row change',async()=>{
 const {db}=await setup();const expiresAt=new Date(Date.now()+1000).toISOString();
 await db.prepare('UPDATE capture_credentials SET expires_at=? WHERE id=?').bind(expiresAt,'owner-capture').run();
 const context=await authenticateCapture('secret-owner',db,config);
 const racing=race(db,()=>new Promise(resolve=>setTimeout(resolve,1100)));
 await expect(ingestAlertBatch(racing,context,{events:[input('owner')]})).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
 expect(await db.prepare("SELECT expires_at FROM capture_credentials WHERE id='owner-capture'").first()).toEqual({expires_at:expiresAt});
});

it('retries the remaining events when an immutable identity collision races a mixed batch',async()=>{
 const {db,contexts}=await setup();let collided=false;
 const racing=race(db,async()=>{if(!collided){collided=true;await ingestAlertBatch(db,contexts[0],{events:[input('owner')]});}});
 const next={...input('owner'),eventId:'00000000-0000-4000-8000-000000000002'};
 const result=await ingestAlertBatch(racing,contexts[0],{events:[input('owner'),next]});
 expect(result.acks.map(ack=>({eventId:ack.eventId,status:ack.status}))).toEqual([{eventId:event().eventId,status:'replayed'},{eventId:next.eventId,status:'accepted'}]);
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:2});
 expect(await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE source='alert'").first()).toEqual({n:2});
});

const NEXT_RAW='00000000-0000-4000-8000-000000000002';
function expectRepeatedConflict(acks:Awaited<ReturnType<typeof ingestAlertBatch>>['acks']) {
 expect(acks[0]).toMatchObject({status:'conflict',receiptId:null,revision:null,projectionState:null,error:{code:'idempotency_conflict'}});
 expect(acks[1]).toEqual(acks[0]);
}
it.each(['transaction','source'])('does not acknowledge repeated events after a persistent %s ID collision',async kind=>{
 const {db,contexts}=await setup();
 if(kind==='transaction')await db.prepare("UPDATE transactions SET id=? WHERE id='owner-tx-1'").bind(event().eventId).run();
 else await prepareCollision(db,'source');
 const before=(await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
 const other={...input('owner'),eventId:NEXT_RAW};
 const result=await ingestAlertBatch(db,contexts[0],{events:[input('owner'),input('owner'),other]});
 expectRepeatedConflict(result.acks);
 // The atomic batch rolls back the other new event too; it must never claim a durable receipt.
 expect(result.acks[2]).toMatchObject({status:'conflict',receiptId:null});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
 expect((await db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(before);
 expect((await ingestAlertBatch(db,contexts[0],{events:[other]})).acks[0]).toMatchObject({status:'accepted',eventId:NEXT_RAW,receiptId:NEXT_RAW});
});
async function secondOwnerDevice(db:D1Database) {
 await db.prepare("INSERT INTO mobile_devices(id,device_name,platform,status) VALUES ('other-device','Other phone','android','paired')").run();
 await db.prepare("INSERT INTO device_source_scopes(id,device_id,source_profile_id,account_id,currency) VALUES ('other-scope','other-device','owner-profile','owner-account','CAD')").run();
 await db.prepare("INSERT INTO capture_credentials(id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at,environment_hash) VALUES ('other-capture','other-device',?,'capture','alerts:write',1,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z',?)").bind(await hashSecret('other-secret'),await hashSecret(config.environment)).run();
 return authenticateCapture('other-secret',db,config);
}
it.each([
 ['content','all'],['device','all'],['content','partial'],['device','partial'],
])('propagates repeated conflicts after a concurrent %s winner with %s pending events resolved',async(kind,resolved)=>{
 const {db,contexts}=await setup();const context=contexts[0];
 const winner=kind==='device'?await secondOwnerDevice(db):context;
 const other={...input('owner'),eventId:NEXT_RAW};let changed=false;
 const racing=race(db,async()=>{
  if(changed)return;changed=true;
  const competing=kind==='content'?{...input('owner'),merchant:'Concurrent winner'}:input('owner');
  expect((await ingestAlertBatch(db,winner,{events:[competing]})).acks[0].status).toBe('accepted');
  if(resolved==='all')expect((await ingestAlertBatch(db,context,{events:[other]})).acks[0].status).toBe('accepted');
 });
 const result=await ingestAlertBatch(racing,context,{events:[input('owner'),input('owner'),other]});
 expectRepeatedConflict(result.acks);
 expect(result.acks[2]).toMatchObject({status:resolved==='all'?'replayed':'accepted',eventId:NEXT_RAW,receiptId:NEXT_RAW,error:null});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:2});
 expect(await db.prepare('SELECT device_id,merchant FROM alert_events WHERE raw_event_id=?').bind(event().eventId).first()).toEqual({device_id:winner.deviceId,merchant:kind==='content'?'Concurrent winner':'Synthetic merchant'});
});
it('propagates pre-existing changed-content conflicts to duplicates while accepting another event',async()=>{
 const {db,contexts}=await setup();await ingestAlertBatch(db,contexts[0],{events:[input('owner')]});
 const changed={...input('owner'),merchant:'Changed'};
 const result=await ingestAlertBatch(db,contexts[0],{events:[changed,changed,{...input('owner'),eventId:NEXT_RAW}]});
 expectRepeatedConflict(result.acks);expect(result.acks[2]).toMatchObject({status:'accepted',receiptId:NEXT_RAW,error:null});
});

it('marks repeated successes as replayed only after their durable receipts are available',async()=>{
 const {db,contexts}=await setup();const first=input('owner');const other={...first,eventId:NEXT_RAW};
 const body={events:[first,first,other,other,{...first,merchant:'Changed'}]};
 const result=await ingestAlertBatch(db,contexts[0],body);
 expect(result.acks.map(ack=>ack.status)).toEqual(['accepted','replayed','accepted','replayed','conflict']);
 for(const ack of result.acks.slice(0,4))expect(ack).toMatchObject({receiptId:ack.eventId,revision:1,projectionState:'provisional',error:null});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:2});
 expect((await ingestAlertBatch(db,contexts[0],body)).acks.map(ack=>ack.status)).toEqual(['replayed','replayed','replayed','replayed','conflict']);
});
