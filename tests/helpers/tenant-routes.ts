import worker from '../../worker/index';
import { createOpaqueCredential, hashSecret } from '../../worker/mobile-auth';
import type { D1Database } from '../../worker/db-types';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants } from './tenants';

export const routeOrigin = 'https://pf.example.com';
export const routeConfig = {
  canonicalOrigin: routeOrigin, callbackUrl: `${routeOrigin}/android/auth/callback`,
  environment: 'sandbox', accessAuthorizationUrl: `${routeOrigin}/mobile/authorize`,
  sessionEncryptionKey: 'synthetic-tenant-route-session-key',
};
export const routeScopes = ['ledger:read','ledger:review','preferences:write','imports:write','exports:read','devices:manage','connections:manage','recurring:classify'];

export async function seedRouteTenants(db: D1Database) {
  await seedTenants(db);
  const tokens = new Map<string,string>();
  const environmentHash = await hashSecret(routeConfig.environment);
  for (const context of [OWNER_LEDGER,SECOND_LEDGER]) {
    const user = context.userId;
    await db.prepare("INSERT INTO mobile_devices(id,ledger_id,device_name,platform,status) VALUES (?,?,'Phone','android','paired')")
      .bind(`${user}-device`,context.ledgerId).run();
    await db.prepare(`UPDATE owner_session_families SET device_id=?,scope_json=?,environment_hash=?,created_at=?,installation_id=? WHERE id=?`)
      .bind(`${user}-device`,JSON.stringify(routeScopes),environmentHash,new Date().toISOString(),`${user}-installation`,`${user}-family`).run();
    await db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES (?,?,'bank','notification','Bank','v1','approved')")
      .bind(`${user}-profile`,context.ledgerId).run();
    await db.prepare("INSERT INTO source_account_mappings(id,ledger_id,source_profile_id,account_id,approval_status,approved_at) VALUES (?,?,?,?,'approved',CURRENT_TIMESTAMP)")
      .bind(`${user}-mapping`,context.ledgerId,`${user}-profile`,`${user}-account`).run();
    await db.prepare("INSERT INTO device_source_scopes(id,ledger_id,device_id,source_profile_id,account_id,currency) VALUES (?,?,?,?,?,'CAD')")
      .bind(`${user}-scope`,context.ledgerId,`${user}-device`,`${user}-profile`,`${user}-account`).run();
    await db.prepare(`INSERT INTO capture_credentials(id,ledger_id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at,environment_hash)
      VALUES (?,?,?,?,'capture','alerts:write',1,CURRENT_TIMESTAMP,'2099-01-01T00:00:00Z',?)`)
      .bind(`${user}-capture`,context.ledgerId,`${user}-device`,await hashSecret(`capture-${user}`),environmentHash).run();
    tokens.set(user,await createOpaqueCredential({kind:'owner-access',familyId:`${user}-family`,generation:1,
      expiresAt:'2099-01-01T00:00:00Z',environmentHash},routeConfig));
  }
  const env = {
    DB: db, LEDGER_APP_ORIGIN: routeOrigin, MOBILE_ENVIRONMENT: routeConfig.environment,
    MOBILE_ACCESS_AUTHORIZATION_URL: routeConfig.accessAuthorizationUrl,
    MOBILE_SESSION_ENCRYPTION_KEY: routeConfig.sessionEncryptionKey,
    ACCESS_TEAM_DOMAIN:'https://access.example.com',ACCESS_AUDIENCE:'tenant-route-audience',
    ASSETS:{fetch:async()=>new Response('not found',{status:404})},
  };
  return {tokens,env};
}

export function routeRequest(path:string, identity:{web:string}|{token:string}, ...operation:[method?:string, body?:unknown, key?:string]) {
  const [method='GET',body,key]=operation;
  const headers = new Headers({'content-type':'application/json',origin:routeOrigin,'X-Ledger-Protocol':'2'});
  if ('web' in identity) headers.set('Cf-Access-Jwt-Assertion',identity.web);
  else headers.set('authorization',`Bearer ${identity.token}`);
  if (key) headers.set('Idempotency-Key',key);
  return new Request(`${routeOrigin}${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
}

export async function callRoute(env:Awaited<ReturnType<typeof seedRouteTenants>>['env'], request:Request) {
  return worker.fetch(request,env as never);
}
