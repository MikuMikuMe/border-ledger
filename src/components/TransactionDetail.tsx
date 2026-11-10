import {useEffect,useRef,useState,type FormEvent,type MouseEvent} from 'react';
import type {LedgerApi} from '../domain/api';
import {LedgerApiError} from '../domain/api';
import {formatMoney} from '../domain/format';
import type {Transaction} from '../domain/types';

type Props={transaction:Transaction;api:LedgerApi;onChanged():Promise<void>;onClose():void};
function saveFailure(error:unknown,saved:boolean){
  if(saved)return {locked:true,message:'Transaction saved, but refresh failed. Refresh Activity before continuing.'};
  if(!(error instanceof LedgerApiError)||error.status>=500)return {locked:true,message:'Save status is unknown. Refresh Activity before trying again.'};
  if(error.status===409)return {locked:true,message:'This transaction changed elsewhere. Close and refresh before trying again.'};
  return {locked:false,message:error.message};
}
function useAnnotationEditor({transaction,api,onChanged,onClose}:Props){
  const [category,setCategory]=useState(transaction.category),[note,setNote]=useState(transaction.note??'');
  const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[savedState,setSavedState]=useState(false),[message,setMessage]=useState('');
  const dirty=category!==transaction.category||note!==(transaction.note??'');
  const close=()=>{if(busy)return;if(dirty&&!savedState){if(!window.confirm('Discard your unsaved category and note changes?'))return;}onClose();};
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(busy)return;
    if(locked)return;
    if(transaction.annotationRevision===undefined)return;
    setBusy(true);setMessage('');let saved=false;
    try{
      await api(`/api/transactions/${encodeURIComponent(transaction.id)}/annotation`,{method:'PATCH',body:JSON.stringify({expectedRevision:transaction.annotationRevision,category:category.trim(),note:note.trim()?note:null})});
      saved=true;setSavedState(true);await onChanged();onClose();
    }catch(error){const result=saveFailure(error,saved);setLocked(result.locked);setMessage(result.message);}
    finally{setBusy(false);}
  };
  return {category,setCategory,note,setNote,busy,locked,message,close,save};
}
function clickedOutside(event:MouseEvent<HTMLDialogElement>){
  if(event.target!==event.currentTarget)return false;
  const bounds=event.currentTarget.getBoundingClientRect();
  return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
}export function TransactionDetail(props:Props){
  const {transaction}=props,editor=useAnnotationEditor(props),dialog=useRef<HTMLDialogElement>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{previous.current=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();previous.current?.focus();};},[]);
  const readOnly=editor.busy||editor.locked;
  const disabled=readOnly||!editor.category.trim()||transaction.annotationRevision===undefined;
  return <dialog ref={dialog} className="transaction-detail" aria-labelledby="transaction-detail-title" onCancel={event=>{event.preventDefault();editor.close();}} onClick={event=>{if(clickedOutside(event))editor.close();}}>
    <div className="transaction-detail-header"><h2 id="transaction-detail-title">Activity detail</h2><button type="button" className="text-button" onClick={editor.close} disabled={editor.busy}>Close</button></div>
    <p><strong>{transaction.merchant}</strong> · {formatMoney(transaction.amountMinor,transaction.currency)} {transaction.currency}</p>
    <p>{transaction.date} · {transaction.status} · {transaction.kind} · {transaction.source}</p>
    <form onSubmit={event=>{void editor.save(event);}} className="transaction-detail-form">
      <label>Category<input aria-label="Category" required maxLength={80} readOnly={readOnly} value={editor.category} onChange={event=>editor.setCategory(event.target.value)}/></label>
      <label>Note<textarea aria-label="Note" maxLength={1000} readOnly={readOnly} value={editor.note} onChange={event=>editor.setNote(event.target.value)}/></label>
      {editor.message?<p role="alert">{editor.message}</p>:null}
      {transaction.annotationRevision===undefined?<p role="alert">Editing is unavailable. Refresh Activity and try again.</p>:null}
      <button type="submit" className="outline-button" disabled={disabled}>Save annotation</button>
    </form>
  </dialog>;
}
