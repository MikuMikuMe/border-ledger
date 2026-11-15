import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {vi} from 'vitest';
import {VERIFIED_WEB_ENV,VERIFIED_WEB_HEADERS,provisionWebOwner} from './helpers/web-identity';
import worker from '../worker/index';
import {handleCategoryApi} from '../worker/category-http';
const owner={userId:'owner',ledgerId:'personal'};
const req=(method:string,body?:unknown)=>new Request('https://example.test/api/categories',{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
describe('category API',()=>{
 it('creates and lists categories, and rejects invalid or duplicate input',async()=>{
  const f=createSqliteD1Fixture();try {
   expect((await handleCategoryApi(req('POST',{name:'Food'}),f.db,owner,'/api/categories'))?.status).toBe(201);
   const response=await handleCategoryApi(req('GET'),f.db,owner,'/api/categories');
   expect(await response?.json()).toEqual({categories:[{name:'Food',archived:false}]});
   expect((await handleCategoryApi(req('POST',{name:'food'}),f.db,owner,'/api/categories'))?.status).toBe(400);
   expect((await handleCategoryApi(req('POST',{}),f.db,owner,'/api/categories'))?.status).toBe(400);
  }finally {f.close();}
 });
 it('serves category operations through the authenticated web route',async()=>{
  const f=createSqliteD1Fixture();try {
   await provisionWebOwner(f.db);
   const env={DB:f.db,...VERIFIED_WEB_ENV,LEDGER_APP_ORIGIN:'https://pf.example.com',ASSETS:{fetch:vi.fn()}};
   const headers={...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'};
   const post=await worker.fetch(new Request('https://pf.example.com/api/categories',{method:'POST',headers,body:JSON.stringify({name:'Dining'})}),env as never);
   expect(post.status).toBe(201);
   const get=await worker.fetch(new Request('https://pf.example.com/api/categories',{headers:VERIFIED_WEB_HEADERS}),env as never);
   expect(await get.json()).toEqual({categories:[{name:'Dining',archived:false}]});
  }finally {f.close();}
 });
 it('previews and applies category cleanup through the API',async()=>{
  const f=createSqliteD1Fixture();try {
   await handleCategoryApi(req('POST',{name:'Food'}),f.db,owner,'/api/categories');
   const request=(path:string,body:unknown)=>new Request(`https://example.test/api/categories/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const preview=await handleCategoryApi(request('preview',{from:'Food',to:'Dining'}),f.db,owner,'/api/categories');
   expect(preview?.status).toBe(200);const data=await preview!.json() as {version:string};
   const apply=await handleCategoryApi(request('cleanup',{from:'Food',to:'Dining',version:data.version}),f.db,owner,'/api/categories');
   expect(apply?.status).toBe(200);
   const list=await handleCategoryApi(req('GET'),f.db,owner,'/api/categories');
   expect(await list?.json()).toMatchObject({categories:expect.arrayContaining([{name:'Food',archived:true},{name:'Dining',archived:false}])});
  }finally {f.close();}
 });
 it('serves date-filtered activity and spending through web authorization',async()=>{
  const f=createSqliteD1Fixture();try {
   await provisionWebOwner(f.db);
   await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('a','Account','Bank','CAD','chequing','connected','personal')").run();
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('t','personal','a','2026-10-10','Coffee',-1200,'CAD','Food','expense','confirmed','manual','fp')").run();
   const env={DB:f.db,...VERIFIED_WEB_ENV,LEDGER_APP_ORIGIN:'https://pf.example.com',ASSETS:{fetch:vi.fn()}};
   const query='category=Food&from=2026-10-01&to=2026-10-31';
   const activity=await worker.fetch(new Request(`https://pf.example.com/api/category-activity?${query}`,{headers:VERIFIED_WEB_HEADERS}),env as never);
   expect(activity.status).toBe(200);expect(await activity.json()).toMatchObject({items:[{id:'t',category:'Food'}]});
   const report=await worker.fetch(new Request(`https://pf.example.com/api/reports/summary?${query}`,{headers:VERIFIED_WEB_HEADERS}),env as never);
   expect(report.status).toBe(200);expect(await report.json()).toMatchObject({currencyTotals:[{currency:'CAD',confirmedMinorUnits:1200}]});
  }finally {f.close();}
 });
});
