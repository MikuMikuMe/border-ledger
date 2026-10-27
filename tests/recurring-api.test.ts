import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it } from 'vitest';
import { validRecurringResponse } from './fixtures/recurring/valid';
import { createD1Fixture, task23MigrationNames } from './helpers/d1';
import { normalizeRecurringSnapshot } from '../worker/plaid-recurring';
import { publishRecurringSnapshot, readRecurringDetail, readRecurringPage, readRecurringSummary, setRecurringClassification } from '../worker/recurring-store';
import { classifyMobileRecurring } from '../worker/recurring-service';

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
    const fixture = await createD1Fixture(task23MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const snapshot = normalizeRecurringSnapshot(validRecurringResponse, 'item-1', new Map([['plaid-cad', 'account-cad'], ['plaid-cny', 'account-cny']]));
    await publishRecurringSnapshot(fixture.db, OWNER_LEDGER, { itemId: 'item-1', generation: 1, scopeVersion: 0, connectionRevision:1, snapshot: snapshot, checkedAt: '2026-10-13T15:00:00.000Z' });
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cad', 'item-1', 'refund-1', 'ledger-refund', 'account-cad', '2026-10-02', 200, 'CAD', 'refund', 1),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cny', 'item-1', 'posted-cad-1', 'ledger-expense', 'account-cny', '2026-10-01', -1234, 'CAD', 'expense', 1),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('item-1:stream-cny', 'item-1', 'transfer-1', 'ledger-transfer', 'account-cny', '2026-10-03', -5000, 'CAD', 'transfer', 1),
    ]);
    await setRecurringClassification(fixture.db, OWNER_LEDGER, 'item-1:stream-cad', 'subscription');

    const firstPage = await readRecurringPage(fixture.db, OWNER_LEDGER, { limit: 1, today: '2026-10-13' });
    expect(firstPage.streams).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await readRecurringPage(fixture.db, OWNER_LEDGER, { limit: 1, cursor: firstPage.nextCursor!, today: '2026-10-13' });
    expect(secondPage.streams).toHaveLength(1);
    expect(secondPage.streams[0].id).not.toBe(firstPage.streams[0].id);

    const detail = await readRecurringDetail(fixture.db, OWNER_LEDGER, 'item-1:stream-cad');
    expect(detail).not.toBeNull();
    expect(detail?.classification).toBe('subscription');
    expect(detail?.history.length).toBeGreaterThan(0);

    const summary = await readRecurringSummary(fixture.db, OWNER_LEDGER, { startDate: '2026-10-01', endDate: '2026-10-31', today: '2026-10-13' });
    expect(summary.streamCount).toBe(2);
    expect(summary.actualCostByCurrency).toMatchObject({ CAD: 1034, CNY: 0, HKD: 0, USD: 0 });
    expect(summary.subscriptionByCurrency.CAD).toBeLessThan(0);
  });

  it('keeps registered currencies in recurring summary maps without converting source amounts', async () => {
    const fixture = await createD1Fixture(task23MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('account-usd', 'USD account', 'Synthetic bank', 'USD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('account-hkd', 'HKD account', 'Synthetic bank', 'HKD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
        .bind('item-multi', 'ciphertext', 'iv', 'Synthetic bank'),
      fixture.db.prepare('INSERT INTO recurring_sync_state (item_id, history_complete, last_success_at, lifecycle) VALUES (?, ?, ?, ?)')
        .bind('item-multi', 1, '2026-10-13T15:00:00.000Z', 'active'),
      fixture.db.prepare(`INSERT INTO recurring_streams
        (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow, average_amount_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('stream-usd', 'item-multi', 'provider-usd', 'account-usd', 'USD service', 'USD', 'MATURE', 'MONTHLY', 'MONTHLY', 1, -500),
      fixture.db.prepare(`INSERT INTO recurring_streams
        (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow, average_amount_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('stream-hkd', 'item-multi', 'provider-hkd', 'account-hkd', 'HKD service', 'HKD', 'MATURE', 'MONTHLY', 'MONTHLY', 1, -700),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions
        (recurring_stream_id, item_id, provider_transaction_id, account_id, date, amount_minor, currency, kind, is_outflow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('stream-usd', 'item-multi', 'provider-usd-transaction', 'account-usd', '2026-10-01', -500, 'USD', 'expense', 1),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions
        (recurring_stream_id, item_id, provider_transaction_id, account_id, date, amount_minor, currency, kind, is_outflow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('stream-hkd', 'item-multi', 'provider-hkd-transaction', 'account-hkd', '2026-10-01', -700, 'HKD', 'expense', 1),
    ]);

    const summary = await readRecurringSummary(fixture.db, OWNER_LEDGER, { startDate: '2026-10-01', endDate: '2026-10-31', today: '2026-10-13' });
    expect(summary.monthlyByCurrency).toMatchObject({ CAD: 0, CNY: 0, HKD: -700, USD: -500 });
    expect(summary.yearlyByCurrency).toMatchObject({ CAD: 0, CNY: 0, HKD: -8400, USD: -6000 });
    expect(summary.actualCostByCurrency).toMatchObject({ CAD: 0, CNY: 0, HKD: 0, USD: 0 });
  });

  it('returns waiting state before the first successful source result and validates classification IDs', async () => {
    const fixture = await createD1Fixture(task23MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-cad', 'CAD account', 'RBC', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)').bind('item-1', 'ciphertext', 'iv', 'RBC'),
      fixture.db.prepare('INSERT INTO recurring_sync_state (item_id, lifecycle, history_complete) VALUES (?, ?, ?)').bind('item-1', 'active', 0),
    ]);
    const page = await readRecurringPage(fixture.db, OWNER_LEDGER, { today: '2026-10-13' });
    expect(page.state).toBe('waiting');
    await expect(setRecurringClassification(fixture.db, OWNER_LEDGER, 'missing', 'bill')).resolves.toBe(false);
  });

  it('reports classification storage unavailability instead of blind-upserting', async () => {
    const fixture = await createD1Fixture(task23MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('legacy-account', 'Legacy account', 'Synthetic bank', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
        .bind('legacy-item', 'ciphertext', 'iv', 'Synthetic bank'),
      fixture.db.prepare(`INSERT INTO recurring_streams
        (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('legacy-stream', 'legacy-item', 'provider-stream', 'legacy-account', 'Legacy service', 'CAD', 'MATURE', 'MONTHLY', 'MONTHLY', 1),
      fixture.db.prepare('INSERT INTO recurring_classifications (recurring_stream_id, classification) VALUES (?, ?)')
        .bind('legacy-stream', 'unclassified'),
    ]);

    await expect(setRecurringClassification(fixture.db, OWNER_LEDGER, 'legacy-stream', 'subscription')).resolves.toBe(true);
    await expect(fixture.db.prepare('SELECT classification FROM recurring_classifications WHERE recurring_stream_id = ?').bind('legacy-stream').first<{ classification: string }>())
      .resolves.toEqual({ classification: 'subscription' });
    const unavailable = { prepare: (sql: string) => { if (sql.startsWith('SELECT revision')) throw new Error('classification storage unavailable'); return fixture.db.prepare(sql); }, batch: fixture.db.batch.bind(fixture.db) };
    await expect(classifyMobileRecurring(unavailable, OWNER_LEDGER, 'legacy-stream', { expectedRevision: 0, classification: 'subscription' }))
      .rejects.toMatchObject({ code: 'temporarily_unavailable', status: 503, retryable: true });
    await expect(fixture.db.prepare('SELECT classification FROM recurring_classifications WHERE recurring_stream_id = ?').bind('legacy-stream').first<{ classification: string }>())
      .resolves.toEqual({ classification: 'subscription' });
  });
});
