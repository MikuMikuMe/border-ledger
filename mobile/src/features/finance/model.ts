import type {ActivityQuery,Report,ReportQuery,Transaction,Reporting,Operation} from './contracts';
import currencies from '../../../../contracts/currencies.json';
export const recurringCurrencies=['CAD','CNY','USD','HKD',...currencies.map(c=>c.code).filter(c=>!['CAD','CNY','USD','HKD'].includes(c))];
export const reportingCurrencies=currencies.map(c=>c.code).sort();
export type Window = 'Today'|'Week'|'Month';
export type ReportQueryOptions={window:Window;now:Date;preferences:Reporting;includeProvisional:boolean;currency:string|null;reportingCurrency:string|null};
export function reportQuery({window,now,preferences:p,includeProvisional,currency,reportingCurrency}:ReportQueryOptions):ReportQuery {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.reportingTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(key:string)=>parts.find(v=>v.type===key)!.value;
  const endDate=`${part('year')}-${part('month')}-${part('day')}`,start=new Date(`${endDate}T12:00:00Z`);
  if(window==='Month')start.setUTCDate(1);
  if(window==='Week')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()-p.weekStart+7)%7);
  return {startDate:start.toISOString().slice(0,10),endDate,includeProvisional,currency,reportingCurrency,timeZone:p.reportingTimezone};
}
export function previousReportQuery(query:ReportQuery):ReportQuery {
  const start=new Date(`${query.startDate}T00:00:00Z`),end=new Date(`${query.endDate}T00:00:00Z`);
  const days=Math.round((end.getTime()-start.getTime())/86400000)+1;
  const previousEnd=new Date(start.getTime()-86400000),previousStart=new Date(previousEnd.getTime()-(days-1)*86400000);
  return {...query,startDate:previousStart.toISOString().slice(0,10),endDate:previousEnd.toISOString().slice(0,10)};
}
function comparisonDatesMatch(current:Report,previous:Report,include:boolean,source:string|null) {
  if(![current.from,current.to,previous.from,previous.to].every(Boolean))return false;
  if(!current.from||!current.to)return false;
  const query={startDate:current.from,endDate:current.to,includeProvisional:include,currency:source,reportingCurrency:current.reportingCurrency,timeZone:current.timeZone??''};
  const expected=previousReportQuery(query);
  return Boolean(current.asOf&&previous.asOf&&previous.from===expected.startDate&&previous.to===expected.endDate);
}
function comparisonSettingsMatch(current:Report,previous:Report,include:boolean) {
  const sources=(r:Report)=>r.sourceCoverage.map(v=>v.source).sort().join('|');
  const sameBasis=previous.timeZone===current.timeZone&&previous.timeBasis===current.timeBasis;
  const checks=[sameBasis,previous.includeProvisional===current.includeProvisional,previous.includeProvisional===include,previous.reportingCurrency===current.reportingCurrency,Boolean(sources(current)||sources(previous)),!sources(current)||!sources(previous)||sources(previous)===sources(current),!current.reportingCurrency||[current.fx.complete,previous.fx.complete].every(Boolean)];
  return checks.every(Boolean);
}
export function comparableTotals(current:Report,previous:Report,include:boolean,source:string|null) {
  if(!comparisonDatesMatch(current,previous,include,source)||!comparisonSettingsMatch(current,previous,include))return [];
  const prior=reportView(previous,include,source).totals,currentTotals=reportView(current,include,source).totals;
  const currencies=[...new Set([...currentTotals,...prior].map(value=>value.currency))].sort();
  return currencies.map(currency=>{
    const currentAmount=currentTotals.find(value=>value.currency===currency)?.amount??'0';
    const previousAmount=prior.find(value=>value.currency===currency)?.amount??'0';
    return {currency,previous:previousAmount,difference:(BigInt(currentAmount)-BigInt(previousAmount)).toString()};
  });
}
type CurrencyMeta=typeof currencies[number];
function exactAmount({value,digits}:{value:string;digits:number}){const amount=BigInt(value),negative=amount<0n,absolute=negative?-amount:amount,scale=10n**BigInt(digits);return {negative,integer:absolute/scale,fraction:(absolute%scale).toString().padStart(digits,'0')};}
function grouping(formatter:Intl.NumberFormat){
  const parts=formatter.formatToParts(1234567890123),groups=parts.filter(p=>p.type==='integer');
  return {separator:parts.find(p=>p.type==='group')?.value,primary:groups.at(-1)?.value.length??3,secondary:groups.at(-2)?.value.length??groups.at(-1)?.value.length??3};
}
function localDigits(formatter:Intl.NumberFormat){return Array.from({length:10},(_,n)=>formatter.formatToParts(n).find(p=>p.type==='integer')!.value);}
function localizeDigits({value,digits}:{value:string;digits:string[]}){return value.replace(/\d/g,d=>digits[Number(d)]);}
function groupInteger({value,separator,primary,secondary}:{value:string;separator:string|undefined;primary:number;secondary:number}){
  if(!separator)return value;
  const chunks:string[]=[];let size=primary;let whole=value;
  while(whole.length>size){chunks.unshift(whole.slice(-size));whole=whole.slice(0,-size);size=secondary;}
  chunks.unshift(whole);return chunks.join(separator);
}
function formatExactMoney({value,currency,digits}:{value:string;currency:string;digits:number}){
  const formatter=new Intl.NumberFormat(currency==='CAD'||currency==='CNY'?undefined:'zh-CN',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits});
  const amount=exactAmount({value,digits}),shape=grouping(formatter),localized=localDigits(formatter);
  const whole=localizeDigits({value:groupInteger({value:amount.integer.toString(),separator:shape.separator,primary:shape.primary,secondary:shape.secondary}),digits:localized});
  const fraction=localizeDigits({value:amount.fraction,digits:localized});
  return formatter.formatToParts(amount.negative?-1:1).map(part=>part.type==='fraction'?fraction:part.type==='integer'?whole:part.value).join('');
}
export function formatMoney(value:string,currency:string):string {
  const meta:CurrencyMeta|undefined=currencies.find(c=>c.code===currency);
  return meta?formatExactMoney({value,currency,digits:meta.minorUnitDigits}):`${currency} ${value}`;
}
const sum=({confirmed,provisional,include}:{confirmed:string;provisional:string;include:boolean})=>(BigInt(confirmed)+(include?BigInt(provisional):0n)).toString();
const moneyTotal=({confirmedMinorUnits,provisionalMinorUnits,include}:{confirmedMinorUnits:string;provisionalMinorUnits:string;include:boolean})=>sum({confirmed:confirmedMinorUnits,provisional:provisionalMinorUnits,include});
function sourceTotals({report,include,source}:{report:Report;include:boolean;source:string|null}){return report.currencyTotals.filter(total=>!source||source===total.currency).map(total=>({currency:total.currency,amount:moneyTotal({...total,include})})).sort((a,b)=>a.currency.localeCompare(b.currency));}
function dailyTotals({report,source}:{report:Report;source:string|null}){return report.reportingCurrency?report.convertedDailyTotals.map(daily=>({...daily,currency:report.reportingCurrency!})):report.dailyTotals.filter(daily=>!source||source===daily.currency);}
function currencyOrder(a:string,b:string){const rank=(currency:string)=>currency==='CAD'?0:currency==='CNY'?1:2;return rank(a)-rank(b)||a.localeCompare(b);}
function reportLanes({daily,include}:{daily:Report['dailyTotals'];include:boolean}){
  const currencies=[...new Set(daily.map(value=>value.currency))].sort(currencyOrder);
  return currencies.map(currency=>({currency,points:daily.filter(value=>value.currency===currency).sort((a,b)=>a.date.localeCompare(b.date)).map(value=>({date:value.date,amount:moneyTotal({...value,include}),confirmed:value.confirmedMinorUnits,provisional:value.provisionalMinorUnits}))}));
}
export function fillReportDays(lane:ReturnType<typeof reportLanes>[number],from:string|null,to:string|null) {
  if(!from||!to)return lane;
  const start=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`),count=(end.getTime()-start.getTime())/86400000+1;
  if(!Number.isInteger(count))return lane;
  if(count<1)return lane;
  if(count>31)return lane;
  const points=new Map(lane.points.map(point=>[point.date,point]));
  return {...lane,points:Array.from({length:count},(_,index)=>{
    const date=new Date(start.getTime()+index*86400000).toISOString().slice(0,10);
    return points.get(date)??{date,amount:'0',confirmed:'0',provisional:'0'};
  })};
}
function convertedTotals({report,include}:{report:Report;include:boolean}){const target=report.reportingCurrency;return target&&report.convertedTotals?[{currency:target,amount:moneyTotal({...report.convertedTotals,include})}]:[];}
export function reportView(report:Report,include:boolean,source:string|null) {
  const sourceValues=sourceTotals({report,include,source}),daily=dailyTotals({report,source}),target=report.reportingCurrency;
  return {totals:target?convertedTotals({report,include}):sourceValues,sourceTotals:sourceValues,lanes:reportLanes({daily,include}),unavailable:Boolean(target&&!report.fx.complete&&!daily.length)};
}
function matchesFacets(transaction:Transaction,q:Partial<ActivityQuery>){return (!q.currency||transaction.currency===q.currency)&&(!q.category||transaction.category===q.category)&&(!q.status||transaction.status===q.status)&&(!q.source||transaction.sourceLabel===q.source);}
function searchableValues(transaction:Transaction){return [transaction.merchant,transaction.accountLabel,transaction.status,transaction.sourceLabel,transaction.category,transaction.note];}
function matchesSearch({transaction,search}:{transaction:Transaction;search:string|undefined}){return !search||searchableValues(transaction).some(value=>value?.toLocaleLowerCase().includes(search));}
export function filterActivity(rows:Transaction[],q:Partial<ActivityQuery>):Transaction[] {
  const search=q.query?.trim().toLocaleLowerCase();
  return rows.filter(transaction=>matchesFacets(transaction,q)&&matchesSearch({transaction,search}));
}
export function mergeRows<T extends {id:string;revision:number}>(previous:T[],next:T[]):T[] {
  const map=new Map(previous.map(t=>[t.id,t]));next.forEach(t=>{if(!map.has(t.id)||map.get(t.id)!.revision<=t.revision)map.set(t.id,t);});return [...map.values()];
}
export function recurringMessage(state:string):string {
  return ({waiting:'Recurring history is still being prepared.',incomplete:'Recurring history is incomplete; estimates are limited to observed coverage.',stale:'Showing the last good recurring result; the source is stale.',unavailable:'The recurring product is unavailable for this connection.',error:'The recurring source reported an error.'} as Record<string,string>)[state]??'No recurring streams match these filters.';
}
export type LoadState<T>={phase:'loading'|'ready'|'offline'|'error'|'locked';data:T|null;message:string|null};
export function errorState(error:unknown):{phase:'offline'|'error'|'locked';message:string} {
  const code=(error as {code?:string})?.code;
  if(code==='unauthorized'||code==='not_signed_in')return {phase:'locked',message:'Renew your owner session to continue.'};
  if(code==='offline')return {phase:'offline',message:'Unavailable offline. Showing cached results where available; refresh when online.'};
  return {phase:'error',message:'The native service could not load this view. Try again.'};
}
export class Resource<T> {
  private state:LoadState<T>={phase:'loading',data:null,message:null};private sequence=0;private disposed=false;
  constructor(private changed:()=>void=()=>{}){}
  current=()=>this.state;
  seed(data:T,replace=false){if(this.disposed)return;if(!replace&&this.state.data!==null)return;this.state={...this.state,data};this.changed();}
  reset(){if(!this.disposed){this.sequence++;this.state={phase:'loading',data:null,message:null};this.changed();}}
  lock(){if(!this.disposed){this.sequence++;this.state={phase:'locked',data:null,message:'Renew your owner session to continue.'};this.changed();}}
  async load(read:()=>Promise<T>,retain=true) {
    if(this.disposed)return;const request=++this.sequence;
    this.state={phase:'loading',data:retain?this.state.data:null,message:null};this.changed();
    try {const data=await read();if(request===this.sequence&&!this.disposed){this.state={phase:'ready',data,message:null};this.changed();}}
    catch(error){if(request===this.sequence&&!this.disposed){const failure=errorState(error);this.state={...failure,data:failure.phase==='locked'?null:this.state.data};this.changed();}}
  }
  dispose(){this.disposed=true;this.sequence++;}
}
export class MutationGate {
  private state={blocked:true,status:'checking'};
  private epoch=0;
  constructor(private changed:()=>void=()=>{}){}
  current=()=>this.state;
  private update(blocked:boolean,status:string){this.state={blocked,status};this.changed();}
  async recover(read:(offset:number,limit:number)=>Promise<Operation[]>) {
    if(this.state.status==='saving')return;
    const epoch=++this.epoch;
    this.update(true,'checking');
    try {let offset=0;let pending=false;let page:Operation[];
      do {page=await read(offset,100);if(epoch!==this.epoch)return;pending ||=page.some(op=>!['completed','revision_conflict','canceled','failed_local','rejected'].includes(op.status));offset+=page.length;}while(page.length===100);
      if(epoch===this.epoch)this.update(pending,pending?'reconciliation_required':'ready');
    }catch{if(epoch===this.epoch)this.update(true,'reconciliation_required');}
  }
  async submit(id:string,write:()=>Promise<Operation>,query:(id:string)=>Promise<Operation|null>) {
    if(this.state.blocked)return;++this.epoch;this.update(true,'saving');let result:Operation|null=null;
    try{result=await write();}catch{try{result=await query(id);}catch{/* Never replay a submitted write. */}}
    const status=result?.status??'reconciliation_required';this.update(!['completed','revision_conflict','canceled','failed_local','rejected'].includes(status),status);
  }
}
