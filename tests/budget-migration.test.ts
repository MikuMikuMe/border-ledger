import {describe,expect,it} from 'vitest';
import {createD1Fixture,task24MigrationNames} from './helpers/d1';
import {configureBudget,setBudgetAllocation,readBudgetAllocations} from '../worker/budget-store';
import {saveBudgetTarget,saveManualCash,listManualCash} from '../worker/budget-inputs';

describe('budget migration',()=>{
  it('installs budget tables after the current production migrations',async()=>{
    const f=await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql']);
    try {
      const owner={userId:'owner',ledgerId:'personal'};
      await configureBudget(f.db,owner,'CAD','2026-10');
      await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:500});
      await saveBudgetTarget(f.db,owner,{category:'Food',targetMinor:1000});
      await saveManualCash(f.db,owner,{id:'cash',name:'Cash',currency:'CAD',amountMinor:2000});
      expect(await readBudgetAllocations(f.db,owner)).toHaveLength(1);
      expect(await listManualCash(f.db,owner)).toHaveLength(1);
    } finally {await f.dispose();}
  },30000);
});
