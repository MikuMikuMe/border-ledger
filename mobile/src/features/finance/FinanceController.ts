import type {Snapshot,ActivityQuery,Report,Transactions,Transaction,Stream,Reporting,Lens,RecurringData,FinancePorts,Page,Summary} from './contracts';
export type {FinancePorts} from './contracts';
import {mergeRows,MutationGate,reportQuery,Resource,type LoadState} from './model';
const PAGE_SIZE=50;
// The page controls membership/order; previously observed higher revisions
// control the value for IDs that reappear on refresh or under another filter.
function rememberRows<T extends {id:string;revision:number}>(known:Map<string,T>,rows:T[]):T[] {
  rows.forEach(row=>{if(!known.has(row.id)||known.get(row.id)!.revision<=row.revision)known.set(row.id,row);});
  return rows.map(row=>known.get(row.id)!);
}
function activityPaginationBlocked(state:LoadState<Transactions>,more:boolean){
  if(!more)return false;
  if(state.phase==='loading')return true;
  return !state.data?.nextCursor;
}
function recurringPaginationBlocked(state:LoadState<RecurringData>,more:boolean){
  if(!more)return false;
  if(state.phase==='loading')return true;
  return !state.data?.page.nextCursor;
}
function activityQuery(filters:Partial<ActivityQuery>,cursor:string|null):ActivityQuery {
  return {cursor,limit:PAGE_SIZE,query:filters.query||null,currency:filters.currency??null,status:filters.status??null,source:filters.source??null,category:filters.category??null};
}
function recurringQuery(filters:{currency?:string|null;classification?:string|null},cursor:string|null){
  return {cursor,limit:PAGE_SIZE,currency:filters.currency??null,classification:filters.classification??null};
}
function shouldSeedActivity(state:LoadState<Transactions>,more:boolean,reset:boolean,snapshot:Snapshot|null){return !more&&!reset&&!state.data&&Boolean(snapshot);}
function recurringRange(now:Date){
  const today=reportQuery({window:'Today',now,preferences:{reportingTimezone:'America/Toronto',weekStart:1,preferredCurrency:null,revision:0,updatedAt:null},includeProvisional:false,currency:null,reportingCurrency:null}).endDate;
  const start=new Date(`${today}T12:00:00Z`),end=new Date(start),month=start.getUTCMonth();
  start.setUTCFullYear(start.getUTCFullYear()-1);if(start.getUTCMonth()!==month)start.setUTCDate(0);end.setUTCDate(end.getUTCDate()+30);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
function mergeSummary(summary:Summary,streams:Map<string,Stream>):Summary {
  return {...summary,upcoming:summary.upcoming.map(item=>({...item,stream:streams.get(item.stream.id)!})),latestPaymentChanges:rememberRows(streams,summary.latestPaymentChanges)};
}
export class FinanceController {
  readonly snapshot:Resource<Snapshot|null>;readonly report:Resource<Report>;readonly activity:Resource<Transactions>;readonly recurring:Resource<RecurringData>;readonly mutation:MutationGate;
  lens:Lens={window:'Month',include:false,source:null,target:null};
  activityFilters:Partial<ActivityQuery>={};recurringFilters:{currency?:string|null;classification?:string|null}={};
  private preferences:Reporting|null=null;private subscriptions:{remove():void}[]=[];private disposed=false;
  private transactions=new Map<string,Transaction>();private streams=new Map<string,Stream>();
  get activityFacetRows():Transaction[]{return [...this.transactions.values()];}
  constructor(private ports:FinancePorts,private changed:()=>void=()=>{},private now:()=>Date=()=>new Date()) {
    this.snapshot=new Resource(changed);this.report=new Resource(changed);this.activity=new Resource(changed);this.recurring=new Resource(changed);this.mutation=new MutationGate(changed);
  }
  async start() {
    this.subscriptions=[this.ports.ledger.onChanged(()=>{void this.reload(false);}),this.ports.recurring.onChanged(()=>{void this.loadRecurring();})];
    await Promise.all([this.recover(),this.reload(false)]);
  }
  async recover(){await this.mutation.recover((offset,limit)=>this.ports.session.readOperations(offset,limit));}
  async reload(refresh=true) {
    await this.snapshot.load(()=>refresh?this.ports.ledger.refreshSnapshot():this.ports.ledger.getSnapshot());
    if(this.disposed)return;
    await Promise.all([this.loadReport(),this.loadActivity()]);
  }
  async loadReport(reset=false) {
    await this.report.load(async()=>{
      const preferences=await this.ports.preferences.readReporting();this.preferences=preferences;
      return this.ports.ledger.readReport(reportQuery({window:this.lens.window,now:this.now(),preferences,includeProvisional:this.lens.include,currency:this.lens.source,reportingCurrency:this.lens.target}));
    },!reset);
  }
  async setLens(lens:Lens){this.lens=lens;this.changed();await this.loadReport(true);}
  async loadActivity(more=false,reset=false) {
    const current=this.activity.current();if(activityPaginationBlocked(current,more))return;
    const previous=more?current.data:null,query=activityQuery(this.activityFilters,previous?.nextCursor??null);
    // The cached owner snapshot is the offline fallback, never a fabricated feed.
    const snapshot=this.snapshot.current().data;if(shouldSeedActivity(current,more,reset,snapshot))this.activity.seed({items:rememberRows(this.transactions,snapshot!.transactions),nextCursor:null,limit:PAGE_SIZE});
    await this.activity.load(()=>this.readActivityPage(query,previous),!reset);
    this.clearActivityCacheWhenLocked();
  }
  async filterActivity(filters:Partial<ActivityQuery>){this.activityFilters=filters;await this.loadActivity(false,true);}
  async loadRecurring(more=false,reset=false) {
    const current=this.recurring.current();if(recurringPaginationBlocked(current,more))return;
    const previous=more?current.data:null,query=recurringQuery(this.recurringFilters,previous?.page.nextCursor??null);
    await this.recurring.load(()=>this.readRecurringPage(query,previous),!reset);
    if(this.recurring.current().phase==='locked')this.streams.clear();
  }
  async filterRecurring(filters:{currency?:string|null;classification?:string|null}){this.recurringFilters=filters;await this.loadRecurring(false,true);}
  async annotate(id:string,transaction:Transaction,draft:{category:string;note:string}) {
    if(!draft.category.trim()||this.mutation.current().status==='revision_conflict')return;
    await this.mutation.submit(id,()=>this.ports.review.startAnnotate(id,{transactionId:transaction.id,expectedRevision:transaction.revision,category:draft.category.trim().slice(0,80),note:draft.note.trim()?draft.note.slice(0,1000):null}),key=>this.ports.session.queryOperation(key));
    if(!this.disposed&&this.mutation.current().status==='completed')await this.reload(false);
  }
  async classify(id:string,stream:Stream,classification:string) {
    if(this.mutation.current().status==='revision_conflict')return;
    await this.mutation.submit(id,()=>this.ports.recurring.startClassify(id,stream.id,stream.revision,classification),key=>this.ports.session.queryOperation(key));
    if(!this.disposed&&this.mutation.current().status==='completed')await this.loadRecurring();
  }
  private async readActivityPage(query:ActivityQuery,previous:Transactions|null):Promise<Transactions>{
    const page=await this.ports.ledger.readTransactions(query),items=rememberRows(this.transactions,page.items);
    return {...page,items:previous?mergeRows(rememberRows(this.transactions,previous.items),items):items};
  }
  private clearActivityCacheWhenLocked(){if(this.activity.current().phase!=='locked')return;this.transactions.clear();this.changed();}
  private async readRecurringPage(query:ReturnType<typeof recurringQuery>,previous:RecurringData|null):Promise<RecurringData>{
    const range=recurringRange(this.now()),summaryPromise=previous?Promise.resolve(previous.summary):this.ports.recurring.readSummary(range.start,range.end);
    const [page,summary]=await Promise.all([this.ports.recurring.readPage(query),summaryPromise]);
    rememberRows(this.streams,[...page.items,...(summary?.upcoming.map(item=>item.stream)??[]),...(summary?.latestPaymentChanges??[])]);
    const items=rememberRows(this.streams,page.items),mergedPage:Page={...page,items:previous?mergeRows(rememberRows(this.streams,previous.page.items),items):items};
    return {page:mergedPage,summary:summary?mergeSummary(summary,this.streams):null};
  }
  dispose(){this.disposed=true;this.subscriptions.forEach(s=>s.remove());this.snapshot.dispose();this.report.dispose();this.activity.dispose();this.recurring.dispose();this.transactions.clear();this.streams.clear();}
}
