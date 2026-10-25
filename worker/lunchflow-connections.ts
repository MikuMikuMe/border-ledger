import { lunchFlowConnectionStatus, revocationPending, operationUncertain } from './lunchflow-connection-status';
import type { D1Database } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { LunchFlowError } from './lunchflow';
import { createLunchFlowPlatform, platformConfiguration, PlatformRequestError, type LunchFlowPlatformEnv } from './lunchflow-platform';
import { lunchFlowEncryptionKey, openLunchFlowTokens } from './lunchflow-crypto';
import { readLunchFlowConnection, assertConnectionApp, claimConnection, assertClaimBeforeFetch, finishConnectionTokens, finishConnectionFailure, connectionError, type LunchFlowConnection } from './lunchflow-connection-store';
export interface LunchFlowConnectionEnv extends LunchFlowPlatformEnv { DB:D1Database; LUNCHFLOW_TOKEN_ENCRYPTION_KEY?:string; LUNCHFLOW_API_KEY?:string }
export function oauthConfigured(env:LunchFlowConnectionEnv) {
  try{return Boolean(platformConfiguration(env)&&lunchFlowEncryptionKey(env.LUNCHFLOW_TOKEN_ENCRYPTION_KEY));}catch{return false;}
}
export function requireOAuthConfiguration(env:LunchFlowConnectionEnv) {
  if(!oauthConfigured(env)) throw new LunchFlowError('configuration_required','Lunch Flow authorization is not configured.',503);
  return env.LUNCHFLOW_TOKEN_ENCRYPTION_KEY!;
}
function uncertainFailure(error:unknown) { return error instanceof PlatformRequestError?error.uncertain:true; }
function usableConnection(row:LunchFlowConnection|null):asserts row is LunchFlowConnection & {token_ciphertext:string;token_iv:string} {
  if(!row)return connectionError('connection_not_found',404);
  if(row.adapter!=='platform')return connectionError('connection_not_found',404);
  if(row.operation_id)return connectionError(operationUncertain(row)?'operation_uncertain':'operation_in_progress');
  if(row.lifecycle!=='connected')return connectionError('reconnect_required');
  if(!row.token_ciphertext||!row.token_iv)return connectionError('reconnect_required');
}
function sameCredentials(row:LunchFlowConnection,current:LunchFlowConnection|null) {
  if(!current)return false;
  if(current.generation!==row.generation)return false;
  if(current.credential_version!==row.credential_version)return false;
  return current.lifecycle==='connected';
}
export function createLunchFlowConnections(env:LunchFlowConnectionEnv,fetcher:typeof fetch=fetch) {
  async function status(binding:FinancialContext) {
    const context=immutableFinancialContext(binding);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const row=await readLunchFlowConnection(env.DB,context);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const configured=row?.adapter==='personal'?Boolean(env.LUNCHFLOW_API_KEY):oauthConfigured(env);
    const result=lunchFlowConnectionStatus(context,row,configured);
    if(row?.adapter==='platform' && row.app_client_id!==env.LUNCHFLOW_CLIENT_ID)return {...result,configured:false,connected:false,canReconnect:false,reason:'application_configuration_changed'};
    return result;
  }
  async function refresh(context:FinancialContext,row:LunchFlowConnection,credentials:{refreshToken:string;secret:string}) {
    const claim=await claimConnection(env.DB,context,row,'refresh');
    try{await assertClaimBeforeFetch(env.DB,context,claim);}catch(error){await finishConnectionFailure(env.DB,claim,'authority_changed',false);throw error;}
    let refreshed;
    try{refreshed=await createLunchFlowPlatform(env,fetcher).refresh(credentials.refreshToken);}catch(error){await finishConnectionFailure(env.DB,claim,'refresh_failed',uncertainFailure(error));throw error;}
    await finishConnectionTokens(env.DB,context,claim,{tokens:refreshed,secret:credentials.secret});
    return refreshed.access_token;
  }
  async function accessToken(binding:FinancialContext,id:string) {
    const context=immutableFinancialContext(binding),secret=requireOAuthConfiguration(env);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const row=await readLunchFlowConnection(env.DB,context,id);
    usableConnection(row);
    assertConnectionApp(row,env.LUNCHFLOW_CLIENT_ID);
    const tokens=await openLunchFlowTokens({ciphertext:row.token_ciphertext,iv:row.token_iv},{secret,binding:{userId:context.userId,ledgerId:context.ledgerId,connectionId:id,version:row.credential_version}});
    if(!row.access_fresh)return refresh(context,row,{refreshToken:tokens.refresh_token,secret});
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const current=await readLunchFlowConnection(env.DB,context,id);
    if(!sameCredentials(row,current))return connectionError('reconnect_required');
    return tokens.access_token;
  }
  async function revoke(context:FinancialContext,row:LunchFlowConnection) {
    if(row.operation_id||!row.provider_user_id)return;
    requireOAuthConfiguration(env);
    assertConnectionApp(row,env.LUNCHFLOW_CLIENT_ID);
    const claim=await claimConnection(env.DB,context,row,'revoke');
    try{await assertClaimBeforeFetch(env.DB,context,claim);}catch(error){await finishConnectionFailure(env.DB,claim,'authority_changed',false);throw error;}
    try{await createLunchFlowPlatform(env,fetcher).revoke(row.provider_user_id);}catch(error){await finishConnectionFailure(env.DB,claim,'revocation_failed',uncertainFailure(error));return;}
    await env.DB.prepare(`UPDATE lunchflow_connections SET lifecycle='revoked',operation_id=NULL,operation_kind=NULL,operation_expires_at=NULL,operation_uncertain=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND generation=? AND operation_id=? AND provider_user_id=?`).bind(row.id,row.generation,claim.operationId,row.provider_user_id).run();
  }
  async function disconnect(binding:FinancialContext,id:string) {
    const context=immutableFinancialContext(binding);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const row=await readLunchFlowConnection(env.DB,context,id);
    if(!row)return connectionError('connection_not_found',404);
    const authority=financialAuthorityPredicate(context,'connections:manage');
    await env.DB.batch([
      env.DB.prepare(`UPDATE lunchflow_connections SET lifecycle=CASE WHEN adapter='personal' THEN 'disconnected' WHEN provider_user_id IS NULL AND operation_id IS NULL THEN 'revoked' ELSE 'revocation_pending' END,
        generation=generation+1,token_ciphertext=NULL,token_iv=NULL,access_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=? AND ledger_id=? AND (lifecycle NOT IN ('revocation_pending','revocation_failed','revoked') OR operation_kind='exchange') AND ${authority.sql}`)
        .bind(id,context.userId,context.ledgerId,...authority.bindings),
      env.DB.prepare(`UPDATE lunchflow_accounts SET enabled=0,revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE connection_id=? AND ledger_id=? AND enabled=1 AND ${authority.sql}`).bind(id,context.ledgerId,...authority.bindings),
      env.DB.prepare(`UPDATE lunchflow_oauth_states SET consumed_by=COALESCE(consumed_by,'disconnected')
        WHERE connection_id=? AND user_id=? AND ledger_id=? AND ${authority.sql}`).bind(id,context.userId,context.ledgerId,...authority.bindings),
    ]);
    await assertFinancialAuthority(env.DB,context,'connections:manage');
    const current=await readLunchFlowConnection(env.DB,context,id);
    if(current&&revocationPending(current))await revoke(context,current);
    return status(context);
  }
  return {status,accessToken,disconnect};
}
