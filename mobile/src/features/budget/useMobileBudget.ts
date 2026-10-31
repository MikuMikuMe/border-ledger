import {decodeBudgetView} from './decodeBudget';
import {useCallback,useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {AppState} from 'react-native';
import NativeBudget from '../../native/specs/NativeBudget';
import NativeSession from '../../native/specs/NativeSession';
import NativePreferences from '../../native/specs/NativePreferences';
import {MutationGate} from '../finance/model';
import {getCurrencyMeta} from '../../../../src/domain/currencies';
import type {BudgetData} from './BudgetContent';

let sequence=0;
function operationId(){return `budget_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;}
function monthIn(timeZone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}`;}
function decodeSettings(value:string):{currency:string}|null {
  const data=JSON.parse(value) as {settings?:{currency?:unknown}|null};
  if(data.settings===null) return null;
  if(typeof data.settings?.currency!=='string') throw new Error('Invalid budget settings');
  if(!getCurrencyMeta(data.settings.currency)) throw new Error('Invalid budget settings');
  return {currency:data.settings.currency};
}
export function useMobileBudget() {
  const [,render]=useReducer(n=>n+1,0),gate=useMemo(()=>new MutationGate(render),[]),request=useRef(0),monthTouched=useRef(false);
  const [month,setMonth]=useState(()=>monthIn('America/Toronto')),[draftMonth,setDraftMonth]=useState(month),[currency,setCurrency]=useState('CAD'),[view,setView]=useState<BudgetData|null>(null),[configured,setConfigured]=useState<boolean|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const recover=useCallback(()=>gate.recover((offset,limit)=>NativeSession.readOperations({offset,limit})),[gate]);
  const load=useCallback(async()=>{const id=++request.current;setLoading(true);try {const settings=decodeSettings(await NativeBudget.readSettings());const next=settings?decodeBudgetView(await NativeBudget.readView(month)):null;if(id!==request.current)return;setConfigured(Boolean(settings));setView(next);if(settings)setCurrency(settings.currency);setError(null);}catch{if(id===request.current){setView(null);setError('Could not load your budget. Refresh and try again.');}}finally{if(id===request.current)setLoading(false);}},[month]);
  useEffect(()=>{void NativePreferences.readReporting().then(p=>{if(!monthTouched.current){const value=monthIn(p.reportingTimezone);setMonth(value);setDraftMonth(value);}}).catch(()=>undefined);},[]);
  useEffect(()=>{void recover();void load();const subscription=AppState.addEventListener('change',state=>{if(state==='active'){void recover();void load();}});return()=>{request.current++;subscription.remove();};},[load,recover]);
  const selectMonth=()=>{monthTouched.current=true;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(draftMonth)){setError('Enter a valid month, for example 2026-10.');return;}setMonth(draftMonth);};
  const write=(action:string,build:(id:string)=>unknown)=>{if(gate.current().blocked)return;const id=operationId();let body:string;try{body=JSON.stringify(build(id));}catch{setError('Check the amount and details, then try again.');return;}setError(null);void gate.submit(id,()=>NativeBudget.startWrite(id,action,body),key=>NativeSession.queryOperation({operationId:key})).then(()=>{if(gate.current().status==='completed')void load();});};
  return {month,draftMonth,setDraftMonth,currency,setCurrency,view,configured,error,loading,mutation:gate.current(),recover,selectMonth,write};
}
