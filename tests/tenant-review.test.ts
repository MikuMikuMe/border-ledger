import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { appendAnnotationRevision, readLatestAnnotation } from '../worker/annotation-store';
import { appendAlertEventBatch, appendAlertProjection } from '../worker/alert-store';
import { readMobileAlertPage, applyMobileAlertReview } from '../worker/mobile-review';
import { applyAlertReview } from '../worker/reconciliation-store';
import type { D1Database, D1Statement } from '../worker/db-types';
import type { LedgerContext } from '../worker/tenant-context';
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.close(); });
async function setup() {
  const fixture = createSqliteD1Fixture(); fixtures.push(fixture); await seedTenants(fixture.db);
  for (const context of [OWNER_LEDGER, SECOND_LEDGER]) {
    await fixture.db.prepare("UPDATE owner_session_families SET scope_json=? WHERE ledger_id=?").bind(JSON.stringify(['ledger:read','ledger:review']),context.ledgerId).run();
    await fixture.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES (?,?,'bank','email','Bank','v1','approved')").bind(`${context.userId}-profile`,context.ledgerId).run();
    await appendAlertEventBatch(fixture.db,context,[{id:'shared-event',eventId:'shared-event',observationId:'observation',sourceProfileId:`${context.userId}-profile`,parserVersion:'v1',notificationPostedAt:null,capturedAt:'2026-01-01T00:00:00Z',eventTimeBasis:'unresolved',eventType:'purchase_notice',direction:'outflow',accountId:`${context.userId}-account`,eventMoneyCurrency:'CAD',eventMoneyAmountMinor:100,amountsJson:'[]',feeTreatment:'unknown',completenessJson:'{}',payloadDigest:'digest'}]);
    await appendAlertProjection(fixture.db,context,{id:'shared-projection',eventId:'shared-event',state:'needs_review',reasonCodes:[],revision:1});
  }
  return fixture.db;
}
it('isolates equal raw event identities and standalone review revisions',async()=>{
  const db=await setup();
  const page=await readMobileAlertPage(db,SECOND_LEDGER,new URLSearchParams());
  expect(page.items).toHaveLength(1); expect(page.items[0].eventId).toBe('shared-event');
  await applyMobileAlertReview(db,SECOND_LEDGER,'shared-event',{expectedRevision:1,decision:'ignore'});
  expect((await readMobileAlertPage(db,OWNER_LEDGER,new URLSearchParams())).items[0].revision).toBe(1);
  expect((await readMobileAlertPage(db,SECOND_LEDGER,new URLSearchParams())).items[0].revision).toBe(2);
});
it('isolates equal annotation operation identities and rejects foreign transactions',async()=>{
  const db=await setup();
  for(const context of [OWNER_LEDGER,SECOND_LEDGER])await appendAnnotationRevision(db,context,{id:'same-operation',transactionId:`${context.userId}-tx-1`,authorSubjectHash:context.userId,revision:1,category:'Food',note:null});
  expect((await readLatestAnnotation(db,SECOND_LEDGER,'second-tx-1'))?.author_subject_hash).toBe('second');
  expect(await readLatestAnnotation(db,SECOND_LEDGER,'owner-tx-1')).toBeNull();
  await expect(appendAnnotationRevision(db,SECOND_LEDGER,{id:'foreign',transactionId:'owner-tx-1',authorSubjectHash:'second',revision:2,category:'Other',note:null})).rejects.toThrow();
});
it('atomically denies native review and annotations revoked at publication',async()=>{
  const db=await setup(); const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:read','ledger:review'] as const};
  const racing={prepare:db.prepare.bind(db),batch:async(statements:Parameters<typeof db.batch>[0])=>{await db.prepare('UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').bind(owner.familyId).run();return db.batch(statements);}};
  await expect(applyMobileAlertReview(racing,owner,'shared-event',{expectedRevision:1,decision:'ignore'})).rejects.toMatchObject({code:'access_not_enabled'});
  expect((await readMobileAlertPage(db,SECOND_LEDGER,new URLSearchParams())).items[0].revision).toBe(1);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_projection_provenance').first()).toEqual({n:0});
});

