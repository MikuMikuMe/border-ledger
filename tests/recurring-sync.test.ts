import { afterEach, describe, expect, it } from 'vitest';
import { validRecurringResponse } from './fixtures/recurring/valid';
import { createD1Fixture } from './helpers/d1';
import { normalizeRecurringSnapshot } from '../worker/plaid-recurring';
import { publishRecurringSnapshot, requestRecurringSync } from '../worker/recurring-store';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

async function seed(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-cad', 'CAD account', 'RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-cny', 'CNY account', 'BOC', 'CNY', 'savings', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)').bind('item-1', 'ciphertext', 'iv', 'RBC'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)').bind('plaid-cad', 'item-1', 'account-cad', 'CAD account'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)').bind('plaid-cny', 'item-1', 'account-cny', 'CNY account'),
    db.prepare(`INSERT INTO recurring_sync_state (item_id, requested_generation, scope_version, lifecycle) VALUES (?, ?, ?, 'active')`).bind('item-1', 1, 2),
    db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, plaid_item_id, provider_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('ledger-cad', 'account-cad', '2026-10-01', 'Metro Toronto', -1234, 'CAD', 'Transport', 'expense', 'confirmed', 'plaid', 'plaid:account-cad:posted-cad-1', 'item-1', 'posted-cad-1'),
  ]);
}

describe('recurring snapshot publication', () => {
  it('publishes one guarded projection, replaces memberships, and preserves classification', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await seed(fixture.db);
    const snapshot = normalizeRecurringSnapshot(validRecurringResponse, 'item-1', new Map([
      ['plaid-cad', 'account-cad'],
      ['plaid-cny', 'account-cny'],
    ]));

    await expect(publishRecurringSnapshot(fixture.db, 'item-1', 1, 2, snapshot, '2026-10-13T15:00:00.000Z')).resolves.toBe('published');
    await fixture.db.prepare('UPDATE recurring_classifications SET classification = ? WHERE recurring_stream_id = ?').bind('bill', 'item-1:stream-cad').run();

    const changed = { ...snapshot, streams: snapshot.streams.map((stream) => stream.id === 'item-1:stream-cad' ? { ...stream, memberships: [{ ...stream.memberships[0], providerTransactionId: 'posted-cad-2', date: '2026-10-02' }] } : stream) };
    await expect(publishRecurringSnapshot(fixture.db, 'item-1', 1, 2, changed, '2026-10-14T15:00:00.000Z')).resolves.toBe('published');

    const streams = await fixture.db.prepare('SELECT id, present_in_latest_snapshot FROM recurring_streams ORDER BY id').all();
    expect(streams.results).toEqual([
      { id: 'item-1:stream-cad', present_in_latest_snapshot: 1 },
      { id: 'item-1:stream-cny', present_in_latest_snapshot: 1 },
    ]);
    await expect(fixture.db.prepare('SELECT classification FROM recurring_classifications WHERE recurring_stream_id = ?').bind('item-1:stream-cad').all()).resolves.toMatchObject({ results: [{ classification: 'bill' }] });
    await expect(fixture.db.prepare('SELECT provider_transaction_id FROM recurring_stream_transactions WHERE recurring_stream_id = ?').bind('item-1:stream-cad').all()).resolves.toMatchObject({ results: [{ provider_transaction_id: 'posted-cad-2' }] });

    const empty = { ...snapshot, streams: [] };
    await expect(publishRecurringSnapshot(fixture.db, 'item-1', 1, 2, empty, '2026-10-15T15:00:00.000Z')).resolves.toBe('published');
    await expect(fixture.db.prepare('SELECT id FROM recurring_streams WHERE present_in_latest_snapshot = 1').all()).resolves.toMatchObject({ results: [] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM recurring_stream_transactions').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('keeps new demand durable and fences disconnected Items', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await seed(fixture.db);
    const messages: unknown[] = [];
    const queue = { send: async (message: unknown) => { messages.push(message); } };
    await expect(requestRecurringSync(fixture.db, queue, 'item-1')).resolves.toBe(2);
    await expect(requestRecurringSync(fixture.db, queue, 'item-1')).resolves.toBe(3);
    expect(messages).toEqual([{ type: 'plaid-recurring-sync', itemId: 'item-1', generation: 2 }, { type: 'plaid-recurring-sync', itemId: 'item-1', generation: 3 }]);
    const snapshot = normalizeRecurringSnapshot(validRecurringResponse, 'item-1', new Map([['plaid-cad', 'account-cad'], ['plaid-cny', 'account-cny']]));
    await expect(publishRecurringSnapshot(fixture.db, 'item-1', 2, 2, snapshot, '2026-10-13T15:00:00.000Z')).resolves.toBe('superseded');
    await fixture.db.prepare('UPDATE recurring_sync_state SET lifecycle = ? WHERE item_id = ?').bind('disconnecting', 'item-1').run();
    await expect(publishRecurringSnapshot(fixture.db, 'item-1', 3, 2, snapshot, '2026-10-13T15:00:00.000Z')).resolves.toBe('disconnected');
    await expect(fixture.db.prepare('SELECT id FROM recurring_streams').all()).resolves.toMatchObject({ results: [] });
  });
});
