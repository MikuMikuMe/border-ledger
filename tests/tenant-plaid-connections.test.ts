import { buildPlaidLinkTokenPayload } from '../worker/index';
import { buildNativePlaidLinkTokenPayload } from '../worker/connection-service';
import { beginPlaidDisconnect, disconnectPublicationStatements } from '../worker/plaid-connection-store';
import { requestRecurringSync } from '../worker/recurring-store';
import { verifiedRecurringJob } from '../worker/recurring-jobs';
import { verifiedPlaidJob } from '../worker/plaid-jobs';
import type { D1Database } from '../worker/db-types';
import { afterEach, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { createConnectionService, type PlaidProvider } from '../worker/connection-service';
import type { OwnerContext } from '../worker/mobile-auth';

const fixtures: ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{for(const fixture of fixtures.splice(0))fixture.close();});
const account={account_id:'same-account',name:'Bank',type:'depository',subtype:'checking',balances:{iso_currency_code:'CAD'}};
async function setup() {
 const fixture=createSqliteD1Fixture();fixtures.push(fixture);await seedTenants(fixture.db);
 const owners=[OWNER_LEDGER,SECOND_LEDGER].map(context=>({...tenantOwner(context),scopes:['connections:manage','ledger:read']} as OwnerContext));
 for(const owner of owners)await fixture.db.prepare('UPDATE owner_session_families SET scope_json=?,created_at=? WHERE id=?').bind(JSON.stringify(owner.scopes),new Date().toISOString(),owner.familyId).run();
 const messages:unknown[]=[];
 const env={DB:fixture.db,PLAID_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',PLAID_ENV:'sandbox',SYNC_QUEUE:{send:async(value:unknown)=>{messages.push(value);}}};
 const provider:PlaidProvider={createLinkToken:async()=>({link_token:'link'}),exchangePublicToken:async()=>({access_token:'synthetic',item_id:'same-item'}),getItem:async()=>({item:{item_id:'same-item',institution_name:'Bank'}}),getAccounts:async()=>({accounts:[account]}),removeItem:async()=>{}};
 return {db:fixture.db,owners,env,provider,messages};
}

it('isolates equal raw provider identities while retaining historical owner IDs',async()=>{
 const {db,owners,env,provider}=await setup();const service=createConnectionService(env,provider);
 for(const owner of owners){
  const pending=await service.exchangePublicToken(owner,{publicToken:'same-token',idempotencyKey:'same-key'});
  await service.selectPendingAccounts(owner,{pendingConnectionId:pending.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'same-selection'});
 }
 const items=await db.prepare('SELECT item_id,ledger_id FROM plaid_items ORDER BY ledger_id').all<{item_id:string;ledger_id:string}>();
 expect(items.results).toHaveLength(2);expect(items.results[0]).toEqual({item_id:'same-item',ledger_id:'personal'});
 const accounts=await db.prepare("SELECT id,ledger_id FROM accounts WHERE status='connected' ORDER BY ledger_id").all<{id:string;ledger_id:string}>();
 expect(accounts.results).toHaveLength(2);expect(accounts.results[0].id).toBe('plaid-same-account');
});

it('does not publish a pending connection or receipt after logout during exchange',async()=>{
 const {db,owners,env,provider}=await setup();provider.getAccounts=async()=>{await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run();return {accounts:[account]};};
 await expect(createConnectionService(env,provider).exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'})).rejects.toThrow();
 expect(await db.prepare('SELECT * FROM mobile_connections').first()).toBeNull();expect(await db.prepare('SELECT * FROM mobile_connection_operations').first()).toBeNull();
});

it('rejects a changed exchange body with the same operation key',async()=>{
 const {owners,env,provider}=await setup();const service=createConnectionService(env,provider);
 await service.exchangePublicToken(owners[0],{publicToken:'first',idempotencyKey:'exchange'});
 await expect(service.exchangePublicToken(owners[0],{publicToken:'second',idempotencyKey:'exchange'})).rejects.toThrow();
});

it('retains ledger ownership when the same user signs in through another provisioned identity',async()=>{
 const {db,owners,env,provider}=await setup();const service=createConnectionService(env,provider);
 const pending=await service.exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'});
 await db.prepare("UPDATE owner_session_families SET subject_hash='alternate' WHERE id='owner-family'").run();
 const alternate={...owners[0],subjectHash:'alternate'};
 expect(await service.readConnections(alternate)).toHaveLength(1);
 await expect(service.selectPendingAccounts(owners[1],{pendingConnectionId:pending.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'foreign'})).rejects.toThrow();
});

it('rejects mismatched provider item exchange responses before publication',async()=>{
 const {db,owners,env,provider}=await setup();provider.getItem=async()=>({item:{item_id:'other-item'}});
 await expect(createConnectionService(env,provider).exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'})).rejects.toThrow();
 expect(await db.prepare('SELECT * FROM mobile_connections').first()).toBeNull();
});

it('lists native accounts only in the authenticated ledger',async()=>{
 const {owners,env,provider}=await setup();
 expect((await createConnectionService(env,provider).listAccounts(owners[1])).accounts.map(account=>account.id)).toEqual(['second-account']);
});
it('retains the durable revision and account ownership through disconnect and reconnect',async()=>{
 const {db,owners,env,provider,messages}=await setup();const service=createConnectionService(env,provider);
 const pending=await service.exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'});
 await service.selectPendingAccounts(owners[0],{pendingConnectionId:pending.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'select'});
 await service.requestSync(owners[0],'sync');const oldJob=messages[0] as Record<string,unknown>;
 const recurring:Record<string,unknown>[]=[];
 await requestRecurringSync(db,owners[0],{send:async value=>{recurring.push(value as Record<string,unknown>);}},'same-item');
 const fence=await beginPlaidDisconnect(db,owners[0],'same-item');
 await db.batch(disconnectPublicationStatements(db,owners[0],'same-item',fence!.revision));
 expect(await db.prepare('SELECT * FROM plaid_items').first()).toBeNull();
 expect(await db.prepare("SELECT lifecycle FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({lifecycle:'disconnected'});
 const replacement=await service.exchangePublicToken(owners[0],{publicToken:'token2',idempotencyKey:'exchange2'});
 await service.selectPendingAccounts(owners[0],{pendingConnectionId:replacement.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'select2'});
 expect(await verifiedPlaidJob(db,oldJob)).toBeNull();expect(await verifiedRecurringJob(db,recurring[0])).toBeNull();
 expect(await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id='plaid-same-account'").first()).toEqual({n:1});
 await expect(db.prepare("INSERT OR REPLACE INTO plaid_account_ownership(account_id,ledger_id,item_id,provider_account_id) VALUES ('plaid-same-account','personal','unrelated-item','same-account')").run()).rejects.toThrow();
});
it.each(['canceled','revoked'] as const)('does not attach a pending selection after %s at the publication boundary',async change=>{
 const {db,owners,env,provider}=await setup();const service=createConnectionService(env,provider);
 const pending=await service.exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'});
 const racing:D1Database={prepare:sql=>db.prepare(sql),batch:async statements=>{
   if(change==='canceled')await db.prepare("UPDATE mobile_connections SET state='canceled' WHERE id=?").bind(pending.pendingConnectionId).run();
   else await db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='owner-family'").run();
   return db.batch(statements);
 }};
 await expect(createConnectionService({...env,DB:racing},provider).selectPendingAccounts(owners[0],{pendingConnectionId:pending.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'select'})).rejects.toThrow();
 expect(await db.prepare('SELECT * FROM plaid_items').first()).toBeNull();
});

it('uses distinct native and web Link users while retaining the configured owner ID',()=>{
 const env={PLAID_ENV:'sandbox',PLAID_CLIENT_USER_ID:'legacy-owner'};
 for(const build of [buildPlaidLinkTokenPayload,buildNativePlaidLinkTokenPayload]) {
   expect(build(env,OWNER_LEDGER)).toMatchObject({user:{client_user_id:'legacy-owner'}});
   expect(build(env,SECOND_LEDGER)).toMatchObject({user:{client_user_id:'ledger:second-ledger'}});
 }
});
it('keeps credentials fenced after provider revocation failure and permits a safe retry',async()=>{
 const {db,owners,env,provider}=await setup();const service=createConnectionService(env,provider);
 const pending=await service.exchangePublicToken(owners[0],{publicToken:'token',idempotencyKey:'exchange'});
 await service.selectPendingAccounts(owners[0],{pendingConnectionId:pending.pendingConnectionId!,accountIds:['same-account'],idempotencyKey:'select'});
 provider.removeItem=async()=>{throw new Error('synthetic provider failure');};
 await expect(service.disconnect(owners[0],pending.pendingConnectionId!,'disconnect',true)).rejects.toMatchObject({code:'provider_revoke_failed'});
 expect(await db.prepare('SELECT * FROM plaid_items').first()).not.toBeNull();
 expect(await db.prepare("SELECT lifecycle FROM sync_state WHERE connection_id='plaid:same-item'").first()).toEqual({lifecycle:'disconnecting'});
 provider.removeItem=async()=>{};
 await service.disconnect(owners[0],pending.pendingConnectionId!,'disconnect',true);
 expect(await db.prepare('SELECT * FROM plaid_items').first()).toBeNull();
});
