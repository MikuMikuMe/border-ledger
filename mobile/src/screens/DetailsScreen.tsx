import React,{useEffect,useMemo,useReducer,useState} from 'react';
import {AppState,View} from 'react-native';
import NativeRecurring from '../native/specs/NativeRecurring';
import NativeReview from '../native/specs/NativeReview';
import NativeAccounts from '../native/specs/NativeAccounts';
import NativeSession from '../native/specs/NativeSession';
import {DetailsController} from '../features/details/DetailsController';
import type {Alert,DetailsPorts} from '../features/details/contracts';
import {AccountsView,RecurringDetailView,ReviewView} from '../features/details/DetailsViews';
import {Action} from '../features/finance/FinanceViews';
const ports:DetailsPorts={recurring:NativeRecurring,review:NativeReview,accounts:NativeAccounts,session:NativeSession};
let sequence=0;
const operationId=()=>`mobile_detail_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;
export function DetailsScreen({dark,destination,recurringId,onCloseRecurring}: {dark:boolean;destination:'review'|'accounts'|'recurring';recurringId?:string|null;onCloseRecurring?():void}){
  const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new DetailsController(ports,render),[]);
  const [selected,setSelected]=useState<Alert|null>(null),[draft,setDraft]=useState({category:'',note:''});
  useEffect(()=>{void controller.start();const resume=AppState.addEventListener('change',state=>{if(state==='active')void controller.resume();});return()=>{resume.remove();controller.dispose();};},[controller]);
  useEffect(()=>{setSelected(null);},[destination]);
  useEffect(()=>{if(recurringId)void controller.openRecurring(recurringId);else controller.closeRecurring();},[controller,recurringId]);
  const mutation=controller.mutation.current(),review=controller.review.current();
  const finishReview=async(action:()=>Promise<void>)=>{await action();if(controller.mutation.current().status==='completed')setSelected(null);};
  return <View>
    {destination==='review'?<ReviewView dark={dark} state={review} mutation={mutation} selected={review.phase==='locked'?null:selected} draft={draft} onDraft={setDraft} onRetry={()=>{void controller.loadReview();}} onLoadMore={()=>{void controller.loadReview(true);}} onOpen={alert=>{setSelected(alert);setDraft({category:alert.annotation?.category??'',note:alert.annotation?.note??''});void controller.recover();}} onClose={()=>setSelected(null)} onResolve={(alert,decision)=>{void finishReview(()=>controller.resolve(operationId(),alert,decision));}} onSave={alert=>{void finishReview(()=>controller.annotate(operationId(),alert,draft));}}/>:null}
    {destination==='accounts'?<AccountsView dark={dark} state={controller.accounts.current()} mutation={mutation} onRetry={()=>{void controller.loadAccounts();}} onLoadMore={()=>{void controller.loadAccounts(true);}} onConnect={reconnect=>{void controller.connect(operationId(),reconnect);}} onSelect={ids=>{void controller.selectAccounts(operationId(),ids);}} onCancel={()=>{void controller.cancelPending(operationId());}} onSync={()=>{void controller.sync(operationId());}} onDisconnect={id=>{void controller.disconnect(operationId(),id,true);}}/>:null}
    {destination==='recurring'&&recurringId?<RecurringDetailView dark={dark} state={controller.detail.current()} mutation={mutation} onRetry={()=>{void controller.loadDetail(false,{recoverConflict:true});}} onLoadMore={()=>{void controller.loadDetail(true);}} onClose={()=>onCloseRecurring?.()} onClassify={value=>{void controller.classify(operationId(),value);}}/>:null}
    {mutation.blocked&&mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>{void controller.recover();}}/>:null}
  </View>;
}
