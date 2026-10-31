import React from 'react';
import {TextInput,View} from 'react-native';
import {Action,Copy,DetailModal} from './FinanceViews';
import type {PlanDraft} from '../../native/specs/NativeRecurring';
export type PlanAccount={id:string;displayName:string;currencies:string[]};
export type PlanEditorDraft=Omit<PlanDraft,'amountMinor'>&{amount:string};
function Choices({dark,label,values,current,onChoose,names={}}:{dark:boolean;label:string;values:string[];current:string;onChoose(value:string):void;names?:Record<string,string>}) {
  return <View style={{gap:6}}><Copy dark={dark}>{label}</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{values.map(value=><Action dark={dark} key={value} label={`${label}: ${names[value]??value}`} text={names[value]??value} selected={value===current} onPress={()=>onChoose(value)}/>)}</View></View>;
}
function Field({dark,label,value,onChange}:{dark:boolean;label:string;value:string;onChange(value:string):void}) {
  return <View style={{gap:6}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/></View>;
}
export function PlanEditor({dark,draft,accounts,editing,busy,onChange,onSave,onClose}:{dark:boolean;draft:PlanEditorDraft;accounts:PlanAccount[];editing:boolean;busy:boolean;onChange(value:PlanEditorDraft):void;onSave():void;onClose():void}) {
  const update=(values:Partial<PlanEditorDraft>)=>onChange({...draft,...values});
  const account=accounts.find(item=>item.id===draft.accountId);
  return <DetailModal dark={dark} title={editing?'Edit recurring plan':'Add recurring plan'} onClose={onClose}>
    <Choices dark={dark} label="Account" values={accounts.map(a=>a.id)} current={draft.accountId} names={Object.fromEntries(accounts.map(a=>[a.id,a.displayName]))} onChoose={id=>update({accountId:id,currency:accounts.find(a=>a.id===id)?.currencies[0]??draft.currency})}/>
    <Choices dark={dark} label="Currency" values={account?.currencies??[draft.currency]} current={draft.currency} onChoose={currency=>update({currency})}/>
    <Field dark={dark} label="Payee" value={draft.merchant} onChange={merchant=>update({merchant})}/><Field dark={dark} label="Amount" value={draft.amount} onChange={amount=>update({amount})}/>
    <Choices dark={dark} label="Direction" values={['expense','income']} current={draft.direction} onChoose={direction=>update({direction})}/>
    <Choices dark={dark} label="Repeats" values={['weekly','biweekly','monthly','yearly']} current={draft.frequency} onChoose={frequency=>update({frequency})}/>
    <Field dark={dark} label="First date (YYYY-MM-DD)" value={draft.startDate} onChange={startDate=>update({startDate})}/><Field dark={dark} label="End date (optional YYYY-MM-DD)" value={draft.endDate??''} onChange={endDate=>update({endDate:endDate||null})}/>
    <Action dark={dark} label="Save recurring plan" disabled={busy||!draft.accountId||!draft.merchant.trim()} onPress={onSave}/><Action dark={dark} label="Cancel plan editing" onPress={onClose}/>
  </DetailModal>;
}
