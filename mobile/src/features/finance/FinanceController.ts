import type {Snapshot,ActivityQuery,Report,Transactions,Transaction,Stream,Reporting,Lens,RecurringData,FinancePorts} from './contracts';
export type {FinancePorts} from './contracts';
import {mergeRows,MutationGate,reportQuery,Resource} from './model';
// The page controls membership/order; previously observed higher revisions
// control the value for IDs that reappear on refresh or under another filter.
function rememberRows<T extends {id:string;revision:number}>(known:Map<string,T>,rows:T[]):T[] {
  rows.forEach(row=>{if(!known.has(row.id)||known.get(row.id)!.revision<=row.revision)known.set(row.id,row);});
  return rows.map(row=>known.get(row.id)!);
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
      return this.ports.ledger.readReport(reportQuery(this.lens.window,this.now(),preferences,this.lens.include,this.lens.source,this.lens.target));
    },!reset);
  }
  async setLens(lens:Lens){this.lens=lens;this.changed();await this.loadReport(true);}
  async loadActivity(more=false,reset=false) {
    const current=this.activity.current();if(more&&(current.phase==='loading'||!current.data?.nextCursor))return;
    const previous=more?current.data:null;
    const query:ActivityQuery={cursor:previous?.nextCursor??null,limit:50,query:this.activityFilters.query||null,currency:this.activityFilters.currency??null,status:this.activityFilters.status??null,source:this.activityFilters.source??null,category:this.activityFilters.category??null};
    // The cached owner snapshot is the offline fallback, never a fabricated feed.
    if(!more&&!reset&&!current.data&&this.snapshot.current().data)this.activity.seed({items:rememberRows(this.transactions,this.snapshot.current().data!.transactions),nextCursor:null,limit:50});
    await this.activity.load(async()=>{const page=await this.ports.ledger.readTransactions(query);const items=rememberRows(this.transactions,page.items);return {...page,items:previous?mergeRows(rememberRows(this.transactions,previous.items),items):items};},!reset);
    if(this.activity.current().phase==='locked'){this.transactions.clear();this.changed();}
  }
  async filterActivity(filters:Partial<ActivityQuery>){this.activityFilters=filters;await this.loadActivity(false,true);}
  async loadRecurring(more=false,reset=false) {
    const current=this.recurring.current();if(more&&(current.phase==='loading'||!current.data?.page.nextCursor))return;
    const previous=more?current.data:null,query={cursor:previous?.page.nextCursor??null,limit:50,currency:this.recurringFilters.currency??null,classification:this.recurringFilters.classification??null};
    await this.recurring.load(async()=>{
      const today=reportQuery('Today',this.now(),{reportingTimezone:'America/Toronto',weekStart:1,preferredCurrency:null,revision:0,updatedAt:null},false,null,null).endDate;
      const start=new Date(`${today}T12:00:00Z`),end=new Date(start);const month=start.getUTCMonth();start.setUTCFullYear(start.getUTCFullYear()-1);if(start.getUTCMonth()!==month)start.setUTCDate(0);end.setUTCDate(end.getUTCDate()+30);
      const [page,summary]=await Promise.all([this.ports.recurring.readPage(query),previous?Promise.resolve(previous.summary):this.ports.recurring.readSummary(start.toISOString().slice(0,10),end.toISOString().slice(0,10))]);
      rememberRows(this.streams,[...page.items,...(summary?.upcoming.map(u=>u.stream)??[]),...(summary?.latestPaymentChanges??[])]);
      const items=rememberRows(this.streams,page.items);
      return {page:{...page,items:previous?mergeRows(rememberRows(this.streams,previous.page.items),items):items},summary:summary?{...summary,upcoming:summary.upcoming.map(u=>({...u,stream:this.streams.get(u.stream.id)!})),latestPaymentChanges:rememberRows(this.streams,summary.latestPaymentChanges)}:null};
    },!reset);
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
  dispose(){this.disposed=true;this.subscriptions.forEach(s=>s.remove());this.snapshot.dispose();this.report.dispose();this.activity.dispose();this.recurring.dispose();this.transactions.clear();this.streams.clear();}
}
