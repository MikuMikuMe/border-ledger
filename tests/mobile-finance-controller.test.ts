import {describe,it,expect} from 'vitest';
import {FinanceController,type FinancePorts} from '../mobile/src/features/finance/FinanceController';
import {report,transaction,stream} from './fixtures/mobile-finance';
const snapshot={schemaVersion:1,snapshotAt:'2026-10-17T12:00:00Z',timeZone:'America/Toronto',accounts:[],transactions:[transaction],recurring:[],reviews:[],report};
function fixture(){
  let listener=()=>{};let removed=0;const reads:unknown[]=[];const writes:unknown[]=[];
  const ports:FinancePorts={ledger:{getSnapshot:async()=>snapshot,refreshSnapshot:async()=>snapshot,readReport:async q=>{reads.push(q);return report;},readTransactions:async q=>{reads.push(q);return {items:[transaction],nextCursor:null,limit:50};},onChanged:cb=>{listener=cb;return {remove:()=>{removed++;}};}},recurring:{readPage:async q=>{reads.push(q);return {items:[stream],nextCursor:null,limit:50,state:'ready',checkedAt:null,sourceUpdatedAt:null,lastError:null,coverageWarnings:[]};},readSummary:async()=>({monthlyByCurrency:[],yearlyByCurrency:[],subscriptionByCurrency:[],actualCostByCurrency:[],upcoming:[],latestPaymentChanges:[],streamCount:1,state:'ready',coverageWarnings:[],checkedAt:null,sourceUpdatedAt:null,lastError:null}),startClassify:async(...args)=>{writes.push(args);return {operationId:args[0],kind:'recurring_classify',status:'completed',updatedAt:'2026-10-17',resultId:null};},onChanged:()=>({remove:()=>{removed++;}})},preferences:{readReporting:async()=>({reportingTimezone:'America/Toronto',weekStart:1,preferredCurrency:'CAD',revision:3,updatedAt:null})},review:{startAnnotate:async(...args)=>{writes.push(args);return {operationId:args[0],kind:'annotate',status:'completed',updatedAt:'2026-10-17',resultId:null};}},session:{readOperations:async()=>[],queryOperation:async()=>null}};
  return {ports,reads,writes,emit:()=>listener(),removed:()=>removed};
}
describe('native screen controller',()=>{
  it('loads native preferences, snapshot and full-window report without implicit FX',async()=>{
    const f=fixture(),c=new FinanceController(f.ports,()=>{},()=>new Date('2026-10-17T12:00:00Z'));
    await c.start();expect(c.report.current().data).toEqual(report);
    expect(f.reads).toContainEqual({startDate:'2026-10-01',endDate:'2026-10-17',timeZone:'America/Toronto',currency:null,reportingCurrency:null,includeProvisional:false});
    c.dispose();expect(f.removed()).toBe(2);
  });
  it('loads a separate equal-length preceding report and clears it on failure',async()=>{
    const f=fixture(),c=new FinanceController(f.ports,()=>{},()=>new Date('2026-10-17T12:00:00Z'));
    await c.start();
    expect(f.reads).toContainEqual({startDate:'2026-09-14',endDate:'2026-09-30',timeZone:'America/Toronto',currency:null,reportingCurrency:null,includeProvisional:false});
    f.ports.ledger.readReport=async query=>{if(query.startDate==='2026-09-14')throw {code:'offline'};return report;};
    await c.loadReport();await new Promise(resolve=>setTimeout(resolve,0));
    expect(c.previousReport.current()).toMatchObject({phase:'offline',data:null});
    expect(c.report.current().phase).toBe('ready');c.dispose();
  });
  it('sends every Activity filter to the server, resets cursor and retains cached rows offline',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.start();
    await c.filterActivity({query:'Cafe',currency:'CAD',category:'Food',status:'confirmed',source:'plaid'});
    expect(f.reads.at(-1)).toEqual({cursor:null,limit:50,query:'Cafe',currency:'CAD',category:'Food',status:'confirmed',source:'plaid'});
    f.ports.ledger.readTransactions=async()=>{throw {code:'offline'};};await c.loadActivity();
    expect(c.activity.current()).toMatchObject({phase:'offline',data:{items:[transaction]}});c.dispose();
  });
  it('submits the displayed revision exactly once and refreshes after a completed annotation',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.start();
    await c.annotate('fixture_write',transaction,{category:' Food ',note:'Draft'});
    expect(f.writes).toEqual([['fixture_write',{transactionId:'fixture_tx',expectedRevision:3,category:'Food',note:'Draft'}]]);
    expect(c.mutation.current().status).toBe('completed');c.dispose();
  });
  it('classifies with the selected revision and never changes posted-cost math locally',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.start();await c.loadRecurring();
    await c.classify('fixture_write',stream,'excluded');
    expect(f.writes).toEqual([['fixture_write','fixture_stream',4,'excluded']]);
    expect(c.recurring.current().data?.summary?.actualCostByCurrency).toEqual([]);c.dispose();
  });
  it('preserves the Compose recurring summary year-back and next-30-days window',async()=>{
    const f=fixture();let dates:unknown;
    f.ports.recurring.readSummary=async(...args)=>{dates=args;return {monthlyByCurrency:[],yearlyByCurrency:[],subscriptionByCurrency:[],actualCostByCurrency:[],upcoming:[],latestPaymentChanges:[],streamCount:0,state:'empty',coverageWarnings:[],checkedAt:null,sourceUpdatedAt:null,lastError:null};};
    const c=new FinanceController(f.ports,()=>{},()=>new Date('2026-10-17T12:00:00Z'));await c.start();await c.loadRecurring();
    expect(dates).toEqual(['2025-10-17','2026-11-16']);c.dispose();
  });
  it('does not let cached-row seeding overwrite a newer Activity filter request',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.snapshot.load(f.ports.ledger.getSnapshot);
    let finish!:(v:any)=>void;
    f.ports.ledger.readTransactions=q=>q.query==='new'?Promise.resolve({items:[{...transaction,id:'new'}],nextCursor:null,limit:50}):new Promise(resolve=>{finish=resolve;});
    const initial=c.loadActivity();await c.filterActivity({query:'new'});finish({items:[transaction],nextCursor:null,limit:50});await initial;
    expect(c.activity.current().data?.items.map(t=>t.id)).toEqual(['new']);c.dispose();
  });
  it('retains highest Activity revisions across full refresh and filter resets with new membership/order',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.start();
    f.ports.ledger.readTransactions=async()=>({items:[{...transaction,id:'later',revision:7,note:'new'}, {...transaction,revision:6,note:'newest'}],nextCursor:null,limit:50});
    await c.loadActivity();
    f.ports.ledger.readTransactions=async()=>({items:[{...transaction,revision:2,note:'old'}, {...transaction,id:'next',revision:1}],nextCursor:'new_cursor',limit:50});
    await c.filterActivity({currency:'CAD'});
    expect(c.activity.current().data).toMatchObject({items:[{id:'fixture_tx',revision:6,note:'newest'},{id:'next',revision:1}],nextCursor:'new_cursor'});
    f.ports.ledger.readTransactions=async()=>({items:[{...transaction,id:'later',revision:3,note:'old'}],nextCursor:null,limit:50});
    await c.loadActivity();expect(c.activity.current().data?.items).toEqual([{...transaction,id:'later',revision:7,note:'new'}]);c.dispose();
  });
  it('retains highest recurring revisions across full refresh and filter resets with new membership/order',async()=>{
    const f=fixture(),c=new FinanceController(f.ports);await c.start();await c.loadRecurring();
    const page=(items:typeof stream[])=>({items,nextCursor:null,limit:50,state:'ready',checkedAt:null,sourceUpdatedAt:null,lastError:null,coverageWarnings:[]});
    f.ports.recurring.readPage=async()=>page([{...stream,id:'later',revision:7,classification:'bill'},{...stream,revision:6,classification:'excluded'}]);
    await c.loadRecurring();
    f.ports.recurring.readPage=async()=>page([{...stream,revision:2},{...stream,id:'next',revision:1}]);
    await c.filterRecurring({currency:'CAD'});
    expect(c.recurring.current().data?.page.items).toMatchObject([{id:'fixture_stream',revision:6,classification:'excluded'},{id:'next',revision:1}]);
    f.ports.recurring.readPage=async()=>page([{...stream,id:'later',revision:3}]);
    await c.loadRecurring();expect(c.recurring.current().data?.page.items).toEqual([{...stream,id:'later',revision:7,classification:'bill'}]);c.dispose();
  });
  it('retains unfiltered Activity facet rows while a filtered page is loading and after reset',async()=>{
    const f=fixture(),cny={...transaction,id:'cny',currency:'CNY',category:'Travel',status:'provisional',sourceLabel:'capture'};
    f.ports.ledger.readTransactions=async()=>({items:[transaction,cny],nextCursor:null,limit:50});
    const c=new FinanceController(f.ports);await c.start();let finish!:(value:any)=>void;
    f.ports.ledger.readTransactions=()=>new Promise(resolve=>{finish=resolve;});
    const pending=c.filterActivity({currency:'CAD'});
    expect(c.activity.current().data).toBeNull();
    expect(c.activityFacetRows).toEqual([transaction,cny]);
    finish({items:[transaction],nextCursor:null,limit:50});await pending;
    expect(c.activityFacetRows).toEqual([transaction,cny]);
    f.ports.ledger.readTransactions=async()=>({items:[],nextCursor:null,limit:50});await c.filterActivity({});
    expect(c.activityFacetRows).toEqual([transaction,cny]);
    f.ports.ledger.readTransactions=async()=>{throw {code:'unauthorized'};};await c.loadActivity();
    expect(c.activityFacetRows).toEqual([]);c.dispose();
  });
});
