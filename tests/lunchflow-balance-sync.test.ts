import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {createLunchFlowService} from '../worker/lunchflow-service';
import {readLunchFlowBalances} from '../worker/lunchflow-balance-store';
const owner={userId:'owner',ledgerId:'personal'};
describe('Lunch Flow balance sync',()=>{
  it('records a balance for a selected account during a successful sync',async()=>{
    const f=createSqliteD1Fixture();
    try {
      const provider={listAccounts:async()=>[{id:'42',name:'Bank',institutionName:'Bank',status:'ACTIVE',currency:'CAD'}],listTransactions:async()=>[],getBalance:async()=>({currency:'CAD',amountMinor:4200})};
      const service=createLunchFlowService({DB:f.db,LUNCHFLOW_API_KEY:'test',SYNC_QUEUE:{send:async()=>{}},now:()=>new Date('2026-10-31T12:00:00Z')},owner,provider);
      await service.selectAccounts({accounts:[{providerAccountId:'42',currency:'CAD',kind:'chequing'}]});
      await service.sync([{providerAccountId:'42',revision:1}]);
      expect(await readLunchFlowBalances(f.db,owner)).toMatchObject([{currency:'CAD',amountMinor:4200,stale:0}]);
    } finally {f.close();}
  });
  it('keeps transaction sync successful and marks an old balance stale if balance retrieval fails',async()=>{
    const f=createSqliteD1Fixture();
    try {
      let failing=false;
      const provider={listAccounts:async()=>[{id:'42',name:'Bank',institutionName:'Bank',status:'ACTIVE',currency:'CAD'}],listTransactions:async()=>[],getBalance:async()=>{if(failing) throw new Error('unavailable'); return {currency:'CAD',amountMinor:4200};}};
      const service=createLunchFlowService({DB:f.db,LUNCHFLOW_API_KEY:'test',SYNC_QUEUE:{send:async()=>{}},now:()=>new Date('2026-10-31T12:00:00Z')},owner,provider);
      await service.selectAccounts({accounts:[{providerAccountId:'42',currency:'CAD',kind:'chequing'}]});
      await service.sync([{providerAccountId:'42',revision:1}]);
      failing=true;
      await expect(service.sync([{providerAccountId:'42',revision:1}])).resolves.toEqual({accounts:1});
      expect(await readLunchFlowBalances(f.db,owner)).toMatchObject([{amountMinor:4200,stale:1}]);
    } finally {f.close();}
  });
  it('marks the previous balance stale when the provider returns a different currency',async()=>{
    const f=createSqliteD1Fixture();try {
      let currency='CAD';
      const provider={listAccounts:async()=>[{id:'42',name:'Bank',institutionName:'Bank',status:'ACTIVE',currency:'CAD'}],listTransactions:async()=>[],getBalance:async()=>({currency,amountMinor:4200})};
      const service=createLunchFlowService({DB:f.db,LUNCHFLOW_API_KEY:'test',SYNC_QUEUE:{send:async()=>{}},now:()=>new Date('2026-10-31T12:00:00Z')},owner,provider);
      await service.selectAccounts({accounts:[{providerAccountId:'42',currency:'CAD',kind:'chequing'}]});
      await service.sync([{providerAccountId:'42',revision:1}]);currency='USD';
      await service.sync([{providerAccountId:'42',revision:1}]);
      expect(await readLunchFlowBalances(f.db,owner)).toMatchObject([{currency:'CAD',amountMinor:4200,stale:1}]);
    }finally{f.close();}
  });
});
