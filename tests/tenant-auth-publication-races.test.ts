import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedRouteTenants, routeConfig } from './helpers/tenant-routes';
import { createOpaqueCredential, hashSecret, pkceChallenge, authenticateOwner } from '../worker/mobile-auth';
import { refreshOwnerSession } from '../worker/mobile-owner-auth';
import { startPairing, approvePairing, claimPairing, renewCaptureCredential } from '../worker/device-pairing';
import type { D1Database } from '../worker/db-types';

const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const fixture of fixtures.splice(0))fixture.close();});
async function setup() {
  const fixture=createSqliteD1Fixture();fixtures.push(fixture);
  return {db:fixture.db,...await seedRouteTenants(fixture.db)};
}
function batchRace(db:D1Database,change:()=>Promise<unknown>,after=false):D1Database {
  return {prepare:db.prepare.bind(db),batch:async statements=>{
    if(!after)await change();const results=await db.batch(statements);if(after)await change();return results;
  }};
}
async function refreshToken(db:D1Database) {
  const token=await createOpaqueCredential({kind:'owner-refresh',familyId:'second-family',generation:1,
    expiresAt:'2099-01-01T00:00:00Z',environmentHash:await hashSecret(routeConfig.environment)},routeConfig);
  await db.prepare(`INSERT INTO owner_refresh_generations(ledger_id,family_id,generation,token_hash,issued_at,expires_at)
    VALUES ('second-ledger','second-family',1,?,CURRENT_TIMESTAMP,'2099-01-01T00:00:00Z')`).bind(await hashSecret(token)).run();
  return token;
}
it.each(['disabled','revoked','generation','expired'] as const)('does not publish refresh generations after %s at the atomic batch',async change=>{
  const {db}=await setup();const token=await refreshToken(db);
  const sql={disabled:"UPDATE users SET status='disabled' WHERE id='second'",
    revoked:"UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'",
    generation:"UPDATE owner_session_families SET refresh_generation=2 WHERE id='second-family'",
    expired:"UPDATE owner_session_families SET refresh_expires_at='2000-01-01T00:00:00Z' WHERE id='second-family'"}[change];
  await expect(refreshOwnerSession(batchRace(db,()=>db.prepare(sql).run()),{refreshToken:token,idempotencyKey:'refresh'},routeConfig)).rejects.toThrow();
  expect(await db.prepare("SELECT consumed_at FROM owner_refresh_generations WHERE family_id='second-family' AND generation=1").first()).toEqual({consumed_at:null});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM owner_refresh_generations WHERE family_id='second-family'").first()).toEqual({n:1});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_replay_records').first()).toEqual({n:0});
});
it('does not disclose a newly committed refresh after post-batch disable',async()=>{
  const {db}=await setup();const token=await refreshToken(db);
  await expect(refreshOwnerSession(batchRace(db,()=>db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run(),true),
    {refreshToken:token,idempotencyKey:'refresh'},routeConfig)).rejects.toThrow();
});
it('does not publish refresh state when disabled during encryption',async()=>{
  const {db}=await setup();const token=await refreshToken(db);const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{
    await db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run();return encrypt(...args);
  });
  await expect(refreshOwnerSession(db,{refreshToken:token,idempotencyKey:'refresh'},routeConfig)).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_refresh_generations').first()).toEqual({n:1});
});
const verifier='tenant-pairing-race-verifier-012345678901234567890123456789';
async function pendingPairing(db:D1Database,token:string) {
  const owner=await authenticateOwner(token,db,routeConfig,'devices:manage');
  const started=await startPairing(db,{deviceName:'Another device',verifierChallenge:await pkceChallenge(verifier)},routeConfig);
  const input={pairingId:started.pairingId,owner:{...owner,consent:true as const},sourceScopes:[{sourceProfileId:'second-profile',accountId:'second-account',currency:'CAD'}]};
  return {started,input};
}
it.each(['generation','environment','scope','expired'] as const)('denies pairing approval after native %s changes at publication',async change=>{
  const {db,tokens}=await setup();const {input}=await pendingPairing(db,tokens.get('second')!);
  const sql={generation:"UPDATE owner_session_families SET access_generation=2 WHERE id='second-family'",
    environment:"UPDATE owner_session_families SET environment_hash='changed' WHERE id='second-family'",
    scope:"UPDATE owner_session_families SET scope_json='[]' WHERE id='second-family'",
    expired:"UPDATE owner_session_families SET access_expires_at='2000-01-01T00:00:00Z' WHERE id='second-family'"}[change];
  await expect(approvePairing(batchRace(db,()=>db.prepare(sql).run()),input,routeConfig)).rejects.toThrow();
  expect(await db.prepare('SELECT ledger_id,status FROM hosted_device_pairings').first()).toEqual({ledger_id:null,status:'pending'});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM mobile_devices').first()).toEqual({n:2});
});
it('revalidates a pairing claim replay after its decryption await',async()=>{
  const {db,tokens}=await setup();const {started,input}=await pendingPairing(db,tokens.get('second')!);
  await approvePairing(db,input,routeConfig);
  const claim={pairingId:started.pairingId,verifier,credentialHash:await hashSecret('new-capture')};
  await claimPairing(db,claim,routeConfig);
  const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle,'decrypt').mockImplementationOnce(async(...args)=>{
    await db.prepare('UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE device_id=?').bind(started.deviceId).run();
    return decrypt(...args);
  });
  await expect(claimPairing(db,claim,routeConfig)).rejects.toThrow();
});

