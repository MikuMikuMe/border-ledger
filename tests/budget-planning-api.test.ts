import {afterEach,describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {handleBudgetApi} from '../worker/budget-http';
import {configureBudget,setBudgetAllocation} from '../worker/budget-store';
import {readTrackingView,readRolloverPreview} from '../worker/budget-planning-view';
import {readBudgetView} from '../worker/budget-view';
import {readBudgetState,saveRolloverPolicy,saveTrackingPlan,readTrackingPlans} from '../worker/budget-planning-store';
const owner={userId:'owner',ledgerId:'personal'};
const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
async function fixture(){const f=createSqliteD1Fixture();fixtures.push(f);await configureBudget(f.db,owner,'CAD','2026-01');await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Bank','Bank','CAD','chequing','connected','personal')").run();return f;}
async function transaction(f:Awaited<ReturnType<typeof fixture>>,input:{id:string;kind:string;amount:number;currency?:string;status?:string;date?:string}){
 const {id,kind,amount,currency='CAD',status='confirmed',date='2026-10-05'}=input;
 await f.db.prepare("INSERT OR IGNORE INTO account_currencies(account_id,currency,ledger_id) VALUES('acct',?,'personal')").bind(currency).run();
 await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES(?,'acct',?,'Shop',?,?,'Food',?,?,'manual',?,'personal')").bind(id,date,amount,currency,kind,status,id).run();
}
describe('budget planning API',()=>{
 it('returns tracking, leaves omitted mode envelope, validates modes and returns revision conflict',async()=>{
  const f=await fixture();const root='/api/budget';
  const request=async(path:string,body?:unknown)=>{const response=await handleBudgetApi(new Request('https://pf.example'+root+path,{...(body?{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),f.db,owner,root);return {status:response!.status,data:await response!.json()};};
  const snapshot=await request('');const revision=(snapshot.data as {settings:{revision:number}}).settings.revision;
  expect((await request('/mode',{mode:'tracking',expectedRevision:revision,operationId:'mode'})).status).toBe(200);
  expect(await request('/mode',{mode:'envelope',expectedRevision:revision,operationId:'stale'})).toMatchObject({status:409,data:{code:'budget_conflict'}});
  expect(await request('/view?month=2026-10&mode=bogus')).toMatchObject({status:400});
  expect(await request('/view?month=2026-10&mode=tracking')).toMatchObject({status:200,data:{mode:'tracking',settings:{preferredMode:'tracking'},summary:{actualIncomeMinor:0}}});
  expect(await request('/view?month=2026-10')).toMatchObject({status:200,data:{summary:{cashMinor:null}}});
 });
 it('separates income from expense, fees/refunds and excludes provisional/transfers',async()=>{
  const f=await fixture();
  await transaction(f,{id:'income',kind:'income',amount:5000});await transaction(f,{id:'expense',kind:'expense',amount:-1200});await transaction(f,{id:'fee',kind:'fee',amount:-100});await transaction(f,{id:'refund',kind:'refund',amount:200});await transaction(f,{id:'pending',kind:'income',amount:9000,currency:'CAD',status:'provisional'});await transaction(f,{id:'transfer',kind:'transfer',amount:5000});
  const view=await readTrackingView(f.db,owner,'2026-10');
  expect(view.summary).toMatchObject({actualIncomeMinor:5000,actualExpenseMinor:1100,actualSavingsMinor:3900});
  expect(view.activity).toHaveLength(4);
  const envelope=await readBudgetView(f.db,owner,'2026-10');expect(envelope.activity).toHaveLength(3);
 });
 it('retains original currency/date and marks only affected metrics unknown without FX',async()=>{
  const f=await fixture();await transaction(f,{id:'income',kind:'income',amount:1000,currency:'CNY'});await transaction(f,{id:'expense',kind:'expense',amount:-100});
  const revision=(await readBudgetState(f.db,owner)).revision;
  await saveTrackingPlan(f.db,owner,{month:'2026-10',direction:'income',category:'Food',plannedMinor:2000,expectedRevision:revision,operationId:'plan'});
  const view=await readTrackingView(f.db,owner,'2026-10',{fetcher:async()=>new Response(null,{status:503})});
  expect(view.summary).toMatchObject({plannedIncomeMinor:2000,actualIncomeMinor:null,actualExpenseMinor:100,actualSavingsMinor:null});
  expect(view.activity.find(row=>row.kind==='income')).toMatchObject({sourceCurrency:'CNY',sourceMinor:1000,activityMinor:null,rateDate:null});
 });
 it('uses dated FX for income without changing envelope expense conversion',async()=>{
  const f=await fixture();await transaction(f,{id:'income',kind:'income',amount:1000,currency:'CNY'});
  const fetcher:typeof fetch=async()=>Response.json([{date:'2026-10-05',base:'EUR',quote:'CAD',rate:2},{date:'2026-10-05',base:'EUR',quote:'CNY',rate:10}]);
  const view=await readTrackingView(f.db,owner,'2026-10',{fetcher});
  expect(view.summary.actualIncomeMinor).toBe(200);expect(view.activity[0]).toMatchObject({sourceMinor:1000,rateDate:'2026-10-05',activityMinor:200});
 });
 it('previews historical category-specific changes and rejects changed source activity',async()=>{
  const f=await fixture();await setBudgetAllocation(f.db,owner,{month:'2026-01',category:'Food',assignedMinor:100});await setBudgetAllocation(f.db,owner,{month:'2026-01',category:'Rent',assignedMinor:200});
  const policy={category:'Food',effectiveMonth:'2026-01',policy:'reset' as const};
  const preview=await readRolloverPreview(f.db,owner,policy,{now:()=>new Date('2026-03-01T12:00:00Z')});
  expect(preview.changes).toEqual([{month:'2026-02',category:'Food',beforeOpeningMinor:100,afterOpeningMinor:0,beforeClosingMinor:100,afterClosingMinor:0},{month:'2026-03',category:'Food',beforeOpeningMinor:100,afterOpeningMinor:0,beforeClosingMinor:100,afterClosingMinor:0}]);
  await transaction(f,{id:'edit',kind:'expense',amount:-10,currency:'CAD',status:'confirmed',date:'2026-01-05'});
  await expect(saveRolloverPolicy(f.db,owner,{...policy,expectedRevision:preview.revision,operationId:'stale'})).rejects.toThrow('conflict');
  const revision=(await readBudgetState(f.db,owner)).revision;await saveRolloverPolicy(f.db,owner,{...policy,expectedRevision:revision,operationId:'reset'});
  const view=await readBudgetView(f.db,owner,'2026-03');expect(view.summary.categories).toMatchObject([{category:'Food',openingMinor:0},{category:'Rent',openingMinor:200}]);
 });
 it('keeps tracking plans and views isolated between ledgers',async()=>{
  const f=await fixture();await f.db.prepare("INSERT INTO users(id,status)VALUES('other','active')").run();await f.db.prepare("INSERT INTO ledgers(id,user_id)VALUES('other','other')").run();
  const other={userId:'other',ledgerId:'other'};await configureBudget(f.db,other,'CAD','2026-01');await saveTrackingPlan(f.db,other,{month:'2026-10',direction:'income',category:'Private',plannedMinor:999,expectedRevision:0,operationId:'plan'});
  expect(await readTrackingPlans(f.db,owner,'2026-10')).toEqual([]);expect((await readTrackingView(f.db,other,'2026-10')).plans).toMatchObject([{category:'Private'}]);
 });
});
