import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {seedTenants,OWNER_LEDGER} from './helpers/tenants';
import {readMobileTransactionPage} from '../worker/mobile-transactions';
describe('category activity dates',()=>{it('filters by category and inclusive date range before pagination',async()=>{
 const f=createSqliteD1Fixture();try{
  await seedTenants(f.db);await f.db.prepare("UPDATE transactions SET date='2026-09-30' WHERE id='owner-tx-2'").run();
  const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({category:'Food',from:'2026-10-01',to:'2026-10-31',limit:'1'}));
  expect(page.items.map(row=>row.id)).toEqual(['owner-tx-1']);expect(page.page.nextCursor).toBeNull();
  await expect(readMobileTransactionPage(f.db,OWNER_LEDGER,new URLSearchParams({from:'2026-02-30'}))).rejects.toThrow();
 }finally{f.close();}
});});
