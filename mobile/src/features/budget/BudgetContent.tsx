import React,{useState} from 'react';
import {TextInput,View} from 'react-native';
import {Action,Copy} from '../finance/FinanceViews';
import {formatMoney} from '../finance/model';
import {getCurrencyMeta,parseMoneyMinor} from '../../../../src/domain/currencies';

export type Category={category:string;openingMinor:number|null;assignedMinor:number;activityMinor:number|null;availableMinor:number|null;targetMinor:number|null;suggestedMinor:number|null;suggestionBasis:'target'|'history'|null;missingTransactionIds:string[]};
export type Balance={id:string;accountId?:string;name:string;source:'manual'|'lunchflow'|'unavailable'|'excluded';sourceCurrency:string;sourceMinor:number|null;amountMinor:number|null;rateDate:string|null;rate?:string|null;observedAt:string|null};
export type BudgetData={settings:{currency:string};summary:{month:string;cashMinor:number|null;unassignedMinor:number|null;categories:Category[]};balances:Balance[];activity:{id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null}[];currentMonth:string;asOf:string;startMonth:string};
type Write=(action:string,build:(id:string)=>unknown)=>void;
const money=(value:number|null,currency:string)=>value===null?'Unavailable':formatMoney(String(value),currency);
function decimal(value:number,currency:string) {const digits=getCurrencyMeta(currency)?.minorUnitDigits??2,negative=value<0,n=BigInt(Math.abs(value)),scale=10n**BigInt(digits);return (negative?'-':'')+(digits?`${n/scale}.${(n%scale).toString().padStart(digits,'0')}`:n.toString());}
function Field({dark,label,value,onChange}:{dark:boolean;label:string;value:string;onChange(value:string):void}) {
  return <View style={{gap:5,marginTop:8}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/></View>;
}
function CategoryPanel({dark,row,currency,month,busy,onWrite}:{dark:boolean;row:Category;currency:string;month:string;busy:boolean;onWrite:Write}) {
  const [allocation,setAllocation]=useState(''),[target,setTarget]=useState('');
  return <View style={{gap:6,paddingVertical:16,borderTopWidth:1,borderColor:dark?'#43534B':'#D2CCC0'}}>
    <Copy dark={dark} heading>{row.category}</Copy><Copy dark={dark}>Available {money(row.availableMinor,currency)}</Copy>
    <Copy dark={dark}>Carried {money(row.openingMinor,currency)} · Assigned {money(row.assignedMinor,currency)} · Activity {money(row.activityMinor,currency)}</Copy>
    <Copy dark={dark}>Target {row.targetMinor===null?'Not set':money(row.targetMinor,currency)}{row.suggestedMinor===null?'':` · Suggested ${money(row.suggestedMinor,currency)} (${row.suggestionBasis})`}</Copy>
    {row.missingTransactionIds.length?<Copy dark={dark} error>Some exchange rates are unavailable.</Copy>:null}
    {row.suggestedMinor!==null?<Action dark={dark} label={`Use suggestion for ${row.category}`} onPress={()=>setAllocation(decimal(row.assignedMinor+row.suggestedMinor!,currency))} disabled={busy}/>:null}
    <Field dark={dark} label={`Assignment for ${row.category}`} value={allocation} onChange={setAllocation}/><Action dark={dark} label={`Save assignment for ${row.category}`} disabled={busy} onPress={()=>onWrite('allocations',()=>({month,category:row.category,assignedMinor:parseMoneyMinor(allocation.trim(),currency)}))}/>
    <Field dark={dark} label={`Target for ${row.category}`} value={target} onChange={setTarget}/><Action dark={dark} label={`Save target for ${row.category}`} disabled={busy} onPress={()=>onWrite('targets',()=>({category:row.category,targetMinor:parseMoneyMinor(target.trim(),currency)}))}/>
  </View>;
}
function AddCategory({dark,currency,month,busy,onWrite}:{dark:boolean;currency:string;month:string;busy:boolean;onWrite:Write}) {
  const [category,setCategory]=useState(''),[amount,setAmount]=useState('');
  return <View style={{gap:6,marginVertical:12}}><Copy dark={dark} heading>Add a category assignment</Copy><Field dark={dark} label="Category" value={category} onChange={setCategory}/><Field dark={dark} label="Amount to assign" value={amount} onChange={setAmount}/><Action dark={dark} label="Assign money" disabled={busy} onPress={()=>onWrite('allocations',()=>({month,category:category.trim(),assignedMinor:parseMoneyMinor(amount.trim(),currency)}))}/></View>;
}
function MoveMoney({dark,currency,month,categories,busy,onWrite}:{dark:boolean;currency:string;month:string;categories:Category[];busy:boolean;onWrite:Write}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[amount,setAmount]=useState('');
  return <View style={{gap:6,marginVertical:12}}><Copy dark={dark} heading>Move money</Copy><Copy dark={dark}>Choose the category to move from and the category to receive it.</Copy>{categories.map(row=><View key={row.category}><Action dark={dark} label={`Move from ${row.category}`} selected={from===row.category} onPress={()=>setFrom(row.category)}/><Action dark={dark} label={`Move to ${row.category}`} selected={to===row.category} onPress={()=>setTo(row.category)}/></View>)}<Field dark={dark} label="Amount to move" value={amount} onChange={setAmount}/><Action dark={dark} label="Move money" disabled={busy||!from||!to||from===to} onPress={()=>onWrite('transfers',id=>({id,month,from,to,amountMinor:parseMoneyMinor(amount.trim(),currency)}))}/></View>;
}
function BalancePanel({dark,view,busy,onWrite}:{dark:boolean;view:BudgetData;busy:boolean;onWrite:Write}) {
  const [name,setName]=useState(''),[currency,setCurrency]=useState(view.settings.currency),[amount,setAmount]=useState(''),[accountId,setAccount]=useState('');
  return <View style={{gap:8,marginTop:20}}><Copy dark={dark} heading>Funding balances</Copy><Copy dark={dark}>A custom account balance replaces the linked balance for that account.</Copy>
    {view.balances.map(item=><View key={`${item.source}:${item.id}`} style={{gap:4,paddingVertical:12,borderTopWidth:1,borderColor:dark?'#43534B':'#D2CCC0'}}><Copy dark={dark} heading>{item.name}</Copy><Copy dark={dark}>{item.source==='excluded'?'Account is no longer eligible for funding':item.source==='unavailable'?'Balance unavailable or stale':item.source==='manual'?'Custom balance':'Lunch Flow balance'} · {money(item.amountMinor,view.settings.currency)}</Copy>{item.sourceCurrency!==view.settings.currency && item.sourceMinor!==null?<Copy dark={dark}>Original {money(item.sourceMinor,item.sourceCurrency)} · Approx. rate {item.rate??'unavailable'} · {item.rateDate??'rate unavailable'}</Copy>:null}{(item.source==='manual'||item.source==='excluded')?<Action dark={dark} label={`Remove ${item.name}`} disabled={busy} onPress={()=>onWrite('cash-delete',()=>({id:item.id}))}/>:null}</View>)}
    <Copy dark={dark} heading>Add a custom balance</Copy><Action dark={dark} label="Unlinked cash or account" selected={!accountId} onPress={()=>setAccount('')}/>{view.balances.filter(item=>item.accountId && item.source!=='excluded').map(item=><Action key={item.accountId} dark={dark} label={`Override ${item.name}`} selected={accountId===item.accountId} onPress={()=>{setAccount(item.accountId!);setName(item.name);setCurrency(item.sourceCurrency);}}/>)}
    <Field dark={dark} label="Balance name" value={name} onChange={setName}/><Field dark={dark} label="Balance currency" value={currency} onChange={value=>setCurrency(value.toUpperCase())}/><Field dark={dark} label="Balance amount" value={amount} onChange={setAmount}/><Action dark={dark} label="Save custom balance" disabled={busy} onPress={()=>onWrite('cash',id=>({id:view.balances.find(item=>item.accountId===accountId && item.source==='manual')?.id??id,name:name.trim(),currency,amountMinor:parseMoneyMinor(amount.trim(),currency),...(accountId?{accountId}:{})}))}/>
  </View>;
}
export function BudgetContent({dark,currency,view,busy,onWrite}:{dark:boolean;currency:string;view:BudgetData;busy:boolean;onWrite:Write}) {
  return <View style={{gap:10}}><Copy dark={dark}>Available to assign: {money(view.summary.unassignedMinor,currency)}</Copy><Copy dark={dark}>Current cash: {money(view.summary.cashMinor,currency)} · credit accounts excluded</Copy><Copy dark={dark}>{view.summary.month===view.currentMonth?'After category balances and future assignments.':'Current cash is not a historical balance.'}</Copy><Copy dark={dark} heading>Categories</Copy>
    {view.summary.categories.map(row=><CategoryPanel key={row.category} dark={dark} row={row} currency={currency} month={view.summary.month} busy={busy} onWrite={onWrite}/>)}
    <AddCategory dark={dark} currency={currency} month={view.summary.month} busy={busy} onWrite={onWrite}/>{view.summary.categories.length>1?<MoveMoney dark={dark} currency={currency} month={view.summary.month} categories={view.summary.categories} busy={busy} onWrite={onWrite}/>:null}
    <Copy dark={dark} heading>Counted transactions</Copy>{view.activity.map(item=><Copy dark={dark} key={item.id}>{item.date} · {item.category} · {money(item.sourceMinor,item.sourceCurrency)} · {money(item.activityMinor,currency)}{item.sourceCurrency!==currency?` · Approx. rate ${item.rate??'unavailable'} · ${item.rateDate??'rate unavailable'}`:''}</Copy>)}
    <BalancePanel dark={dark} view={view} busy={busy} onWrite={onWrite}/>
  </View>;
}
