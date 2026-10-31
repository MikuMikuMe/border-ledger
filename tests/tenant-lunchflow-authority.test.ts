import { afterEach, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { createLunchFlowService } from '../worker/lunchflow-service';
import { publishLunchFlowSelection, rememberLunchFlowOperation } from '../worker/lunchflow-store';
import type { D1Database } from '../worker/db-types';
import type { OwnerContext } from '../worker/mobile-auth';

const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });
const account = { id: 'bank', name: 'Private bank', institutionName: 'Bank', currency: 'CAD', status: 'ACTIVE' };
const selection = [{ providerAccountId: 'bank', accountId: 'lf-bank', name: 'Bank', institution: 'Bank', currency: 'CAD', kind: 'chequing' as const }];
const identity = {ownerSubjectHash:'owner-subject',operationKind:'account-selection',idempotencyKey:'selection'};
const invalidations = {
  revoked: "revoked_at=CURRENT_TIMESTAMP",
  generation: 'access_generation=2',
  scope: "scope_json='[]'",
  expired: "access_expires_at='2000-01-01T00:00:00Z'",
  environment: "environment_hash='other-environment'",
};
async function setup() {
  const fixture = createSqliteD1Fixture(); fixtures.push(fixture);
  await seedTenants(fixture.db);
  const owner: OwnerContext = {...tenantOwner(OWNER_LEDGER),scopes:['connections:manage']};
  await fixture.db.prepare('UPDATE owner_session_families SET scope_json=? WHERE id=?').bind(JSON.stringify(owner.scopes),owner.familyId).run();
  const messages: unknown[]=[];
  const env={DB:fixture.db,LUNCHFLOW_API_KEY:'synthetic',SYNC_QUEUE:{send:async(message:unknown)=>{messages.push(message);}}};
  return {db:fixture.db,owner,env,messages};
}
async function invalidate(db:D1Database, change:keyof typeof invalidations) {
  await db.prepare(`UPDATE owner_session_families SET ${invalidations[change]} WHERE id='owner-family'`).run();
}

it.each(Object.keys(invalidations) as (keyof typeof invalidations)[])('blocks native discovery and selection after %s during provider discovery', async change=>{
  for (const operation of ['readAccounts','selectAccounts'] as const) {
    const {db,owner,env,messages}=await setup();
    const service=createLunchFlowService(env,owner,{listAccounts:async()=>{await invalidate(db,change);return [account];},listTransactions:async()=>[]});
    const result=operation==='readAccounts' ? service.readAccounts() : service.selectAccounts({accounts:[{providerAccountId:'bank',currency:'CAD',kind:'chequing'}],...identity});
    await expect(result).rejects.toThrow();
    expect(await db.prepare('SELECT * FROM lunchflow_accounts').first()).toBeNull();
    expect(await db.prepare('SELECT * FROM lunchflow_operations').first()).toBeNull();
    expect(messages).toEqual([]);
  }
});

it('blocks provider access with missing connections scope and preserves the supplied scope snapshot',async()=>{
  const {owner,env}=await setup();
  const scopes: OwnerContext['scopes'][number][]=['ledger:read'];
  let calls=0;
  const service=createLunchFlowService(env,{...owner,scopes},{listAccounts:async()=>{calls++;return [account];},listTransactions:async()=>[]});
  scopes.push('connections:manage');
  await expect(service.readAccounts()).rejects.toThrow();
  expect(calls).toBe(0);
});

it.each(['selection','receipt'] as const)('atomically rejects native %s publication after logout at the batch boundary',async operation=>{
  const {db,owner}=await setup();
  const racing:D1Database={prepare:sql=>db.prepare(sql),batch:async statements=>{await invalidate(db,'revoked');return db.batch(statements);}};
  const result=operation==='selection'
    ? publishLunchFlowSelection(racing,owner,selection,{...identity,selection,requestDigest:'digest',response:{selected:1}})
    : rememberLunchFlowOperation(racing,owner,identity,{response:{queued:true}});
  await expect(result).rejects.toThrow();
  expect(await db.prepare('SELECT * FROM lunchflow_accounts').first()).toBeNull();
  expect(await db.prepare('SELECT * FROM lunchflow_operations').first()).toBeNull();
});

it('keeps stored background connection authority independent of logout and omits native credentials from jobs',async()=>{
  const {db,owner,env,messages}=await setup();
  const provider={listAccounts:async()=>[account],listTransactions:async()=>[]};
  await createLunchFlowService(env,owner,provider).selectAccounts({accounts:[{providerAccountId:'bank',currency:'CAD',kind:'chequing'}]});
  expect(messages).toEqual([{type:'lunchflow-sync',jobId:expect.any(String),connectionId:'lunchflow-personal-owner',generation:1,userId:'owner',ledgerId:'personal',accounts:[{providerAccountId:'bank',revision:1}]}]);
  await invalidate(db,'revoked');
  expect(await createLunchFlowService(env,OWNER_LEDGER,provider).sync()).toEqual({accounts:1});
});
