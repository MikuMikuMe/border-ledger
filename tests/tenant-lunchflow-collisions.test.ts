import { afterEach, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER } from './helpers/tenants';
import { mapLunchFlowTransaction } from '../worker/lunchflow';
import { publishLunchFlowSelection, publishLunchFlowSnapshot } from '../worker/lunchflow-store';
import type { D1Database } from '../worker/db-types';

const fixtures: ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{for(const fixture of fixtures.splice(0))fixture.close();});
async function setup() {
  const fixture=createSqliteD1Fixture();fixtures.push(fixture);
  const selection=[{providerAccountId:'bank',accountId:'lf-account',name:'Bank',institution:'Bank',currency:'CAD',kind:'chequing' as const}];
  await publishLunchFlowSelection(fixture.db,OWNER_LEDGER,selection);
  const transaction=await mapLunchFlowTransaction({id:'last-good',accountId:'bank',amount:-10,currency:'CAD',date:'2026-10-24',merchant:'Original',description:'purchase',isPending:false},'bank','lf-account');
  const publication={revision:{providerAccountId:'bank',revision:1},transactions:[transaction],syncedAt:'2026-10-24T00:00:00Z'};
  await publishLunchFlowSnapshot(fixture.db,OWNER_LEDGER,publication);
  return {db:fixture.db,transaction,publication};
}
async function history(db:D1Database) {
  const tables=['transactions','transaction_source_records','lunchflow_accounts','accounts','account_currencies'];
  return Promise.all(tables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
}

it.each(['manual-transaction','other-account','provider-identity','source-identity','source-record-id','incoming-account','incoming-provider'] as const)('rejects %s collisions atomically without changing last-good history',async collision=>{
  const {db,transaction,publication}=await setup();
  const incoming=await mapLunchFlowTransaction({id:'incoming',accountId:'bank',amount:-20,currency:'USD',date:'2026-10-24',merchant:'Incoming',description:'purchase',isPending:false},'bank','lf-account');
  if(collision==='manual-transaction') {
    await db.prepare("UPDATE transactions SET source='manual',merchant='Unrelated manual',amount_minor=-9900 WHERE id=?").bind(transaction.id).run();
    incoming.id=transaction.id;
  }
  if(collision==='other-account') {
    await db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status) VALUES ('other','Other','Bank','CAD','chequing','import_only')").run();
    await db.prepare("DELETE FROM transaction_source_records WHERE transaction_id=?").bind(transaction.id).run();
    await db.prepare("UPDATE transactions SET account_id='other' WHERE id=?").bind(transaction.id).run();
    incoming.id=transaction.id;
  }
  if(collision==='provider-identity') incoming.id=transaction.id;
  if(collision==='source-identity') incoming.sourceIdentity=transaction.sourceIdentity;
  if(collision==='source-record-id') incoming.sourceRecordId=transaction.sourceRecordId;
  if(collision==='incoming-account') incoming.accountId='wrong-account';
  if(collision==='incoming-provider') incoming.providerAccountId='wrong-provider';
  const before=await history(db);
  await expect(publishLunchFlowSnapshot(db,OWNER_LEDGER,{...publication,transactions:[{...transaction,merchant:'Changed'},incoming],syncedAt:'2026-10-25T00:00:00Z'})).rejects.toThrow();
  expect(await history(db)).toEqual(before);
});

it('checks a transaction collision inside the publication batch',async()=>{
  const {db,transaction,publication}=await setup();
  const racing:D1Database={prepare:sql=>db.prepare(sql),batch:async statements=>{
    await db.prepare("UPDATE transactions SET source='manual' WHERE id=?").bind(transaction.id).run();
    return db.batch(statements);
  }};
  await expect(publishLunchFlowSnapshot(racing,OWNER_LEDGER,{...publication,transactions:[{...transaction,merchant:'Changed'}]})).rejects.toThrow();
  expect(await db.prepare('SELECT merchant,source FROM transactions WHERE id=?').bind(transaction.id).first()).toEqual({merchant:'Original',source:'manual'});
});
