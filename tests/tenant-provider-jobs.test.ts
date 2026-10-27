import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { encryptAccessToken } from '../worker/plaid';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants } from './helpers/tenants';
import type { D1Database } from '../worker/db-types';

const key='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
afterEach(()=>vi.restoreAllMocks());

async function seedJobs(db:D1Database) {
  await seedTenants(db);
  const sealed=await encryptAccessToken('synthetic-owner-access',key);
  await db.prepare('INSERT INTO plaid_items(item_id,ledger_id,access_token_ciphertext,access_token_iv) VALUES (?,?,?,?)')
    .bind('owner-item','personal',sealed.ciphertext,sealed.iv).run();
  await db.prepare("INSERT INTO recurring_sync_state(item_id,ledger_id,requested_generation,scope_version,lifecycle) VALUES ('owner-item','personal',1,2,'active')").run();
  await db.prepare("INSERT INTO plaid_accounts(plaid_account_id,item_id,account_id,name,ledger_id) VALUES ('raw-provider-account','owner-item','owner-account','Bank','personal')").run();
  await db.prepare(`INSERT INTO recurring_streams(id,ledger_id,item_id,stream_id,account_id,currency,source_status,source_frequency,frequency,is_outflow)
    VALUES ('last-good','personal','owner-item','raw-stream','owner-account','CAD','MATURE','MONTHLY','MONTHLY',1)`).run();
}

function runtime(db:D1Database) {
  return {DB:db,ASSETS:{fetch:async()=>new Response('not found',{status:404})},PLAID_CLIENT_ID:'synthetic-client',PLAID_SECRET:'synthetic-secret',PLAID_ENV:'sandbox',PLAID_ENCRYPTION_KEY:key,LUNCHFLOW_API_KEY:'synthetic-key'};
}

async function deliver(db:D1Database,body:unknown) {
  const outcome={acked:0,retried:0};
  await worker.queue({messages:[{body,ack:()=>{outcome.acked+=1;},retry:()=>{outcome.retried+=1;}}]},runtime(db));
  return outcome;
}

const validJob={type:'plaid-recurring-sync',...OWNER_LEDGER,itemId:'owner-item',generation:1,scopeVersion:2,connectionRevision:1};

it.each([
  {...validJob,...SECOND_LEDGER},
  {...validJob,userId:'second'},
  {...validJob,generation:0},
  {...validJob,scopeVersion:1},
  {type:'plaid-recurring-sync',itemId:'owner-item',generation:1},
  {type:'lunchflow-sync',...SECOND_LEDGER,accounts:[{providerAccountId:'raw-provider-account',revision:1}]},
])('rejects a forged or stale queue binding before fetching financial data: %j',async body=>{
  const fixture=createSqliteD1Fixture();
  try {
    await seedJobs(fixture.db);
    const requests:unknown[]=[];
    vi.spyOn(globalThis,'fetch').mockImplementation(async request=>{requests.push(request);throw new Error('unexpected provider request');});
    expect(await deliver(fixture.db,body)).toEqual({acked:1,retried:0});
    expect(requests).toEqual([]);
    expect((await fixture.db.prepare("SELECT present_in_latest_snapshot AS present FROM recurring_streams WHERE id='last-good'").first<{present:number}>())?.present).toBe(1);
  } finally {fixture.close();}
});

it('publishes a valid recurring queue result using the raw provider account boundary',async()=>{
  const fixture=createSqliteD1Fixture();
  try {
    await seedJobs(fixture.db);
    vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
      const request=new Request(input);
      expect(new URL(request.url).pathname).toBe('/transactions/recurring/get');
      expect(await request.json()).toMatchObject({access_token:'synthetic-owner-access',account_ids:['raw-provider-account']});
      return Response.json({updated_at:'2026-10-24T00:00:00Z',history_complete:true,inflow_streams:[],outflow_streams:[]});
    });
    expect(await deliver(fixture.db,validJob)).toEqual({acked:1,retried:0});
    expect((await fixture.db.prepare("SELECT completed_generation AS generation FROM recurring_sync_state WHERE item_id='owner-item'").first<{generation:number}>())?.generation).toBe(1);
    expect((await fixture.db.prepare("SELECT present_in_latest_snapshot AS present FROM recurring_streams WHERE id='last-good'").first<{present:number}>())?.present).toBe(0);
  } finally {fixture.close();}
});

it('does not publish when the user is disabled while the provider request is in flight',async()=>{
  const fixture=createSqliteD1Fixture();
  try {
    await seedJobs(fixture.db);
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
      return Response.json({updated_at:'2026-10-24T00:00:00Z',history_complete:true,inflow_streams:[],outflow_streams:[]});
    });
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    expect(await deliver(fixture.db,validJob)).toEqual({acked:0,retried:1});
    expect(log).toHaveBeenCalledExactlyOnceWith('queue_message_failed','LedgerAccessError');
    expect((await fixture.db.prepare("SELECT present_in_latest_snapshot AS present FROM recurring_streams WHERE id='last-good'").first<{present:number}>())?.present).toBe(1);
    expect(await deliver(fixture.db,validJob)).toEqual({acked:1,retried:0});
  } finally {fixture.close();}
});
