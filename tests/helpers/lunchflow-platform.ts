import { createSqliteD1Fixture } from './sqlite-d1';
import { seedTenants, SECOND_LEDGER, OWNER_LEDGER, tenantOwner } from './tenants';
import { createLunchFlowConnections } from '../../worker/lunchflow-connections';
import { createLunchFlowOAuth } from '../../worker/lunchflow-oauth';
export const platformEnv={LUNCHFLOW_CLIENT_ID:'test-client',LUNCHFLOW_CLIENT_SECRET:'test-secret',LUNCHFLOW_REDIRECT_URI:'https://ledger.example/api/lunchflow/oauth/callback',LEDGER_APP_ORIGIN:'https://ledger.example',LUNCHFLOW_TOKEN_ENCRYPTION_KEY:'11'.repeat(32)};
export const token={access_token:'test-access',refresh_token:'test-refresh',token_type:'Bearer' as const,expires_in:3600,user_id:'external-second'};
export const browser={sessionHash:'verified-session',identityHash:'verified-identity',expiresAt:'2099-01-01T00:00:00Z'};
export function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; }
export async function setup(fetcher:typeof fetch=async()=>Response.json(token)) {
  const fixture=createSqliteD1Fixture(); await seedTenants(fixture.db);
  const env={...platformEnv,DB:fixture.db};
  const connections=createLunchFlowConnections(env,fetcher),oauth=createLunchFlowOAuth(env,fetcher);
  return {...fixture,env,connections,oauth};
}
export async function connect(f:Awaited<ReturnType<typeof setup>>) {
  const start=await f.oauth.startWeb(SECOND_LEDGER,browser);
  const state=new URL(start.authorizationUrl).searchParams.get('state')!;
  await f.oauth.complete(SECOND_LEDGER,browser,{state,cookie:start.cookie,code:'test-code'});
  return (await f.connections.status(SECOND_LEDGER)).connectionId!;
}

export { SECOND_LEDGER, OWNER_LEDGER, tenantOwner };
