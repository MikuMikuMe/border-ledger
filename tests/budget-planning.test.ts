import {describe,it,expect} from 'vitest';
import {summarizeTracking} from '../src/domain/budget-tracking';
import {summarizeBudget} from '../src/domain/budget-summary';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {configureBudget,readBudgetSettings,setBudgetAllocation} from '../worker/budget-store';
import {readBudgetState,saveBudgetMode,saveTrackingPlan,copyTrackingPlans,readTrackingCopy,saveRolloverPolicy} from '../worker/budget-planning-store';
const owner={userId:'owner',ledgerId:'personal'};
describe('tracking domain',()=>{
 it('keeps forecasts independent and treats income separately from expense/refund activity',()=>{
  const summary=summarizeTracking('2026-10',[{month:'2026-10',direction:'income',category:'Salary',plannedMinor:5000},{month:'2026-10',direction:'expense',category:'Food',plannedMinor:1000}],[{id:'a',category:'Salary',kind:'income',activityMinor:4000},{id:'b',category:'Food',kind:'expense',activityMinor:-1200},{id:'c',category:'Food',kind:'refund',activityMinor:200}]);
  expect(summary).toMatchObject({plannedIncomeMinor:5000,plannedExpenseMinor:1000,plannedSavingsMinor:4000,actualIncomeMinor:4000,actualExpenseMinor:1000,actualSavingsMinor:3000});
 });
 it('keeps known plans when FX is missing and nulls affected metrics',()=>{
  expect(summarizeTracking('2026-10',[],[{id:'x',category:'Pay',kind:'income',activityMinor:null}])).toMatchObject({plannedSavingsMinor:0,actualIncomeMinor:null,actualExpenseMinor:0,actualSavingsMinor:null});
 });
});
describe('chronological rollover',()=>{
 const input={month:'2026-03',allocations:[{month:'2026-01',category:'Food',assignedMinor:100}],targets:[],balances:[{id:'cash',amountMinor:50}],activity:[{id:'x',date:'2026-01-01',category:'Food',activityMinor:-150}]};
 it('applies the outgoing month policy and never turns a reset deficit into cash',()=>{
  expect(summarizeBudget({...input,rolloverPolicies:[{category:'Food',effectiveMonth:'2026-01',policy:'carry_positive'}]}).categories[0].openingMinor).toBe(0);
  expect(summarizeBudget({...input,rolloverPolicies:[{category:'Food',effectiveMonth:'2026-01',policy:'reset'}]}).unassignedMinor).toBe(50);
  expect(summarizeBudget(input).categories[0].openingMinor).toBe(-50);
 });
 it('clears unknown carry only after an explicit reset',()=>{
  const missing={...input,activity:[{id:'x',date:'2026-01-01',category:'Food',activityMinor:null}]};
  expect(summarizeBudget({...missing,rolloverPolicies:[{category:'Food',effectiveMonth:'2026-01',policy:'carry_positive'}]}).categories[0].openingMinor).toBeNull();
  expect(summarizeBudget({...missing,rolloverPolicies:[{category:'Food',effectiveMonth:'2026-02',policy:'reset'}]}).categories[0]).toMatchObject({openingMinor:0,missingTransactionIds:[]});
 });
});
describe('revision guarded budget planning',()=>{
 it('replays exact operations, rejects conflicts, copies tracking only and preserves preference',async()=>{
  const f=createSqliteD1Fixture();try{
   await configureBudget(f.db,owner,'CAD','2026-01');
   const mode={mode:'tracking' as const,operationId:'mode',expectedRevision:0};
   expect(await saveBudgetMode(f.db,owner,mode)).toEqual({ok:true,revision:1});
   expect(await saveBudgetMode(f.db,owner,mode)).toEqual({ok:true,revision:1});
   await expect(saveBudgetMode(f.db,owner,{...mode,mode:'envelope'})).rejects.toThrow('conflict');
   await saveTrackingPlan(f.db,owner,{month:'2026-01',direction:'expense',category:'Food',plannedMinor:100,expectedRevision:1,operationId:'plan'});
   const preview=await readTrackingCopy(f.db,owner,'2026-02');
   expect(preview).toMatchObject({sourceMonth:'2026-01',revision:2,sourceRevision:2,plans:[{category:'Food',plannedMinor:100}]});
   await setBudgetAllocation(f.db,owner,{month:'2026-02',category:'Food',assignedMinor:30});
   await expect(copyTrackingPlans(f.db,owner,{month:'2026-02',sourceMonth:'2026-01',expectedRevision:2,expectedSourceRevision:2,operationId:'stale'})).rejects.toThrow('conflict');
   const state=await readBudgetState(f.db,owner);
   await copyTrackingPlans(f.db,owner,{month:'2026-02',sourceMonth:'2026-01',expectedRevision:state.revision,expectedSourceRevision:state.revision,operationId:'copy'});
   await configureBudget(f.db,owner,'CAD');
   expect(await readBudgetState(f.db,owner)).toMatchObject({preferredMode:'tracking'});
   expect(await readBudgetSettings(f.db,owner)).toMatchObject({currency:'CAD'});
  } finally {f.close();}
 });
 it('enforces ledger ownership, rejects stale writes and invalid values atomically',async()=>{
  const f=createSqliteD1Fixture();try{
   await configureBudget(f.db,owner,'CAD','2026-01');
   await expect(saveBudgetMode(f.db,{userId:'intruder',ledgerId:'personal'},{mode:'tracking',expectedRevision:0,operationId:'bad'})).rejects.toThrow();
   expect(await readBudgetState(f.db,owner)).toMatchObject({preferredMode:'envelope',revision:0});
   await expect(saveTrackingPlan(f.db,owner,{month:'2026-01',direction:'expense',category:'Food',plannedMinor:-1,expectedRevision:0,operationId:'bad'})).rejects.toThrow();
   await saveRolloverPolicy(f.db,owner,{category:'Food',effectiveMonth:'2026-01',policy:'reset',expectedRevision:0,operationId:'reset'});
   await expect(saveBudgetMode(f.db,owner,{mode:'tracking',expectedRevision:0,operationId:'old'})).rejects.toThrow('conflict');
  }finally{f.close();}
 });
});
