import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import { ClientRequest } from './helpers/client-request';
import worker from '../worker/index';
import { handleMobileRequest } from '../worker/mobile';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';

describe('manual transaction client routes', () => {
  it('shares web-created and mobile-created transactions and enforces owner scope', async () => {
    const f=createSqliteD1Fixture();
    try {
      await provisionWebOwner(f.db);
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const expires=new Date(Date.now()+3600000).toISOString(),environment='sandbox',key='manual-transaction-api-session-key';
      const env={DB:f.db,...VERIFIED_WEB_ENV,LEDGER_APP_ORIGIN:'https://pf.example.com',MOBILE_ENVIRONMENT:environment,MOBILE_ACCESS_AUTHORIZATION_URL:'https://pf.example.com/mobile/authorize',MOBILE_SESSION_ENCRYPTION_KEY:key,ASSETS:{fetch:vi.fn()}};
      await f.db.prepare("INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash) VALUES('manual-family','personal','owner-hash',1,1,?,?,?,?)").bind(expires,expires,JSON.stringify(['ledger:read','ledger:review']),await hashSecret(environment)).run();
      const token=await createOpaqueCredential({kind:'owner-access',familyId:'manual-family',generation:1,expiresAt:expires,environmentHash:await hashSecret(environment)},{canonicalOrigin:'https://pf.example.com',callbackUrl:'https://pf.example.com/android/auth/callback',environment,accessAuthorizationUrl:'https://access.example.com/authorize',sessionEncryptionKey:key});
      const body={requestId:'manual_request_123456',accountId:'acct',date:'2026-11-07',merchant:'Coffee',amount:'12.34',currency:'CAD',category:'Food',kind:'expense',note:null};
      const web=await worker.fetch(new Request('https://pf.example.com/api/transactions',{method:'POST',headers:{...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'},body:JSON.stringify(body)}),env as never);
      expect(web.status).toBe(201);
      const mobile=await handleMobileRequest(new ClientRequest('https://pf.example.com/api/mobile/v1/transactions',{headers:{authorization:`Bearer ${token}`}}),env);
      expect(mobile?.status).toBe(200);
      expect(await mobile?.json()).toMatchObject({items:[{merchant:'Coffee',source:'manual'}]});
      const added=await handleMobileRequest(new ClientRequest('https://pf.example.com/api/mobile/v1/transactions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...body,requestId:'manual_request_654321',merchant:'Lunch'})}),env);
      expect(added?.status).toBe(201);
      const webRead=await worker.fetch(new Request('https://pf.example.com/api/transactions',{headers:VERIFIED_WEB_HEADERS}),env as never);
      expect(await webRead.json()).toMatchObject({transactions:expect.arrayContaining([expect.objectContaining({merchant:'Coffee'}),expect.objectContaining({merchant:'Lunch'})])});
      await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank','acct','2026-11-08','Coffee',-1234,'CAD','Food','expense','confirmed','plaid','bank','personal')").run();
      const matches=await worker.fetch(new Request('https://pf.example.com/api/transactions/manual-matches',{headers:VERIFIED_WEB_HEADERS}),env as never);
      const matchBody=await matches.json() as {matches:Array<{manualId:string;bankId:string;revision:number;manualMerchant:string}>};
      const match=matchBody.matches.find(row=>row.manualMerchant==='Coffee')!;
      const confirm=await worker.fetch(new Request('https://pf.example.com/api/transactions/manual-matches',{method:'POST',headers:{...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'},body:JSON.stringify({...match,decision:'confirmed',expectedRevision:match.revision})}),env as never);
      expect(confirm.status).toBe(200);
      const updated=await handleMobileRequest(new ClientRequest('https://pf.example.com/api/mobile/v1/transactions',{headers:{authorization:`Bearer ${token}`}}),env);
      const page=await updated?.json() as {items:Array<{id:string}>};
      expect(page).toMatchObject({items:expect.arrayContaining([expect.objectContaining({id:'bank'}),expect.objectContaining({merchant:'Lunch'})])});
      expect(page.items.some(row=>row.id===match.manualId)).toBe(false);
      expect(((await f.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source='manual'").first()) as {count:number}).count).toBe(2);
      const matchesOnMobile=await handleMobileRequest(new ClientRequest('https://pf.example.com/api/mobile/v1/transactions/manual-matches',{headers:{authorization:`Bearer ${token}`}}),env);
      expect(await matchesOnMobile?.json()).toMatchObject({matches:expect.arrayContaining([expect.objectContaining({manualId:match.manualId,decision:'confirmed'})])});
      await f.db.prepare("UPDATE owner_session_families SET scope_json=? WHERE id='manual-family'").bind(JSON.stringify(['ledger:read'])).run();
      const denied=await handleMobileRequest(new ClientRequest('https://pf.example.com/api/mobile/v1/transactions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...body,requestId:'manual_request_denied'})}),env);
      expect(denied?.status).toBe(403);
    } finally {f.close();}
  });
});
