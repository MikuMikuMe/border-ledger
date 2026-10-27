import React,{useEffect,useState} from 'react';
import {Action,Copy} from '../finance/FinanceViews';
import {canAuthorizeConnection,canRemoveConnection,connectionMessage,disconnectExplanation,connectionIntent,type LunchFlowConnection} from '../../../../contracts/lunchflow';
import type {LunchFlowBinding} from './contracts';
export type LunchFlowActions={message:string|null;authorize():void;cancel():void;disconnect(binding:LunchFlowBinding):void};
type Props={dark:boolean;value:LunchFlowConnection;disabled:boolean;actions:LunchFlowActions};
function ConnectionActions({dark,value,disabled,actions,confirm}:Props&{confirm(value:LunchFlowConnection):void}){
  return <>
    {canAuthorizeConnection(value)?<Action dark={dark} label={value.reconnectRequired?'Reconnect Lunch Flow':'Connect Lunch Flow'} disabled={disabled} onPress={actions.authorize}/>:null}
    {canRemoveConnection(value)?<Action dark={dark} label={value.retryable?'Retry Lunch Flow access removal':'Disconnect Lunch Flow'} disabled={disabled} onPress={()=>confirm(value)}/>:null}
    {value.adapter==='platform'?<Action dark={dark} label="Cancel Lunch Flow browser handoff" disabled={disabled} onPress={actions.cancel}/>:null}
  </>;
}
function Confirmation({dark,value,disabled,actions,close}:Props&{close():void}){
  return <><Copy dark={dark}>{disconnectExplanation(value)}</Copy><Action dark={dark} label="Confirm Lunch Flow disconnect" disabled={disabled} onPress={()=>{actions.disconnect(connectionIntent(value));close();}}/><Action dark={dark} label="Keep Lunch Flow connection" onPress={close}/></>;
}
export function LunchFlowControls({dark,value,disabled,actions}:Omit<Props,'value'>&{value:LunchFlowConnection|undefined}) {
  const [confirmation,setConfirmation]=useState<LunchFlowConnection|null>(null);
  useEffect(()=>setConfirmation(null),[value?.connectionId,value?.generation]);
  if(!value)return <Copy dark={dark}>Check bank status to read your Lunch Flow connection.</Copy>;
  return <>
    <Copy dark={dark}>{connectionMessage(value)}</Copy>
    {actions.message?<Copy dark={dark} error>{actions.message}</Copy>:null}
    <ConnectionActions dark={dark} value={value} disabled={disabled} actions={actions} confirm={setConfirmation}/>
    {confirmation?<Confirmation dark={dark} value={confirmation} disabled={disabled} actions={actions} close={()=>setConfirmation(null)}/>:null}
  </>;
}
