import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {configureBudget,setBudgetAllocation,readBudgetAllocations} from '../worker/budget-store';
import {transferBudgetAllocation} from '../worker/budget-transfer-store';
const owner={userId:'owner',ledgerId:'personal'};
describe('budget category transfer',()=>{
 it('moves funds atomically and handles retries idempotently',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-10');
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Food',assignedMinor:5000});
   const request={id:'op-1',month:'2026-10',from:'Food',to:'Rent',amountMinor:1200};
   await transferBudgetAllocation(f.db,owner,request);await transferBudgetAllocation(f.db,owner,request);
   expect(await readBudgetAllocations(f.db,owner)).toEqual([{month:'2026-10',category:'Food',assignedMinor:3800},{month:'2026-10',category:'Rent',assignedMinor:1200}]);
   await expect(transferBudgetAllocation(f.db,owner,{...request,amountMinor:1300})).rejects.toThrow();
   expect((await readBudgetAllocations(f.db,owner))[0].assignedMinor).toBe(3800);
  }finally{f.close();}
 });
 it('rejects invalid transfers and rolls back both sides on overflow',async()=>{
  const f=createSqliteD1Fixture();try {
   await configureBudget(f.db,owner,'CAD','2026-10');
   await setBudgetAllocation(f.db,owner,{month:'2026-10',category:'Rent',assignedMinor:Number.MAX_SAFE_INTEGER});
   await expect(transferBudgetAllocation(f.db,owner,{id:'op-2',month:'2026-10',from:'Food',to:'Rent',amountMinor:1})).rejects.toThrow();
   expect(await readBudgetAllocations(f.db,owner)).toEqual([{month:'2026-10',category:'Rent',assignedMinor:Number.MAX_SAFE_INTEGER}]);
   await expect(transferBudgetAllocation(f.db,owner,{id:'op-3',month:'2026-10',from:'Rent',to:'Rent',amountMinor:1})).rejects.toThrow();
  }finally{f.close();}
 });
});
