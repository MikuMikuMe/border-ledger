import { readPlanOccurrences } from '../worker/recurring-plan-projection';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Fixture, task24MigrationNames } from './helpers/d1';
import { createPlan, listPlans, updatePlan } from '../worker/recurring-plans';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose(); });
const owner = { userId: 'owner', ledgerId: 'personal' };
const input = { accountId: 'acct', currency: 'CAD', merchant: 'Transit', direction: 'expense' as const, amountMinor: 1250, frequency: 'monthly' as const, startDate: '2026-01-31', endDate: null };
async function fixture() {
  const result = await createD1Fixture([...task24MigrationNames, '0025-lunchflow-platform.sql', '0026-lunchflow-connection-mappings.sql', '0027-hosted-users-activation.sql', '0028-recurring-plans.sql']); fixtures.push(result);
  await result.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
  await result.db.prepare("INSERT OR IGNORE INTO account_currencies(account_id,currency,ledger_id) VALUES('acct','CAD','personal')").run();
  return result.db;
}
describe('ledger-owned recurring plans', () => {
  it('creates idempotently, scopes reads and checks revisions', async () => {
    const db = await fixture();
    const created = await createPlan(db, owner, 'operation-1', input);
    expect(await createPlan(db, owner, 'operation-1', input)).toEqual(created);
    expect(await listPlans(db, owner)).toHaveLength(1);
    expect(await listPlans(db, { userId: 'other', ledgerId: 'other' })).toEqual([]);
    expect(await updatePlan(db, owner, {id:created.id,revision:0,value:{ ...input, merchant: 'New name', enabled: true }})).toMatchObject({ revision: 1, merchant: 'New name' });
    await expect(updatePlan(db, owner, {id:created.id,revision:0,value:{ ...input, enabled: true }})).rejects.toThrow('revision');
  });
  it('projects confirmed ledger transactions without creating or changing them', async () => {
    const db = await fixture();
    await createPlan(db, owner, 'projection', input);
    await db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx','acct','2026-02-28','Transit',-1250,'CAD','Transit','expense','confirmed','manual','fp','personal')").run();
    const items = await readPlanOccurrences(db, owner, {from:'2026-02-28', to:'2026-02-28', today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')});
    expect(items[0]).toMatchObject({ status: 'matched', candidateIds: ['tx'] });
    const count = await db.prepare('SELECT count(*) AS count FROM transactions').first<{count:number}>();
    expect(count?.count).toBe(1);
  });
  it('flags missing only after an error-free connected Lunch Flow sync', async () => {
    const db = await fixture();
    await createPlan(db, owner, 'freshness', input);
    await db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,connection_id,account_id,ledger_id,name,institution,currency,kind,enabled,last_synced_at) VALUES('provider','lunchflow-personal-owner','acct','personal','Account','Bank','CAD','chequing',1,'2026-03-10T16:00:00Z')").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
    await db.prepare("INSERT INTO recurring_lunchflow_sync_jobs(job_id,ledger_id,connection_id,connection_generation,provider_account_id,account_revision,state) VALUES('done','personal','lunchflow-personal-owner',1,'provider',1,'completed')").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28', to:'2026-02-28', today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('potentially_missing');
    await db.prepare("UPDATE lunchflow_connections SET operation_id='busy',operation_kind='refresh',operation_expires_at='2099-01-01' WHERE id='lunchflow-personal-owner'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
    await db.prepare("UPDATE lunchflow_connections SET operation_id=NULL,operation_kind=NULL,operation_expires_at=NULL WHERE id='lunchflow-personal-owner'").run();
    await db.prepare("INSERT INTO recurring_lunchflow_sync_jobs(job_id,ledger_id,connection_id,connection_generation,provider_account_id,account_revision,state) VALUES('job','personal','lunchflow-personal-owner',1,'provider',1,'pending')").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
    await db.prepare("UPDATE recurring_lunchflow_sync_jobs SET state='completed' WHERE job_id='job'").run();
    await db.prepare("UPDATE lunchflow_connections SET last_error='sync failed' WHERE id='lunchflow-personal-owner'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28', to:'2026-02-28', today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
  });
  it('assesses missing payments for a freshly synced Plaid account', async () => {
    const db = await fixture();
    await createPlan(db, owner, 'plaid-plan', input);
    await db.prepare("INSERT INTO plaid_items(item_id,access_token_ciphertext,access_token_iv,ledger_id) VALUES('item','cipher','iv','personal')").run();
    await db.prepare("INSERT INTO plaid_accounts(plaid_account_id,item_id,account_id,name,ledger_id) VALUES('provider','item','acct','Account','personal')").run();
    await db.prepare("UPDATE sync_state SET lifecycle='active',last_success_at='2026-03-10T16:00:00Z' WHERE connection_id='plaid:item' AND ledger_id='personal'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('potentially_missing');
    await db.prepare("UPDATE sync_state SET last_success_at='2026-03-09T23:00:00Z' WHERE connection_id='plaid:item'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T12:00:00Z')}))[0].status).toBe('potentially_missing');
    await db.prepare("UPDATE sync_state SET last_success_at='2026-03-10T16:00:00Z' WHERE connection_id='plaid:item'").run();
    await db.prepare("UPDATE sync_state SET requested_generation=2,completed_generation=1 WHERE connection_id='plaid:item'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
    await db.prepare("UPDATE sync_state SET completed_generation=2 WHERE connection_id='plaid:item'").run();
    await db.prepare("UPDATE sync_state SET last_error='failed' WHERE connection_id='plaid:item'").run();
    expect((await readPlanOccurrences(db, owner, {from:'2026-02-28',to:'2026-02-28',today:'2026-03-10',now:new Date('2026-03-10T20:00:00Z')}))[0].status).toBe('not_assessable');
  });
  it('rejects creation above the bounded plan limit', async () => {
    const db = await fixture();
    await db.batch(Array.from({length:200}, (_, index) => db.prepare("INSERT INTO recurring_plans(id,ledger_id,account_id,currency,merchant,direction,amount_minor,frequency,start_date,operation_id,initial_payload) VALUES(?, 'personal','acct','CAD','Transit','expense',1250,'monthly','2026-01-31',?,'{}')").bind(`plan-${index}`, `op-${index}`)));
    await expect(createPlan(db, owner, 'one-too-many', input)).rejects.toThrow('limit');
    expect(await listPlans(db, owner)).toHaveLength(200);
  });
  it('does not permit another ledger to read or update a plan', async () => {
    const db = await fixture();
    const plan = await createPlan(db, owner, 'private', input);
    await db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
    await db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
    await db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('other-acct','Other','Bank','CAD','chequing','connected','other-ledger')").run();
    const other = {userId:'other',ledgerId:'other-ledger'};
    expect(await listPlans(db, other)).toEqual([]);
    await expect(updatePlan(db, other, {id:plan.id,revision:0,value:{...input,accountId:'other-acct',enabled:true}})).rejects.toThrow('revision');
    expect((await listPlans(db, owner))[0].revision).toBe(0);
  });
  it('rejects unknown currencies, foreign accounts and conflicting idempotency reuse', async () => {
    const db = await fixture();
    await expect(createPlan(db, owner, 'bad', { ...input, currency: 'CNY' })).rejects.toThrow();
    await expect(createPlan(db, owner, 'bad', { ...input, accountId: 'missing' })).rejects.toThrow();
    await createPlan(db, owner, 'once', input);
    await expect(createPlan(db, owner, 'once', { ...input, amountMinor: 2000 })).rejects.toThrow();
  });
});
