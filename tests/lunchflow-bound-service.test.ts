import { expect, it } from 'vitest';
import { setup, connect, SECOND_LEDGER, OWNER_LEDGER, browser, token, deferred } from './helpers/lunchflow-platform';
import { resolveLunchFlowScope } from '../worker/lunchflow-scope';
import { publishLunchFlowSnapshot, publishLunchFlowSelection, recordLunchFlowError } from '../worker/lunchflow-store';
import { mapLunchFlowTransaction } from '../worker/lunchflow';
import type { D1Statement } from '../worker/db-types';
import { createLunchFlowService } from '../worker/lunchflow-service';
const account={id:'same-bank',bankConnectionId:'raw-bank-connection',name:'Bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'};
const transaction={id:'same-tx',accountId:'same-bank',amount:-10,currency:'CAD',date:'2026-10-24',merchant:'Cafe',description:'purchase',isPending:false};
const provider={listAccounts:async()=>[account],listTransactions:async()=>[transaction]};
const selection={accounts:[{providerAccountId:'same-bank',currency:'CAD',kind:'chequing' as const}],idempotencyKey:'same-key'};
it.each([OWNER_LEDGER,SECOND_LEDGER])('binds $userId Platform reconnect to stable history and fresh queue generations',async context=>{
 const f=await setup(async(_input,init)=>init?.method==='DELETE'?new Response(null,{status:204}):Response.json(token));
 try{
  const initial=await f.oauth.startWeb(context,browser),id=initial.connectionId,queued:unknown[]=[];
  await f.oauth.complete(context,browser,{state:new URL(initial.authorizationUrl).searchParams.get('state')!,cookie:initial.cookie,code:'first'});
  const env={...f.env,SYNC_QUEUE:{send:async(message:unknown)=>{queued.push(message);}}};
  const service=createLunchFlowService(env,context,provider,id);
  await service.selectAccounts(selection);await service.sync();
  const before=(await f.db.prepare("SELECT * FROM transactions WHERE source='lunchflow'").all()).results;
  expect(before).toHaveLength(1);
  expect(queued[0]).toMatchObject({connectionId:id,generation:2,userId:context.userId,ledgerId:context.ledgerId});
  expect(await f.db.prepare('SELECT connection_id,provider_bank_connection_id FROM lunchflow_accounts').first()).toEqual({connection_id:id,provider_bank_connection_id:'raw-bank-connection'});
  await f.connections.disconnect(context,id,(await f.connections.status(context)).generation!);
  expect(await f.db.prepare('SELECT enabled FROM lunchflow_accounts').first()).toEqual({enabled:0});
  await expect(service.requestSync()).rejects.toThrow();
  const start=await f.oauth.startWeb(context,browser);expect(start.connectionId).toBe(id);
  await f.oauth.complete(context,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'again'});
  const reconnected=createLunchFlowService(env,context,provider,id);
  await reconnected.selectAccounts(selection);await reconnected.sync();
  const after=(await f.db.prepare("SELECT id,account_id FROM transactions WHERE source='lunchflow'").all()).results;
  expect(after).toEqual(before.map(row=>({id:row.id,account_id:row.account_id})));
  expect(queued[1]).toMatchObject({connectionId:id,generation:4});
 }finally{f.close();}
});
it('does not silently reactivate disconnected Personal access when its key remains configured',async()=>{
 const f=await setup();try{
  await f.connections.disconnect(OWNER_LEDGER,'lunchflow-personal-owner',1);
  let calls=0;const service=createLunchFlowService({...f.env,LUNCHFLOW_API_KEY:'test-owner',SYNC_QUEUE:{send:async()=>{}}},OWNER_LEDGER,{...provider,listAccounts:async()=>{calls++;return [account];}});
  await expect(service.selectAccounts(selection)).rejects.toThrow();
  expect(calls).toBe(0);
  expect(await f.connections.status(OWNER_LEDGER)).toMatchObject({connected:false,canReconnect:false,reason:'personal_disconnected'});
 }finally{f.close();}
});


