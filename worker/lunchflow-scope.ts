import type { D1Database } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { connectionError, assertConnectionIdle, readLunchFlowConnection } from './lunchflow-connection-store';
import type { LedgerContext } from './tenant-context';
export interface LunchFlowConnectionBinding { id:string; generation:number; adapter:'personal'|'platform' }
export type LunchFlowScope=FinancialContext & {connection:Readonly<LunchFlowConnectionBinding>};
export type LunchFlowBinding=FinancialContext & {connection?:Readonly<LunchFlowConnectionBinding>};
export const PERSONAL_CONNECTION_ID='lunchflow-personal-owner';
export function connectionBinding(context:LedgerContext & {connection?:Readonly<LunchFlowConnectionBinding>}):Readonly<LunchFlowConnectionBinding> {
  if(context.connection)return context.connection;
  if(context.userId==='owner'&&context.ledgerId==='personal')return {id:PERSONAL_CONNECTION_ID,generation:1,adapter:'personal'};
  return connectionError('connection_required',400);
}
export async function resolveLunchFlowScope(db:D1Database,context:LunchFlowBinding,id?:string,expectedGeneration?:number):Promise<LunchFlowScope|null> {
  await assertFinancialAuthority(db,context,'connections:manage');
  const requested=id??context.connection?.id??(context.userId==='owner'&&context.ledgerId==='personal'?PERSONAL_CONNECTION_ID:undefined);
  if(!requested)return null;
  const row=await readLunchFlowConnection(db,context,requested);
  if(!row)return connectionError('connection_not_found',404);
  if(expectedGeneration!==undefined&&row.generation!==expectedGeneration)return connectionError('connection_generation_conflict');
  const binding=context.connection??{id:row.id,generation:expectedGeneration??row.generation,adapter:row.adapter};
  return Object.freeze({...immutableFinancialContext(context),connection:Object.freeze({...binding})});
}
export function lunchFlowScopePredicate(context:LunchFlowBinding) {
  const authority=financialAuthorityPredicate(context,'connections:manage'),binding=connectionBinding(context);
  return {sql:`${authority.sql} AND EXISTS (SELECT 1 FROM lunchflow_connections active_connection
    WHERE active_connection.id=? AND active_connection.user_id=? AND active_connection.ledger_id=?
    AND active_connection.adapter=? AND active_connection.generation=? AND active_connection.lifecycle='connected'
    AND active_connection.operation_id IS NULL)`,bindings:[...authority.bindings,binding.id,context.userId,context.ledgerId,binding.adapter,binding.generation]};
}
export async function assertLunchFlowScope(db:D1Database,context:LunchFlowBinding) {
  await assertFinancialAuthority(db,context,'connections:manage');
  const fence=lunchFlowScopePredicate(context);
  if(await db.prepare(`SELECT 1 WHERE ${fence.sql}`).bind(...fence.bindings).first())return;
  const row=await readLunchFlowConnection(db,context,connectionBinding(context).id);
  if(row&&row.generation!==connectionBinding(context).generation)return connectionError('connection_generation_conflict');
  if(row)assertConnectionIdle(row);
  connectionError('reconnect_required');
}
export function lunchFlowIdentity(context:LedgerContext & {connection?:Readonly<LunchFlowConnectionBinding>},value:string) {
  const binding=connectionBinding(context);
  return binding.adapter==='personal'?value:JSON.stringify([binding.id,value]);
}
