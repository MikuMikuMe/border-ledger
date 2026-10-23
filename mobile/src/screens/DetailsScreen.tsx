import React,{useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {AppState,View} from 'react-native';
import NativeRecurring from '../native/specs/NativeRecurring';
import NativeReview from '../native/specs/NativeReview';
import NativeAccounts from '../native/specs/NativeAccounts';
import NativeLedger from '../native/specs/NativeLedger';
import NativeSession from '../native/specs/NativeSession';
import {DetailsController} from '../features/details/DetailsController';
import type {Alert,DetailsPorts,LunchFlowAccountKind,LunchFlowAccounts} from '../features/details/contracts';
import {AccountsView,RecurringDetailView,ReviewView} from '../features/details/DetailsViews';
import {Action} from '../features/finance/FinanceViews';
const ports:DetailsPorts={
 recurring:{
  readDetail:(id,cursor,limit)=>NativeRecurring.readDetail({id,cursor,limit}),
  startClassify:(operationId,id,revision,classification)=>NativeRecurring.startClassify({operationId,id,expectedRevision:revision,classification}),
  onChanged:NativeRecurring.onChanged,
 },
 review:{
  readAlerts:(cursor,limit)=>NativeReview.readAlerts({cursor,limit}),
  startReview:(operationId,value)=>NativeReview.startReview({operationId,value}),
  startAnnotate:(operationId,value)=>NativeReview.startAnnotate({operationId,value}),
  onChanged:NativeReview.onChanged,
 },
 accounts:{
  getSnapshot:NativeAccounts.getSnapshot,
  readAccounts:(cursor,limit)=>NativeAccounts.readAccounts({cursor,limit}),
  readConnections:NativeAccounts.readConnections,
  readLunchFlowAccounts:async():Promise<LunchFlowAccounts>=>{
   const value=await NativeAccounts.readLunchFlowAccounts();
   return {...value,accounts:value.accounts.map(account=>({...account,kind:(['chequing','savings','credit'] as const).includes(account.kind as LunchFlowAccountKind)?account.kind as LunchFlowAccountKind:null}))};
  },
  readLunchFlowStatus:async():Promise<LunchFlowAccounts>=>{
   const value=await NativeAccounts.readLunchFlowStatus();
   return {...value,accounts:value.accounts.map(account=>({...account,kind:(['chequing','savings','credit'] as const).includes(account.kind as LunchFlowAccountKind)?account.kind as LunchFlowAccountKind:null}))};
  },
  startConnect:(operationId,reconnect)=>NativeAccounts.startConnect({operationId,reconnectConnectionId:reconnect}),
  cancelConnect:operationId=>NativeAccounts.cancelConnect({operationId}),
  startSelectAccounts:(operationId,pendingConnectionId,accountIds)=>NativeAccounts.startSelectAccounts({operationId,pendingConnectionId,accountIds}),
  startCancelPending:(operationId,pendingConnectionId)=>NativeAccounts.startCancelPending({operationId,pendingConnectionId}),
  startSync:operationId=>NativeAccounts.startSync({operationId}),
  startDisconnect:(operationId,connectionId)=>NativeAccounts.startDisconnect({operationId,connectionId}),
  startLunchFlowAccountSelection:(operationId,accounts)=>NativeAccounts.startLunchFlowAccountSelection({operationId,accounts}),
  startLunchFlowSync:operationId=>NativeAccounts.startLunchFlowSync({operationId}),
  onStateChanged:NativeAccounts.onStateChanged,
 },
 session:{
  readOperations:(offset,limit)=>NativeSession.readOperations({offset,limit}),
  queryOperation:operationId=>NativeSession.queryOperation({operationId}),
 },
 refreshLedger:()=>NativeLedger.refreshSnapshot(),
};
let sequence=0;
const operationId=()=>`mobile_detail_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;

type Destination='review'|'accounts'|'recurring';
type Controller=DetailsController;

function ReviewPanel({dark,controller,selected,draft,setDraft,setSelected,finishReview}:{dark:boolean;controller:Controller;selected:Alert|null;draft:{category:string;note:string};setDraft(value:{category:string;note:string}):void;setSelected(value:Alert|null):void;finishReview(action:()=>Promise<void>):Promise<void>}) {
  const state=controller.review.current();
  return <ReviewView dark={dark} state={state} mutation={controller.mutation.current()} selected={state.phase==='locked'?null:selected} draft={draft} onDraft={setDraft}
    onRetry={()=>{void controller.loadReview();}} onLoadMore={()=>{void controller.loadReview(true);}}
    onOpen={alert=>{setSelected(alert);setDraft({category:alert.annotation?.category??'',note:alert.annotation?.note??''});void controller.recover();}}
    onClose={()=>setSelected(null)} onResolve={(alert,decision)=>{void finishReview(()=>controller.resolve({operationId:operationId(),alert,decision}));}}
    onSave={alert=>{void finishReview(()=>controller.annotate({operationId:operationId(),alert,draft}));}}/>;
}

function AccountsPanel({dark,controller}:{dark:boolean;controller:Controller}) {
  return <AccountsView dark={dark} state={controller.accounts.current()} mutation={controller.mutation.current()} lunchFlowBusy={controller.lunchFlowBusy}
    onRetry={()=>{void controller.loadAccounts();}} onLoadMore={()=>{void controller.loadAccounts(true);}}
    onConnect={reconnect=>{void controller.connect({operationId:operationId(),reconnect});}} onCancelConnect={()=>{void controller.cancelConnect();}}
    onSelect={ids=>{void controller.selectAccounts({operationId:operationId(),ids});}} onCancel={()=>{void controller.cancelPending({operationId:operationId()});}}
    onSync={()=>{void controller.sync({operationId:operationId()});}} onDisconnect={id=>{void controller.disconnect({operationId:operationId(),connectionId:id,confirmed:true});}}
    onLunchFlowSelection={accounts=>{void controller.selectLunchFlow({operationId:operationId(),accounts});}}
    onLunchFlowSync={()=>{void controller.syncLunchFlow({operationId:operationId()});}}/>;
}

function RecurringPanel({dark,controller,recurringId,onCloseRecurring}:{dark:boolean;controller:Controller;recurringId:string|null;onCloseRecurring?():void}) {
  if(!recurringId)return null;
  return <RecurringDetailView dark={dark} state={controller.detail.current()} mutation={controller.mutation.current()}
    onRetry={()=>{void controller.loadDetail(false,{recoverConflict:true});}} onLoadMore={()=>{void controller.loadDetail(true);}}
    onClose={()=>onCloseRecurring?.()} onClassify={classification=>{void controller.classify({operationId:operationId(),classification});}}/>;
}

function DetailsDestination({dark,destination,controller,selected,draft,setDraft,setSelected,finishReview,recurringId,onCloseRecurring}:{dark:boolean;destination:Destination;controller:Controller;selected:Alert|null;draft:{category:string;note:string};setDraft(value:{category:string;note:string}):void;setSelected(value:Alert|null):void;finishReview(action:()=>Promise<void>):Promise<void>;recurringId?:string|null;onCloseRecurring?():void}) {
  if(destination==='review')return <ReviewPanel dark={dark} controller={controller} selected={selected} draft={draft} setDraft={setDraft} setSelected={setSelected} finishReview={finishReview}/>;
  if(destination==='accounts')return <AccountsPanel dark={dark} controller={controller}/>;
  return <RecurringPanel dark={dark} controller={controller} recurringId={recurringId??null} onCloseRecurring={onCloseRecurring}/>;
}
export function DetailsScreen({dark,destination,recurringId,onCloseRecurring}: {dark:boolean;destination:Destination;recurringId?:string|null;onCloseRecurring?():void}){
  const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new DetailsController(ports,render),[]);
  const [selected,setSelected]=useState<Alert|null>(null),[draft,setDraft]=useState({category:'',note:''});
  const currentDestination=useRef(destination);currentDestination.current=destination;
  const refreshSharedLedger=()=>{void NativeLedger.refreshSnapshot().catch(()=>{});};
  useEffect(()=>{void controller.start();const resume=AppState.addEventListener('change',state=>{if(state==='active'){void controller.resume();if(currentDestination.current==='accounts')refreshSharedLedger();}});return()=>{resume.remove();controller.dispose();};},[controller]);
  useEffect(()=>{setSelected(null);},[destination]);
  useEffect(()=>{if(destination==='accounts')refreshSharedLedger();},[destination]);
  useEffect(()=>{if(recurringId)void controller.openRecurring(recurringId);else controller.closeRecurring();},[controller,recurringId]);
  const finishReview=async(action:()=>Promise<void>)=>{await action();if(controller.mutation.current().status==='completed')setSelected(null);};
  const mutation=controller.mutation.current();
  return <View>
    <DetailsDestination dark={dark} destination={destination} controller={controller} selected={selected} draft={draft} setDraft={setDraft} setSelected={setSelected} finishReview={finishReview} recurringId={recurringId} onCloseRecurring={onCloseRecurring}/>
    {mutation.blocked&&mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>{void controller.recover();}}/>:null}
  </View>;
}
