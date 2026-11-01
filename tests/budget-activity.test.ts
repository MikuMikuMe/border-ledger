import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {readBudgetActivity} from '../worker/budget-activity';
const owner={userId:'owner',ledgerId:'personal'};
describe('budget activity',()=>{
  it('counts confirmed spending and refunds using transaction-date rates',async()=>{
    const f=createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      await f.db.prepare("INSERT OR IGNORE INTO account_currencies(account_id,currency,ledger_id) VALUES('acct','CNY','personal')").run();
      for(const [id,date,amount,currency,kind,status] of [['a','2026-10-05',-1000,'CAD','expense','confirmed'],['b','2026-10-06',-1000,'CNY','expense','confirmed'],['c','2026-10-07',200,'CAD','refund','confirmed'],['d','2026-10-08',-300,'CAD','expense','provisional'],['e','2026-10-09',-500,'CAD','transfer','confirmed']] as const) {
        await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES(?,'acct',?,'Shop',?,?,'Food',?,?,'manual',?,'personal')").bind(id,date,amount,currency,kind,status,id).run();
      }
      const fetcher:typeof fetch=async()=>Response.json([{date:'2026-10-06',base:'EUR',quote:'CAD',rate:2},{date:'2026-10-06',base:'EUR',quote:'CNY',rate:10}]);
      const rows=await readBudgetActivity(f.db,owner,{from:'2026-10-01',to:'2026-10-31',currency:'CAD'},{fetcher});
      expect(rows.map(x=>({id:x.id,amount:x.activityMinor,rateDate:x.rateDate}))).toEqual([{id:'a',amount:-1000,rateDate:null},{id:'b',amount:-200,rateDate:'2026-10-06'},{id:'c',amount:200,rateDate:null}]);
      expect(await readBudgetActivity(f.db,{userId:'other',ledgerId:'other'},{from:'2026-10-01',to:'2026-10-31',currency:'CAD'},{fetcher})).toEqual([]);
    } finally {f.close();}
  });
  it('returns an unavailable amount when the historical rate cannot be obtained',async()=>{
    const f=createSqliteD1Fixture();
    try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CNY','chequing','connected','personal')").run();
      await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-10-06','Shop',-100,'CNY','Food','expense','confirmed','manual','fp','personal')").run();
      const result=await readBudgetActivity(f.db,owner,{from:'2026-10-01',to:'2026-10-31',currency:'CAD'},{fetcher:async()=>new Response(null,{status:503})});
      expect(result[0]).toMatchObject({id:'tx',activityMinor:null,sourceMinor:-100,sourceCurrency:'CNY'});
    } finally {f.close();}
  });
});
