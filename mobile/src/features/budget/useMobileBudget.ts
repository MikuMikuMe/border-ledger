import {decodeBudgetView,decodeCopyPreview,decodeRolloverPreview} from './decodeBudget';
import {useCallback,useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {AppState} from 'react-native';
import NativePreferences from '../../native/specs/NativePreferences';
import {MutationGate} from '../finance/model';
import {getCurrencyMeta} from '../../../../src/domain/currencies';
import {nativeBudgetService,type BudgetService} from './budgetService';
import type {BudgetMode,CopyPreview,RolloverPolicy,RolloverPreview} from './budgetTracking';

const MONTH_ERROR='Enter a valid month, for example 2026-10.';
let sequence=0;
function operationId(){return `budget_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;}
function monthIn(timeZone:string){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}`;}
function budgetMode(value:unknown):BudgetMode {if(value===undefined)return 'envelope';if(value==='envelope'||value==='tracking')return value;throw new Error('Invalid budget mode');}
function budgetRevision(value:unknown):number {if(value===undefined)return 0;if(typeof value!=='number')throw new Error('Invalid budget revision');if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid budget revision');return value;}
async function refreshWriteResult(status:string,load:()=>Promise<void>,setError:(value:string)=>void) {
 if(!['completed','revision_conflict','rejected'].includes(status))return;
 await load();if(status==='completed')return;
 setError(status==='revision_conflict'?'Budget changed. Review the refreshed amounts and preview again before saving.':'The change was rejected. Check the details and try again.');
}
function decodeSettings(value:string):{currency:string;preferredMode:BudgetMode;revision:number}|null {
 const data=JSON.parse(value) as {settings?:{currency?:unknown;preferredMode?:unknown;revision?:unknown}|null};
 if(data.settings===null) return null;
 if(typeof data.settings?.currency!=='string'||!getCurrencyMeta(data.settings.currency)) throw new Error('Invalid budget settings');
 return {currency:data.settings.currency,preferredMode:budgetMode(data.settings.preferredMode),revision:budgetRevision(data.settings.revision)};
}
export function useMobileBudget(service:BudgetService=nativeBudgetService) {
 const [,render]=useReducer(n=>n+1,0),gate=useMemo(()=>new MutationGate(render),[]),request=useRef(0),previewRequest=useRef(0),monthTouched=useRef(false);
 const [month,setMonth]=useState(()=>monthIn('America/Toronto')),[draftMonth,setDraftMonth]=useState(month),[currency,setCurrency]=useState('CAD'),[mode,setMode]=useState<BudgetMode>('envelope'),[view,setView]=useState<ReturnType<typeof decodeBudgetView>|null>(null),[configured,setConfigured]=useState<boolean|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const [monthError,setMonthError]=useState<string|null>(null);
 const [copyPreview,setCopyPreview]=useState<CopyPreview|null>(null),[rolloverPreview,setRolloverPreview]=useState<RolloverPreview|null>(null),[previewLoading,setPreviewLoading]=useState(false);
 const recover=useCallback(async()=>{await gate.recover(service.readOperations);if(!gate.current().blocked){setCopyPreview(null);setRolloverPreview(null);}},[gate,service]);
 const load=useCallback(async()=>{
  const id=++request.current;previewRequest.current++;setLoading(true);setCopyPreview(null);setRolloverPreview(null);setPreviewLoading(false);
  try {const settings=decodeSettings(await service.readSettings());const next=settings?decodeBudgetView(await service.readModeView(month,settings.preferredMode)):null;if(id!==request.current)return;setConfigured(Boolean(settings));setView(next);if(settings){setCurrency(settings.currency);setMode(settings.preferredMode);}setError(null);}
  catch{if(id===request.current){setView(null);setError('Could not load your budget. Refresh and try again.');}}
  finally{if(id===request.current)setLoading(false);}
 },[month,service]);
 useEffect(()=>{void NativePreferences.readReporting().then(p=>{if(!monthTouched.current){const value=monthIn(p.reportingTimezone);setMonth(value);setDraftMonth(value);}}).catch(()=>undefined);},[]);
 useEffect(()=>{void recover();void load();const subscription=AppState.addEventListener('change',state=>{if(state==='active'){void recover();void load();}});return()=>{request.current++;previewRequest.current++;subscription.remove();};},[load,recover]);
 const chooseMonth=(next:string)=>{monthTouched.current=true;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)){setMonthError(MONTH_ERROR);return;}setMonthError(null);setDraftMonth(next);if(next===month)return;request.current++;previewRequest.current++;setCopyPreview(null);setRolloverPreview(null);setPreviewLoading(false);setMonth(next);};
 const selectMonth=()=>chooseMonth(draftMonth);
 const shiftMonth=(delta:-1|1)=>{const [year,part]=month.split('-').map(Number),index=year*12+part-1+delta,nextYear=Math.floor(index/12);if(nextYear<1||nextYear>9999)return;chooseMonth(`${String(nextYear).padStart(4,'0')}-${String(index%12+1).padStart(2,'0')}`);};
 const write=(action:string,build:(id:string)=>unknown)=>{
  if(gate.current().blocked)return;const id=operationId();let body:string;
  try{body=JSON.stringify(build(id));}catch{setError('Check the amount and details, then try again.');return;}
  request.current++;previewRequest.current++;setError(null);
  void gate.submit(id,()=>service.startWrite(id,action,body),service.queryOperation).then(()=>{const status=gate.current().status;if(status==='canceled'||status==='failed_local'){setCopyPreview(null);setRolloverPreview(null);}return refreshWriteResult(status,load,setError);});
 };
 const preview=async(kind:'copy'|'rollover',read:()=>Promise<string>)=>{
  const id=++previewRequest.current;setPreviewLoading(true);setError(null);setCopyPreview(null);setRolloverPreview(null);
  try{const value=await read();if(id!==previewRequest.current)return;if(kind==='copy')setCopyPreview(decodeCopyPreview(value));else setRolloverPreview(decodeRolloverPreview(value));}
  catch{if(id===previewRequest.current)setError('Could not preview this change. Refresh and try again.');}
  finally{if(id===previewRequest.current)setPreviewLoading(false);}
 };
 const selectMode=(next:BudgetMode)=>{if(next===mode||!view)return;write('mode',id=>({mode:next,expectedRevision:view.settings.revision??0,operationId:id}));};
 return {month,draftMonth,setDraftMonth,currency,setCurrency,mode,selectMode,view,configured,error:monthError??error,loading,mutation:gate.current(),recover,load,selectMonth,chooseMonth,shiftMonth,write,copyPreview,rolloverPreview,previewLoading,
  previewCopy:()=>void preview('copy',()=>service.readCopyPreview(month)),
  previewRollover:(category:string,effectiveMonth:string,policy:RolloverPolicy)=>void preview('rollover',()=>service.readRolloverPreview(category,effectiveMonth,policy)),
  cancelPreview:()=>{previewRequest.current++;setCopyPreview(null);setRolloverPreview(null);setPreviewLoading(false);},
 };
}
