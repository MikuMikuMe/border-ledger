import { expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task24MigrationNames } from './helpers/d1';
import { seedTenants, SECOND_LEDGER, OWNER_LEDGER } from './helpers/tenants';
import { platformEnv, token, browser } from './helpers/lunchflow-platform';
import { createLunchFlowOAuth } from '../worker/lunchflow-oauth';
import { ensurePlatformConnection } from '../worker/lunchflow-connection-store';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { createLunchFlowConnections } from '../worker/lunchflow-connections';
const migration='0025-lunchflow-platform.sql';
it('migrates real D1 without changing owner history and rejects ownership transfers',async()=>{
 const f=await createD1Fixture(task24MigrationNames);try{
  await seedTenants(f.db);await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,account_id,ledger_id,name,institution) VALUES ('raw-bank','owner-account','personal','Old','Bank')").run();
  const before=await f.db.prepare('SELECT * FROM lunchflow_accounts').all();const transactions=await f.db.prepare('SELECT * FROM transactions ORDER BY id').all();
  await applyMigrations(f.db,[migration]);
  expect((await f.db.prepare('SELECT * FROM lunchflow_accounts').all()).results).toEqual(before.results);
  expect((await f.db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(transactions.results);
  await f.db.prepare("INSERT INTO lunchflow_provider_bindings(provider_user_id,user_id,ledger_id) VALUES ('external','second','second-ledger')").run();
  await expect(f.db.prepare("INSERT OR REPLACE INTO lunchflow_provider_bindings(provider_user_id,user_id,ledger_id) VALUES ('external','owner','personal')").run()).rejects.toThrow();
  expect(await f.db.prepare("SELECT user_id FROM lunchflow_provider_bindings WHERE provider_user_id='external'").first()).toEqual({user_id:'second'});
 }finally{await f.dispose();}
});
it('consumes concurrent real-D1 callbacks once and keeps the connection ID on reconnect',async()=>{
 const f=await createD1Fixture([...task24MigrationNames,migration,'0026-lunchflow-connection-mappings.sql']);try{
  await seedTenants(f.db);let requests=0;const fetcher:typeof fetch=async(_input,init)=>{if(init?.method==='DELETE')return new Response(null,{status:204});requests++;return Response.json(token);};
  const env={...platformEnv,DB:f.db},oauth=createLunchFlowOAuth(env,fetcher),connections=createLunchFlowConnections(env,fetcher);
  const start=await oauth.startWeb(SECOND_LEDGER,browser),input={state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'};
  const results=await Promise.allSettled([oauth.complete(SECOND_LEDGER,browser,input),oauth.complete(SECOND_LEDGER,browser,input)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(requests).toBe(1);
  await connections.disconnect(SECOND_LEDGER,start.connectionId,(await connections.status(SECOND_LEDGER)).generation!);
  const next=await oauth.startWeb(SECOND_LEDGER,browser);expect(next.connectionId).toBe(start.connectionId);
  await oauth.complete(SECOND_LEDGER,browser,{state:new URL(next.authorizationUrl).searchParams.get('state')!,cookie:next.cookie,code:'next'});
  expect(await connections.status(SECOND_LEDGER)).toMatchObject({connected:true,connectionId:start.connectionId});
  await expect(connections.accessToken(OWNER_LEDGER,start.connectionId)).rejects.toMatchObject({code:'connection_not_found'});
 }finally{await f.dispose();}
});


it.each(['fresh','migrated'] as const)('preserves every connection barrier against replacement in %s schema',async schema=>{
 const f=schema==='fresh'?createSqliteD1Fixture():await createD1Fixture([...task24MigrationNames,migration,'0026-lunchflow-connection-mappings.sql']);
 try{
  await seedTenants(f.db);
  const config={hasPersonalKey:false,clientId:'test-client'};
  const rows=await Promise.all([ensurePlatformConnection(f.db,SECOND_LEDGER,config),ensurePlatformConnection(f.db,SECOND_LEDGER,config)]);
  expect(rows[0].id).toBe(rows[1].id);
  const id=rows[0].id;
  const oauth=createLunchFlowOAuth({...platformEnv,DB:f.db},async()=>Response.json(token));
  await oauth.startWeb(SECOND_LEDGER,browser);
  await f.db.prepare("INSERT INTO lunchflow_provider_bindings(provider_user_id,user_id,ledger_id) VALUES ('external-second','second','second-ledger')").run();
  await f.db.prepare("UPDATE lunchflow_connections SET provider_user_id='external-second',lifecycle='revocation_pending',generation=9,credential_version=7,token_ciphertext='sealed',token_iv='iv',operation_id='inflight-revoke',operation_kind='revoke',operation_expires_at='2099-01-01',operation_uncertain=1 WHERE id=?").bind(id).run();
  const before=await f.db.prepare('SELECT * FROM lunchflow_connections WHERE id=?').bind(id).first();
  const states=(await f.db.prepare('SELECT * FROM lunchflow_oauth_states WHERE connection_id=?').bind(id).all()).results;
  for(const replacementId of [id,'new-connection']){
   await expect(f.db.prepare("INSERT OR REPLACE INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id) VALUES (?,'second','second-ledger','platform','different-app')").bind(replacementId).run()).rejects.toThrow('connection already exists');
   expect(await f.db.prepare('SELECT * FROM lunchflow_connections WHERE id=?').bind(id).first()).toEqual(before);
   expect((await f.db.prepare('SELECT * FROM lunchflow_oauth_states WHERE connection_id=?').bind(id).all()).results).toEqual(states);
  }
  await expect(ensurePlatformConnection(f.db,SECOND_LEDGER,config)).rejects.toMatchObject({code:'operation_uncertain'});
  expect(await f.db.prepare('SELECT * FROM lunchflow_connections WHERE id=?').bind(id).first()).toEqual(before);
 }finally{if('dispose' in f)await f.dispose();else f.close();}
});
