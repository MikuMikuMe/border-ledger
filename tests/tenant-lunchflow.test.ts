import { resolveLunchFlowScope } from '../worker/lunchflow-scope';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants } from './helpers/tenants';
import { mapLunchFlowTransaction } from '../worker/lunchflow';
import { createLunchFlowService } from '../worker/lunchflow-service';
import { readLunchFlowMappings, lunchFlowLedgerAccountId, publishLunchFlowSelection, publishLunchFlowSnapshot, readLunchFlowOperationRecord } from '../worker/lunchflow-store';

describe('Lunch Flow tenant isolation', () => {
  it('does not expose the owner Personal feed to a second user', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const provider = { listAccounts: async () => [{id:'owner-bank',name:'Owner bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'}], listTransactions: async () => [] };
      const service = createLunchFlowService({DB:fixture.db,LUNCHFLOW_API_KEY:'synthetic-owner-key'}, SECOND_LEDGER, provider);
      expect(await service.readAccounts()).toEqual({configured:false,accounts:[]});
    } finally {fixture.close();}
  });
  it('reads only mappings for the selected ledger when provider IDs overlap', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      await fixture.db.prepare("INSERT INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id,lifecycle) VALUES ('second-connection','second','second-ledger','platform','test-client','connected')").run();
      for (const context of [OWNER_LEDGER,SECOND_LEDGER]) {
        await fixture.db.prepare(`INSERT INTO lunchflow_accounts(provider_account_id,account_id,ledger_id,name,institution,currency,kind,connection_id)
          VALUES ('same-bank',?,?,?,'Bank','CAD','chequing',?)`).bind(`${context.userId}-account`,context.ledgerId,context.userId,context.userId==='owner'?'lunchflow-personal-owner':'second-connection').run();
      }
      expect((await readLunchFlowMappings(fixture.db, (await resolveLunchFlowScope(fixture.db,SECOND_LEDGER,'second-connection'))!)).map(row => row.name)).toEqual(['second']);
    } finally {fixture.close();}
  });
});

it('does not return provider discovery after the owner is disabled during the request', async () => {
  const fixture = createSqliteD1Fixture();
  try {
    const provider = {listAccounts: async () => {
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
      return [{id:'owner-bank',name:'Private bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'}];
    },listTransactions:async()=>[]};
    const service=createLunchFlowService({DB:fixture.db,LUNCHFLOW_API_KEY:'synthetic'},OWNER_LEDGER,provider);
    await expect(service.readAccounts()).rejects.toThrow();
  } finally {fixture.close();}
});

it('keeps equal provider IDs and idempotency keys independent while preserving historical owner IDs', async () => {
  const fixture = createSqliteD1Fixture();
  try {
    await seedTenants(fixture.db);
    const identity={ownerSubjectHash:'same-subject',operationKind:'account-selection',idempotencyKey:'same-key'};
    await fixture.db.prepare("INSERT INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id,lifecycle) VALUES ('second-connection','second','second-ledger','platform','test-client','connected')").run();
    const second=(await resolveLunchFlowScope(fixture.db,SECOND_LEDGER,'second-connection'))!;
    for(const context of [OWNER_LEDGER,second]) {
      const accountId=await lunchFlowLedgerAccountId(context,'same-bank');
      const selection=[{providerAccountId:'same-bank',accountId,name:context.userId,institution:'Bank',currency:'CAD',kind:'chequing' as const}];
      await publishLunchFlowSelection(fixture.db,context,selection,{...identity,selection,requestDigest:'digest',response:{user:context.userId}});
      const transaction=await mapLunchFlowTransaction({id:'same-transaction',accountId:'same-bank',amount:-10,currency:'CAD',date:'2026-10-24',merchant:context.userId,description:'purchase',isPending:false},'same-bank',accountId);
      await publishLunchFlowSnapshot(fixture.db,context,{revision:{providerAccountId:'same-bank',revision:1},transactions:[transaction],syncedAt:'2026-10-24T00:00:00Z'});
      const rows=await fixture.db.prepare("SELECT id,merchant FROM transactions WHERE ledger_id=? AND source='lunchflow'").bind(context.ledgerId).all<{id:string;merchant:string}>();
      expect(rows.results).toHaveLength(1);
      expect(rows.results[0].merchant).toBe(context.userId);
      expect(rows.results[0].id === transaction.id).toBe(context.userId==='owner');
      expect((await readLunchFlowOperationRecord(fixture.db,context,identity,'digest'))?.response).toEqual({user:context.userId});
    }
    expect((await fixture.db.prepare("SELECT COUNT(*) AS count FROM transaction_source_records WHERE source_kind='lunchflow'").first<{count:number}>())?.count).toBe(2);
  } finally {fixture.close();}
});

it.each(['disabled','reselected'] as const)('keeps Lunch Flow history unchanged if publication becomes %s',async change=>{
  const fixture=createSqliteD1Fixture();
  try {
    const selection=[{providerAccountId:'same-bank',accountId:'lf-account',name:'Bank',institution:'Bank',currency:'CAD',kind:'chequing' as const}];
    await publishLunchFlowSelection(fixture.db,OWNER_LEDGER,selection);
    const transaction=await mapLunchFlowTransaction({id:'same-tx',accountId:'same-bank',amount:-10,currency:'CAD',date:'2026-10-24',merchant:'original',description:'purchase',isPending:false},'same-bank','lf-account');
    const publication={revision:{providerAccountId:'same-bank',revision:1},transactions:[transaction],syncedAt:'2026-10-24T00:00:00Z'};
    await publishLunchFlowSnapshot(fixture.db,OWNER_LEDGER,publication);
    const racing={prepare:fixture.db.prepare.bind(fixture.db),batch:async(statements:import('../worker/db-types').D1Statement[])=>{
      if(change==='disabled')await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
      else await fixture.db.prepare("UPDATE lunchflow_accounts SET revision=2 WHERE ledger_id='personal'").run();
      return fixture.db.batch(statements);
    }};
    await publishLunchFlowSnapshot(racing,OWNER_LEDGER,{...publication,transactions:[{...transaction,merchant:'changed'}]}).catch(()=>undefined);
    expect((await fixture.db.prepare('SELECT merchant FROM transactions WHERE id=?').bind(transaction.id).first<{merchant:string}>())?.merchant).toBe('original');
  } finally {fixture.close();}
});
