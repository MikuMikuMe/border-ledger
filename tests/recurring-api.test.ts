import { afterEach, describe, expect, it } from 'vitest';
import { validRecurringResponse } from './fixtures/recurring/valid';
import { createD1Fixture } from './helpers/d1';
import { normalizeRecurringSnapshot } from '../worker/plaid-recurring';
import { publishRecurringSnapshot, readRecurringDetail, readRecurringPage, readRecurringSummary, setRecurringClassification } from '../worker/recurring-store';

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
    db.prepare('INSERT INTO recurring_sync_state (item_id, requested_generation, scope_version, history_complete, source_updated_at, last_success_at, lifecycle) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('item-1', 1, 0, 1, '2026-10-13T14:00:00.000Z', '2026-10-13T15:00:00.000Z', 'active'),
    db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, plaid_item_id, provider_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('ledger-expense', 'account-cad', '2026-10-01', 'Metro Toronto', -1234, 'CAD', 'Transport', 'expense', 'confirmed', 'plaid', 'expense-fingerprint', 'item-1', 'posted-cad-1'),
    db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, plaid_item_id, provider_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('ledger-refund', 'account-cad', '2026-10-02', 'Metro refund', 200, 'CAD', 'Refunds', 'refund', 'confirmed', 'plaid', 'refund-fingerprint', 'item-1', 'refund-1'),
    db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, plaid_item_id, provider_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('ledger-transfer', 'account-cad', '2026-10-03', 'Card payment', -5000, 'CAD', 'Transfers', 'transfer', 'confirmed', 'plaid', 'transfer-fingerprint', 'item-1', 'transfer-1'),
  ]);
}

describe('recurring repository reads', () => {
  it('paginates stable streams, reads detail history, and aggregates actual cost across full history', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await seed(fixture.db);
    const snapshot = normalizeRecurringSnapshot(validRecurringResponse, 'item-1', new Map([['plaid-cad', 'account-cad'], ['plaid-cny', 'account-cny']]));
    await publishRecurringSnapshot(fixture.db, 'item-1', 1, 0, snapshot, '2026-10-13T15:00:00.000Z');
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cad', 'item-1', 'refund-1', 'ledger-refund', 'account-cad', '2026-10-02', 200, 'CAD', 'refund', 1),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cny', 'item-1', 'posted-cad-1', 'ledger-expense', 'account-cny', '2026-10-01', -1234, 'CAD', 'expense', 1),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cny', 'item-1', 'transfer-1', 'ledger-transfer', 'account-cny', '2026-10-03', -5000, 'CAD', 'transfer', 1),
    ]);
    await setRecurringClassification(fixture.db, 'item-1:stream-cad', 'subscription');

    const firstPage = await readRecurringPage(fixture.db, { limit: 1, today: '2026-10-13' });
    expect(firstPage.streams).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await readRecurringPage(fixture.db, { limit: 1, cursor: firstPage.nextCursor!, today: '2026-10-13' });
    expect(secondPage.streams).toHaveLength(1);
    expect(secondPage.streams[0].id).not.toBe(firstPage.streams[0].id);

    const detail = await readRecurringDetail(fixture.db, 'item-1:stream-cad');
    expect(detail).not.toBeNull();
    expect(detail?.classification).toBe('subscription');
    expect(detail?.history.length).toBeGreaterThan(0);

    const summary = await readRecurringSummary(fixture.db, { startDate: '2026-10-01', endDate: '2026-10-31', today: '2026-10-13' });
    expect(summary.streamCount).toBe(2);
    expect(summary.actualCostByCurrency).toEqual({ CAD: 1034, CNY: 0 });
    expect(summary.subscriptionByCurrency.CAD).toBeLessThan(0);
  });

  it('returns waiting state before the first successful source result and validates classification IDs', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-cad', 'CAD account', 'RBC', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)').bind('item-1', 'ciphertext', 'iv', 'RBC'),
      fixture.db.prepare('INSERT INTO recurring_sync_state (item_id, lifecycle, history_complete) VALUES (?, ?, ?)').bind('item-1', 'active', 0),
    ]);
    const page = await readRecurringPage(fixture.db, { today: '2026-10-13' });
    expect(page.state).toBe('waiting');
    await expect(setRecurringClassification(fixture.db, 'missing', 'bill')).resolves.toBe(false);
  });
});
