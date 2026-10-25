import { afterEach,expect,it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER,SECOND_LEDGER,seedTenants,tenantOwner } from './helpers/tenants';
import { appendAlertEventBatch,appendAlertProjection,appendAlertEventLink,appendTransactionSourceRecord } from '../worker/alert-store';
const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{for(const fixture of fixtures.splice(0))fixture.close();});
async function setup(){const fixture=createSqliteD1Fixture();fixtures.push(fixture);await seedTenants(fixture.db);for(const context of [OWNER_LEDGER,SECOND_LEDGER])await fixture.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES (?,?,'bank','email','Bank','v1','approved')").bind(`${context.userId}-profile`,context.ledgerId).run();return fixture.db;}
function evidence(user:string){return {id:'shared-event',eventId:'shared-event',observationId:'same-observation',sourceProfileId:`${user}-profile`,parserVersion:'v1',notificationPostedAt:null,capturedAt:'2026-01-01T00:00:00Z',eventTimeBasis:'unresolved' as const,eventType:'purchase_notice' as const,direction:'outflow' as const,accountId:`${user}-account`,amountsJson:'[]',feeTreatment:'unknown' as const,completenessJson:'{}',payloadDigest:'same-digest'};}
it('keeps equal operator alert and projection identities scoped and preserves owner IDs',async()=>{
 const db=await setup();
 for(const context of [OWNER_LEDGER,SECOND_LEDGER]){
  await appendAlertEventBatch(db,context,[evidence(context.userId)]);
  await appendAlertProjection(db,context,{id:'shared-projection',eventId:'shared-event',state:'needs_review',reasonCodes:[],revision:1,provenance:[{sourceKind:'alert',sourceId:'shared-event',basis:'alert_event'}]});
  await appendTransactionSourceRecord(db,context,{id:'shared-source',sourceKind:'alert',eventId:'shared-event',transactionId:`${context.userId}-tx-1`,accountId:`${context.userId}-account`,contentDigest:'same-digest'});
 }
 const rows=(await db.prepare('SELECT id,ledger_id,raw_event_id FROM alert_events ORDER BY ledger_id').all()).results;expect(rows).toHaveLength(2);expect(rows[0].id).toBe('shared-event');expect(rows[1].id).not.toBe('shared-event');
 expect((await db.prepare('SELECT COUNT(*) AS n FROM alert_projections').first())).toEqual({n:2});
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('rejects foreign event, transaction and source references without publication',async()=>{
 const db=await setup();await appendAlertEventBatch(db,OWNER_LEDGER,[evidence('owner')]);
 await expect(appendAlertProjection(db,SECOND_LEDGER,{id:'projection',eventId:'shared-event',state:'needs_review',reasonCodes:[],revision:1})).rejects.toThrow();
 await expect(appendAlertProjection(db,OWNER_LEDGER,{id:'projection',eventId:'shared-event',transactionId:'second-tx-1',state:'needs_review',reasonCodes:[],revision:1})).rejects.toThrow();
 await expect(appendAlertEventLink(db,OWNER_LEDGER,{id:'link',fromEventId:'shared-event',toTransactionId:'second-tx-1',relation:'confirms',evidenceBasis:'user_review',revision:1})).rejects.toThrow();
 await expect(appendTransactionSourceRecord(db,OWNER_LEDGER,{id:'source',sourceKind:'alert',eventId:'shared-event',transactionId:'second-tx-1',accountId:'second-account',contentDigest:'digest'})).rejects.toThrow();
 for(const table of ['alert_projections','alert_event_links','transaction_source_records'])expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({n:0});
});

it('retains native authority through identifier hashing and the final store batch',async()=>{
 const db=await setup();const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:review' as const]};
 await db.prepare('UPDATE owner_session_families SET scope_json=? WHERE id=?').bind(JSON.stringify(owner.scopes),owner.familyId).run();
 const racing={prepare:db.prepare.bind(db),batch:async(statements:Parameters<typeof db.batch>[0])=>{await db.prepare('UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').bind(owner.familyId).run();return db.batch(statements);}};
 await expect(appendAlertEventBatch(racing,owner,[evidence('second')])).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_events').first()).toEqual({n:0});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_digests').first()).toEqual({n:0});
});

it('rejects foreign polymorphic provenance without leaving a projection',async()=>{
 const db=await setup();await appendAlertEventBatch(db,OWNER_LEDGER,[evidence('owner')]);
 await db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,file_sha256,row_index,content_digest) VALUES ('foreign-source','second-ledger','statement','foreign-identity','second-tx-1','second-account','file',0,'digest')").run();
 await expect(appendAlertProjection(db,OWNER_LEDGER,{id:'projection',eventId:'shared-event',state:'needs_review',reasonCodes:[],revision:1,provenance:[{sourceKind:'statement',sourceId:'foreign-source',basis:'statement'}]})).rejects.toThrow();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_projections').first()).toEqual({n:0});
 expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_projection_provenance').first()).toEqual({n:0});
});
