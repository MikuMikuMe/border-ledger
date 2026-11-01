import {useCallback,useEffect,useRef,useState} from 'react';
import {LedgerApiError,type LedgerApi} from '../domain/api';
import type {BudgetMode,BudgetSnapshot,BudgetViewData,TrackingViewData} from './BudgetTypes';

async function readBudget(api:LedgerApi,month:string) {
 const snapshot=await api<BudgetSnapshot>('/api/budget');
 const mode=snapshot.settings?.preferredMode??'envelope';
 const data=snapshot.settings?await api<BudgetViewData|TrackingViewData>(`/api/budget/view?month=${encodeURIComponent(month)}&mode=${mode}`):null;
 return {snapshot,data};
}
function useBudgetWrites(api:LedgerApi,load:()=>Promise<void>,revision:number,setError:(error:string|null)=>void) {
 const [busy,setBusy]=useState(false),operations=useRef(new Map<string,string>()),latestLoad=useRef(load);
 latestLoad.current=load;
 async function mutate(path:string,init:RequestInit) {
  setBusy(true);setError(null);
  try{await api(`/api/budget/${path}`,init);await latestLoad.current();}
  catch(cause){
   if(cause instanceof LedgerApiError && cause.status===409){
    await latestLoad.current();setError('The budget changed elsewhere. Your draft is kept. Review the refreshed values and preview again before saving.');
   }else setError('Could not save. Your draft is kept. Check your connection and details, then try again.');
   throw cause;
  }finally{setBusy(false);}
 }
 const save=(path:string,value:unknown)=>mutate(path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 async function guardedSave(path:string,value:Record<string,unknown>,expectedRevision=revision) {
  const payload={...value,expectedRevision},key=JSON.stringify({path,payload});
  const operationId=operations.current.get(key)??crypto.randomUUID();operations.current.set(key,operationId);
  await save(path,{...payload,operationId});operations.current.delete(key);
 }
 const changeMode=(mode:BudgetMode)=>guardedSave('mode',{mode});
 const preview=<T,>(path:string)=>api<T>(`/api/budget/${path}`);
 const remove=(id:string)=>mutate(`cash/${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>undefined);
 return {busy,save,guardedSave,changeMode,preview,remove};
}
export function useBudget(api:LedgerApi,initialMonth:string) {
 const [month,setMonth]=useState(initialMonth),[currency,setCurrency]=useState('CAD');
 const [snapshot,setSnapshot]=useState<BudgetSnapshot|null>(null),[data,setData]=useState<BudgetViewData|TrackingViewData|null>(null);
 const [error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),sequence=useRef(0);
 const load=useCallback(async()=>{
  const current=++sequence.current;setLoading(true);
  try {
   const result=await readBudget(api,month);
   if(current!==sequence.current)return;
   setSnapshot(result.snapshot);setData(result.data);if(result.snapshot.settings)setCurrency(result.snapshot.settings.currency);setError(null);
  }catch{if(current===sequence.current){setSnapshot(null);setData(null);setError('Could not load the budget. Check your connection and try again.');}}
  finally{if(current===sequence.current)setLoading(false);}
 },[api,month]);
 useEffect(()=>{void load();return ()=>{sequence.current++;};},[load]);
 const writes=useBudgetWrites(api,load,data?.settings.revision??snapshot?.settings?.revision??0,setError);
 return {month,setMonth,currency,setCurrency,snapshot,data,mode:snapshot?.settings?.preferredMode??'envelope',error,setError,loading,...writes};
}
