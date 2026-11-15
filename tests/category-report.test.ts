import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {seedTenants,OWNER_LEDGER} from './helpers/tenants';
import {readLedgerReport} from '../worker/ledger-reports';
describe('category spending report',()=>{
 it('applies category to full-window totals and respects the latest annotation',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('dining','personal','owner-tx-1','hash',1,'Dining',NULL)").run();
   const food=await readLedgerReport(f.db,OWNER_LEDGER,{category:'Food',from:'2026-10-01',to:'2026-10-31'});
   const dining=await readLedgerReport(f.db,OWNER_LEDGER,{category:'Dining',from:'2026-10-01',to:'2026-10-31'});
   expect(food.currencyTotals).toEqual([expect.objectContaining({currency:'CAD',confirmedMinorUnits:100,confirmedCount:1})]);
   expect(dining.currencyTotals).toEqual([expect.objectContaining({currency:'CAD',confirmedMinorUnits:100,confirmedCount:1})]);
  }finally{f.close();}
 });
});
