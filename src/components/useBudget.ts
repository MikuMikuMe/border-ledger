import {useCallback,useEffect,useRef,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import type {BudgetSnapshot,BudgetViewData} from './BudgetView';

export function useBudget(api:LedgerApi,initialMonth:string) {
  const [month,setMonth]=useState(initialMonth),[currency,setCurrency]=useState('CAD'),[snapshot,setSnapshot]=useState<BudgetSnapshot|null>(null),[data,setData]=useState<BudgetViewData|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const sequence=useRef(0);
  const load=useCallback(async()=>{
    const current=++sequence.current;setLoading(true);
    try {
      const state=await api<BudgetSnapshot>('/api/budget');
      const view=state.settings?await api<BudgetViewData>(`/api/budget/view?month=${encodeURIComponent(month)}`):null;
      if(current!==sequence.current) return;
      setSnapshot(state);setData(view);if(state.settings)setCurrency(state.settings.currency);setError(null);
    } catch {if(current===sequence.current)setError('Could not load the budget. Check your connection and try again.');}
    finally {if(current===sequence.current)setLoading(false);}
  },[api,month]);
  useEffect(()=>{void load();return ()=>{sequence.current++;};},[load]);
  async function mutate(path:string,init:RequestInit) {
    setBusy(true);setError(null);
    try{await api(`/api/budget/${path}`,init);await load();}
    catch{setError('Could not save. Check the details and try again.');throw new Error('Save failed');}
    finally{setBusy(false);}
  }
  const save=(path:string,value:unknown)=>mutate(path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const remove=(id:string)=>mutate(`cash/${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>undefined);
  return {month,setMonth,currency,setCurrency,snapshot,data,error,setError,busy,loading,save,remove};
}