it('returns authority denial when disabled during a pairing claim batch',async()=>{
  const {db,tokens}=await setup();const {started,input}=await pendingPairing(db,tokens.get('second')!);
  await approvePairing(db,input,routeConfig);
  const claim={pairingId:started.pairingId,verifier,credentialHash:await hashSecret('new-capture')};
  const racing=batchRace(db,()=>db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run());
  await expect(claimPairing(racing,claim,routeConfig)).rejects.toMatchObject({status:403});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM owner_replay_records WHERE request_kind='pairing-claim'").first()).toEqual({n:0});
});

it('returns authority denial when the native generation changes during capture renewal',async()=>{
  const {db,tokens}=await setup();const owner=await authenticateOwner(tokens.get('second')!,db,routeConfig,'devices:manage');
  const racing=batchRace(db,()=>db.prepare("UPDATE owner_session_families SET access_generation=2 WHERE id='second-family'").run());
  await expect(renewCaptureCredential(racing,{owner:{...owner,consent:true},deviceId:'second-device',credentialHash:await hashSecret('renewed')},routeConfig)).rejects.toMatchObject({status:403});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM capture_credentials WHERE device_id='second-device' AND revoked_at IS NULL").first()).toEqual({n:1});
});

it('checks native pairing expiry at SQL execution time without changing the family row',async()=>{
  const {db,tokens}=await setup();const {input}=await pendingPairing(db,tokens.get('second')!);
  await db.prepare("UPDATE owner_session_families SET access_expires_at=? WHERE id='second-family'")
    .bind(new Date(Date.now()+800).toISOString()).run();
  const delayed=batchRace(db,()=>new Promise(resolve=>setTimeout(resolve,1000)));
  await expect(approvePairing(delayed,input,routeConfig)).rejects.toMatchObject({status:403});
  expect(await db.prepare('SELECT ledger_id,status FROM hosted_device_pairings').first()).toEqual({ledger_id:null,status:'pending'});
});

it.each(['refresh_expires_at','access_expires_at','stay_signed_in_until'] as const)('preserves a concurrent future restriction in %s',async field=>{
  const {db}=await setup();const token=await refreshToken(db);
  const shortened=new Date(Date.now()+60_000).toISOString();
  const racing=batchRace(db,()=>db.prepare(`UPDATE owner_session_families SET ${field}=? WHERE id='second-family'`).bind(shortened).run());
  await expect(refreshOwnerSession(racing,{refreshToken:token,idempotencyKey:'shortened'},routeConfig)).rejects.toThrow();
  expect(await db.prepare(`SELECT ${field},refresh_generation FROM owner_session_families WHERE id='second-family'`).first())
    .toEqual({[field]:shortened,refresh_generation:1});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_refresh_generations').first()).toEqual({n:1});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_replay_records').first()).toEqual({n:0});
});

function overlappingBatches(db:D1Database,afterWinner:()=>Promise<unknown>=async()=>{}) :D1Database {
  let arrived=0;
  let releaseBoth!:()=>void;const both=new Promise<void>(resolve=>{releaseBoth=resolve;});
  let releaseWinner!:()=>void;const winner=new Promise<void>(resolve=>{releaseWinner=resolve;});
  return {prepare:db.prepare.bind(db),batch:async statements=>{
    const order=++arrived;
    if(order===2)releaseBoth();
    await both;
    if(order===1) {
      try {const results=await db.batch(statements);await afterWinner();return results;}
      finally {releaseWinner();}
    }
    await winner;return db.batch(statements);
  }};
}

