import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {readAiLedgerSummary} from '../worker/ai-summary';
const owner={userId:'owner',ledgerId:'personal'};
describe('analysis summaries',()=>{
  it('defaults to aggregates and only includes transaction details when requested',async()=>{
    const f=createSqliteD1Fixture();try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,kind,status,currency,ledger_id) VALUES('a','Cash','Bank','chequing','connected','CAD','personal')").run();

      await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('t','a','2026-10-05','Private merchant',123,'CAD','Food','expense','confirmed','manual','f','personal')").run();
      await f.db.prepare("UPDATE transactions SET note='Private note' WHERE id='t'").run();
      const summary=await readAiLedgerSummary(f.db,owner,{from:'2026-10-01',to:'2026-10-31',detail:false});
      expect(JSON.stringify(summary)).not.toContain('Private merchant');
      expect(JSON.stringify(summary)).not.toContain('Private note');
      expect(summary.groups).toEqual([{category:'Food',currency:'CAD',kind:'expense',amountMinor:123,count:1}]);
      const detail=await readAiLedgerSummary(f.db,owner,{from:'2026-10-01',to:'2026-10-31',detail:true});
      expect(JSON.stringify(detail)).toContain('Private merchant');
      expect(detail.transactions).toMatchObject([{account:'Cash',note:'Private note',source:'manual'}]);
      await expect(readAiLedgerSummary(f.db,owner,{from:'2020-01-01',to:'2026-10-31',detail:true})).rejects.toThrow();
    } finally {f.close();}
  });
  it('includes transfers only when requested for full-ledger analysis',async()=>{
    const f=createSqliteD1Fixture();try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,kind,status,currency,ledger_id) VALUES('a','Cash','Bank','chequing','connected','CAD','personal')").run();
      await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('t','a','2026-10-05','Transfer',123,'CAD','Transfers','transfer','confirmed','manual','f','personal')").run();
      const budget=await readAiLedgerSummary(f.db,owner,{from:'2026-10-01',to:'2026-10-31',detail:false});
      const ledger=await readAiLedgerSummary(f.db,owner,{from:'2026-10-01',to:'2026-10-31',detail:false,includeTransfers:true});
      expect(budget.groups).toEqual([]);
      expect(ledger.groups).toMatchObject([{kind:'transfer',amountMinor:123}]);
    }finally{f.close();}
  });
  it('aggregates magnitudes for mixed-sign transactions while retaining transfer direction',async()=>{
    const f=createSqliteD1Fixture();try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,kind,status,currency,ledger_id) VALUES('a','Cash','Bank','chequing','connected','CAD','personal')").run();
      for(const [id,kind,amount] of [['r1','refund',500],['r2','refund',-500],['e1','expense',-300],['e2','expense',300],['t1','transfer',-100],['t2','transfer',40]] as const) {
        await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES(?,'a','2026-10-05','Shop',?,'CAD','Food',?,'confirmed','manual',?,'personal')").bind(id,amount,kind,id).run();
      }
      const result=await readAiLedgerSummary(f.db,owner,{from:'2026-10-01',to:'2026-10-31',detail:true,includeTransfers:true});
      expect(result.groups).toEqual(expect.arrayContaining([{category:'Food',currency:'CAD',kind:'refund',amountMinor:1000,count:2},{category:'Food',currency:'CAD',kind:'expense',amountMinor:600,count:2},{category:'Food',currency:'CAD',kind:'transfer',amountMinor:-60,count:2}]));
      expect(result.transactions?.map(row=>row.amountMinor)).toEqual([-300,300,500,-500,-100,40]);
    }finally{f.close();}
  });
});
