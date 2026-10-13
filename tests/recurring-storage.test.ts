import { afterEach, describe, expect, it } from 'vitest';
import { createD1Fixture } from './helpers/d1';
import { mapPlaidTransaction, removePlaidTransaction, upsertPlaidTransaction } from '../worker/plaid';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

function plaidTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: 'pending-1',
    account_id: 'plaid-account-1',
    amount: 20,
    iso_currency_code: 'CAD',
    date: '2026-10-09',
    merchant_name: 'Cafe',
    name: 'Cafe',
    pending: true,
    ...overrides,
  };
}

async function seedLedger(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-rbc', 'Everyday chequing', 'RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)').bind('item-1', 'ciphertext', 'iv', 'RBC'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)').bind('plaid-account-1', 'item-1', 'account-rbc', 'Everyday chequing'),
  ]);
}

describe('Plaid transaction storage identity', () => {
  it('keeps one local row across pending, posted, modified, and removal events', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await seedLedger(fixture.db);

    const pending = mapPlaidTransaction(plaidTransaction(), 'account-rbc', 'item-1');
    expect(pending).not.toBeNull();
    await upsertPlaidTransaction(fixture.db, pending!);

    const posted = mapPlaidTransaction(plaidTransaction({ transaction_id: 'posted-1', pending_transaction_id: 'pending-1', pending: false }), 'account-rbc', 'item-1');
    expect(posted).not.toBeNull();
    await upsertPlaidTransaction(fixture.db, posted!);
    await removePlaidTransaction(fixture.db, 'item-1', 'pending-1');

    const afterPendingRemoval = await fixture.db.prepare('SELECT id, amount_minor, status, provider_transaction_id, provider_pending_transaction_id FROM transactions').all<Record<string, unknown>>();
    expect(afterPendingRemoval.results).toHaveLength(1);
    expect(afterPendingRemoval.results[0]).toMatchObject({ id: pending!.id, amount_minor: -2000, status: 'confirmed', provider_transaction_id: 'posted-1', provider_pending_transaction_id: 'pending-1' });

    const modified = mapPlaidTransaction(plaidTransaction({ transaction_id: 'posted-1', amount: 21, pending: false, pending_transaction_id: null }), 'account-rbc', 'item-1');
    expect(modified).not.toBeNull();
    await upsertPlaidTransaction(fixture.db, modified!);

    const afterModification = await fixture.db.prepare('SELECT id, amount_minor, provider_transaction_id FROM transactions').all<Record<string, unknown>>();
    expect(afterModification.results).toEqual([{ id: pending!.id, amount_minor: -2100, provider_transaction_id: 'posted-1' }]);

    await removePlaidTransaction(fixture.db, 'item-1', 'posted-1');
    await expect(fixture.db.prepare('SELECT id FROM transactions').all()).resolves.toMatchObject({ results: [] });
  });

  it('preserves the existing ledger and skips a tracked migration on repeat', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('legacy-1', 'Legacy account', 'Legacy bank', 'CNY', 'savings', 'import_only').run();
    await fixture.db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('legacy-tx', 'legacy-1', '2026-01-02', 'Old merchant', -1234, 'CNY', 'Food', 'expense', 'confirmed', 'statement', 'legacy-fingerprint', 'Keep this note').run();

    const before = await fixture.db.prepare('SELECT id, amount_minor, date, note FROM transactions WHERE id = ?').bind('legacy-tx').all();
    expect(before.results[0]).toMatchObject({ id: 'legacy-tx', amount_minor: -1234, date: '2026-01-02', note: 'Keep this note' });

    const migrationsBefore = await fixture.db.prepare('SELECT COUNT(*) AS count FROM __migrations').all<{ count: number }>();
    expect(migrationsBefore.results[0].count).toBe(3);
    await fixture.db.prepare('CREATE TABLE IF NOT EXISTS __migrations_sentinel (id TEXT PRIMARY KEY)').run();
    const migrationsAfter = await fixture.db.prepare('SELECT COUNT(*) AS count FROM __migrations').all<{ count: number }>();
    expect(migrationsAfter.results[0].count).toBe(migrationsBefore.results[0].count);

    const after = await fixture.db.prepare('SELECT id, amount_minor, date, note FROM transactions WHERE id = ?').bind('legacy-tx').all();
    expect(after.results[0]).toEqual(before.results[0]);
  });

  it('uses real D1 batch atomicity for invalid writes', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await expect(fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('batch-account', 'Batch', 'Bank', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('batch-tx', 'missing-account', '2026-01-01', 'Bad', -100, 'CAD', 'Food', 'expense', 'confirmed', 'statement', 'batch-fingerprint', null),
    ])).rejects.toThrow();
    await expect(fixture.db.prepare('SELECT id FROM accounts WHERE id = ?').bind('batch-account').all()).resolves.toMatchObject({ results: [] });
  });
});
