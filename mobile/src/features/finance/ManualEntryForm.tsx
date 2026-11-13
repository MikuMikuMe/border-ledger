import React,{useRef,useState} from 'react';
import {Alert,TextInput,View} from 'react-native';
import {parseMoneyMinor} from '../../../../src/domain/currencies';
import {Action,Copy,DetailModal,MutationStatus} from './FinanceViews';
import {CurrencyPicker} from './CurrencyPicker';
import type {MutationState,Snapshot} from './contracts';

export type ManualDraft={accountId:string;date:string;merchant:string;amount:string;currency:string;kind:string;direction:string;category:string;note:string};
type Account=Snapshot['accounts'][number];
function validateDraft(draft:ManualDraft) {
  const date=new Date(`${draft.date}T00:00:00.000Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date))return 'Enter a valid date in YYYY-MM-DD format.';
  if(!Number.isFinite(date.valueOf()))return 'Enter a valid date in YYYY-MM-DD format.';
  if(date.toISOString().slice(0,10)!==draft.date)return 'Enter a valid date in YYYY-MM-DD format.';
  try {if(parseMoneyMinor(draft.amount.trim(),draft.currency)<=0)throw new Error('Invalid amount');}
  catch {return 'Enter a positive amount with the correct decimal places for the currency.';}
  return '';
}
function fieldError(error:string,prefix:string) { return error.startsWith(prefix)?error:undefined; }
function Field({dark,label,value,onChange,disabled,error,keyboard='default'}:{dark:boolean;label:string;value:string;onChange(value:string):void;disabled:boolean;error?:string;keyboard?:'default'|'decimal-pad'}){
  return <View style={{gap:4}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} accessibilityHint={error} value={value} editable={!disabled} onChangeText={onChange} keyboardType={keyboard} style={{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:12,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'}}/>{error?<View accessibilityLiveRegion="polite"><Copy dark={dark} error>{error}</Copy></View>:null}</View>;
}
function closeManualDraft(draft:ManualDraft,initial:ManualDraft,mutation:MutationState,onClose:()=>void){
  if(mutation.status==='saving')return;
  const changed=(Object.keys(initial) as (keyof ManualDraft)[]).some(key=>draft[key]!==initial[key]);
  if(changed){Alert.alert('Discard transaction?', 'Your local transaction draft may be lost. Check the operation status before trying again.',[{text:'Keep editing',style:'cancel'},{text:'Discard',style:'destructive',onPress:onClose}]);return;}
  onClose();
}
export function ManualEntryForm({dark,accounts,draft,onDraft,mutation,onSave,onClose}:{dark:boolean;accounts:Account[];draft:ManualDraft;onDraft(value:ManualDraft):void;mutation:MutationState;onSave():void;onClose():void}) {
  const [error,setError]=useState('');
  const initial=useRef({...draft});
  const close=()=>closeManualDraft(draft,initial.current,mutation,onClose);
  const selected=accounts.find(account=>account.id===draft.accountId);
  const update=(key:keyof ManualDraft,value:string)=>{setError('');onDraft({...draft,[key]:value});};
  const submit=()=>{
    const validation=validateDraft(draft);
    setError(validation);if(!validation)onSave();
  };
  return <DetailModal dark={dark} title="Add transaction" onClose={close} dismissOutside>
    <Copy dark={dark}>Account</Copy>{accounts.map(account=><Action key={account.id} dark={dark} label={`${account.institution??''} ${account.displayName}`} disabled={mutation.blocked} radio selected={draft.accountId===account.id} onPress={()=>onDraft({...draft,accountId:account.id,currency:account.currencies[0]??''})}/>)}
    <Field dark={dark} disabled={mutation.blocked} label="Date (YYYY-MM-DD)" error={fieldError(error,'Enter a valid date')} value={draft.date} onChange={value=>update('date',value)}/>
    <Field dark={dark} disabled={mutation.blocked} label="Description" value={draft.merchant} onChange={value=>update('merchant',value)}/>
    <Field dark={dark} disabled={mutation.blocked} label="Amount" error={fieldError(error,'Enter a positive amount')} value={draft.amount} keyboard="decimal-pad" onChange={value=>update('amount',value)}/>
    <CurrencyPicker dark={dark} accountCurrency={selected?.currencies[0]} value={draft.currency} disabled={mutation.blocked} onChange={code=>update('currency',code)}/>
    <Copy dark={dark}>Type</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{['expense','income','transfer','refund','fee'].map(kind=><Action key={kind} dark={dark} label={kind} disabled={mutation.blocked} radio selected={draft.kind===kind} onPress={()=>update('kind',kind)}/>)}</View>
    {draft.kind==='transfer'?<><Copy dark={dark}>Direction</Copy><Action dark={dark} label="Out of account" disabled={mutation.blocked} radio selected={draft.direction==='out'} onPress={()=>update('direction','out')}/><Action dark={dark} label="Into account" disabled={mutation.blocked} radio selected={draft.direction==='in'} onPress={()=>update('direction','in')}/></>:null}
    <Field dark={dark} disabled={mutation.blocked} label="Category" value={draft.category} onChange={value=>update('category',value)}/><Field dark={dark} disabled={mutation.blocked} label="Note (optional)" value={draft.note} onChange={value=>update('note',value)}/>
    <MutationStatus dark={dark} mutation={mutation}/><Action dark={dark} label="Save transaction" disabled={mutation.blocked||!draft.accountId||!draft.date||!draft.merchant.trim()||!draft.amount||!draft.category.trim()} onPress={submit}/>
    <Action dark={dark} label={mutation.blocked?'Close':'Cancel'} onPress={close}/>
  </DetailModal>;
}
