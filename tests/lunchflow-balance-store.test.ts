import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {publishLunchFlowBalance,readLunchFlowBalances} from '../worker/lunchflow-balance-store';
const owner={userId:'owner',ledgerId:'personal',connection:{id:'lunchflow-personal-owner',generation:1,adapter:'personal' as const}};
describe('Lunch Flow balance publication',()=>{
  it('stores balance for the current selected account only',async()=>{
    const f=createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Bank','Bank','CAD','chequing','connected','personal')").run();
      await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,connection_id,account_id,ledger_id,name,institution,currency,kind,enabled,revision) VALUES('42','lunchflow-personal-owner','acct','personal','Bank','Bank','CAD','chequing',1,1)").run();
      const payload={providerAccountId:'42',accountId:'acct',revision:1,currency:'CAD',amountMinor:1200,observedAt:'2026-10-31T00:00:00Z'};
      expect(await publishLunchFlowBalance(f.db,owner,{...payload,currency:'USD'})).toBe(false);
      expect(await publishLunchFlowBalance(f.db,owner,payload)).toBe(true);
      expect(await readLunchFlowBalances(f.db,owner)).toMatchObject([{accountId:'acct',currency:'CAD',amountMinor:1200}]);
      await f.db.prepare("UPDATE lunchflow_accounts SET revision=2 WHERE ledger_id='personal' AND provider_account_id='42'").run();
      expect(await publishLunchFlowBalance(f.db,owner,{...payload,amountMinor:5000})).toBe(false);
      expect((await readLunchFlowBalances(f.db,owner))[0].amountMinor).toBe(1200);
      expect(await readLunchFlowBalances(f.db,{userId:'other',ledgerId:'other-ledger'})).toEqual([]);
    } finally {f.close();}
  });
});
