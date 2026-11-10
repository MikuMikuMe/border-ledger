import {readFileSync} from 'node:fs';
import {readBudgetActivity} from '../worker/budget-activity';
import {readMobileTransactionPage} from '../worker/mobile-transactions';
import {seedTenants,SECOND_LEDGER} from './helpers/tenants';
import {createManualTransaction} from '../worker/manual-transactions';
import {describe,expect,it,vi} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {VERIFIED_WEB_ENV,VERIFIED_WEB_HEADERS,provisionWebOwner} from './helpers/web-identity';
import worker from '../worker/index';

describe('web transaction annotations',()=>{
  it('projects the latest revision without changing unrelated or foreign transactions',async()=>{
    const f=createSqliteD1Fixture();
    try{
      await seedTenants(f.db);
      await f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('old','personal','owner-tx-1','hash',1,'Old','before'),('latest','personal','owner-tx-1','hash',2,'Travel',NULL)").run();
      await f.db.prepare(readFileSync('worker/migrations/0035-annotation-projection.sql','utf8')).run();
      expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Travel',note:null});
      expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-2'").first()).toEqual({category:'Food',note:null});
      expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id='second-tx-1'").first()).toEqual({category:'Food',note:null});
      const repeat=await f.db.prepare(readFileSync('worker/migrations/0035-annotation-projection.sql','utf8')).run();
      expect(repeat.meta?.changes).toBe(0);
    }finally{f.close();}
  });
  it('saves a revision and returns the updated category and note in Activity',async()=>{
    const f=createSqliteD1Fixture();
    try{
      await provisionWebOwner(f.db);
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const env={DB:f.db,...VERIFIED_WEB_ENV,LEDGER_APP_ORIGIN:'https://pf.example.com',ASSETS:{fetch:vi.fn()}};
      const headers={...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'};
      const created=await worker.fetch(new Request('https://pf.example.com/api/transactions',{method:'POST',headers,body:JSON.stringify({requestId:'manual_annotation_123',accountId:'acct',date:'2026-11-07',merchant:'Coffee',amount:'12.34',currency:'CAD',category:'Food',kind:'expense',note:null})}),env as never);
      expect(created.status).toBe(201);const value=await created.json() as {id:string};
      const write=await worker.fetch(new Request(`https://pf.example.com/api/transactions/${encodeURIComponent(value.id)}/annotation`,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:0,category:'Dining',note:'Lunch'})}),env as never);
      expect(write.status).toBe(200);
      const budget=await readBudgetActivity(f.db,{userId:'owner',ledgerId:'personal'},{from:'2026-11-01',to:'2026-11-30',currency:'CAD'});
      expect(budget).toEqual([expect.objectContaining({id:value.id,category:'Dining'})]);
      // Simulate an annotation saved before transaction fields were updated with the revision.
      await f.db.prepare('UPDATE transactions SET category=?, note=? WHERE id=?').bind('Food', null, value.id).run();
      const mobile=await readMobileTransactionPage(f.db,{userId:'owner',ledgerId:'personal'},new URLSearchParams({category:'Dining',query:'Lunch'}));
      expect(mobile.items).toEqual([expect.objectContaining({id:value.id,category:'Dining',note:'Lunch',revision:1})]);
      const response=await worker.fetch(new Request('https://pf.example.com/api/transactions',{headers:VERIFIED_WEB_HEADERS}),env as never);
      expect(await response.json()).toMatchObject({transactions:[expect.objectContaining({id:value.id,category:'Dining',note:'Lunch',annotation_revision:1})]});
      await f.db.prepare(readFileSync('worker/migrations/0035-annotation-projection.sql','utf8')).run();
      const corrected=await readBudgetActivity(f.db,{userId:'owner',ledgerId:'personal'},{from:'2026-11-01',to:'2026-11-30',currency:'CAD'});
      expect(corrected).toEqual([expect.objectContaining({id:value.id,category:'Dining'})]);
      const stale=await worker.fetch(new Request(`https://pf.example.com/api/transactions/${encodeURIComponent(value.id)}/annotation`,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:0,category:'Other',note:null})}),env as never);
      expect(stale.status).toBe(409);
      await seedTenants(f.db);
      const foreign=await createManualTransaction(f.db,SECOND_LEDGER,{requestId:'foreign_annotation_123',accountId:'second-account',date:'2026-11-07',merchant:'Private',amount:'1.00',currency:'CAD',category:'Food',kind:'expense',note:null});
      const denied=await worker.fetch(new Request(`https://pf.example.com/api/transactions/${encodeURIComponent(foreign.id)}/annotation`,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:0,category:'Other',note:null})}),env as never);
      expect(denied.status).toBe(404);
      expect(await f.db.prepare('SELECT category FROM transactions WHERE id=?').bind(foreign.id).first()).toEqual({category:'Food'});
    }finally{f.close();}
  });
});
