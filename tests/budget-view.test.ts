import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {configureBudget,setBudgetAllocation} from '../worker/budget-store';
import {saveManualCash} from '../worker/budget-inputs';
import {readBudgetView} from '../worker/budget-view';
const owner={userId:'owner',ledgerId:'personal'};
async function addAccount(db:ReturnType<typeof createSqliteD1Fixture>['db']) {
  await db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Bank','Bank','CAD','chequing','connected','personal')").run();
}
async function accountBudget(db:ReturnType<typeof createSqliteD1Fixture>['db'],startMonth:string) {
  await configureBudget(db,owner,'CAD',startMonth);
  await addAccount(db);
  await saveManualCash(db,owner,{id:'override',name:'Bank',accountId:'acct',currency:'CAD',amountMinor:10000});
}
describe('budget view',()=>{
 it('uses manual account overrides once and carries allocations and spending forward',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-01');
   await addAccount(f.db);
   await saveManualCash(f.db,owner,{id:'manual',name:'Bank manual',accountId:'acct',currency:'CAD',amountMinor:20000});
   await saveManualCash(f.db,owner,{id:'cash',name:'Wallet',currency:'CAD',amountMinor:5000});
   await setBudgetAllocation(f.db,owner,{month:'2026-01',category:'Food',assignedMinor:10000});
   await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-01-15','Shop',-4000,'CAD','Food','expense','confirmed','manual','fp','personal')").run();
   const view=await readBudgetView(f.db,owner,'2026-02',{now:()=>new Date('2026-10-31T12:00:00Z')});
   expect(view.summary).toMatchObject({cashMinor:25000,unassignedMinor:null,categories:[{category:'Food',openingMinor:6000,availableMinor:6000}]});
   expect(view.balances).toHaveLength(2);
  }finally{f.close();}
 });
 it('shows unknown funding for an eligible account without a balance',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-01');
   await addAccount(f.db);
   const view=await readBudgetView(f.db,owner,'2026-10');
   expect(view.summary).toMatchObject({cashMinor:null,unassignedMinor:null});
   expect(view.balances).toMatchObject([{accountId:'acct',amountMinor:null,source:'unavailable'}]);
  }finally{f.close();}
 });
 it('reserves future allocations and does not imply current cash is a historical balance',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-01');
   await saveManualCash(f.db,owner,{id:'cash',name:'Wallet',currency:'CAD',amountMinor:25000});
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:10000});
   await setBudgetAllocation(f.db,owner,{month:'2026-11',category:'Rent',assignedMinor:3000});
   const view=await readBudgetView(f.db,owner,'2026-10',{now:()=>new Date('2026-10-31T12:00:00Z')});
   expect(view.summary.unassignedMinor).toBe(12000);
   const history=await readBudgetView(f.db,owner,'2026-09',{now:()=>new Date('2026-10-31T12:00:00Z')});
   expect(history.summary.unassignedMinor).toBeNull();
  }finally{f.close();}
 });
 it('suggests funding from the last three months when no target exists',async()=>{
  const f=createSqliteD1Fixture();try {
   await accountBudget(f.db,'2026-10');
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:100});
   await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-08-05','Shop',-3000,'CAD','Food','expense','confirmed','manual','fp','personal')").run();
   const view=await readBudgetView(f.db,owner,'2026-10',{now:()=>new Date('2026-10-31T12:00:00Z')});
   expect(view.summary.categories).toMatchObject([{category:'Food',availableMinor:100,suggestedMinor:900,suggestionBasis:'history'}]);
  }finally{f.close();}
 });
 it('carries spending forward from the configured start even before the first assignment',async()=>{
  const f=createSqliteD1Fixture();try {
   await accountBudget(f.db,'2026-01');
   await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-01-15','Shop',-1000,'CAD','Food','expense','confirmed','manual','fp','personal')").run();
   const view=await readBudgetView(f.db,owner,'2026-02',{now:()=>new Date('2026-02-20T12:00:00Z')});
   expect(view.summary.categories).toMatchObject([{category:'Food',openingMinor:-1000,availableMinor:-1000}]);
  }finally{f.close();}
 });
 it('recalculates after transaction edits and balance changes without counting an override twice',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-10');
   await addAccount(f.db);
   await saveManualCash(f.db,owner,{id:'override',name:'Bank',accountId:'acct',currency:'CAD',amountMinor:20000});
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:10000});
   await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-10-05','Shop',-3000,'CAD','Food','expense','confirmed','manual','fp','personal')").run();
   const now=()=>new Date('2026-10-31T12:00:00Z');
   expect((await readBudgetView(f.db,owner,'2026-10',{now})).summary).toMatchObject({cashMinor:20000,unassignedMinor:13000,categories:[{category:'Food',availableMinor:7000}]});
   await f.db.prepare("UPDATE transactions SET amount_minor=-5000,category='Dining' WHERE id='tx'").run();
   await saveManualCash(f.db,owner,{id:'override',name:'Bank',accountId:'acct',currency:'CAD',amountMinor:15000});
   const updated=await readBudgetView(f.db,owner,'2026-10',{now});
   expect(updated.summary).toMatchObject({cashMinor:15000,unassignedMinor:5000,categories:[{category:'Dining',availableMinor:-5000},{category:'Food',availableMinor:10000}]});
   expect(updated.balances).toHaveLength(1);
  }finally{f.close();}
 });
 it('does not count a future deallocation as cash available in the current month',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-10');
   await saveManualCash(f.db,owner,{id:'cash',name:'Wallet',currency:'CAD',amountMinor:10000});
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:10000});
   await setBudgetAllocation(f.db,owner,{month:'2026-11',category:'Food',assignedMinor:-3000});
   expect((await readBudgetView(f.db,owner,'2026-10',{now:()=>new Date('2026-10-20T12:00:00Z')})).summary.unassignedMinor).toBe(0);
  }finally{f.close();}
 });
 it('shows an excluded custom balance when its account changes to a credit account',async()=>{
  const f=createSqliteD1Fixture();try {
   await accountBudget(f.db,'2026-10');
   await f.db.prepare("UPDATE accounts SET kind='credit' WHERE id='acct'").run();
   const result=await readBudgetView(f.db,owner,'2026-10',{now:()=>new Date('2026-10-20T12:00:00Z')});
   expect(result.balances).toMatchObject([{id:'override',source:'excluded',amountMinor:null}]);
   expect(result.summary.cashMinor).toBeNull();
  }finally{f.close();}
 });
});
