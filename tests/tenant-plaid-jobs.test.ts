import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants } from './helpers/tenants';
import { connectionPublicationStatements } from '../worker/plaid-connection-store';
import { requestPlaidSync } from '../worker/plaid-jobs';
import { encryptAccessToken, mapPlaidTransaction } from '../worker/plaid';
const key='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const fixture of fixtures.splice(0))fixture.close();});
async function setup() {
 const fixture=createSqliteD1Fixture();fixtures.push(fixture);await seedTenants(fixture.db);
 const sealed=await encryptAccessToken('synthetic',key);
 const publication=await connectionPublicationStatements(fixture.db,OWNER_LEDGER,{providerItemId:'same-item',institution:'Bank',...sealed,
   accounts:[{providerAccountId:'same-account',name:'Bank',currency:'CAD',kind:'chequing',mask:null,subtype:null}]});
 await fixture.db.batch(publication.statements);
 const jobs:Record<string,unknown>[]=[];await requestPlaidSync(fixture.db,OWNER_LEDGER,{send:async value=>{jobs.push(value as Record<string,unknown>);}},publication.itemId);
 const env={DB:fixture.db,PLAID_CLIENT_ID:'synthetic',PLAID_SECRET:'synthetic',PLAID_ENV:'sandbox',PLAID_ENCRYPTION_KEY:key,ASSETS:{fetch:async()=>new Response('404')}};
 return {db:fixture.db,env,job:jobs[0]};
}
async function deliver(env:Awaited<ReturnType<typeof setup>>['env'],body:unknown) {
 const result={acked:0,retried:0};await worker.queue({messages:[{body,ack:()=>{result.acked++;},retry:()=>{result.retried++;}}]},env);return result;
}
const transaction={transaction_id:'raw-transaction',account_id:'same-account',amount:12,iso_currency_code:'CAD',date:'2026-10-24',name:'Purchase',pending:false};
it.each(['foreign','generation','revision','legacy','disabled'] as const)('rejects %s transaction jobs before provider fetch',async change=>{
 const {db,env,job}=await setup();
 const body={...job};if(change==='foreign')Object.assign(body,SECOND_LEDGER);if(change==='generation')body.generation=0;
 if(change==='revision')body.connectionRevision=0;if(change==='legacy'){delete body.userId;delete body.ledgerId;}
 if(change==='disabled')await db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({added:[],modified:[],removed:[],next_cursor:'new',has_more:false}));
 expect(await deliver(env,body)).toEqual({acked:1,retried:0});expect(fetch).not.toHaveBeenCalled();
});
it('does not publish transactions or cursor after disabled-during-fetch',async()=>{
 const {db,env,job}=await setup();const log=vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
 await db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
 return Response.json({added:[transaction],modified:[],removed:[],next_cursor:'new',has_more:false});});
 await deliver(env,job);
 expect(await db.prepare("SELECT * FROM transactions WHERE source='plaid'").first()).toBeNull();
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:null});
 expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','Error');
});
it('rolls back all changed rows and cursor when an incoming identity collides with manual history',async()=>{
 const {db,env,job}=await setup();const log=vi.spyOn(console,'error').mockImplementation(()=>{});const colliding={...transaction,transaction_id:'collision'};const mapped=mapPlaidTransaction(colliding,'plaid-same-account','same-item')!;
 await db.prepare(`INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint)
 VALUES (?,'plaid-same-account','2026-10-24','Manual',-9900,'CAD','Food','expense','confirmed','manual','manual')`).bind(mapped.id).run();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({added:[transaction,colliding],modified:[],removed:[],next_cursor:'new',has_more:false}));
 await deliver(env,job);
 expect(await db.prepare("SELECT * FROM transactions WHERE source='plaid'").first()).toBeNull();
 expect(await db.prepare('SELECT source,merchant FROM transactions WHERE id=?').bind(mapped.id).first()).toEqual({source:'manual',merchant:'Manual'});
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:null});
 expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','Error');
});
it('publishes every page and its cursor together using raw provider account IDs',async()=>{
 const {db,env,job}=await setup();const cursors:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
   const body=await new Request(input).json() as {cursor:string};cursors.push(body.cursor);
   return Response.json(body.cursor===''?{added:[transaction],modified:[],removed:[],next_cursor:'page1',has_more:true}
     :{added:[{...transaction,transaction_id:'second'}],modified:[],removed:[],next_cursor:'complete',has_more:false});
 });
 expect(await deliver(env,job)).toEqual({acked:1,retried:0});expect(cursors).toEqual(['','page1']);
 expect(await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE source='plaid'").first()).toEqual({n:2});
 expect(await db.prepare("SELECT cursor,completed_generation FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:'complete',completed_generation:job.generation});
});
it.each(['disabled','new-demand','disconnect'] as const)('preserves the full last-good snapshot after %s at the batch boundary',async change=>{
 const {db,env,job}=await setup();const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const racing={prepare:db.prepare.bind(db),batch:async(statements:import('../worker/db-types').D1Statement[])=>{
  if(change==='disabled')await db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
  if(change==='new-demand')await db.prepare("UPDATE sync_state SET requested_generation=requested_generation+1 WHERE connection_id='plaid:same-item'").run();
  if(change==='disconnect')await db.prepare("UPDATE sync_state SET lifecycle='disconnecting',connection_revision=connection_revision+1 WHERE connection_id='plaid:same-item'").run();
  return db.batch(statements);
 }};
 vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({added:[transaction],modified:[],removed:[],next_cursor:'new',has_more:false}));
 await deliver({...env,DB:racing},job);
 expect(await db.prepare("SELECT * FROM transactions WHERE source='plaid'").first()).toBeNull();
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:null});
 expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','Error');
});
it('keeps two users with equal raw transaction IDs isolated through the actual queue',async()=>{
 const {db,env,job}=await setup();const sealed=await encryptAccessToken('synthetic-second',key);
 const publication=await connectionPublicationStatements(db,SECOND_LEDGER,{providerItemId:'same-item',institution:'Bank',...sealed,
   accounts:[{providerAccountId:'same-account',name:'Second bank',currency:'CAD',kind:'chequing',mask:null,subtype:null}]});
 await db.batch(publication.statements);const jobs:unknown[]=[];
 await requestPlaidSync(db,SECOND_LEDGER,{send:async value=>{jobs.push(value);}},publication.itemId);
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({added:[transaction],modified:[],removed:[],next_cursor:'complete',has_more:false}));
 expect(await deliver(env,job)).toEqual({acked:1,retried:0});expect(await deliver(env,jobs[0])).toEqual({acked:1,retried:0});
 const rows=await db.prepare("SELECT id,ledger_id FROM transactions WHERE source='plaid' ORDER BY ledger_id").all<{id:string;ledger_id:string}>();
 expect(rows.results).toHaveLength(2);expect(rows.results[0].id).toBe('plaid-plaid-same-account-raw-transaction');expect(rows.results[1].id).not.toBe(rows.results[0].id);
 const sources=await db.prepare("SELECT provider_item_id,provider_transaction_id FROM transaction_source_records WHERE source_kind='plaid'").all();
 expect(sources.results).toEqual([{provider_item_id:'same-item',provider_transaction_id:'raw-transaction'},{provider_item_id:'same-item',provider_transaction_id:'raw-transaction'}]);
});