it('returns the durable winner to both overlapping identical refresh requests',async()=>{
  const {db}=await setup();const token=await refreshToken(db);const racing=overlappingBatches(db);
  const input={refreshToken:token,idempotencyKey:'overlap'};
  const responses=await Promise.all([refreshOwnerSession(racing,input,routeConfig),refreshOwnerSession(racing,input,routeConfig)]);
  expect(responses[0]).toEqual(responses[1]);
  expect(await db.prepare("SELECT refresh_generation,revoked_at FROM owner_session_families WHERE id='second-family'").first()).toEqual({refresh_generation:2,revoked_at:null});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_refresh_generations').first()).toEqual({n:2});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_replay_records').first()).toEqual({n:1});
});

it('returns the durable winner to both overlapping identical pairing claims',async()=>{
  const {db,tokens}=await setup();const {started,input}=await pendingPairing(db,tokens.get('second')!);
  await approvePairing(db,input,routeConfig);
  const claim={pairingId:started.pairingId,verifier,credentialHash:await hashSecret('overlap-capture')};
  const racing=overlappingBatches(db);
  const responses=await Promise.all([claimPairing(racing,claim,routeConfig),claimPairing(racing,claim,routeConfig)]);
  expect(responses[0]).toEqual(responses[1]);expect(responses[0].revocationCapability).toBeTruthy();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials WHERE device_id=?').bind(started.deviceId).first()).toEqual({n:1});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM owner_replay_records WHERE request_kind='pairing-claim'").first()).toEqual({n:1});
});

it('does not disclose the overlapping refresh winner after live revocation',async()=>{
  const {db}=await setup();const token=await refreshToken(db);
  const racing=overlappingBatches(db,()=>db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run());
  const input={refreshToken:token,idempotencyKey:'revoked-overlap'};
  const results=await Promise.allSettled([refreshOwnerSession(racing,input,routeConfig),refreshOwnerSession(racing,input,routeConfig)]);
  expect(results.map(result=>result.status)).toEqual(['rejected','rejected']);
});

it('does not disclose the overlapping claim winner after capture revocation',async()=>{
  const {db,tokens}=await setup();const {started,input}=await pendingPairing(db,tokens.get('second')!);
  await approvePairing(db,input,routeConfig);
  const claim={pairingId:started.pairingId,verifier,credentialHash:await hashSecret('revoked-overlap-capture')};
  const racing=overlappingBatches(db,()=>db.prepare('UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE device_id=?').bind(started.deviceId).run());
  const results=await Promise.allSettled([claimPairing(racing,claim,routeConfig),claimPairing(racing,claim,routeConfig)]);
  expect(results.map(result=>result.status)).toEqual(['rejected','rejected']);
});

it('treats overlapping refreshes with different request keys as reuse instead of replay',async()=>{
  const {db}=await setup();const token=await refreshToken(db);const racing=overlappingBatches(db);
  const results=await Promise.allSettled(['first','different'].map(idempotencyKey=>
    refreshOwnerSession(racing,{refreshToken:token,idempotencyKey},routeConfig)));
  expect(results.some(result=>result.status==='rejected')).toBe(true);
  expect(await db.prepare("SELECT revoked_at FROM owner_session_families WHERE id='second-family'").first())
    .toMatchObject({revoked_at:expect.any(String)});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_replay_records').first()).toEqual({n:1});
});

it('rejects a conflicting overlapping claim credential hash without replaying its winner',async()=>{
  const {db,tokens}=await setup();const {started,input}=await pendingPairing(db,tokens.get('second')!);
  await approvePairing(db,input,routeConfig);const racing=overlappingBatches(db);
  const hashes=await Promise.all(['first-capture','different-capture'].map(hashSecret));
  const results=await Promise.allSettled(hashes.map(credentialHash=>claimPairing(racing,{pairingId:started.pairingId,verifier,credentialHash},routeConfig)));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const denied=results.find(result=>result.status==='rejected') as PromiseRejectedResult;
  expect(denied.reason).toMatchObject({code:'claim_conflict',status:409});
});

it.each(['refresh','claim'] as const)('does not turn an unrelated %s SQL failure into a replay',async operation=>{
  const {db,tokens}=await setup();
  const broken:D1Database={prepare:db.prepare.bind(db),batch:async()=>{throw new Error('unexpected-storage-error');}};
  if(operation==='refresh') {
    const token=await refreshToken(db);
    await expect(refreshOwnerSession(broken,{refreshToken:token,idempotencyKey:'sql-error'},routeConfig)).rejects.toThrow('unexpected-storage-error');
  } else {
    const {started,input}=await pendingPairing(db,tokens.get('second')!);await approvePairing(db,input,routeConfig);
    await expect(claimPairing(broken,{pairingId:started.pairingId,verifier,credentialHash:await hashSecret('sql-error')},routeConfig)).rejects.toThrow('unexpected-storage-error');
  }
});
