import { ClientRequest as Request } from './helpers/client-request';
import { handleMobileRequest } from '../worker/mobile';
import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { bindConsentedCaptureDevice } from '../worker/mobile-capture-device-binding';
import { issueCaptureAuthorization, readDevices, readDevice, replaceDeviceSourceConfig, revokeDevice } from '../worker/mobile-device-service';
import { upsertSourceProfile, createDevicePairing, approveDeviceSourceScope, approveSourceAccountMapping, addSourceProfileHint, issueSecureCaptureCredential, revokeCaptureCredentialsForDevice, revokeCaptureCredential } from '../worker/device-store';
import { createOpaqueCredential, hashSecret, type OwnerContext } from '../worker/mobile-auth';
import type { D1Database } from '../worker/db-types';

const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.close(); });
const authConfig = { canonicalOrigin:'https://pf.example.test', callbackUrl:'https://pf.example.test/android/auth/callback', environment:'production', accessAuthorizationUrl:'https://pf.example.test/mobile/authorize', sessionEncryptionKey:'synthetic-device-isolation-key' };
async function setup() {
  const fixture=createSqliteD1Fixture(); fixtures.push(fixture); await seedTenants(fixture.db);
  const environmentHash=await hashSecret(authConfig.environment);
  const owners=[OWNER_LEDGER,SECOND_LEDGER].map(context => ({...tenantOwner(context), deviceId:`${context.userId}-device`, environmentHash, scopes:['devices:manage']} as OwnerContext));
  for (const owner of owners) {
    await fixture.db.prepare("INSERT INTO mobile_devices(id,ledger_id,device_name,platform,status) VALUES (?,?,'Phone','android','paired')").bind(owner.deviceId,owner.ledgerId).run();
    await fixture.db.prepare('UPDATE owner_session_families SET device_id=?,scope_json=?,environment_hash=?,created_at=?,installation_id=? WHERE id=?').bind(owner.deviceId,JSON.stringify(owner.scopes),environmentHash,new Date().toISOString(),'installation',owner.familyId).run();
    await fixture.db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES (?,?,'bank','notification','Bank','v1','approved')").bind(`${owner.userId}-profile`,owner.ledgerId).run();
    await fixture.db.prepare("INSERT INTO source_account_mappings(id,ledger_id,source_profile_id,account_id,approval_status,approved_at) VALUES (?,?,?,?,'approved',CURRENT_TIMESTAMP)").bind(`${owner.userId}-mapping`,owner.ledgerId,`${owner.userId}-profile`,`${owner.userId}-account`).run();
  }
  return {db:fixture.db,owners};
}
function configFor(owner:OwnerContext, expectedRevision=0) {
  return {expectedRevision,mappings:[{sourceProfileId:`${owner.userId}-profile`,accountId:`${owner.userId}-account`,allowedCurrencies:['CAD']}]};
}
function racingDb(db:D1Database, change:()=>Promise<unknown>):D1Database {
  return {prepare:sql=>db.prepare(sql),batch:async statements=>{await change();return db.batch(statements);}};
}
it('lists only devices in the authenticated ledger', async()=>{
  const {db,owners}=await setup();
  expect((await readDevices(db,owners[1])).map(row=>row.id)).toEqual(['second-device']);
});
it('does not disclose a guessed foreign device',async()=>{
  const {db,owners}=await setup();await expect(readDevice(db,owners[1],'owner-device')).rejects.toMatchObject({status:404});
});
it('revalidates a claimed existing device instead of trusting the context snapshot',async()=>{
  const {db,owners}=await setup();
  await expect(bindConsentedCaptureDevice(db,{...owners[1],deviceId:'owner-device',consent:true},authConfig)).rejects.toThrow();
});
it.each(['disabled','revoked'] as const)('does not revoke a device after authority becomes %s at the batch',async change=>{
  const {db,owners}=await setup();
  const racing=racingDb(db,()=>db.prepare(change==='disabled'?"UPDATE users SET status='disabled' WHERE id='owner'":"UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run());
  await expect(revokeDevice(racing,owners[0],'owner-device',authConfig)).rejects.toThrow();
  expect(await db.prepare("SELECT status FROM mobile_devices WHERE id='owner-device'").first()).toEqual({status:'paired'});
});
it('keeps configuration revision and mappings unchanged on a failed scope publication',async()=>{
  const {db,owners}=await setup();
  await replaceDeviceSourceConfig(db,owners[0],'owner-device',configFor(owners[0]));
  const racing=racingDb(db,()=>db.prepare("UPDATE source_profiles SET status='paused' WHERE id='owner-profile'").run());
  await expect(replaceDeviceSourceConfig(racing,owners[0],'owner-device',configFor(owners[0],1))).rejects.toThrow();
  expect(await db.prepare("SELECT source_config_revision FROM mobile_devices WHERE id='owner-device'").first()).toEqual({source_config_revision:1});
  expect(await db.prepare("SELECT COUNT(*) AS n FROM device_source_scopes WHERE device_id='owner-device'").first()).toEqual({n:1});
});
it('publishes a capture grant for the second ledger with its own approved mapping',async()=>{
  const {db,owners}=await setup();
  const result=await issueCaptureAuthorization(db,owners[1],{consent:true,credentialHash:'a'.repeat(64),sourceConfig:configFor(owners[1])},authConfig);
  expect(result.deviceId).toBe('second-device');
  expect(await db.prepare('SELECT ledger_id,device_id FROM capture_credentials').first()).toEqual({ledger_id:'second-ledger',device_id:'second-device'});
});
it('does not leave a new device or grant after a failed consent publication',async()=>{
  const {db,owners}=await setup();await db.prepare("UPDATE owner_session_families SET device_id=NULL WHERE id='owner-family'").run();
  const racing=racingDb(db,()=>db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run());
  await expect(issueCaptureAuthorization(racing,{...owners[0],deviceId:null},{consent:true,credentialHash:'b'.repeat(64),sourceConfig:configFor(owners[0])},authConfig)).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM mobile_devices').first()).toEqual({n:2});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:0});
});
it('preserves distinct profile identities for equal raw IDs in separate ledgers',async()=>{
  const {db,owners}=await setup();
  for(const owner of owners) await upsertSourceProfile(db,owner,{id:'same-profile',provider:'other-bank',sourceKind:'email',displayName:'Other',parserVersion:'v1'});
  const rows=await db.prepare("SELECT id,ledger_id FROM source_profiles WHERE provider='other-bank' ORDER BY ledger_id").all<{id:string;ledger_id:string}>();
  expect(rows.results).toHaveLength(2);expect(rows.results[0].id).toBe('same-profile');expect(rows.results[1].id).not.toBe('same-profile');
});

it('rejects unapproved source scope even through the operator store',async()=>{
  const {db}=await setup();await db.prepare("UPDATE source_profiles SET status='paused' WHERE id='owner-profile'").run();
  await expect(approveDeviceSourceScope(db,OWNER_LEDGER,{id:'scope',deviceId:'owner-device',sourceProfileId:'owner-profile',accountId:'owner-account',currency:'CAD'})).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM device_source_scopes').first()).toEqual({n:0});
});
it('rejects approval of an unregistered instrument hint',async()=>{
  const {db}=await setup();
  await expect(approveSourceAccountMapping(db,OWNER_LEDGER,{id:'new-map',sourceProfileId:'owner-profile',accountId:'owner-account',hintKind:'card_suffix',hintValue:'9999',approvedAt:new Date().toISOString()})).rejects.toThrow();
});
it('cannot change another ledger configuration or revoke its credentials by guessed ID',async()=>{
  const {db,owners}=await setup();
  await issueCaptureAuthorization(db,owners[0],{consent:true,credentialHash:'c'.repeat(64),sourceConfig:configFor(owners[0])},authConfig);
  const before=await db.prepare('SELECT * FROM capture_credentials').all();
  await revokeCaptureCredentialsForDevice(db,owners[1],'owner-device',new Date().toISOString());
  await revokeCaptureCredential(db,owners[1],String(before.results[0].id),new Date().toISOString());
  await expect(replaceDeviceSourceConfig(db,owners[1],'owner-device',configFor(owners[1]))).rejects.toMatchObject({status:404});
  expect(await db.prepare('SELECT * FROM capture_credentials').all()).toEqual(before);
});
it('rejects colliding profile identities without updating the existing profile',async()=>{
  const {db}=await setup();const before=await db.prepare("SELECT * FROM source_profiles WHERE id='owner-profile'").first();
  await expect(upsertSourceProfile(db,OWNER_LEDGER,{id:'owner-profile',provider:'unrelated',sourceKind:'notification',displayName:'Changed',parserVersion:'v2'})).rejects.toThrow();
  await expect(upsertSourceProfile(db,OWNER_LEDGER,{id:'other-id',provider:'bank',sourceKind:'notification',displayName:'Changed',parserVersion:'v2'})).rejects.toThrow();
  await expect(db.prepare("INSERT OR REPLACE INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version) VALUES ('owner-profile','second-ledger','new','new','Changed','v2')").run()).rejects.toThrow();
  expect(await db.prepare("SELECT * FROM source_profiles WHERE id='owner-profile'").first()).toEqual(before);
});
it.each([false,true])('rolls back credential/config publication when logout occurs during encryption (new device: %s)',async newDevice=>{
  const {db,owners}=await setup();const owner=owners[0];
  if(newDevice) {await db.prepare("UPDATE owner_session_families SET device_id=NULL WHERE id='owner-family'").run();owner.deviceId=null;}
  else await issueCaptureAuthorization(db,owner,{consent:true,credentialHash:'d'.repeat(64),sourceConfig:configFor(owner)},authConfig);
  const beforeDevices=await db.prepare('SELECT * FROM mobile_devices ORDER BY id').all();
  const beforeScopes=await db.prepare('SELECT * FROM device_source_scopes ORDER BY id').all();
  const beforeCredentials=await db.prepare('SELECT * FROM capture_credentials ORDER BY id').all();
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{
    const encrypted=await encrypt(...args);await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run();return encrypted;
  });
  await expect(issueCaptureAuthorization(db,owner,{consent:true,credentialHash:'e'.repeat(64),sourceConfig:configFor(owner,newDevice?0:1)},authConfig)).rejects.toThrow();
  expect(await db.prepare('SELECT * FROM mobile_devices ORDER BY id').all()).toEqual(beforeDevices);
  expect(await db.prepare('SELECT * FROM device_source_scopes ORDER BY id').all()).toEqual(beforeScopes);
  expect(await db.prepare('SELECT * FROM capture_credentials ORDER BY id').all()).toEqual(beforeCredentials);
});
it('keeps the winning configuration when a competing revision publishes before the batch',async()=>{
  const {db,owners}=await setup();
  const racing=racingDb(db,()=>replaceDeviceSourceConfig(db,owners[0],'owner-device',configFor(owners[0])));
  await expect(replaceDeviceSourceConfig(racing,owners[0],'owner-device',configFor(owners[0]))).rejects.toMatchObject({code:'revision_conflict',status:409,currentRevision:1});
  expect((await readDevice(db,owners[0],'owner-device')).revision).toBe(1);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM device_source_scopes').first()).toEqual({n:1});
});
it.each(['owner-profile','owner-account'])('rejects foreign source/account mapping guesses (%s)',async foreign=>{
  const {db,owners}=await setup();const config=configFor(owners[1]);
  if(foreign==='owner-profile')config.mappings[0].sourceProfileId=foreign;else config.mappings[0].accountId=foreign;
  await expect(replaceDeviceSourceConfig(db,owners[1],'second-device',config)).rejects.toMatchObject({status:403});
  expect((await readDevice(db,owners[1],'second-device')).revision).toBe(0);
});
it('does not approve foreign hints or credentials through low-level stores',async()=>{
  const {db,owners}=await setup();
  await expect(addSourceProfileHint(db,owners[1],{id:'hint',sourceProfileId:'owner-profile',hintKind:'card_suffix',hintValue:'1234'})).rejects.toThrow();
  await expect(issueSecureCaptureCredential(db,owners[1],{id:'credential',deviceId:'owner-device',credentialHash:'f'.repeat(64),generation:1,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),environmentHash:owners[1].environmentHash,revocationCapabilityHash:'hash'})).rejects.toThrow();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:0});
});
it('rechecks recent approval for another device in the revocation batch',async()=>{
  const {db,owners}=await setup();
  await db.prepare("INSERT INTO mobile_devices(id,ledger_id,device_name,platform,status) VALUES ('other-owner-device','personal','Other','android','paired')").run();
  const racing=racingDb(db,()=>db.prepare("UPDATE owner_session_families SET created_at='2020-01-01T00:00:00Z' WHERE id='owner-family'").run());
  await expect(revokeDevice(racing,owners[0],'other-owner-device',authConfig)).rejects.toThrow();
  expect(await db.prepare("SELECT status FROM mobile_devices WHERE id='other-owner-device'").first()).toEqual({status:'paired'});
});

