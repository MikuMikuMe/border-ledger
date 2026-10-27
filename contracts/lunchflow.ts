export interface LunchFlowConnection {
  userId:string; ledgerId:string; connectionId:string|null; generation:number|null;
  adapter:'personal'|'platform'; configured:boolean; connected:boolean; reconnectRequired:boolean;
  canReconnect:boolean; remoteRevocation:'not_requested'|'pending'|'failed'|'uncertain'|'succeeded'; reason:string; retryable:boolean;
}
const blockedMessages:Record<string,string>={
  application_configuration_changed:'The connection configuration changed. Ask the operator to restore it.',
  operation_uncertain:'Sync is stopped. The outcome at Lunch Flow is uncertain; contact the operator before reconnecting.',
  operation_in_progress:'Lunch Flow is completing another operation. Check connection status again shortly.',
};
const removalMessages:Record<string,string>={
  uncertain:blockedMessages.operation_uncertain,
  failed:'Sync is stopped locally, but Lunch Flow access removal failed. Retry removal when available.',
  pending:'Sync is stopped locally. Removal of this application’s Lunch Flow access is pending.',
};
export function connectionMessage(value:LunchFlowConnection):string {
  if(blockedMessages[value.reason])return blockedMessages[value.reason];
  if(removalMessages[value.remoteRevocation])return removalMessages[value.remoteRevocation];
  if(!value.configured)return 'Lunch Flow is not configured. Ask the operator to finish connection setup.';
  if(value.connected)return 'Connected. Only the accounts you select will sync into this ledger.';
  if(value.adapter==='personal')return 'This Personal feed is disconnected. Restoring access requires the operator.';
  if(value.reconnectRequired)return 'Lunch Flow needs authorization again. Imported history stays in the ledger.';
  return 'Lunch Flow is disconnected. Imported history stays in the ledger.';
}
export function canAuthorizeConnection(value:LunchFlowConnection|null|undefined):boolean {
  if(!value?.configured)return false;
  if(value.adapter!=='platform')return false;
  if(value.connected)return false;
  return value.canReconnect;
}
export function canRemoveConnection(value:LunchFlowConnection|null|undefined):boolean {
  if(!value?.connectionId)return false;
  return value.connected||value.retryable;
}
export function disconnectExplanation(value:LunchFlowConnection):string {
  return value.adapter==='personal'
    ? 'Disconnect stops future sync. Imported history stays in the ledger. Restoring this Personal feed requires the operator. Remove its REST API destination in Lunch Flow to stop provider-side access.'
    : 'Disconnect stops future sync and asks Lunch Flow to remove this application’s access and tokens for your Lunch Flow user, across its bank feeds. Imported history stays in the ledger. Your bank and Lunch Flow login are not deleted.';
}
export function connectionIntent(value:LunchFlowConnection) {
  if(!value.connectionId)throw new Error('Refresh Lunch Flow connection status before continuing.');
  if(value.generation===null||!Number.isSafeInteger(value.generation))throw new Error('Refresh Lunch Flow connection status before continuing.');
  if(value.generation<1)throw new Error('Refresh Lunch Flow connection status before continuing.');
  return {connectionId:value.connectionId,expectedGeneration:value.generation!};
}
