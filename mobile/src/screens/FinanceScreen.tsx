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

const ports:FinancePorts={
 ledger:NativeLedger,
 recurring:{
  readPage:NativeRecurring.readPage,
  readSummary:(startDate,endDate)=>NativeRecurring.readSummary({startDate,endDate}),
  startClassify:(operationId,id,expectedRevision,classification)=>NativeRecurring.startClassify({operationId,id,expectedRevision,classification}),
  onChanged:NativeRecurring.onChanged,
 },
 preferences:{readReporting:NativePreferences.readReporting},
 review:{startAnnotate:(operationId,value)=>NativeReview.startAnnotate({operationId,value})},
 session:{
  readOperations:(offset,limit)=>NativeSession.readOperations({offset,limit}),
  queryOperation:operationId=>NativeSession.queryOperation({operationId}),
 },
};
let operationSequence=0;
const operationId=()=>`mobile_${Date.now().toString(36)}_${(++operationSequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;

type FinanceDestination='overview'|'activity'|'recurring';
type FinanceControllerInstance=FinanceController;

function currencyOptions(controller:FinanceControllerInstance):string[] {
  const snapshot=controller.snapshot.current();
  return [...new Set([
    ...(snapshot.data?.accounts.flatMap(a=>a.currencies)??[]),
    ...(snapshot.data?.transactions.map(t=>t.currency)??[]),
    ...(controller.report.current().data?.currencyTotals.map(t=>t.currency)??[]),
  ])].sort();
}

function OverviewPanel({dark,controller,currencies}:{dark:boolean;controller:FinanceControllerInstance;currencies:string[]}) {
  return <OverviewView dark={dark} state={controller.report.current()} snapshot={controller.snapshot.current().data} lens={controller.lens} currencies={currencies} onLens={lens=>{void controller.setLens(lens);}} onRetry={()=>{void controller.reload();}}/>;
}

function ActivityPanel({dark,controller,selected,draft,setSelected,setDraft}:{dark:boolean;controller:FinanceControllerInstance;selected:Transaction|null;draft:{category:string;note:string};setSelected(value:Transaction|null):void;setDraft(value:{category:string;note:string}):void}) {
  const openTransaction=(id:string)=>{
    const transaction=controller.activity.current().data?.items.find(row=>row.id===id);
    if(!transaction)return;
    setSelected(transaction);
    setDraft({category:transaction.category??'',note:transaction.note??''});
    void controller.recover();
  };
  const saveTransaction=()=>{
    if(!selected)return;
    void controller.annotate(operationId(),selected,draft).then(()=>{
      if(controller.mutation.current().status==='completed')setSelected(null);
    });
  };
  return <ActivityView dark={dark} state={controller.activity.current()} facetRows={controller.activityFacetRows} filters={controller.activityFilters} selected={selected} draft={draft} mutation={controller.mutation.current()}
    onRetry={()=>{void controller.loadActivity();}} onFilter={filters=>{void controller.filterActivity(filters);}} onOpen={openTransaction}
    onLoadMore={()=>{void controller.loadActivity(true);}} onClose={()=>setSelected(null)} onDraft={setDraft} onSave={saveTransaction}/>;
}

function openRecurringStream(controller:FinanceControllerInstance,id:string,onOpenRecurring:((id:string)=>void)|undefined,setStream:(value:Stream|null)=>void):void {
  if(onOpenRecurring){onOpenRecurring(id);return;}
  const data=controller.recurring.current().data;
  const selected=[...(data?.page.items??[]),...(data?.summary?.upcoming.map(u=>u.stream)??[]),...(data?.summary?.latestPaymentChanges??[])].find(item=>item.id===id);
  setStream(selected??null);
  void controller.recover();
}

function classifyRecurringStream(controller:FinanceControllerInstance,stream:Stream|null,classification:string,setStream:(value:Stream|null)=>void):void {
  if(!stream)return;
  void controller.classify(operationId(),stream,classification).then(()=>{
    if(controller.mutation.current().status==='completed')setStream(null);
  });
}

function RecurringPanel({dark,controller,stream,setStream,onOpenRecurring}:{dark:boolean;controller:FinanceControllerInstance;stream:Stream|null;setStream(value:Stream|null):void;onOpenRecurring?(id:string):void}) {
  return <RecurringView dark={dark} state={controller.recurring.current()} filters={controller.recurringFilters} currencies={recurringCurrencies} selected={stream} mutation={controller.mutation.current()}
    onRetry={()=>{void controller.loadRecurring();}} onFilter={filters=>{void controller.filterRecurring(filters);}} onOpen={id=>openRecurringStream(controller,id,onOpenRecurring,setStream)}
    onLoadMore={()=>{void controller.loadRecurring(true);}} onClose={()=>setStream(null)} onClassify={classification=>classifyRecurringStream(controller,stream,classification,setStream)}/>;
}

function FinanceDestination({dark,destination,controller,currencies,selected,stream,draft,setSelected,setStream,setDraft,onOpenRecurring}:{dark:boolean;destination:FinanceDestination;controller:FinanceControllerInstance;currencies:string[];selected:Transaction|null;stream:Stream|null;draft:{category:string;note:string};setSelected(value:Transaction|null):void;setStream(value:Stream|null):void;setDraft(value:{category:string;note:string}):void;onOpenRecurring?(id:string):void}) {
  if(destination==='overview')return <OverviewPanel dark={dark} controller={controller} currencies={currencies}/>;
  if(destination==='activity')return <ActivityPanel dark={dark} controller={controller} selected={selected} draft={draft} setSelected={setSelected} setDraft={setDraft}/>;
  return <RecurringPanel dark={dark} controller={controller} stream={stream} setStream={setStream} onOpenRecurring={onOpenRecurring}/>;
}
export function FinanceScreen({dark,destination,onOpenRecurring}: {dark:boolean;destination:FinanceDestination;onOpenRecurring?(id:string):void}) {
  const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new FinanceController(ports,render),[]);
  const [selected,setSelected]=useState<Transaction|null>(null),[stream,setStream]=useState<Stream|null>(null),[draft,setDraft]=useState({category:'',note:''});
  const currentDestination=useRef(destination);currentDestination.current=destination;
  useEffect(()=>{
    void controller.start();
    const resume=AppState.addEventListener('change',state=>{
      if(state!=='active')return;
      if(controller.mutation.current().status!=='saving')void controller.recover();
      void controller.reload(false);
      if(currentDestination.current==='recurring')void controller.loadRecurring();
    });
    return ()=>{resume.remove();controller.dispose();};
  // The controller is scoped to this signed-in shell; the destination is handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[controller]);
  useEffect(()=>{setSelected(null);setStream(null);if(destination==='recurring')void controller.loadRecurring();},[controller,destination]);
  const snapshot=controller.snapshot.current(),mutation=controller.mutation.current();
  const currencies=currencyOptions(controller);
  return <View>
    {snapshot.message?<Text accessibilityLiveRegion="polite" style={{color:dark?'#FFB4AB':'#A83F3F',fontSize:15}}>{snapshot.message}</Text>:null}
    <FinanceDestination dark={dark} destination={destination} controller={controller} currencies={currencies} selected={selected} stream={stream} draft={draft} setSelected={setSelected} setStream={setStream} setDraft={setDraft} onOpenRecurring={onOpenRecurring}/>
    {mutation.blocked&&mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>{void controller.recover();}}/>:null}
  </View>;
}
