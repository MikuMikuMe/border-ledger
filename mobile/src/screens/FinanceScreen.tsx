import React,{useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {AppState,Text,View} from 'react-native';
import NativeLedger from '../native/specs/NativeLedger';
import NativeRecurring from '../native/specs/NativeRecurring';
import NativePreferences from '../native/specs/NativePreferences';
import NativeReview from '../native/specs/NativeReview';
import NativeSession from '../native/specs/NativeSession';
import {FinanceController,type FinancePorts} from '../features/finance/FinanceController';
import {Action,ActivityView,OverviewView,RecurringView} from '../features/finance/FinanceViews';
import {recurringCurrencies} from '../features/finance/model';
import type {Transaction,Stream} from '../features/finance/contracts';

const ports:FinancePorts={ledger:NativeLedger,recurring:NativeRecurring,preferences:NativePreferences,review:NativeReview,session:NativeSession};
let operationSequence=0;
const operationId=()=>`mobile_${Date.now().toString(36)}_${(++operationSequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;
export function FinanceScreen({dark,destination,onOpenRecurring}: {dark:boolean;destination:'overview'|'activity'|'recurring';onOpenRecurring?(id:string):void}) {
  const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new FinanceController(ports,render),[]);
  const [selected,setSelected]=useState<Transaction|null>(null),[stream,setStream]=useState<Stream|null>(null),[draft,setDraft]=useState({category:'',note:''});
  const currentDestination=useRef(destination);currentDestination.current=destination;
  useEffect(()=>{
    void controller.start();
    const resume=AppState.addEventListener('change',state=>{if(state==='active'){if(controller.mutation.current().status!=='saving')void controller.recover();void controller.reload(false);if(currentDestination.current==='recurring')void controller.loadRecurring();}});
    return ()=>{resume.remove();controller.dispose();};
  // The controller is scoped to this signed-in shell; the destination is handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[controller]);
  useEffect(()=>{setSelected(null);setStream(null);if(destination==='recurring')void controller.loadRecurring();},[controller,destination]);
  const snapshot=controller.snapshot.current(),mutation=controller.mutation.current();
  const currencies=[...new Set([...(snapshot.data?.accounts.flatMap(a=>a.currencies)??[]),...(snapshot.data?.transactions.map(t=>t.currency)??[]),...(controller.report.current().data?.currencyTotals.map(t=>t.currency)??[])])].sort();
  return <View>
    {snapshot.message?<Text accessibilityLiveRegion="polite" style={{color:dark?'#FFB4AB':'#A83F3F',fontSize:15}}>{snapshot.message}</Text>:null}
    {destination==='overview'?<OverviewView dark={dark} state={controller.report.current()} snapshot={snapshot.data} lens={controller.lens} currencies={currencies} onLens={lens=>{void controller.setLens(lens);}} onRetry={()=>{void controller.reload();}}/>:null}
    {destination==='activity'?<ActivityView dark={dark} state={controller.activity.current()} facetRows={controller.activityFacetRows} filters={controller.activityFilters} selected={selected} draft={draft} mutation={mutation} onRetry={()=>{void controller.loadActivity();}} onFilter={filters=>{void controller.filterActivity(filters);}} onOpen={id=>{const t=controller.activity.current().data?.items.find(r=>r.id===id);if(t){setSelected(t);setDraft({category:t.category??'',note:t.note??''});void controller.recover();}}} onLoadMore={()=>{void controller.loadActivity(true);}} onClose={()=>setSelected(null)} onDraft={setDraft} onSave={()=>{if(selected)void controller.annotate(operationId(),selected,draft).then(()=>{if(controller.mutation.current().status==='completed')setSelected(null);});}}/>:null}
    {destination==='recurring'?<RecurringView dark={dark} state={controller.recurring.current()} filters={controller.recurringFilters} currencies={recurringCurrencies} selected={stream} mutation={mutation} onRetry={()=>{void controller.loadRecurring();}} onFilter={filters=>{void controller.filterRecurring(filters);}} onOpen={id=>{if(onOpenRecurring){onOpenRecurring(id);return;}const data=controller.recurring.current().data;const selectedStream=[...(data?.page.items??[]),...(data?.summary?.upcoming.map(u=>u.stream)??[]),...(data?.summary?.latestPaymentChanges??[])].find(s=>s.id===id);setStream(selectedStream??null);void controller.recover();}} onLoadMore={()=>{void controller.loadRecurring(true);}} onClose={()=>setStream(null)} onClassify={classification=>{if(stream)void controller.classify(operationId(),stream,classification).then(()=>{if(controller.mutation.current().status==='completed')setStream(null);});}}/>:null}
    {mutation.blocked&&mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>{void controller.recover();}}/>:null}
  </View>;
}
