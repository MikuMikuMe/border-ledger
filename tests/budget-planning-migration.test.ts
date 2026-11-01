import {afterEach,describe,it,expect} from 'vitest';
import {createD1Fixture,task24MigrationNames,applyMigrations} from './helpers/d1';
import {configureBudget,setBudgetAllocation,readBudgetAllocations} from '../worker/budget-store';
import {saveBudgetTarget,saveManualCash,listBudgetTargets,listManualCash} from '../worker/budget-inputs';
import {readBudgetState,saveBudgetMode,saveTrackingPlan,copyTrackingPlans,readTrackingPlans} from '../worker/budget-planning-store';
const owner={userId:'owner',ledgerId:'personal'};
const base=[...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql','0030-ai-settings.sql'];
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.dispose();});
describe('budget tracking additive migration and D1 writes',()=>{
 it('preserves existing funded envelopes/targets/cash and defaults preference to envelope',async()=>{
  const f=await createD1Fixture(base);fixtures.push(f);await configureBudget(f.db,owner,'CAD','2026-10');await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:100});await saveBudgetTarget(f.db,owner,{category:'Food',targetMinor:200});await saveManualCash(f.db,owner,{id:'cash',name:'Cash',currency:'CAD',amountMinor:500});
  await applyMigrations(f.db,['0031-budget-tracking.sql']);
  expect(await readBudgetState(f.db,owner)).toEqual({preferredMode:'envelope',revision:0});expect(await readBudgetAllocations(f.db,owner)).toEqual([{month:'2026-10',category:'Food',assignedMinor:100}]);expect(await listBudgetTargets(f.db,owner)).toEqual([{category:'Food',targetMinor:200}]);expect(await listManualCash(f.db,owner)).toMatchObject([{amountMinor:500}]);
  await saveBudgetMode(f.db,owner,{mode:'tracking',expectedRevision:0,operationId:'mode'});
  await saveTrackingPlan(f.db,owner,{month:'2026-10',direction:'income',category:'Salary',plannedMinor:1000,expectedRevision:1,operationId:'plan'});
  await copyTrackingPlans(f.db,owner,{month:'2026-11',sourceMonth:'2026-10',expectedRevision:2,expectedSourceRevision:2,operationId:'copy'});
  await saveTrackingPlan(f.db,owner,{month:'2026-11',direction:'income',category:'Salary',plannedMinor:2000,expectedRevision:3,operationId:'new'});
  // A delayed exact retry returns the stored result and cannot repeat its replace.
  expect(await copyTrackingPlans(f.db,owner,{month:'2026-11',sourceMonth:'2026-10',expectedRevision:2,expectedSourceRevision:2,operationId:'copy'})).toEqual({ok:true,revision:3});
  expect(await readTrackingPlans(f.db,owner,'2026-11')).toMatchObject([{plannedMinor:2000}]);
  expect(await readBudgetState(f.db,owner)).toEqual({preferredMode:'tracking',revision:4});
  await expect(configureBudget(f.db,owner,'CNY')).rejects.toThrow('currency');
 },30000);
 it('rolls back source-stale writes and rejects a revoked native authority at the commit boundary',async()=>{
  const f=await createD1Fixture([...base,'0031-budget-tracking.sql']);fixtures.push(f);await configureBudget(f.db,owner,'CAD','2026-01');
  const native={...owner,credentialType:'owner' as const,familyId:'gone',subjectHash:'subject',environmentHash:'environment',accessGeneration:1,scopes:['preferences:write']};
  await expect(saveBudgetMode(f.db,native as Parameters<typeof saveBudgetMode>[1],{mode:'tracking',expectedRevision:0,operationId:'revoked'})).rejects.toThrow('Access');
  expect(await readBudgetState(f.db,owner)).toEqual({preferredMode:'envelope',revision:0});
  const operations=await f.db.prepare('SELECT operation_id FROM budget_planning_operations WHERE ledger_id=?').bind(owner.ledgerId).all();expect(operations.results).toEqual([]);
 },30000);
});
