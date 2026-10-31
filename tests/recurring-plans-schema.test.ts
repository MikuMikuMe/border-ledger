import { describe, it, expect } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { createPlan, listPlans } from '../worker/recurring-plans';
describe('recurring plans bootstrap schema', () => {
  it('supports the same plan storage in the canonical schema', async () => {
    const f = createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('bootstrap','Account','Bank','CAD','chequing','connected','personal')").run();
      await createPlan(f.db, {userId:'owner',ledgerId:'personal'}, 'op', {accountId:'bootstrap',currency:'CAD',merchant:'Transit',direction:'expense',amountMinor:1250,frequency:'monthly',startDate:'2026-01-01',endDate:null});
      expect(await listPlans(f.db,{userId:'owner',ledgerId:'personal'})).toHaveLength(1);
    } finally { f.close(); }
  });
});
