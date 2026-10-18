import type {ActivityQuery,Report,ReportQuery,Transaction,Reporting,Operation} from './contracts';
import currencies from '../../../../contracts/currencies.json';
export const recurringCurrencies=['CAD','CNY','USD','HKD',...currencies.map(c=>c.code).filter(c=>!['CAD','CNY','USD','HKD'].includes(c))];
export const reportingCurrencies=currencies.map(c=>c.code).sort();
export type Window = 'Today'|'Week'|'Month';
export function reportQuery(window:Window,now:Date,p:Reporting,includeProvisional:boolean,currency:string|null,reportingCurrency:string|null):ReportQuery {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.reportingTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(key:string)=>parts.find(v=>v.type===key)!.value;
  const endDate=`${part('year')}-${part('month')}-${part('day')}`,start=new Date(`${endDate}T12:00:00Z`);
  if(window==='Month')start.setUTCDate(1);
  if(window==='Week')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()-p.weekStart+7)%7);
  return {startDate:start.toISOString().slice(0,10),endDate,includeProvisional,currency,reportingCurrency,timeZone:p.reportingTimezone};
}
export function formatMoney(value:string,currency:string):string {
  const meta=currencies.find(c=>c.code===currency);
  if(!meta)return `${currency} ${value}`;
  const digits=meta.minorUnitDigits;
  const formatter=new Intl.NumberFormat(currency==='CAD'||currency==='CNY'?undefined:'zh-CN',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits});
  const amount=BigInt(value),negative=amount<0n,abs=negative?-amount:amount,scale=10n**BigInt(digits),integer=abs/scale,fraction=(abs%scale).toString().padStart(digits,'0');
  // Hermes Intl accepts Number only. Ask it for locale structure using small
  // samples, then insert exact decimal digits without converting the amount.
  const grouped=formatter.formatToParts(1234567890123),groups=grouped.filter(p=>p.type==='integer');
  const separator=grouped.find(p=>p.type==='group')?.value;
  const primary=groups.at(-1)?.value.length??3,secondary=groups.at(-2)?.value.length??primary;
  const localizedDigits=Array.from({length:10},(_,n)=>formatter.formatToParts(n).find(p=>p.type==='integer')!.value);
  const localize=(s:string)=>s.replace(/\d/g,d=>localizedDigits[Number(d)]);
  let whole=integer.toString();const chunks:string[]=[];
  if(separator){let size=primary;while(whole.length>size){chunks.unshift(whole.slice(-size));whole=whole.slice(0,-size);size=secondary;}chunks.unshift(whole);whole=chunks.join(separator);}
  return formatter.formatToParts(negative?-1:1).map(p=>p.type==='fraction'?localize(fraction):p.type==='integer'?localize(whole):p.value).join('');
}
const sum=(a:string,b:string,include:boolean)=>(BigInt(a)+(include?BigInt(b):0n)).toString();
export function reportView(report:Report,include:boolean,source:string|null) {
  const target=report.reportingCurrency;
  const sourceTotals=report.currencyTotals.filter(t=>!source||source===t.currency).map(t=>({currency:t.currency,amount:sum(t.confirmedMinorUnits,t.provisionalMinorUnits,include)})).sort((a,b)=>a.currency.localeCompare(b.currency));
  const totals=target?(report.convertedTotals?[{currency:target,amount:sum(report.convertedTotals.confirmedMinorUnits,report.convertedTotals.provisionalMinorUnits,include)}]:[]):sourceTotals;
  const daily=target?report.convertedDailyTotals.map(d=>({...d,currency:target})):report.dailyTotals.filter(d=>!source||source===d.currency);
  const currencies=[...new Set(daily.map(d=>d.currency))].sort((a,b)=>(a==='CAD'?0:a==='CNY'?1:2)-(b==='CAD'?0:b==='CNY'?1:2)||a.localeCompare(b));
  const lanes=currencies.map(currency=>({currency,points:daily.filter(d=>d.currency===currency).sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({date:d.date,amount:sum(d.confirmedMinorUnits,d.provisionalMinorUnits,include),confirmed:d.confirmedMinorUnits,provisional:d.provisionalMinorUnits}))}));
  return {totals,sourceTotals,lanes,unavailable:!!target&&!report.fx.complete&&daily.length===0};
}
export function filterActivity(rows:Transaction[],q:Partial<ActivityQuery>):Transaction[] {
  const search=q.query?.trim().toLocaleLowerCase();
  return rows.filter(t=>(!q.currency||t.currency===q.currency)&&(!q.category||t.category===q.category)&&(!q.status||t.status===q.status)&&(!q.source||t.sourceLabel===q.source)&&(!search||[t.merchant,t.accountLabel,t.status,t.sourceLabel,t.category,t.note].some(s=>s?.toLocaleLowerCase().includes(search))));
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
  seed(data:T,replace=false){if(!this.disposed&&(replace||this.state.data===null)){this.state={...this.state,data};this.changed();}}
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
