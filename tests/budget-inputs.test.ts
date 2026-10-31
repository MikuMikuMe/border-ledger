import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { configureBudget } from '../worker/budget-store';
import { saveBudgetTarget, listBudgetTargets, saveManualCash, listManualCash } from '../worker/budget-inputs';
const owner={userId:'owner',ledgerId:'personal'};
describe('budget funding inputs', () => {
  it('saves private targets and manual cash with original currency', async () => {
    const f=createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
      await f.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
      await configureBudget(f.db,owner,'CAD');
      await saveBudgetTarget(f.db,owner,{category:'Food',targetMinor:30000});
      await saveManualCash(f.db,owner,{id:'cash-1',name:'Wallet',currency:'CNY',amountMinor:5000});
      expect(await listBudgetTargets(f.db,owner)).toEqual([{category:'Food',targetMinor:30000}]);
      expect(await listManualCash(f.db,owner)).toEqual([{id:'cash-1',name:'Wallet',currency:'CNY',amountMinor:5000}]);
      expect(await listManualCash(f.db,{userId:'other',ledgerId:'other-ledger'})).toEqual([]);
      await expect(configureBudget(f.db,owner,'CNY')).rejects.toThrow();
    } finally {f.close();}
  });
  it('rejects invalid target and cash values', async () => {
    const f=createSqliteD1Fixture();
    try {
      await configureBudget(f.db,owner,'CAD');
      await expect(saveBudgetTarget(f.db,owner,{category:'Food',targetMinor:-1})).rejects.toThrow();
      await expect(saveManualCash(f.db,owner,{id:'cash-1',name:'Wallet',currency:'XXX',amountMinor:100})).rejects.toThrow();
      expect(await listBudgetTargets(f.db,owner)).toEqual([]);
    } finally {f.close();}
  });
  it('allows a custom balance to be tied to one owned account',async()=>{
    const f=createSqliteD1Fixture();
    try {
      await configureBudget(f.db,owner,'CAD');
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Bank','Bank','CAD','chequing','connected','personal')").run();
      await saveManualCash(f.db,owner,{id:'override',name:'Bank override',currency:'CAD',amountMinor:5000,accountId:'acct'});
      expect(await listManualCash(f.db,owner)).toMatchObject([{id:'override',accountId:'acct'}]);
      await expect(saveManualCash(f.db,owner,{id:'duplicate',name:'Other',currency:'CAD',amountMinor:5000,accountId:'acct'})).rejects.toThrow();
      await expect(saveManualCash(f.db,owner,{id:'foreign',name:'Other',currency:'CAD',amountMinor:5000,accountId:'missing'})).rejects.toThrow();
    } finally {f.close();}
  });
  it('rejects custom balances tied to credit accounts that are excluded from funding',async()=>{
    const f=createSqliteD1Fixture();try {
      await configureBudget(f.db,owner,'CAD');
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('card','Card','Bank','CAD','credit','connected','personal')").run();
      await expect(saveManualCash(f.db,owner,{id:'card-balance',name:'Card',currency:'CAD',amountMinor:5000,accountId:'card'})).rejects.toThrow();
      expect(await listManualCash(f.db,owner)).toEqual([]);
    }finally{f.close();}
  });
});