it('keeps equal raw device/profile/hint/mapping/scope/credential IDs independent across tenants',async()=>{
  const {db,owners}=await setup();
  for(const owner of owners) {
    const profile=await upsertSourceProfile(db,owner,{id:'shared-profile',provider:'shared-bank',sourceKind:'email',displayName:'Shared',parserVersion:'v1',status:'approved'});
    await addSourceProfileHint(db,owner,{id:'shared-hint',sourceProfileId:profile,hintKind:'card_suffix',hintValue:'1234'});
    await approveSourceAccountMapping(db,owner,{id:'shared-map',sourceProfileId:profile,accountId:`${owner.userId}-account`,hintKind:'card_suffix',hintValue:'1234',approvedAt:new Date().toISOString()});
    const pairing=await createDevicePairing(db,owner,{deviceId:'shared-device',pairingId:'shared-pairing',deviceName:'Phone',platform:'android',deviceVerifierHash:`verifier-${owner.userId}`,userCodeHash:`code-${owner.userId}`,expiresAt:new Date(Date.now()+60000).toISOString()});
    await db.prepare("UPDATE mobile_devices SET status='paired' WHERE id=? AND ledger_id=?").bind(pairing.deviceId,owner.ledgerId).run();
    await approveDeviceSourceScope(db,owner,{id:'shared-scope',deviceId:pairing.deviceId,sourceProfileId:profile,accountId:`${owner.userId}-account`,currency:'CAD',instrumentHint:{kind:'card_suffix',value:'1234'}});
    const credential=await issueSecureCaptureCredential(db,owner,{id:'shared-credential',deviceId:pairing.deviceId,credentialHash:`hash-${owner.userId}`,generation:1,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),environmentHash:owner.environmentHash,revocationCapabilityHash:`revocation-${owner.userId}`});
    expect((await readDevice(db,owner,pairing.deviceId)).sourceConfig.mappings).toEqual([{sourceProfileId:profile,accountId:`${owner.userId}-account`,allowedCurrencies:['CAD'],instrumentHint:{kind:'card_suffix',value:'1234'}}]);
    expect(await db.prepare('SELECT ledger_id FROM capture_credentials WHERE id=?').bind(credential).first()).toEqual({ledger_id:owner.ledgerId});
    if(owner.userId==='owner'){expect(pairing.deviceId).toBe('shared-device');expect(credential).toBe('shared-credential');}
    else {expect(pairing.deviceId).not.toBe('shared-device');expect(credential).not.toBe('shared-credential');}
  }
  expect(await db.prepare('SELECT COUNT(*) AS n FROM source_profile_hints').first()).toEqual({n:2});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:2});
});
it.each(['credential','config'] as const)('does not disclose a capability when %s changes after publication before response',async change=>{
  const {db,owners}=await setup();
  const racing:D1Database={prepare:sql=>db.prepare(sql),batch:async statements=>{
    const result=await db.batch(statements);
    await db.prepare(change==='credential'?"UPDATE capture_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE ledger_id='personal'":"UPDATE mobile_devices SET source_config_revision=source_config_revision+1 WHERE id='owner-device'").run();
    return result;
  }};
  await expect(issueCaptureAuthorization(racing,owners[0],{consent:true,credentialHash:'9'.repeat(64),sourceConfig:configFor(owners[0])},authConfig).then(()=>true)).rejects.toThrow();
});

