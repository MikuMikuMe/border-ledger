import {useCallback,useEffect,useRef,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import type {LunchFlowConnection} from '../domain/lunchflow-connection';
function message(cause:unknown){return cause instanceof Error?cause.message:'Lunch Flow could not complete the action. Check connection status before trying again.';}
function useMounted(){
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  return mounted;
}
function consumeReturnHint(){
  const url=new URL(window.location.href);
  if(!url.searchParams.has('lunchflow'))return;
  url.searchParams.delete('lunchflow');window.history.replaceState(null,'',url);
}
export function useLunchFlowConnection(api:LedgerApi) {
  const [connection,setConnection]=useState<LunchFlowConnection|null>(null),[error,setError]=useState<string|null>(null);
  const sequence=useRef(0),mounted=useMounted();
  const refresh=useCallback(async()=>{
    const request=++sequence.current;
    const current=()=>mounted.current&&sequence.current===request;
    try {
      const value=await api<LunchFlowConnection>('/api/lunchflow/connection');
      if(!value.userId||!value.ledgerId)throw new Error('Sign in again to read this connection.');
      if(current()){setConnection(value);setError(null);}
    }catch(cause){if(current()){setConnection(null);setError(message(cause));}}
  },[api,mounted]);
  useEffect(()=>{
    void refresh();consumeReturnHint();
    const focus=()=>{void refresh();};window.addEventListener('focus',focus);
    return()=>window.removeEventListener('focus',focus);
  },[refresh]);
  return {connection,error,refresh};
}
export function useConnectionAction(refresh:()=>Promise<void>){
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<string|null>(null),running=useRef(false),mounted=useMounted();
  async function run(action:()=>Promise<void>){
    if(running.current)return;running.current=true;setBusy(true);setFailure(null);
    try{await action();}catch(cause){if(mounted.current)setFailure(message(cause));}
    finally{running.current=false;if(mounted.current){setBusy(false);await refresh();}}
  }
  return {busy,failure,run,mounted};
}