async function history(f:Awaited<ReturnType<typeof setup>>) {
 const rows=await Promise.all(['accounts','transactions','transaction_source_records','lunchflow_accounts','lunchflow_operations'].map(async table=>(await f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
 return rows;
}
async function selectedFixture(){
 const f=await setup(async(_input,init)=>init?.method==='DELETE'?new Response(null,{status:204}):Response.json(token));
 const id=await connect(f),env={...f.env,SYNC_QUEUE:{send:async()=>{}}};
 const service=createLunchFlowService(env,SECOND_LEDGER,provider,id);
 await service.selectAccounts(selection);await service.sync();
 return {...f,id,env,service};
}
it.each(['snapshot','selection'] as const)('fences disconnect immediately before the %s batch including metadata and receipts',async operation=>{
 const f=await selectedFixture();try{
  const scope=(await resolveLunchFlowScope(f.db,SECOND_LEDGER,f.id))!;
  const mapping=await f.db.prepare('SELECT account_id FROM lunchflow_accounts WHERE connection_id=?').bind(f.id).first<{account_id:string}>();
  const row=await mapLunchFlowTransaction({...transaction,merchant:'late'},'same-bank',mapping!.account_id);
  let saved:unknown;
  const racing={prepare:f.db.prepare.bind(f.db),batch:async(statements:D1Statement[])=>{await f.connections.disconnect(SECOND_LEDGER,f.id,(await f.connections.status(SECOND_LEDGER)).generation!);saved=await history(f);return f.db.batch(statements);}};
  const write=operation==='snapshot'
   ?publishLunchFlowSnapshot(racing,scope,{revision:{providerAccountId:'same-bank',revision:1},transactions:[row],syncedAt:'2090-01-01'})
   :publishLunchFlowSelection(racing,scope,[{providerAccountId:'same-bank',accountId:mapping!.account_id,providerBankConnectionId:'raw-bank-connection',name:'late',institution:'Bank',currency:'CAD',kind:'chequing'}]);
  await expect(write).rejects.toThrow();expect(await history(f)).toEqual(saved);
  await recordLunchFlowError(f.db,scope,{providerAccountId:'same-bank',revision:1},'late error','2090-01-01');
  expect(await history(f)).toEqual(saved);
 }finally{f.close();}
});
it('blocks raw bank connection changes without remapping imported history',async()=>{
 const f=await selectedFixture();try{
  const before=await history(f),changed={...provider,listAccounts:async()=>[{...account,bankConnectionId:'different-bank'}]};
  const service=createLunchFlowService(f.env,SECOND_LEDGER,changed,f.id);
  await expect(service.readAccounts()).rejects.toMatchObject({code:'bank_connection_changed'});
  await expect(service.selectAccounts({...selection,idempotencyKey:'new-key'})).rejects.toThrow();
  expect(await history(f)).toEqual(before);
 }finally{f.close();}
});
it('isolates equal raw account/transaction IDs and request keys across two Platform users',async()=>{
 const f=await setup(async(_input,init)=>Response.json({...token,user_id:JSON.parse(String(init?.body)).code==='owner-code'?'external-owner':token.user_id}));
 try{
  const second=await connect(f),start=await f.oauth.startWeb(OWNER_LEDGER,browser);
  await f.oauth.complete(OWNER_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'owner-code'});
  const env={...f.env,SYNC_QUEUE:{send:async()=>{}}};
  for(const [context,id] of [[OWNER_LEDGER,start.connectionId],[SECOND_LEDGER,second]] as const){
   const service=createLunchFlowService(env,context,provider,id);await service.selectAccounts(selection);await service.sync();
  }
  const accounts=(await f.db.prepare('SELECT account_id,connection_id FROM lunchflow_accounts').all()).results;
  expect(accounts).toHaveLength(2);expect(new Set(accounts.map(row=>row.account_id)).size).toBe(2);
  expect((await f.db.prepare("SELECT COUNT(*) n FROM transactions WHERE source='lunchflow'").first())?.n).toBe(2);
  await expect(createLunchFlowService(env,OWNER_LEDGER,provider,second).readAccounts()).rejects.toMatchObject({code:'connection_not_found'});
 }finally{f.close();}
});

it.each([null,'historical-local-account'])('retains or completes an existing Personal account mapping (%s)',async originalId=>{
 const f=await setup();try{
  if(originalId)await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES (?,'Old','Bank','CAD','chequing','connected')").bind(originalId).run();
  await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,account_id,name,institution) VALUES ('same-bank',?,'Old','Bank')").bind(originalId).run();
  const personalProvider={...provider,listAccounts:async()=>[{...account,bankConnectionId:undefined}]};
  const service=createLunchFlowService({...f.env,LUNCHFLOW_API_KEY:'owner-test',SYNC_QUEUE:{send:async()=>{}}},OWNER_LEDGER,personalProvider);
  await service.selectAccounts(selection);
  const row=await f.db.prepare("SELECT account_id FROM lunchflow_accounts WHERE provider_account_id='same-bank'").first<{account_id:string}>();
  expect(row?.account_id).toBeTruthy();if(originalId)expect(row?.account_id).toBe(originalId);
  expect(await f.db.prepare("SELECT COUNT(*) n FROM accounts WHERE ledger_id='personal'").first()).toEqual({n:2});
 }finally{f.close();}
});

it.each(['discovery','transactions'] as const)('does not return or publish %s fetched before disconnect',async phase=>{
 const f=await selectedFixture(),gate=deferred<void>(),entered=deferred<void>();try{
  const delayed={listAccounts:async()=>{if(phase==='discovery'){entered.resolve();await gate.promise;}return [account];},
    listTransactions:async()=>{entered.resolve();await gate.promise;return [{...transaction,merchant:'late-private-data'}];}};
  const service=createLunchFlowService(f.env,SECOND_LEDGER,delayed,f.id);
  const pending=phase==='discovery'?service.readAccounts():service.sync();const rejected=expect(pending).rejects.toThrow();
  await entered.promise;await f.connections.disconnect(SECOND_LEDGER,f.id,(await f.connections.status(SECOND_LEDGER)).generation!);const saved=await history(f);
  gate.resolve();await rejected;expect(await history(f)).toEqual(saved);
 }finally{f.close();}
});