async function publishThroughDeviceRoute(db:D1Database,owner:OwnerContext,operation:'config'|'capture') {
  const accessToken=await createOpaqueCredential({kind:'owner-access',familyId:owner.familyId,generation:owner.accessGeneration,expiresAt:owner.expiresAt,environmentHash:owner.environmentHash},authConfig);
  const sourceConfig=configFor(owner);
  const path=operation==='config'?'source-config':'capture-authorization';
  const body=operation==='config'?sourceConfig:{consent:true,credentialHash:'8'.repeat(64),sourceConfig};
  return handleMobileRequest(new Request(`${authConfig.canonicalOrigin}/api/mobile/v1/devices/self/${path}`,{
    method:operation==='config'?'PUT':'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify(body),
  }),{DB:db,LEDGER_APP_ORIGIN:authConfig.canonicalOrigin,MOBILE_ENVIRONMENT:authConfig.environment,MOBILE_CALLBACK_URL:authConfig.callbackUrl,MOBILE_ACCESS_AUTHORIZATION_URL:authConfig.accessAuthorizationUrl,MOBILE_SESSION_ENCRYPTION_KEY:authConfig.sessionEncryptionKey});
}
it.each(['config','capture'] as const)('returns the established409 contract when the %s route loses a revision race',async operation=>{
  const {db,owners}=await setup();let winningScopes:unknown;
  const racing=racingDb(db,async()=>{
    await replaceDeviceSourceConfig(db,owners[0],'owner-device',configFor(owners[0]));
    winningScopes=await db.prepare("SELECT * FROM device_source_scopes WHERE device_id='owner-device'").all();
  });
  const response=await publishThroughDeviceRoute(racing,owners[0],operation);
  expect(response?.status).toBe(409);
  expect(await response!.json()).toMatchObject({code:'revision_conflict',currentRevision:1,retryable:false});
  expect((await readDevice(db,owners[0],'owner-device')).revision).toBe(1);
  expect(await db.prepare("SELECT * FROM device_source_scopes WHERE device_id='owner-device'").all()).toEqual(winningScopes);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:0});
});
it.each(['config','capture'] as const)('does not disclose the winning revision after native revocation in the %s race',async operation=>{
  const {db,owners}=await setup();
  const racing=racingDb(db,async()=>{
    await replaceDeviceSourceConfig(db,owners[0],'owner-device',configFor(owners[0]));
    await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run();
  });
  const response=await publishThroughDeviceRoute(racing,owners[0],operation);
  expect(response?.status).toBe(403);
  const body=await response!.json();expect(body).toMatchObject({code:'access_not_enabled',retryable:false});expect(body).not.toHaveProperty('currentRevision');
  expect(await db.prepare("SELECT source_config_revision FROM mobile_devices WHERE id='owner-device'").first()).toEqual({source_config_revision:1});
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:0});
});
it.each([
  ['config',false],['capture',false],['config',true],['capture',true],
] as const)('preserves unrelated SQL failures on the %s route (concurrent revision: %s)',async(operation,advanced)=>{
  const {db,owners}=await setup();
  const unavailable:D1Database={prepare:sql=>db.prepare(sql),batch:async()=>{
    if(advanced)await replaceDeviceSourceConfig(db,owners[0],'owner-device',configFor(owners[0]));
    throw new Error('synthetic database unavailable');
  }};
  const response=await publishThroughDeviceRoute(unavailable,owners[0],operation);
  expect(response?.status).toBe(500);expect(await response!.json()).toMatchObject({code:'temporarily_unavailable',retryable:true});
  expect((await readDevice(db,owners[0],'owner-device')).revision).toBe(advanced?1:0);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM capture_credentials').first()).toEqual({n:0});
});
