import type { FinancialContext } from './financial-authority';
import type { LunchFlowConnection } from './lunchflow-connection-store';
export function revocationPending(row:LunchFlowConnection) { return ['revocation_pending','revocation_failed'].includes(row.lifecycle); }
export function operationUncertain(row:LunchFlowConnection) { return Boolean(row.operation_id && (row.operation_uncertain||row.operation_expired)); }
function remoteRevocation(row:LunchFlowConnection) {
  if(operationUncertain(row)&&revocationPending(row))return 'uncertain' as const;
  if(row.lifecycle==='revoked')return 'succeeded' as const;
  if(row.lifecycle==='revocation_failed')return 'failed' as const;
  if(row.lifecycle==='revocation_pending')return 'pending' as const;
  return 'not_requested' as const;
}
function connectionReason(row:LunchFlowConnection,configured:boolean) {
  if(operationUncertain(row))return 'operation_uncertain';
  if(row.operation_id)return 'operation_in_progress';
  if(!configured)return 'configuration_required';
  return row.lifecycle;
}
function initialStatus(context:FinancialContext,configured:boolean) {
  return {userId:context.userId,ledgerId:context.ledgerId,connectionId:null as string|null,adapter:'platform' as 'personal'|'platform',configured,
    connected:false,reconnectRequired:false,canReconnect:configured,remoteRevocation:'not_requested' as 'not_requested'|'uncertain'|'pending'|'failed'|'succeeded',
    reason:configured?'disconnected':'configuration_required',generation:null as number|null,retryable:false};
}
function canReconnect(row:LunchFlowConnection,configured:boolean) {
  if(!configured)return false;
  if(row.operation_id)return false;
  return !revocationPending(row);
}
function isConnected(row:LunchFlowConnection,configured:boolean) {
  if(!configured)return false;
  if(row.lifecycle!=='connected')return false;
  return !operationUncertain(row);
}
export function lunchFlowConnectionStatus(context:FinancialContext,row:LunchFlowConnection|null,configured:boolean) {
  const initial=initialStatus(context,configured);
  if(!row)return initial;
  if(row.adapter==='personal')return {...initial,connectionId:row.id,adapter:row.adapter,generation:row.generation,connected:configured&&row.lifecycle==='connected',canReconnect:false,reason:row.lifecycle==='connected'?'legacy_cutover_required':'personal_disconnected'};
  return {...initial,connectionId:row.id,adapter:row.adapter,connected:isConnected(row,configured),reconnectRequired:row.lifecycle==='reconnect_required',
    canReconnect:canReconnect(row,configured),remoteRevocation:remoteRevocation(row),reason:connectionReason(row,configured),generation:row.generation,
    retryable:revocationPending(row)&&!row.operation_id};
}
