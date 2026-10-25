import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants } from './helpers/tenants';
import { readRecurringPage, publishRecurringSnapshot, readRecurringDetail, requestRecurringSync, updateRecurringClassification } from '../worker/recurring-store';
import type { D1Database } from '../worker/db-types';

async function seedRecurring(db: D1Database) {
  await seedTenants(db);
  for (const context of [OWNER_LEDGER, SECOND_LEDGER]) {
    const id = context.userId;
    await db.prepare("INSERT INTO plaid_items(item_id,ledger_id,access_token_ciphertext,access_token_iv) VALUES (?,?,'cipher','iv')").bind(`${id}-item`,context.ledgerId).run();
    await db.prepare("INSERT INTO recurring_sync_state(item_id,ledger_id,requested_generation,scope_version,lifecycle) VALUES (?,?,1,0,'active')").bind(`${id}-item`,context.ledgerId).run();
    await db.prepare(`INSERT INTO recurring_streams(id,ledger_id,item_id,stream_id,account_id,currency,source_status,source_frequency,frequency,is_outflow)
      VALUES (?,?,?,?,?,'CAD','MATURE','MONTHLY','MONTHLY',1)`).bind(`${id}-stream`,context.ledgerId,`${id}-item`,'same-stream',`${id}-account`).run();
  }
}

function emptySnapshot() {
  return { itemId: 'owner-item', sourceUpdatedAt: '2026-10-24T00:00:00Z', requestId: null, historyComplete: true, streams: [], coverageWarnings: [] };
}

describe('recurring tenant isolation', () => {
  it('lists only streams owned by the authenticated ledger', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedRecurring(fixture.db);
      const page = await readRecurringPage(fixture.db, SECOND_LEDGER);
      expect(page.streams.map(stream => stream.id)).toEqual(['second-stream']);
    } finally { fixture.close(); }
  });
  it.each(['disabled-user','disconnected','new-generation'] as const)('preserves last-good data on a publication race: %s', async (change) => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedRecurring(fixture.db);
      const racing: D1Database = { prepare: query => fixture.db.prepare(query), batch: async statements => {
        if (change === 'disabled-user') await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
        if (change === 'disconnected') await fixture.db.prepare("UPDATE recurring_sync_state SET lifecycle='disconnected' WHERE item_id='owner-item'").run();
        if (change === 'new-generation') await fixture.db.prepare("UPDATE recurring_sync_state SET requested_generation=2 WHERE item_id='owner-item'").run();
        return fixture.db.batch(statements);
      }};
      await publishRecurringSnapshot(racing, OWNER_LEDGER, { itemId: 'owner-item', generation: 1, scopeVersion: 0, connectionRevision:1, snapshot: emptySnapshot(), checkedAt: '2026-10-24T00:00:00Z' }).catch(() => undefined);
      const row = await fixture.db.prepare("SELECT present_in_latest_snapshot AS present FROM recurring_streams WHERE id='owner-stream'").first<{present:number}>();
      expect(row?.present).toBe(1);
    } finally { fixture.close(); }
  });
});


describe('recurring demand and mutation authority', () => {
  it('does not reuse a generation when requests overlap', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedRecurring(fixture.db);
      const messages: unknown[] = [];
      const queue = {send: async (message: unknown) => {messages.push(message);}};
      const generations = await Promise.all([requestRecurringSync(fixture.db, OWNER_LEDGER, queue, 'owner-item'),requestRecurringSync(fixture.db, OWNER_LEDGER, queue, 'owner-item')]);
      expect(generations.sort()).toEqual([2,3]);
    } finally {fixture.close();}
  });
  it('rejects classification after the trusted user was disabled', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedRecurring(fixture.db);
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run();
      await expect(updateRecurringClassification(fixture.db, SECOND_LEDGER, 'second-stream', { classification: 'bill', expectedRevision: 0 })).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT classification FROM recurring_classifications WHERE recurring_stream_id='second-stream'").first()).toBeNull();
    } finally {fixture.close();}
  });
  it('does not disclose or classify a guessed stream from another ledger', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedRecurring(fixture.db);
      expect(await readRecurringDetail(fixture.db, SECOND_LEDGER, 'owner-stream')).toBeNull();
      expect(await updateRecurringClassification(fixture.db, SECOND_LEDGER, 'owner-stream', { classification: 'bill', expectedRevision: 0 })).toMatchObject({kind:'not_found'});
    } finally {fixture.close();}
  });
});

it('rolls back classification when the user is disabled immediately before its write batch', async () => {
  const fixture=createSqliteD1Fixture();
  try {
    await seedRecurring(fixture.db);
    const racing:D1Database={prepare:sql=>fixture.db.prepare(sql),batch:async statements=>{
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run();
      return fixture.db.batch(statements);
    }};
    await updateRecurringClassification(racing,SECOND_LEDGER,'second-stream',{classification:'bill',expectedRevision:0}).catch(()=>undefined);
    expect(await fixture.db.prepare("SELECT * FROM recurring_classifications WHERE recurring_stream_id='second-stream'").first()).toBeNull();
  } finally {fixture.close();}
});
