import type { D1Database } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import type { LedgerContext } from './tenant-context';
import { LunchFlowError } from './lunchflow';
import { sealLunchFlowTokens } from './lunchflow-crypto';
import type { PlatformTokens } from './lunchflow-platform';

export interface LunchFlowConnection {
  id:string; user_id:string; ledger_id:string; adapter:'personal'|'platform'; app_client_id:string|null; provider_user_id:string|null;
  lifecycle:'disconnected'|'connected'|'reconnect_required'|'revocation_pending'|'revocation_failed'|'revoked';
  generation:number; credential_version:number; token_ciphertext:string|null; token_iv:string|null; access_expires_at:string|null;
  operation_id:string|null; operation_kind:'exchange'|'refresh'|'revoke'|null; operation_uncertain:number; operation_expired:number;
  access_fresh:number; last_error:string|null;
}
export interface ConnectionClaim { connection:LunchFlowConnection; operationId:string }
export function connectionError(code:string,status=409):never {
  const messages:Record<string,string>={connection_not_found:'Lunch Flow connection not found.',operation_in_progress:'Lunch Flow is completing another operation.',operation_uncertain:'A Lunch Flow operation has an uncertain outcome. Contact the operator before reconnecting.',application_configuration_changed:'Restore the OAuth application configuration used by this connection before continuing.',legacy_cutover_required:'Preserve the existing Personal feed. Verified account mapping is required before switching to Platform.',provider_identity_conflict:'This Lunch Flow identity cannot replace or belong to another hosted user.',reconnect_required:'Reconnect Lunch Flow to continue.',revocation_pending:'Lunch Flow access removal must finish before reconnecting.'};
  throw new LunchFlowError(code,messages[code]??'The Lunch Flow operation could not be completed.',status,code==='operation_in_progress');
}
export async function readLunchFlowConnection(db:D1Database,context:LedgerContext,id?:string) {
  return db.prepare(`SELECT *,operation_id IS NOT NULL AND julianday(operation_expires_at)<=julianday('now') AS operation_expired,
    julianday(access_expires_at)>julianday('now','+60 seconds') AS access_fresh FROM lunchflow_connections
    WHERE user_id=? AND ledger_id=? ${id?'AND id=?':"ORDER BY CASE adapter WHEN 'platform' THEN 0 ELSE 1 END"} LIMIT 1`)
    .bind(context.userId,context.ledgerId,...(id?[id]:[])).first<LunchFlowConnection>();
}
export function assertConnectionApp(row:LunchFlowConnection,clientId?:string) {
  if(row.adapter==='platform' && row.app_client_id!==clientId)connectionError('application_configuration_changed',503);
}
export function assertConnectionIdle(row:LunchFlowConnection) {
  if(row.operation_id) connectionError(row.operation_uncertain||row.operation_expired?'operation_uncertain':'operation_in_progress');
  if(row.lifecycle==='revocation_pending'||row.lifecycle==='revocation_failed') connectionError('revocation_pending');
}
export async function ensurePlatformConnection(db:D1Database,context:FinancialContext,config:{hasPersonalKey:boolean;clientId:string}) {
  await assertFinancialAuthority(db,context,'connections:manage');
  if(context.userId==='owner'&&context.ledgerId==='personal') {
    const legacy=await db.prepare("SELECT 1 FROM lunchflow_accounts WHERE ledger_id='personal' AND connection_id='lunchflow-personal-owner' LIMIT 1").first();
    if(config.hasPersonalKey||legacy) connectionError('legacy_cutover_required');
  }
  const authority=financialAuthorityPredicate(context,'connections:manage');
  await db.prepare(`INSERT INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id)
    SELECT ?,?,?,'platform',? WHERE ${authority.sql}
    AND NOT EXISTS (SELECT 1 FROM lunchflow_connections WHERE user_id=? AND ledger_id=? AND adapter='platform')`)
    .bind(crypto.randomUUID(),context.userId,context.ledgerId,config.clientId,...authority.bindings,context.userId,context.ledgerId).run();
  await assertFinancialAuthority(db,context,'connections:manage');
  const row=await readLunchFlowConnection(db,context);
  if(!row||row.adapter!=='platform') return connectionError('connection_not_found',404);
  assertConnectionApp(row,config.clientId);
  assertConnectionIdle(row);
  return row;
}
export async function claimConnection(db:D1Database,context:FinancialContext,row:LunchFlowConnection,kind:'refresh'|'revoke') {
  const authority=financialAuthorityPredicate(context,'connections:manage');
  const operationId=crypto.randomUUID();
  const states=kind==='refresh'?"'connected'":"'revocation_pending','revocation_failed'";
  const claimed=await db.prepare(`UPDATE lunchflow_connections SET operation_id=?,operation_kind=?,operation_uncertain=0,
    operation_expires_at=datetime('now','+30 seconds'),updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND user_id=? AND ledger_id=? AND generation=? AND credential_version=? AND operation_id IS NULL
    AND lifecycle IN (${states}) AND ${authority.sql} RETURNING id`)
    .bind(operationId,kind,row.id,context.userId,context.ledgerId,row.generation,row.credential_version,...authority.bindings).first();
  if(!claimed){await assertFinancialAuthority(db,context,'connections:manage');return connectionError('operation_in_progress');}
  return {connection:row,operationId};
}
export async function assertClaimBeforeFetch(db:D1Database,context:FinancialContext,claim:ConnectionClaim) {
  await assertFinancialAuthority(db,context,'connections:manage');
  const row=await readLunchFlowConnection(db,context,claim.connection.id);
  if(!row)return connectionError('reconnect_required');
  if(row.generation!==claim.connection.generation)return connectionError('reconnect_required');
  if(row.operation_id!==claim.operationId)connectionError('reconnect_required');
}
export async function finishConnectionFailure(db:D1Database,claim:ConnectionClaim,code:string,uncertain:boolean) {
  await db.prepare(`UPDATE lunchflow_connections SET token_ciphertext=NULL,token_iv=NULL,access_expires_at=NULL,
    lifecycle=CASE WHEN lifecycle IN ('revocation_pending','revocation_failed') THEN 'revocation_failed' ELSE 'reconnect_required' END,
    last_error=?,operation_uncertain=?,operation_id=CASE WHEN ? THEN operation_id ELSE NULL END,
    operation_kind=CASE WHEN ? THEN operation_kind ELSE NULL END,
    operation_expires_at=CASE WHEN ? THEN operation_expires_at ELSE NULL END,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND operation_id=?`).bind(code,Number(uncertain),Number(uncertain),Number(uncertain),Number(uncertain),claim.connection.id,claim.operationId).run();
}
function providerBindingStatement(db:D1Database,claim:ConnectionClaim,providerUser:string) {
  const row=claim.connection;
  return db.prepare(`INSERT INTO lunchflow_provider_bindings(provider_user_id,user_id,ledger_id)
    SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM lunchflow_connections WHERE id=? AND operation_id=?)
    ON CONFLICT(provider_user_id) DO UPDATE SET user_id=CASE WHEN user_id=excluded.user_id AND ledger_id=excluded.ledger_id THEN user_id ELSE NULL END`)
    .bind(providerUser,row.user_id,row.ledger_id,row.id,claim.operationId);
}
export async function finishConnectionTokens(db:D1Database,context:FinancialContext,claim:ConnectionClaim,credentials:{tokens:PlatformTokens;secret:string;authorizationId?:string}) {
  const {tokens,secret}=credentials;
  const row=claim.connection;
  if(row.provider_user_id && row.provider_user_id!==tokens.user_id) {
    await finishConnectionFailure(db,claim,'provider_identity_conflict',false);return connectionError('provider_identity_conflict');
  }
  const version=row.credential_version+1;
  const sealed=await sealLunchFlowTokens(tokens,{secret,binding:{userId:row.user_id,ledgerId:row.ledger_id,connectionId:row.id,version}});
  const authority=financialAuthorityPredicate(context,'connections:manage');
  const authorization=credentials.authorizationId?{sql:` AND EXISTS (SELECT 1 FROM lunchflow_oauth_states WHERE id=? AND consumed_by=? AND julianday(expires_at)>julianday('now'))`,bindings:[credentials.authorizationId,claim.operationId]}:{sql:'',bindings:[]};
  const allowed=`generation=? AND lifecycle NOT IN ('revocation_pending','revocation_failed') AND ${authority.sql}${authorization.sql}`;
  const condition=[row.generation,...authority.bindings,...authorization.bindings];
  const expires=new Date(Date.now()+tokens.expires_in*1000).toISOString();
  try {
    await db.batch([providerBindingStatement(db,claim,tokens.user_id),db.prepare(`UPDATE lunchflow_connections SET
      provider_user_id=?,token_ciphertext=CASE WHEN ${allowed} THEN ? ELSE NULL END,
      token_iv=CASE WHEN ${allowed} THEN ? ELSE NULL END,access_expires_at=CASE WHEN ${allowed} THEN ? ELSE NULL END,
      credential_version=CASE WHEN ${allowed} THEN ? ELSE credential_version END,
      lifecycle=CASE WHEN ${allowed} THEN 'connected' WHEN lifecycle IN ('revocation_pending','revocation_failed') THEN lifecycle ELSE 'reconnect_required' END,
      operation_id=NULL,operation_kind=NULL,operation_expires_at=NULL,operation_uncertain=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND operation_id=?`).bind(tokens.user_id,...condition,sealed.ciphertext,...condition,sealed.iv,...condition,expires,...condition,version,...condition,row.id,claim.operationId)]);
  }catch{
    await finishConnectionFailure(db,claim,'provider_identity_conflict',false);return connectionError('provider_identity_conflict');
  }
  await assertFinancialAuthority(db,context,'connections:manage');
  const current=await readLunchFlowConnection(db,context,row.id);
  if(!current)return connectionError('reconnect_required');
  if(current.generation!==row.generation)return connectionError('reconnect_required');
  if(current.lifecycle!=='connected')return connectionError('reconnect_required');
  if(current.credential_version!==version)connectionError('reconnect_required');
}
