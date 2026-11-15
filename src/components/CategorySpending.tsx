import {useEffect,useRef,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import {formatDate,formatMoney} from '../domain/format';
import type {Transaction} from '../domain/types';
import {TransactionDetail} from './TransactionDetail';
type Category={name:string;archived:boolean};
type Total={currency:string;confirmedMinorUnits:number;provisionalMinorUnits:number};
type Report={currencyTotals:Total[];reportingCurrency:string|null;convertedTotals:{confirmedMinorUnits:number;provisionalMinorUnits:number}|null;fx?:{complete:boolean}};
type Item=Omit<Transaction,'fingerprint'|'annotationRevision'|'note'>&{note:string|null;revision:number};
type Page={items:Item[];page:{nextCursor:string|null}};
type Props={api:LedgerApi;from:string;to:string;timeZone:string;includeProvisional:boolean;reportingCurrency:string|null;onChanged?():Promise<void>};
function CategoryTotals({report,includeProvisional}:{report:Report;includeProvisional:boolean}) {
 const converted=report.convertedTotals;
 return <div aria-live="polite">{report.currencyTotals.length?report.currencyTotals.map(total=><p key={total.currency}>{total.currency}: {formatMoney(total.confirmedMinorUnits+(includeProvisional?total.provisionalMinorUnits:0),total.currency)}</p>):<p>No spending in this period.</p>}{converted&&report.reportingCurrency?<p>Converted: {report.fx?.complete===false?'Unavailable for some transactions':formatMoney(converted.confirmedMinorUnits+(includeProvisional?converted.provisionalMinorUnits:0),report.reportingCurrency)}</p>:null}</div>;
}
function CategoryActivity({items,cursor,busy,load,setSelected}:{items:Item[];cursor:string|null;busy:boolean;load(next:string|null):Promise<void>;setSelected(value:Transaction):void}) {
 return <><p>All activity in this category and period, including items excluded from spending.</p><ul>{items.map(item=><li key={item.id}><button type="button" className="text-button" onClick={()=>setSelected({...item,note:item.note??undefined,fingerprint:'',annotationRevision:item.revision})}>{item.merchant}</button> · {formatDate(item.date)} · {item.kind} · {item.status} · {item.kind==='income'||item.kind==='refund'?'+':item.kind==='transfer'?'↔ ':'− '}{formatMoney(Math.abs(item.amountMinor),item.currency,{signDisplay:'never'})}</li>)}</ul>{cursor?<button type="button" className="outline-button" disabled={busy} onClick={()=>{void load(cursor);}}>Load more</button>:null}</>;
}
export function CategorySpending({api,from,to,timeZone,includeProvisional,reportingCurrency,onChanged=async()=>{}}:Props) {
 const [categories,setCategories]=useState<Category[]>([]),[category,setCategory]=useState(''),[report,setReport]=useState<Report|null>(null),[items,setItems]=useState<Item[]>([]),[cursor,setCursor]=useState<string|null>(null),[opened,setOpened]=useState(false),[selected,setSelected]=useState<Transaction|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{let active=true;void api<{categories:Category[]}>('/api/categories').then(value=>{if(!Array.isArray(value.categories))throw new Error('Invalid category response');if(active)setCategories(value.categories);}).catch(()=>{if(active)setError('Could not load categories.');});return()=>{active=false;};},[api,refresh]);
 useEffect(()=>{const current=++generation.current;setItems([]);setOpened(false);setCursor(null);setReport(null);setBusy(false);setLoading(Boolean(category));setError('');if(!category)return;
  const params=new URLSearchParams({from,to,timeZone,category,includeProvisional:String(includeProvisional)});if(reportingCurrency)params.set('reportingCurrency',reportingCurrency);
  void api<Report>(`/api/reports/summary?${params}`).then(value=>{if(current===generation.current){setReport(value);setLoading(false);}}).catch(()=>{if(current===generation.current){setLoading(false);setError('Could not load category spending.');}});
  return()=>{generation.current++;};
 },[api,category,from,to,timeZone,includeProvisional,reportingCurrency,refresh]);
 const load=async(next:string|null)=>{const current=generation.current;setBusy(true);setError('');try{const params=new URLSearchParams({category,from,to,limit:'50'});if(next)params.set('cursor',next);const page=await api<Page>(`/api/category-activity?${params}`);if(current!==generation.current)return;setItems(previous=>next?[...previous,...page.items]:page.items);setCursor(page.page.nextCursor);setOpened(true);}catch{if(current===generation.current)setError('Could not load category activity.');}finally{if(current===generation.current)setBusy(false);}};
 return <section className="panel category-spending"><h2>Spending by category</h2><p>For {from} to {to}, using your report settings.</p><label>Category<select value={category} onChange={event=>setCategory(event.target.value)}><option value="">Choose a category</option>{categories.map(item=><option key={item.name} value={item.name}>{item.name}{item.archived?' (archived)':''}</option>)}</select></label>{loading?<p role="status">Loading category spending…</p>:null}{category&&report?<><CategoryTotals report={report} includeProvisional={includeProvisional}/><button type="button" className="outline-button" disabled={busy} onClick={()=>{void load(null);}}>View activity</button></>:null}{opened?<CategoryActivity items={items} cursor={cursor} busy={busy} load={load} setSelected={setSelected}/>:null}{selected?<TransactionDetail transaction={selected} api={api} onChanged={async()=>{await onChanged();setRefresh(current=>current+1);}} onClose={()=>setSelected(null)}/>:null}{error?<div role="alert"><p>{error}</p><button type="button" className="outline-button" onClick={()=>setRefresh(current=>current+1)}>Retry</button></div>:null}</section>;
}
