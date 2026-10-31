import {AnalysisPanel} from './AnalysisPanel';
import {useRef,useState} from 'react';
import {useBudget} from './useBudget';
import type {LedgerApi} from '../domain/api';
import {getCurrencyMeta,parseMoneyMinor,supportedCurrencyCodes} from '../domain/currencies';
import {formatMoney} from '../domain/format';
import type {BudgetCategorySummary} from '../domain/budget-summary';

type Account={id:string;name:string;currency:string};
type Balance={id:string;accountId?:string;name:string;source:'manual'|'lunchflow'|'unavailable'|'excluded';sourceCurrency:string;sourceMinor:number|null;amountMinor:number|null;observedAt:string|null;rateDate:string|null;rate?:string|null};
export type BudgetSnapshot={settings:{currency:string}|null;cash:{id:string;name:string;currency:string;amountMinor:number;accountId?:string}[]};
type SuggestedCategory=BudgetCategorySummary & {suggestionBasis?:'target'|'history'|null};
export type BudgetViewData={settings:{currency:string};currentMonth:string;summary:{month:string;cashMinor:number|null;unassignedMinor:number|null;categories:SuggestedCategory[]};balances:Balance[];activity:{id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null}[];asOf:string;startMonth:string};
const money=(value:number|null,currency:string)=>value===null?'Unavailable':formatMoney(value,currency);
function decimalAmount(value:number,currency:string) {const digits=getCurrencyMeta(currency)?.minorUnitDigits??2;const negative=value<0;const n=BigInt(Math.abs(value)),scale=10n**BigInt(digits);return (negative?'-':'')+(digits?`${n/scale}.${(n%scale).toString().padStart(digits,'0')}`:n.toString());}
function CurrencySelect({value,onChange,label}:{value:string;onChange(value:string):void;label:string}) {
  return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{supportedCurrencyCodes.map(code=><option key={code} value={code}>{code}</option>)}</select></label>;
}
function CategoryRow({row,currency,onAllocate,onTarget,busy}:{row:SuggestedCategory;currency:string;onAllocate(category:string,amount:string):void;onTarget(category:string,amount:string):void;busy:boolean}) {
  const [allocation,setAllocation]=useState(''),[target,setTarget]=useState('');
  return <div className="budget-category">
    <div><h3>{row.category}</h3><p>Available <strong>{money(row.availableMinor,currency)}</strong>{row.missingTransactionIds.length?' · Some exchange rates are unavailable':''}</p><p>Carried {money(row.openingMinor,currency)} · Assigned {money(row.assignedMinor,currency)} · Activity {money(row.activityMinor,currency)}</p><p>Target {row.targetMinor===null?'Not set':money(row.targetMinor,currency)}{row.suggestedMinor!==null?` · Suggested ${money(row.suggestedMinor,currency)}`:''}</p></div>
    <div className="budget-actions">{row.suggestedMinor!==null?<button className="budget-suggestion" type="button" disabled={busy || !Number.isSafeInteger(row.assignedMinor+row.suggestedMinor)} onClick={()=>setAllocation(decimalAmount(row.assignedMinor+row.suggestedMinor!,currency))}>Use {row.suggestionBasis==='history'?'spending':'target'} suggestion</button>:null}<label>Set this month’s assignment<input aria-label={`Assignment for ${row.category}`} inputMode="decimal" value={allocation} onChange={e=>setAllocation(e.target.value)} /></label><button type="button" disabled={busy} onClick={()=>onAllocate(row.category,allocation)}>Save assignment</button><label>Monthly target<input aria-label={`Target for ${row.category}`} inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)} /></label><button type="button" disabled={busy} onClick={()=>onTarget(row.category,target)}>Save target</button></div>
  </div>;
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
function BudgetDetails({data,snapshot,accounts,busy,save,remove,onInvalid}:{data:BudgetViewData;snapshot:BudgetSnapshot;accounts:Account[];busy:boolean;save(path:string,value:unknown):Promise<void>;remove(id:string):Promise<void>;onInvalid():void}) {
  const currency=data.settings.currency,transferId=useRef<string|null>(null),cashId=useRef<string|null>(null);
  const amount=(value:string)=>parseMoneyMinor(value.trim(),currency);
  const run=async(path:string,build:()=>unknown,onSuccess?:()=>void)=>{try{await save(path,build());onSuccess?.();}catch{onInvalid();}};
  const assign=(category:string,value:string)=>void run('allocations',()=>({month:data.summary.month,category:category.trim(),assignedMinor:amount(value)}));
  const target=(category:string,value:string)=>void run('targets',()=>({category:category.trim(),targetMinor:amount(value)}));
  const transfer=(from:string,to:string,value:string)=>{transferId.current??=crypto.randomUUID();void run('transfers',()=>({id:transferId.current,month:data.summary.month,from,to,amountMinor:amount(value)}),()=>{transferId.current=null;});};
  const cash=(value:{name:string;currency:string;amount:string;accountId:string})=>{cashId.current??=crypto.randomUUID();const existing=snapshot.cash.find(item=>item.accountId && item.accountId===value.accountId);void run('cash',()=>({id:existing?.id??cashId.current,name:value.name.trim(),currency:value.currency,amountMinor:parseMoneyMinor(value.amount.trim(),value.currency),...(value.accountId?{accountId:value.accountId}:{})}),()=>{cashId.current=null;});};
  return <BudgetDetailsContent data={data} accounts={accounts} busy={busy} remove={remove} assign={assign} target={target} transfer={transfer} cash={cash}/>;
}
function BudgetDetailsContent({data,accounts,busy,remove,assign,target,transfer,cash}:{data:BudgetViewData;accounts:Account[];busy:boolean;remove(id:string):Promise<void>;assign(category:string,value:string):void;target(category:string,value:string):void;transfer(from:string,to:string,value:string):void;cash(value:{name:string;currency:string;amount:string;accountId:string}):void}) {
  const currency=data.settings.currency;
  return <>
    <section className="budget-overview" aria-label="Budget totals"><div><span>Available to assign</span><strong>{money(data.summary.unassignedMinor,currency)}</strong><p>{data.summary.month===data.currentMonth?'After category balances and future assignments.':'Available to assign is shown for the current month only.'}</p></div><div><span>Current cash</span><strong>{money(data.summary.cashMinor,currency)}</strong><p>As of {new Date(data.asOf).toLocaleString()} · credit accounts excluded</p></div></section>
    <section className="budget-section"><h2>Categories</h2><p>Assign money to categories. Unused funds and overspending carry forward.</p>{data.summary.categories.length?data.summary.categories.map(row=><CategoryRow key={row.category} row={row} currency={currency} onAllocate={assign} onTarget={target} busy={busy}/>):<p>No categories yet. Add an assignment to get started.</p>}<CategoryEditor busy={busy} onSave={assign}/>{data.summary.categories.length>1?<TransferEditor categories={data.summary.categories} busy={busy} onTransfer={transfer}/>:null}</section>
    <details className="budget-section"><summary>View counted transactions</summary><p>Confirmed spending and refunds since the budget started. Converted amounts use the transaction’s stored date.</p>{data.activity.length?data.activity.map(item=><div className="budget-balance" key={item.id}><div><strong>{item.category} · {item.date}</strong><p>Original {money(item.sourceMinor,item.sourceCurrency)}{item.sourceCurrency!==currency?` · Approx. rate ${item.rate??'unavailable'} · Rate date ${item.rateDate??'unavailable'}`:''}</p></div><strong>{money(item.activityMinor,currency)}</strong></div>):<p>No confirmed budget activity in this period.</p>}</details>
    <section className="budget-section"><h2>Funding balances</h2><p>Custom account balances replace the linked balance for that account. Unavailable or stale balances make the total unavailable.</p>{data.balances.map(item=><div className="budget-balance" key={`${item.source}:${item.id}`}><div><strong>{item.name}</strong><p>{item.source==='excluded'?'Account is no longer eligible for funding':item.source==='unavailable'?'Balance unavailable or stale':item.source==='manual'?'Custom balance':'Lunch Flow balance'}{item.observedAt?` · ${new Date(item.observedAt).toLocaleString()}`:''}</p>{item.sourceMinor!==null && item.sourceCurrency!==currency?<p>Original {money(item.sourceMinor,item.sourceCurrency)} · Approx. rate {item.rate??'unavailable'} · Rate date {item.rateDate??'unavailable'}</p>:null}</div><strong>{money(item.amountMinor,currency)}</strong>{(item.source==='manual'||item.source==='excluded')?<button type="button" disabled={busy} onClick={()=>void remove(item.id)}>Remove</button>:null}</div>)}<CashEditor accounts={accounts} busy={busy} onSave={cash}/></section>
  </>;
}
function BudgetBody({state,accounts}:{state:ReturnType<typeof useBudget>;accounts:Account[]}) {
  if(state.loading) return null;
  if(state.snapshot && !state.snapshot.settings) return <form className="budget-form" onSubmit={event=>{event.preventDefault();void state.save('settings',{currency:state.currency,startMonth:state.month}).catch(()=>undefined);}}><h2>Choose your budget currency</h2><p>Transactions retain their original currency and use their dated exchange rates.</p><CurrencySelect label="Budget currency" value={state.currency} onChange={state.setCurrency}/><button disabled={state.busy || !getCurrencyMeta(state.currency)}>Create budget</button></form>;
  if(!state.data || !state.snapshot) return null;
  return <BudgetDetails data={state.data} snapshot={state.snapshot} accounts={accounts} busy={state.busy} save={state.save} remove={state.remove} onInvalid={()=>state.setError('Check the amount and details, then try again.')}/>;
}
export function BudgetView({api,initialMonth,accounts}:{api:LedgerApi;initialMonth:string;accounts:Account[]}) {
  const state=useBudget(api,initialMonth);
  return <div className="budget-page"><header className="page-intro"><div><h1>Budget</h1><p>Give your available money a job, then adjust as life changes.</p></div><label>Budget month<input type="month" value={state.month} onChange={e=>state.setMonth(e.target.value)}/></label></header>
    {state.error?<p role="alert" className="budget-error">{state.error}</p>:null}{state.loading?<p role="status">Loading budget…</p>:null}<BudgetBody state={state} accounts={accounts}/><AnalysisPanel api={api} month={state.month}/>
  </div>;
}
