import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { configureBudget, readBudgetSettings, setBudgetAllocation, readBudgetAllocations } from '../worker/budget-store';

const owner = {userId:'owner',ledgerId:'personal'};
describe('budget ledger storage', () => {
  it('stores allocations privately and rejects currency changes once funded', async () => {
    const f = createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
      await f.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
      await configureBudget(f.db, owner, 'CAD', '2026-10');
      await setBudgetAllocation(f.db, owner, {month:'2026-10',category:'Food',assignedMinor:12000});
      expect(await readBudgetAllocations(f.db, owner)).toEqual([{month:'2026-10',category:'Food',assignedMinor:12000}]);
      expect(await readBudgetAllocations(f.db, {userId:'other',ledgerId:'other-ledger'})).toEqual([]);
      expect(await readBudgetSettings(f.db, owner)).toMatchObject({currency:'CAD'});
      await expect(configureBudget(f.db, owner, 'CNY')).rejects.toThrow('currency');
    } finally { f.close(); }
  });
  it('rejects invalid input and does not alter previous allocations', async () => {
    const f = createSqliteD1Fixture();
    try {
      await configureBudget(f.db, owner, 'CAD', '2026-10');
      await setBudgetAllocation(f.db, owner, {month:'2026-10',category:'Food',assignedMinor:100});
      await expect(setBudgetAllocation(f.db, owner, {month:'2026-13',category:'Food',assignedMinor:100})).rejects.toThrow();
      await expect(setBudgetAllocation(f.db, owner, {month:'2026-10',category:'Food',assignedMinor:1.5})).rejects.toThrow();
      expect(await readBudgetAllocations(f.db, owner)).toHaveLength(1);
    } finally { f.close(); }
  });
  it('rejects assignments before the configured start',async()=>{
    const f=createSqliteD1Fixture();try {
      await configureBudget(f.db,owner,'CAD','2026-10');
      await expect(setBudgetAllocation(f.db,owner,{month:'2026-09',category:'Food',assignedMinor:100})).rejects.toThrow();
      expect(await readBudgetAllocations(f.db,owner)).toEqual([]);
    } finally {f.close();}
  });
  it('preserves the configured start on a currency-only update',async()=>{
    const f=createSqliteD1Fixture();try {
      await configureBudget(f.db,owner,'CAD','2026-01');
      await configureBudget(f.db,owner,'CNY');
      expect(await readBudgetSettings(f.db,owner)).toEqual({currency:'CNY',startMonth:'2026-01'});
    } finally {f.close();}
  });
});
