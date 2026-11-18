import React,{useState} from 'react';
import {Alert,View} from 'react-native';
import {parseMoneyMinor} from '../../../src/domain/currencies';
import {Action,ActivityDetail,Copy} from '../features/finance/FinanceViews';
import {ManualEntryForm,type ManualDraft} from '../features/finance/ManualEntryForm';
import {transactionDraft} from '../features/finance/transactionDraft';
import {transaction} from './financeFixtures';

const initial={...transaction,editRevision:0,sourceAmountMinor:'-1000'};
const accounts=[{id:'fixture_account',displayName:'Everyday Chequing',institution:'Example Bank',instrument:null,currencies:['CAD','USD'],lastSuccessfulSyncAt:null}];
const ready={blocked:false,status:'ready'};
function applyDraft(item:typeof initial,draft:ManualDraft) {
 const minor=parseMoneyMinor(draft.amount,draft.currency);
 const signed=draft.kind==='income'||draft.kind==='refund'||(draft.kind==='transfer'&&draft.direction==='in')?minor:-minor;
 return {...item,occurredAt:draft.date,merchant:draft.merchant,currency:draft.currency,kind:draft.kind,category:draft.category,note:draft.note||null,accountId:draft.accountId,sourceAmountMinor:String(signed),signedMinorUnits:String(draft.kind==='refund'?-minor:minor)};
}
export function TransactionFlowFixture({dark}:{dark:boolean}) {
 const [item,setItem]=useState(initial),[draft,setDraft]=useState(()=>transactionDraft(initial));
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[deleted,setDeleted]=useState(false),[showDeleted,setShowDeleted]=useState(false);
 const save=()=>{setItem(applyDraft(item,draft));setEditing(false);setOpen(false);};
 const remove=()=>Alert.alert('Delete transaction?','It will be removed from your totals. You can restore it for 365 days.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>{setDeleted(true);setOpen(false);}}]);
 return <View style={{gap:12}}><Copy dark={dark}>Synthetic data only. Changes are local to this fixture.</Copy>
  {!deleted?<Action dark={dark} label={`Open activity: ${item.merchant}`} onPress={()=>setOpen(true)}/>:<Copy dark={dark}>No activity matches this search.</Copy>}
  <Action dark={dark} label="Recently deleted" onPress={()=>setShowDeleted(!showDeleted)}/>
  {showDeleted&&deleted?<><Copy dark={dark}>{item.merchant} · {item.occurredAt.slice(0,10)} · Deleted today</Copy><Action dark={dark} label={`Restore ${item.merchant}`} onPress={()=>setDeleted(false)}/></>:null}
  {open&&!editing?<ActivityDetail dark={dark} selected={item} draft={{category:item.category??'',note:item.note??''}} mutation={ready} onDraft={()=>{}} onSave={()=>{}} onClose={()=>setOpen(false)} onEdit={()=>{setDraft(transactionDraft(item));setEditing(true);}} onDelete={remove}/>:null}
  {editing?<ManualEntryForm dark={dark} mode="edit" accounts={accounts} draft={draft} onDraft={setDraft} mutation={ready} onSave={save} onClose={()=>setEditing(false)}/>:null}
 </View>;
}
