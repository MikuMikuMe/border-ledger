import type { D1Result } from './db-types';
import type { LedgerContext } from './tenant-context';
import type { OwnerContext } from './mobile-auth';
import { assertFinancialAuthority, financialAuthorityPredicate, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { LunchFlowError } from './lunchflow';
import { createLunchFlowPlatform, PlatformRequestError } from './lunchflow-platform';
import { requireOAuthConfiguration, type LunchFlowConnectionEnv } from './lunchflow-connections';
import { lunchFlowNonce, lunchFlowHash } from './lunchflow-crypto';
import { ensurePlatformConnection, assertConnectionApp, readLunchFlowConnection, assertConnectionIdle, assertClaimBeforeFetch, finishConnectionTokens, finishConnectionFailure, connectionError, type ConnectionClaim } from './lunchflow-connection-store';

/** Created by the HTTP authentication boundary, never from request JSON or query parameters. */
export interface LunchFlowBrowserSession { sessionHash:string; identityHash:string; expiresAt:string }
interface OAuthState {
  id:string; connection_id:string; user_id:string; ledger_id:string; generation:number;
  native_context_json:string|null; return_kind:'web'|'native';
}
export interface LunchFlowCallback { state:string; cookie:string; code:string }
function requireConsumed(result:D1Result[]) {
  if(result[0]?.meta?.changes!==1)invalidState();
  if(result[1]?.meta?.changes!==1)invalidState();
}
function invalidState():never { throw new LunchFlowError('invalid_oauth_state','Lunch Flow authorization expired or does not match this session. Start again.',403); }
function bounded(value:string,max=256) {
  if(typeof value!=='string')invalidState();
  if(!value.length)invalidState();
  if(value.length>max)invalidState();
  return value;
}
function browserBinding(browser:LunchFlowBrowserSession) {
  bounded(browser.sessionHash);bounded(browser.identityHash);
  const expires=Date.parse(browser.expiresAt);
  if(!Number.isFinite(expires)||expires<=Date.now())invalidState();
}
function stateAuthority(row:OAuthState,context:LedgerContext):FinancialContext {
  if(row.user_id!==context.userId||row.ledger_id!==context.ledgerId)invalidState();
  if(!row.native_context_json)return immutableFinancialContext(context);
  let parsed:OwnerContext;
  try{parsed=JSON.parse(row.native_context_json) as OwnerContext;}catch{return invalidState();}
  if(parsed.credentialType!=='owner')invalidState();
  if(parsed.userId!==row.user_id)invalidState();
  if(parsed.ledgerId!==row.ledger_id)invalidState();
  return immutableFinancialContext(parsed);
}
export function createLunchFlowOAuth(env:LunchFlowConnectionEnv,fetcher:typeof fetch=fetch) {
  async function issuance(context:FinancialContext,browser:LunchFlowBrowserSession|null) {
    const state=lunchFlowNonce(),cookie=lunchFlowNonce();
    if(browser) {
      browserBinding(browser);
      return {fields:[await lunchFlowHash(state),null,await lunchFlowHash(cookie),browser.sessionHash,browser.identityHash,null,'web'],
        authorizationUrl:createLunchFlowPlatform(env,fetcher).authorize(state),cookie,expiresAt:browser.expiresAt};
    }
    const ticket=lunchFlowNonce();
    return {fields:[null,await lunchFlowHash(ticket),null,null,null,JSON.stringify(context),'native'],
      authorizationUrl:new URL(`/api/lunchflow/oauth/launch?ticket=${encodeURIComponent(ticket)}`,env.LUNCHFLOW_REDIRECT_URI).href,cookie:'',expiresAt:'9999-01-01T00:00:00Z'};
  }
  async function start(binding:FinancialContext,browser:LunchFlowBrowserSession|null) {
    const context=immutableFinancialContext(binding);
    requireOAuthConfiguration(env);
    const connection=await ensurePlatformConnection(env.DB,context,{hasPersonalKey:Boolean(env.LUNCHFLOW_API_KEY?.trim()),clientId:env.LUNCHFLOW_CLIENT_ID!});
    const issued=await issuance(context,browser);
    const authority=financialAuthorityPredicate(context,'connections:manage');
    const result=await env.DB.prepare(`INSERT INTO lunchflow_oauth_states(id,connection_id,user_id,ledger_id,generation,
      state_hash,launch_hash,cookie_hash,browser_session_hash,browser_identity_hash,native_context_json,return_kind,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN julianday(?)<julianday('now','+10 minutes') THEN ? ELSE datetime('now','+10 minutes') END WHERE ${authority.sql}
      AND EXISTS (SELECT 1 FROM lunchflow_connections WHERE id=? AND generation=? AND operation_id IS NULL AND lifecycle NOT IN ('revocation_pending','revocation_failed'))`)
      .bind(crypto.randomUUID(),connection.id,context.userId,context.ledgerId,connection.generation,...issued.fields,issued.expiresAt,issued.expiresAt,
        ...authority.bindings,connection.id,connection.generation).run();
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    if(result.meta?.changes!==1)return invalidState();
    return {authorizationUrl:issued.authorizationUrl,cookie:issued.cookie,connectionId:connection.id};
  }
  async function startWeb(context:LedgerContext,browser:LunchFlowBrowserSession) {
    if('credentialType' in context)invalidState();
    return start(context,browser);
  }
  async function startNative(owner:OwnerContext) {
    if(owner.credentialType!=='owner')invalidState();
    const {authorizationUrl,connectionId}=await start(owner,null);
    return {authorizationUrl,connectionId};
  }
  async function launch(binding:LedgerContext,browser:LunchFlowBrowserSession,ticket:string) {
    const context=immutableFinancialContext(binding);browserBinding(browser);requireOAuthConfiguration(env);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const hash=await lunchFlowHash(bounded(ticket));
    const row=await env.DB.prepare(`SELECT * FROM lunchflow_oauth_states WHERE launch_hash=? AND user_id=? AND ledger_id=?
      AND launch_consumed=0 AND consumed_by IS NULL AND julianday(expires_at)>julianday('now')`).bind(hash,context.userId,context.ledgerId).first<OAuthState>();
    if(!row)return invalidState();
    const authority=stateAuthority(row,context);await assertFinancialAuthority(env.DB,authority,'connections:manage');
    const predicate=financialAuthorityPredicate(authority,'connections:manage');
    const state=lunchFlowNonce(),cookie=lunchFlowNonce();
    const result=await env.DB.prepare(`UPDATE lunchflow_oauth_states SET launch_consumed=1,state_hash=?,cookie_hash=?,browser_session_hash=?,browser_identity_hash=?,
      expires_at=CASE WHEN julianday(?)<julianday(expires_at) THEN ? ELSE expires_at END
      WHERE id=? AND launch_consumed=0 AND consumed_by IS NULL AND julianday(expires_at)>julianday('now') AND ${predicate.sql}
      AND EXISTS (SELECT 1 FROM lunchflow_connections WHERE id=? AND generation=? AND operation_id IS NULL AND lifecycle NOT IN ('revocation_pending','revocation_failed'))`)
      .bind(await lunchFlowHash(state),await lunchFlowHash(cookie),browser.sessionHash,browser.identityHash,browser.expiresAt,browser.expiresAt,row.id,...predicate.bindings,row.connection_id,row.generation).run();
    if(result.meta?.changes!==1)return invalidState();
    await assertFinancialAuthority(env.DB,authority,'connections:manage');
    return {authorizationUrl:createLunchFlowPlatform(env,fetcher).authorize(state),cookie,connectionId:row.connection_id};
  }
  async function consume(context:LedgerContext,browser:LunchFlowBrowserSession,input:LunchFlowCallback) {
    browserBinding(browser);
    const hash=await lunchFlowHash(bounded(input.state));const cookie=await lunchFlowHash(bounded(input.cookie));
    const row=await env.DB.prepare(`SELECT * FROM lunchflow_oauth_states WHERE state_hash=? AND cookie_hash=? AND browser_session_hash=? AND browser_identity_hash=?
      AND user_id=? AND ledger_id=? AND consumed_by IS NULL AND julianday(expires_at)>julianday('now')`)
      .bind(hash,cookie,browser.sessionHash,browser.identityHash,context.userId,context.ledgerId).first<OAuthState>();
    if(!row)return invalidState();
    const authority=stateAuthority(row,context);await assertFinancialAuthority(env.DB,authority,'connections:manage');
    const connection=await readLunchFlowConnection(env.DB,context,row.connection_id);
    if(!connection)return invalidState();
    if(connection.generation!==row.generation)return invalidState();
    assertConnectionApp(connection,env.LUNCHFLOW_CLIENT_ID);
    assertConnectionIdle(connection);
    const predicate=financialAuthorityPredicate(authority,'connections:manage'),operationId=crypto.randomUUID();
    const result=await env.DB.batch([
      env.DB.prepare(`UPDATE lunchflow_oauth_states SET consumed_by=? WHERE id=? AND consumed_by IS NULL
        AND julianday(expires_at)>julianday('now') AND ${predicate.sql}`).bind(operationId,row.id,...predicate.bindings),
      env.DB.prepare(`UPDATE lunchflow_connections SET generation=generation+1,operation_id=?,operation_kind='exchange',operation_uncertain=0,operation_expires_at=datetime('now','+30 seconds')
        WHERE id=? AND generation=? AND operation_id IS NULL AND lifecycle NOT IN ('revocation_pending','revocation_failed') AND ${predicate.sql}
        AND EXISTS (SELECT 1 FROM lunchflow_oauth_states WHERE id=? AND consumed_by=?)`)
        .bind(operationId,connection.id,row.generation,...predicate.bindings,row.id,operationId),
    ]);
    requireConsumed(result);
    return {authority,claim:{connection:{...connection,generation:connection.generation+1},operationId} satisfies ConnectionClaim,returnKind:row.return_kind,authorizationId:row.id};
  }
  async function deny(binding:LedgerContext,browser:LunchFlowBrowserSession,input:Omit<LunchFlowCallback,'code'>) {
    const context=immutableFinancialContext(binding);browserBinding(browser);
    const row=await env.DB.prepare(`SELECT * FROM lunchflow_oauth_states WHERE state_hash=? AND cookie_hash=? AND browser_session_hash=? AND browser_identity_hash=?
      AND user_id=? AND ledger_id=? AND consumed_by IS NULL AND julianday(expires_at)>julianday('now')`)
      .bind(await lunchFlowHash(bounded(input.state)),await lunchFlowHash(bounded(input.cookie)),browser.sessionHash,browser.identityHash,context.userId,context.ledgerId).first<OAuthState>();
    if(!row)return invalidState();
    const authority=stateAuthority(row,context);await assertFinancialAuthority(env.DB,authority,'connections:manage');
    const predicate=financialAuthorityPredicate(authority,'connections:manage');
    const result=await env.DB.prepare(`UPDATE lunchflow_oauth_states SET consumed_by='denied' WHERE id=? AND consumed_by IS NULL AND julianday(expires_at)>julianday('now') AND ${predicate.sql}`)
      .bind(row.id,...predicate.bindings).run();
    if(result.meta?.changes!==1)return invalidState();
    return {returnKind:row.return_kind};
  }
  async function complete(binding:LedgerContext,browser:LunchFlowBrowserSession,input:LunchFlowCallback) {
    const context=immutableFinancialContext(binding),secret=requireOAuthConfiguration(env);bounded(input.code,4096);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const {authority,claim,returnKind,authorizationId}=await consume(context,browser,input);
    try{await assertClaimBeforeFetch(env.DB,authority,claim);}catch(error){await finishConnectionFailure(env.DB,claim,'authority_changed',false);throw error;}
    let tokens;
    try{tokens=await createLunchFlowPlatform(env,fetcher).exchange(input.code);}catch(error){await finishConnectionFailure(env.DB,claim,'exchange_failed',!(error instanceof PlatformRequestError)||error.uncertain);throw error;}
    await finishConnectionTokens(env.DB,authority,claim,{tokens,secret,authorizationId});
    await assertFinancialAuthority(env.DB,authority,'connections:manage');
    return {completed:true,returnKind};
  }
  return {startWeb,startNative,launch,complete,deny};
}