it('acknowledges a completed redelivery without fetching or changing the committed snapshot',async()=>{
 const {db,env,job}=await setup();
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({added:[transaction],modified:[],removed:[],next_cursor:'newer',has_more:false}));
 await deliver(env,job);
 const before=(await db.prepare('SELECT * FROM transactions').all()).results;
 fetch.mockResolvedValue(Response.json({added:[{...transaction,name:'Stale'}],modified:[],removed:[],next_cursor:'older',has_more:false}));
 expect(await deliver(env,job)).toEqual({acked:1,retried:0});
 expect(fetch).toHaveBeenCalledTimes(1);
 expect((await db.prepare('SELECT * FROM transactions').all()).results).toEqual(before);
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:'newer'});
});
it('rejects an older in-flight result when another delivery completes the same generation first',async()=>{
 const {db,env,job}=await setup();let release!:()=>void;let started!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});const entered=new Promise<void>(resolve=>{started=resolve;});
 let calls=0;vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
  calls++;const older=calls===1;if(older){started();await pending;}
  return Response.json({added:[{...transaction,name:older?'Stale':'Latest'}],modified:[],removed:[],next_cursor:older?'older':'newer',has_more:false});
 });
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const older=deliver(env,job);await entered;await deliver(env,job);release();await older;
 expect(await db.prepare("SELECT merchant FROM transactions WHERE source='plaid'").first()).toEqual({merchant:'Latest'});
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:'newer'});
 expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','Error');
});
it('retries a failed recurring follow-up without repeating completed transaction work',async()=>{
 const {db,env,job}=await setup();const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const send=vi.fn().mockRejectedValueOnce(new Error('synthetic queue failure')).mockResolvedValue(undefined);
 const queuedEnv={...env,SYNC_QUEUE:{send}};
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({added:[transaction],modified:[],removed:[],next_cursor:'complete',has_more:false}));
 expect(await deliver(queuedEnv,job)).toEqual({acked:0,retried:1});
 expect(await deliver(queuedEnv,job)).toEqual({acked:1,retried:0});
 expect(await deliver(queuedEnv,job)).toEqual({acked:1,retried:0});
 expect(fetch).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','Error');
 expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
 expect(send.mock.calls[1][0]).toMatchObject({type:'plaid-recurring-sync',itemId:job.itemId,connectionRevision:job.connectionRevision});
 expect(await db.prepare("SELECT cursor FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({cursor:'complete'});
});