async function statement(db: D1Database, context: LedgerContext) {
  const transactionId = `${context.userId}-tx-1`;
  await db.prepare("UPDATE transactions SET source='statement',amount_minor=-100 WHERE id=? AND ledger_id=?")
    .bind(transactionId,context.ledgerId).run();
  await db.prepare(`INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,file_sha256,row_index,content_digest)
    VALUES (?,?,'statement',?,?,?,'file',0,'digest')`)
    .bind(`${context.userId}-source`,context.ledgerId,`${context.userId}-identity`,transactionId,`${context.userId}-account`).run();
  return transactionId;
}
function atBatch(db: D1Database, change: () => Promise<unknown>): D1Database {
  return {prepare: db.prepare.bind(db),batch:async statements=>{await change();return db.batch(statements);}};
}
function review(transactionId: string) {
  return {id:'same-review-operation',alertEventId:'shared-event',statementTransactionId:transactionId,
    relation:'possible_duplicate' as const,evidenceBasis:'user_review' as const,revision:2};
}
it('scopes equal raw review operations and replays without advancing twice',async()=>{
  const db=await setup();
  for (const context of [OWNER_LEDGER,SECOND_LEDGER]) {
    const target=await statement(db,context);
    expect(await applyAlertReview(db,context,review(target))).toMatchObject({alertEventId:'shared-event',replayed:false});
    expect(await applyAlertReview(db,context,review(target))).toMatchObject({alertEventId:'shared-event',replayed:true});
  }
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:2});
  expect((await readMobileAlertPage(db,SECOND_LEDGER,new URLSearchParams())).items[0]).toMatchObject({revision:2,links:[{targetTransactionId:'second-tx-1'}]});
  await expect(applyAlertReview(db,SECOND_LEDGER,{...review('owner-tx-1'),id:'foreign-target',revision:3})).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:2});
});
it.each(['revision','amount','disable','revoke','generation','expiry'] as const)('rolls back all link effects when %s changes at publication',async kind=>{
  const db=await setup(); const target=await statement(db,SECOND_LEDGER);
  const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:read','ledger:review'] as const};
  const changes={revision:"UPDATE alert_projections SET revision=2 WHERE ledger_id='second-ledger'",
    amount:"UPDATE transactions SET amount_minor=-101 WHERE id='second-tx-1'",
    disable:"UPDATE users SET status='disabled' WHERE id='second'",
    revoke:"UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'",
    generation:"UPDATE owner_session_families SET access_generation=2 WHERE id='second-family'",
    expiry:"UPDATE owner_session_families SET access_expires_at='2000-01-01T00:00:00Z' WHERE id='second-family'"};
  await expect(applyAlertReview(atBatch(db,()=>db.prepare(changes[kind]).run()),owner,review(target))).rejects.toMatchObject({code:['revision','amount'].includes(kind)?'stale_revision':'access_not_enabled'});
  for(const table of ['alert_event_links','alert_projection_provenance'])expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({n:0});
});
it('does not disclose currentRevision when native authority is lost with a stale standalone review',async()=>{
  const db=await setup();const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:read','ledger:review'] as const};
  const racing=atBatch(db,async()=>{
    await db.prepare("UPDATE alert_projections SET revision=2 WHERE ledger_id='second-ledger'").run();
    await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run();
  });
  const error=await applyMobileAlertReview(racing,owner,'shared-event',{expectedRevision:1,decision:'ignore'}).catch(error=>error);
  expect(error).toMatchObject({code:'access_not_enabled'});expect(error).not.toHaveProperty('currentRevision');
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_projection_provenance').first()).toEqual({n:0});
});
it('guards annotation revision and authenticated author in the same batch',async()=>{
  const db=await setup();const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:read','ledger:review'] as const};
  const input={id:'annotation',transactionId:'second-tx-1',authorSubjectHash:'spoofed',revision:1,category:'Travel',note:null};
  await appendAnnotationRevision(db,owner,input);
  expect(await readLatestAnnotation(db,owner,'second-tx-1')).toMatchObject({revision:1,author_subject_hash:'second-subject'});
  const racing=atBatch(db,()=>db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run());
  await expect(appendAnnotationRevision(racing,owner,{...input,id:'next',revision:2})).rejects.toMatchObject({code:'access_not_enabled'});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM annotation_revisions').first()).toEqual({n:1});
});
it('retains immutable native authority through review identifier hashing',async()=>{
  const db=await setup();const target=await statement(db,SECOND_LEDGER);
  const owner={...tenantOwner(SECOND_LEDGER),scopes:['ledger:read','ledger:review'] as const};
  const digest=crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{
    owner.familyId='owner-family';
    await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run();
    return digest(...args);
  });
  await expect(applyAlertReview(db,owner,review(target))).rejects.toMatchObject({code:'access_not_enabled'});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:0});
});

it('rejects a candidate that disappeared before the reconciliation store reload',async()=>{
  const db=await setup();const target=await statement(db,SECOND_LEDGER);
  await db.prepare("UPDATE transactions SET source='alert',amount_minor=-100 WHERE id='second-tx-2'").run();
  await db.prepare("UPDATE alert_projections SET transaction_id='second-tx-2' WHERE ledger_id='second-ledger'").run();
  await expect(applyAlertReview(db,SECOND_LEDGER,{...review(target),candidateTransactionId:'second-tx-2'}))
    .rejects.toMatchObject({code:'candidate_mismatch'});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:0});
});
