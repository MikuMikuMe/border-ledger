import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import NativeLedger from '../../native/specs/NativeLedger';
import NativeSession from '../../native/specs/NativeSession';
import {Action,Copy,MutationStatus} from './FinanceViews';
import {formatMoney} from './model';
import type {FinanceController} from './FinanceController';

type Deleted={id:string;merchant:string;date:string;amountMinor:number;currency:string;accountName:string;deletedAt:string;revision:number};
function validDeleted(value:unknown):value is Deleted {
 if(!value||typeof value!=='object')return false;
 if(Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 if(!['id','merchant','date','currency','accountName','deletedAt'].every(key=>typeof row[key]==='string'))return false;
 return Number.isSafeInteger(row.amountMinor)&&Number.isSafeInteger(row.revision)&&(row.revision as number)>=0;
}
type Props={dark:boolean;controller:FinanceController;operationId:()=>string};
export function RecentlyDeleted({dark,controller,operationId}:Props) {
 const [open,setOpen]=useState(false),[items,setItems]=useState<Deleted[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=async()=>{setLoading(true);try{const result=JSON.parse(await NativeLedger.readDeletedTransactions());if(!Array.isArray(result.items)||!result.items.every(validDeleted))throw new Error();setItems(result.items);setError('');}catch{setError('Could not load deleted transactions.');}finally{setLoading(false);}};
 useEffect(()=>{if(open)void load();},[open]);
 const restore=async(item:Deleted)=>{
  const id=operationId(),body={transactionId:item.id,requestId:id,expectedRevision:item.revision};
  await controller.mutation.submit(id,()=>NativeLedger.startManualWrite(id,'restore',JSON.stringify(body)),key=>NativeSession.queryOperation({operationId:key}));
  if(controller.mutation.current().status==='completed')await Promise.all([controller.reload(),load()]);
 };
 return <View><Action dark={dark} label={open?'Close recently deleted':'Recently deleted'} expanded={open} onPress={()=>setOpen(!open)}/>{open?<View style={{gap:8}}><Copy dark={dark}>Transactions can be restored for 365 days.</Copy>{error?<Copy dark={dark} error>{error}</Copy>:null}{loading?<Copy dark={dark}>Loading deleted transactions...</Copy>:null}{!loading&&!error&&!items.length?<Copy dark={dark}>No recently deleted transactions.</Copy>:null}{items.map(item=><View key={item.id}><Copy dark={dark}>{item.merchant} · {item.date} · {item.accountName} · {item.currency} {formatMoney(String(item.amountMinor),item.currency)} · Deleted {item.deletedAt.slice(0,10)}</Copy><Action dark={dark} label={`Restore ${item.merchant}, ${item.date}, ${item.accountName}, ${item.currency} ${formatMoney(String(item.amountMinor),item.currency)}`} text="Restore" disabled={controller.mutation.current().blocked} onPress={()=>{void restore(item);}}/></View>)}<MutationStatus dark={dark} mutation={controller.mutation.current()}/><Action dark={dark} label="Refresh deleted transactions" onPress={()=>{void load();}}/></View>:null}</View>;
}
