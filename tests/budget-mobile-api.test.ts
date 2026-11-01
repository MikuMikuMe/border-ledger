import {afterEach,describe,expect,it} from 'vitest';
import {createD1Fixture,task24MigrationNames} from './helpers/d1';
import {ClientRequest as Request} from './helpers/client-request';
import {createOpaqueCredential,hashSecret} from '../worker/mobile-auth';
import {handleMobileRequest} from '../worker/mobile';
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{while(fixtures.length) await fixtures.pop()!.dispose();});
describe('budget mobile API',()=>{
  it('enforces owner scopes for reading and writing',async()=>{
    const f=await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql']);fixtures.push(f);
    const now=new Date(), expiresAt=new Date(now.getTime()+3600000).toISOString(),environmentHash=await hashSecret('sandbox');
    await f.db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash,created_at) VALUES('family','personal','subject',1,1,?,?,?, ?,?)`).bind(expiresAt,expiresAt,JSON.stringify(['ledger:read','preferences:write']),environmentHash,now.toISOString()).run();
    const config={canonicalOrigin:'https://pf.example.com',callbackUrl:'https://pf.example.com/android/auth/callback',environment:'sandbox',accessAuthorizationUrl:'https://access.example.com/authorize',sessionEncryptionKey:'synthetic-mobile-key'};
    const credential=await createOpaqueCredential({kind:'owner-access',familyId:'family',generation:1,expiresAt,environmentHash},config);
    const env={DB:f.db,LEDGER_APP_ORIGIN:config.canonicalOrigin,MOBILE_ENVIRONMENT:'sandbox',MOBILE_ACCESS_AUTHORIZATION_URL:`${config.canonicalOrigin}/mobile/authorize`,MOBILE_SESSION_ENCRYPTION_KEY:config.sessionEncryptionKey};
    const headers={authorization:`Bearer ${credential}`,'content-type':'application/json'};
    const settings=await handleMobileRequest(new Request(`${config.canonicalOrigin}/api/mobile/v1/budget/settings`,{method:'PUT',headers,body:JSON.stringify({currency:'CAD'})}),env);
    expect(settings?.status).toBe(200);
    const get=await handleMobileRequest(new Request(`${config.canonicalOrigin}/api/mobile/v1/budget`,{headers}),env);
    expect(await get?.json()).toMatchObject({settings:{currency:'CAD'}});
    expect((await handleMobileRequest(new Request(`${config.canonicalOrigin}/api/mobile/v1/budget`),env))?.status).toBe(401);
  },30000);
});
