import React,{useEffect,useState} from 'react';
import {Alert} from 'react-native';
import NativeLedger from '../../native/specs/NativeLedger';
import NativeSession from '../../native/specs/NativeSession';
import {ManualEntryForm,type ManualDraft} from './ManualEntryForm';
import {transactionDraft} from './transactionDraft';
import type {MutationState,Transaction} from './contracts';
import type {FinanceController} from './FinanceController';
import type {CategoryCleanup} from './CategoryPicker';

function confirmRefresh({controller,current,onLatest,onFailure}:{controller:FinanceController;current:Transaction;onLatest(value:Transaction):void;onFailure():void}) {
 Alert.alert('Refresh transaction?','Your unsaved changes will be discarded.',[{text:'Keep editing',style:'cancel'},{text:'Refresh',onPress:async()=>{try{const latest=await controller.refreshTransaction(current.id);if(latest)onLatest(latest);else onFailure();}catch{onFailure();}}}]);
}
function editorMutation(state:MutationState,blocked:boolean,conflict:boolean):MutationState {
 return {...state,blocked:state.blocked||blocked||conflict,status:state.status==='revision_conflict'&&!conflict?'ready':state.status};
}
function editorRecovery({pending,conflict,failed,cleanup,refresh}:{pending:CategoryCleanup|null;conflict:boolean;failed:boolean;cleanup(value:CategoryCleanup):Promise<boolean>;refresh():void}) {
 if(pending)return {message:'Category changes could not be refreshed. Refresh before saving.',onRefresh:()=>{void cleanup(pending);}};
 if(conflict)return {message:failed?'Transaction unavailable. Close and refresh Activity to find the latest record.':'This transaction changed elsewhere. Refresh to review the latest values.',onRefresh:refresh};
 return undefined;
}
type Props={dark:boolean;transaction:Transaction;controller:FinanceController;operationId:()=>string;onClose():void;onCategoryCleanup(cleanup:CategoryCleanup):Promise<boolean>};
export function TransactionEditor({dark,transaction,controller,operationId,onClose,onCategoryCleanup}:Props) {
 const [draft,setDraft]=useState<ManualDraft>(()=>transactionDraft(transaction));
 const [current,setCurrent]=useState(transaction),[conflict,setConflict]=useState(false),[refreshFailed,setRefreshFailed]=useState(false),[formVersion,setFormVersion]=useState(0);
 useEffect(()=>setCurrent(transaction),[transaction]);
 const [pendingCleanup,setPendingCleanup]=useState<CategoryCleanup|null>(null);
 const save=async()=>{
  if(current.editRevision==null||conflict)return;
  const id=operationId();
  const body={...draft,transactionId:current.id,requestId:id,expectedRevision:current.editRevision,expectedAnnotationRevision:current.revision,note:draft.note.trim()||null};
  await controller.mutation.submit(id,()=>NativeLedger.startManualWrite(id,'edit',JSON.stringify(body)),key=>NativeSession.queryOperation({operationId:key}));
  if(controller.mutation.current().status==='completed'){onClose();await controller.reload();}
  else if(controller.mutation.current().status==='revision_conflict')setConflict(true);
 };
 const cleanup=async(value:CategoryCleanup)=>{setPendingCleanup(value);try{const result=await onCategoryCleanup(value);if(result)setPendingCleanup(null);return result;}catch{return false;}};
 const refresh=()=>confirmRefresh({controller,current,onFailure:()=>setRefreshFailed(true),onLatest:latest=>{setCurrent(latest);setDraft(transactionDraft(latest));setFormVersion(value=>value+1);setRefreshFailed(false);setConflict(false);}});
 const state=controller.mutation.current();
 const mutation=editorMutation(state,Boolean(pendingCleanup),conflict);
 const recovery=editorRecovery({pending:pendingCleanup,conflict,failed:refreshFailed,cleanup,refresh});
 return <ManualEntryForm key={formVersion} dark={dark} mode="edit" accounts={controller.snapshot.current().data?.accounts??[]} draft={draft} onDraft={setDraft} mutation={mutation} recovery={recovery} onSave={()=>{void save();}} onClose={onClose} onCategoryCleanup={cleanup}/>;
}
