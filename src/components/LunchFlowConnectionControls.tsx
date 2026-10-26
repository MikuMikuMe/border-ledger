import {useEffect,useState} from 'react';
import {useConnectionAction} from './lunchflow-connection-hooks';
export {useLunchFlowConnection} from './lunchflow-connection-hooks';
import type {LedgerApi} from '../domain/api';
import {canAuthorizeConnection,canRemoveConnection,connectionMessage,disconnectExplanation,connectionIntent,type LunchFlowConnection} from '../domain/lunchflow-connection';
function authorizationTarget(value:string):string {
  let url:URL;try{url=new URL(value);}catch{throw new Error('The authorization address could not be verified.');}
  if(url.protocol!=='https:')throw new Error('The authorization address could not be verified.');
  if(url.hostname!=='www.lunchflow.app')throw new Error('The authorization address could not be verified.');
  if(url.username||url.password)throw new Error('The authorization address could not be verified.');
  return url.href;
}
function ConnectionButtons({value,busy,refresh,authorize,confirm}:{value:LunchFlowConnection|null;busy:boolean;refresh():Promise<void>;authorize():void;confirm(value:LunchFlowConnection):void}){
  return <div className="lunchflow-actions">
    <button className="outline-button" type="button" disabled={busy} onClick={()=>{void refresh();}}>Check connection status</button>
    {canAuthorizeConnection(value)?<button className="primary-button" type="button" disabled={busy} onClick={authorize}>{value?.reconnectRequired?'Reconnect Lunch Flow':'Connect Lunch Flow'}</button>:null}
    {canRemoveConnection(value)?<button className="outline-button" type="button" disabled={busy} onClick={()=>{if(value)confirm(value);}}>{value?.retryable?'Retry access removal':'Disconnect Lunch Flow'}</button>:null}
  </div>;
}
function DisconnectConfirmation({value,busy,cancel,confirm}:{value:LunchFlowConnection;busy:boolean;cancel():void;confirm():void}){
  return <div className="lunchflow-state"><div><p>{disconnectExplanation(value)}</p><div className="lunchflow-actions"><button className="outline-button" type="button" disabled={busy} onClick={cancel}>Keep connection</button><button className="primary-button" type="button" disabled={busy} onClick={confirm}>{busy?'Removing access…':'Confirm disconnect'}</button></div></div></div>;
}
async function authorizeConnection(api:LedgerApi,captured:LunchFlowConnection,mounted:{current:boolean}) {
  const result=await api<{authorizationUrl:string;connectionId:string}>('/api/lunchflow/oauth/start',{method:'POST'});
  if(!mounted.current)return;
  if(captured.connectionId&&result.connectionId!==captured.connectionId)throw new Error('Connection changed. Check status before trying again.');
  window.location.assign(authorizationTarget(result.authorizationUrl));
}
function connectionCopy(value:LunchFlowConnection|null,error:string|null) {
  if(error)return error;
  return value?connectionMessage(value):'Reading Lunch Flow connection status…';
}
export function LunchFlowConnectionControls({api,value,error,refresh}:{api:LedgerApi;value:LunchFlowConnection|null;error:string|null;refresh():Promise<void>}) {
  const [confirmation,setConfirmation]=useState<LunchFlowConnection|null>(null);
  const {busy,failure,run,mounted}=useConnectionAction(refresh);
  useEffect(()=>{setConfirmation(null);},[value?.connectionId,value?.generation]);
  function authorize(){
    const captured=value;if(!captured||!canAuthorizeConnection(captured))return;
    void run(()=>authorizeConnection(api,captured,mounted));
  }
  function disconnect(){
    if(!confirmation)return;const intent=connectionIntent(confirmation);
    void run(async()=>{await api('/api/lunchflow/disconnect',{method:'POST',body:JSON.stringify(intent)});if(mounted.current)setConfirmation(null);});
  }
  return <div className="lunchflow-connection-controls">
    <p role={error?'alert':'status'}>{connectionCopy(value,error)}</p>
    {failure?<p role="alert">{failure}</p>:null}
    <ConnectionButtons value={value} busy={busy} refresh={refresh} authorize={authorize} confirm={setConfirmation}/>
    {confirmation?<DisconnectConfirmation value={confirmation} busy={busy} cancel={()=>setConfirmation(null)} confirm={disconnect}/>:null}
  </div>;
}
