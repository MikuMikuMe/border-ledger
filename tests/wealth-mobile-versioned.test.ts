import { afterEach, expect, it } from 'vitest';
import { createD1Fixture, task24MigrationNames } from './helpers/d1';
import { provisionWebOwner } from './helpers/web-identity';
import worker from '../worker/index';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose(); });

it('serves the versioned mobile Wealth report only to an owner with Wealth read access', async () => {
  const f = await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql','0030-ai-settings.sql','0031-budget-tracking.sql','0032-ai-official-providers.sql','0033-wealth.sql']);
  fixtures.push(f); await provisionWebOwner(f.db);
  const now = new Date(), expiresAt = new Date(now.getTime() + 3_600_000).toISOString(), environmentHash = await hashSecret('sandbox');
  await f.db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash,created_at) VALUES('wealth-read-family','personal','subject',1,1,?,?,?, ?,?)`).bind(expiresAt,expiresAt,JSON.stringify(['wealth:read']),environmentHash,now.toISOString()).run();
  const config = {canonicalOrigin:'https://pf.example.com',callbackUrl:'https://pf.example.com/android/auth/callback',environment:'sandbox',accessAuthorizationUrl:'https://pf.example.com/mobile/authorize',sessionEncryptionKey:'synthetic-mobile-key'};
  const credential = await createOpaqueCredential({kind:'owner-access',familyId:'wealth-read-family',generation:1,expiresAt,environmentHash},config);
  const env = {DB:f.db,LEDGER_APP_ORIGIN:config.canonicalOrigin,MOBILE_ENVIRONMENT:config.environment,MOBILE_ACCESS_AUTHORIZATION_URL:config.accessAuthorizationUrl,MOBILE_SESSION_ENCRYPTION_KEY:config.sessionEncryptionKey};
  const url='https://pf.example.com/api/mobile/v1/wealth/report?view=overview';
  const response=await worker.fetch(new Request(url,{headers:{authorization:`Bearer ${credential}`,'X-Ledger-Protocol':'2'}}),env as never);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({accounts:[]});
  const deniedWrite=await worker.fetch(new Request('https://pf.example.com/api/mobile/v1/wealth/accounts',{method:'PUT',headers:{authorization:`Bearer ${credential}`,'X-Ledger-Protocol':'2','content-type':'application/json'},body:JSON.stringify({id:'test',name:'Test',kind:'manual_asset',mode:'aggregate',currency:'CAD',expectedRevision:0})}),env as never);
  expect(deniedWrite.status).toBe(403);
  const unauthenticated=await worker.fetch(new Request(url,{headers:{'X-Ledger-Protocol':'2'}}),env as never);
  expect(unauthenticated.status).toBe(401);
},30000);
