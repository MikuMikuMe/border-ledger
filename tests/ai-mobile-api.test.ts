import {afterEach,describe,expect,it} from 'vitest';
import {createD1Fixture,task24MigrationNames} from './helpers/d1';
import {ClientRequest as Request} from './helpers/client-request';
import {createOpaqueCredential,hashSecret} from '../worker/mobile-auth';
import {handleMobileRequest} from '../worker/mobile';
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{while(fixtures.length) await fixtures.pop()!.dispose();});
describe('analysis mobile API',()=>{
  it('requires owner access and write scope for credential changes',async()=>{
    const f=await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql','0030-ai-settings.sql']);fixtures.push(f);
    const now=new Date(),expiresAt=new Date(now.getTime()+3600000).toISOString(),environmentHash=await hashSecret('sandbox');
    await f.db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash,created_at) VALUES('family','personal','subject',1,1,?,?,?, ?,?)`).bind(expiresAt,expiresAt,JSON.stringify(['ledger:read']),environmentHash,now.toISOString()).run();
    const origin='https://pf.example.com',config={canonicalOrigin:origin,callbackUrl:origin+'/android/auth/callback',environment:'sandbox',accessAuthorizationUrl:'https://access.example.com/authorize',sessionEncryptionKey:'synthetic-mobile-key'};
    const credential=await createOpaqueCredential({kind:'owner-access',familyId:'family',generation:1,expiresAt,environmentHash},config);
    const env={DB:f.db,LEDGER_APP_ORIGIN:origin,MOBILE_ENVIRONMENT:'sandbox',MOBILE_ACCESS_AUTHORIZATION_URL:origin+'/mobile/authorize',MOBILE_SESSION_ENCRYPTION_KEY:config.sessionEncryptionKey,AI_CREDENTIAL_ENCRYPTION_KEY:'ab'.repeat(32)};
    const root=origin+'/api/mobile/v1/analysis',headers={authorization:`Bearer ${credential}`,'content-type':'application/json'};
    expect((await handleMobileRequest(new Request(root),env))?.status).toBe(401);
    expect((await handleMobileRequest(new Request(root,{headers}),env))?.status).toBe(200);
    expect((await handleMobileRequest(new Request(root+'/sharing',{method:'PUT',headers,body:'{"enabled":true}'}),env))?.status).toBe(403);
  },30000);
});
