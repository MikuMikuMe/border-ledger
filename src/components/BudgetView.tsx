import {AnalysisPanel} from './AnalysisPanel';
import {useRef,useState} from 'react';
import {useBudget} from './useBudget';
import type {LedgerApi} from '../domain/api';
import {getCurrencyMeta,parseMoneyMinor,supportedCurrencyCodes} from '../domain/currencies';
import type {BudgetCategorySummary} from '../domain/budget-summary';

import type {Account,BudgetSnapshot,BudgetViewData} from './BudgetTypes';
import {money} from './budget-display';
import {TrackingBudget} from './TrackingBudget';
import {BudgetCategoryRow} from './BudgetCategoryRow';
import {BudgetTransactions} from './BudgetTransactions';
export type {BudgetSnapshot,BudgetViewData} from './BudgetTypes';

function CurrencySelect({value,onChange,label}:{value:string;onChange(value:string):void;label:string}) {
  return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{supportedCurrencyCodes.map(code=><option key={code} value={code}>{code}</option>)}</select></label>;
}
function CategoryEditor({busy,onSave}:{busy:boolean;onSave(category:string,amount:string):void}) {
  const [category,setCategory]=useState(''),[amount,setAmount]=useState('');
  return <form className="budget-form" onSubmit={e=>{e.preventDefault();onSave(category,amount);}}><h3>Add a category assignment</h3><label>Category<input value={category} maxLength={120} onChange={e=>setCategory(e.target.value)}/></label><label>Amount<input value={amount} inputMode="decimal" onChange={e=>setAmount(e.target.value)}/></label><button disabled={busy}>Assign money</button></form>;
}
function TransferEditor({categories,busy,onTransfer}:{categories:BudgetCategorySummary[];busy:boolean;onTransfer(from:string,to:string,amount:string):void}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[amount,setAmount]=useState('');
  return <form className="budget-form" onSubmit={e=>{e.preventDefault();onTransfer(from,to,amount);}}><h3>Move money</h3><label>From<select value={from} onChange={e=>setFrom(e.target.value)}><option value="">Choose category</option>{categories.map(x=><option key={x.category}>{x.category}</option>)}</select></label><label>To<select value={to} onChange={e=>setTo(e.target.value)}><option value="">Choose category</option>{categories.map(x=><option key={x.category}>{x.category}</option>)}</select></label><label>Amount<input value={amount} inputMode="decimal" onChange={e=>setAmount(e.target.value)}/></label><button disabled={busy}>Move money</button></form>;
}
function CashEditor({accounts,busy,onSave}:{accounts:Account[];busy:boolean;onSave(value:{name:string;currency:string;amount:string;accountId:string}):void}) {
  const [name,setName]=useState(''),[currency,setCurrency]=useState('CAD'),[amount,setAmount]=useState(''),[accountId,setAccount]=useState('');
  return <form className="budget-form" onSubmit={e=>{e.preventDefault();onSave({name,currency,amount,accountId});}}><h3>Add a custom balance</h3><label>Account<select value={accountId} onChange={e=>{setAccount(e.target.value);const account=accounts.find(a=>a.id===e.target.value);if(account){setCurrency(account.currency);setName(account.name);}}}><option value="">Cash or an unlinked account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Name<input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><CurrencySelect label="Currency" value={currency} onChange={setCurrency}/><label>Balance<input value={amount} inputMode="decimal" onChange={e=>setAmount(e.target.value)}/></label><button disabled={busy}>Save balance</button></form>;
}
function BudgetDetails({data,snapshot,accounts,busy,save,remove,onInvalid,state}:{data:BudgetViewData;snapshot:BudgetSnapshot;accounts:Account[];busy:boolean;save(path:string,value:unknown):Promise<void>;remove(id:string):Promise<void>;onInvalid():void;state:ReturnType<typeof useBudget>}) {
  const currency=data.settings.currency,transferId=useRef<string|null>(null),cashId=useRef<string|null>(null);
  const amount=(value:string)=>parseMoneyMinor(value.trim(),currency);
  const run=async(path:string,build:()=>unknown,onSuccess?:()=>void)=>{let value:unknown;try{value=build();}catch{onInvalid();return;}try{await save(path,value);onSuccess?.();}catch{/* The hook keeps the save error and the draft. */}};
  const assign=(category:string,value:string)=>void run('allocations',()=>({month:data.summary.month,category:category.trim(),assignedMinor:amount(value)}));
  const target=(category:string,value:string)=>void run('targets',()=>({category:category.trim(),targetMinor:amount(value)}));
  const transfer=(from:string,to:string,value:string)=>{transferId.current??=crypto.randomUUID();void run('transfers',()=>({id:transferId.current,month:data.summary.month,from,to,amountMinor:amount(value)}),()=>{transferId.current=null;});};
  const cash=(value:{name:string;currency:string;amount:string;accountId:string})=>{cashId.current??=crypto.randomUUID();const existing=snapshot.cash.find(item=>item.accountId && item.accountId===value.accountId);void run('cash',()=>({id:existing?.id??cashId.current,name:value.name.trim(),currency:value.currency,amountMinor:parseMoneyMinor(value.amount.trim(),value.currency),...(value.accountId?{accountId:value.accountId}:{})}),()=>{cashId.current=null;});};
  return <BudgetDetailsContent data={data} state={state} accounts={accounts} busy={busy} remove={remove} assign={assign} target={target} transfer={transfer} cash={cash}/>;
}
function BudgetDetailsContent({data,accounts,busy,remove,assign,target,transfer,cash,state}:{data:BudgetViewData;state:ReturnType<typeof useBudget>;accounts:Account[];busy:boolean;remove(id:string):Promise<void>;assign(category:string,value:string):void;target(category:string,value:string):void;transfer(from:string,to:string,value:string):void;cash(value:{name:string;currency:string;amount:string;accountId:string}):void}) {
  const currency=data.settings.currency;
  return <>
    <section className="budget-overview" aria-label="Budget totals"><div><span>Available to assign</span><strong>{money(data.summary.unassignedMinor,currency)}</strong><p>{data.summary.month===data.currentMonth?'After category balances and future assignments.':'Available to assign is shown for the current month only.'}</p></div><div><span>Current cash</span><strong>{money(data.summary.cashMinor,currency)}</strong><p>As of {new Date(data.asOf).toLocaleString()} · credit accounts excluded</p></div></section>
    <section className="budget-section"><h2>Categories</h2><p>Assign money to categories, then expand a row to edit its assignment, target or rollover.</p><div className="budget-ledger-heading" aria-hidden="true"><span>Category</span><span>Assigned</span><span>Activity</span><span>Available</span></div>{data.summary.categories.length?data.summary.categories.map(row=><BudgetCategoryRow key={row.category} row={row} data={data} state={state} currency={currency} onAllocate={assign} onTarget={target} busy={busy}/>):<p>No categories yet. Add an assignment to get started.</p>}<CategoryEditor busy={busy} onSave={assign}/>{data.summary.categories.length>1?<TransferEditor categories={data.summary.categories} busy={busy} onTransfer={transfer}/>:null}</section>
    <BudgetTransactions activity={data.activity} currency={currency}/>
    <section className="budget-section"><h2>Funding balances</h2><p>Custom account balances replace the linked balance for that account. Unavailable or stale balances make the total unavailable.</p>{data.balances.map(item=><div className="budget-balance" key={`${item.source}:${item.id}`}><div><strong>{item.name}</strong><p>{item.source==='excluded'?'Account is no longer eligible for funding':item.source==='unavailable'?'Balance unavailable or stale':item.source==='manual'?'Custom balance':'Lunch Flow balance'}{item.observedAt?` · ${new Date(item.observedAt).toLocaleString()}`:''}</p>{item.sourceMinor!==null && item.sourceCurrency!==currency?<p>Original {money(item.sourceMinor,item.sourceCurrency)} · Approx. rate {item.rate??'unavailable'} · Rate date {item.rateDate??'unavailable'}</p>:null}</div><strong>{money(item.amountMinor,currency)}</strong>{(item.source==='manual'||item.source==='excluded')?<button type="button" disabled={busy} onClick={()=>void remove(item.id)}>Remove</button>:null}</div>)}<CashEditor accounts={accounts} busy={busy} onSave={cash}/></section>
  </>;
}
function BudgetSetup({state}:{state:ReturnType<typeof useBudget>}) {
 return <form className="budget-form" onSubmit={event=>{event.preventDefault();void state.save('settings',{currency:state.currency,startMonth:state.month}).catch(()=>undefined);}}><h2>Choose your budget currency</h2><p>Transactions retain their original currency and use their dated exchange rates.</p><CurrencySelect label="Budget currency" value={state.currency} onChange={state.setCurrency}/><button disabled={state.busy || !getCurrencyMeta(state.currency)}>Create budget</button></form>;
}
function BudgetBody({state,accounts}:{state:ReturnType<typeof useBudget>;accounts:Account[]}) {
  if(!state.snapshot)return null;
  if(!state.snapshot.settings)return <BudgetSetup state={state}/>;
  if(!state.data || state.data.summary.month!==state.month)return null;
  if(state.data.mode==='tracking')return <TrackingBudget key={state.month+'tracking'} data={state.data} state={state}/>;
  return <BudgetDetails key={state.month+'envelope'} state={state} data={state.data} snapshot={state.snapshot} accounts={accounts} busy={state.busy} save={state.save} remove={state.remove} onInvalid={()=>state.setError('Check the amount and details, then try again.')}/>;
}
export function BudgetView({api,initialMonth,accounts}:{api:LedgerApi;initialMonth:string;accounts:Account[]}) {
  const state=useBudget(api,initialMonth);
  return <div className="budget-page"><header className="page-intro"><div><h1>Budget</h1><p>{state.mode==='tracking'?'Compare your monthly plans with confirmed income and spending.':'Give your available money a job, then adjust as life changes.'}</p></div><label>Budget month<input type="month" disabled={state.busy} value={state.month} onChange={e=>state.setMonth(e.target.value)}/></label></header>
    {state.snapshot?.settings?<div className="budget-toolbar"><div className="budget-mode" role="group" aria-label="Budget mode">{(['envelope','tracking'] as const).map(mode=><button key={mode} type="button" aria-pressed={state.mode===mode} disabled={state.busy||state.loading} onClick={()=>void state.changeMode(mode).catch(()=>undefined)}>{mode==='envelope'?'Envelope':'Tracking'}</button>)}</div><p>Budget currency <strong>{state.currency}</strong> · {state.mode==='tracking'?'Forecasts only':'Actual cash funding'}</p></div>:null}
    {state.error?<p role="alert" className="budget-error">{state.error}</p>:null}{state.busy?<p role="status">Saving budget…</p>:state.loading?<p role="status">Loading budget…</p>:null}<BudgetBody state={state} accounts={accounts}/><details className="budget-analysis"><summary>Envelope spending analysis</summary><p>Analysis uses envelope spending history and targets, including while Tracking is selected.</p><AnalysisPanel api={api} month={state.month}/></details>
  </div>;
}
