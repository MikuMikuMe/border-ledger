import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task18MigrationNames } from './helpers/d1';
import { mapPlaidTransaction, upsertPlaidTransaction } from '../worker/plaid';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

describe('Task 3 provider and candidate identity', () => {
  it('upserts by provider identity and writes source provenance idempotently', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task18MigrationNames);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('account-rbc', 'Synthetic RBC', 'RBC', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv) VALUES (?, ?, ?)')
        .bind('item-rbc', 'ciphertext-fixture', 'iv-fixture'),
    ]);

    const first = mapPlaidTransaction({
      transaction_id: 'provider-1',
      account_id: 'plaid-account-rbc',
      amount: 12,
      iso_currency_code: 'CAD',
      date: '2026-10-12',
      merchant_name: 'Synthetic Cafe',
      name: 'Synthetic Cafe',
      pending: false,
    }, 'account-rbc', 'item-rbc');
    expect(first).not.toBeNull();
    await upsertPlaidTransaction(fixture.db, first!);

    const equalPurchase = {
      ...first!,
      id: 'plaid-account-rbc-provider-2',
      providerTransactionId: 'provider-2',
    };
    await upsertPlaidTransaction(fixture.db, equalPurchase);
    await upsertPlaidTransaction(fixture.db, { ...first!, amountMinor: -1300, merchant: 'Synthetic Cafe updated' });

    await expect(fixture.db.prepare(`SELECT id, amount_minor, merchant, provider_transaction_id
      FROM transactions ORDER BY provider_transaction_id`).all()).resolves.toMatchObject({
      results: [
        { id: 'plaid-account-rbc-provider-1', amount_minor: -1300, merchant: 'Synthetic Cafe updated', provider_transaction_id: 'provider-1' },
        { id: 'plaid-account-rbc-provider-2', amount_minor: -1200, merchant: 'Synthetic Cafe', provider_transaction_id: 'provider-2' },
      ],
    });
    await expect(fixture.db.prepare(`SELECT identity_key, transaction_id, provider_transaction_id
      FROM transaction_source_records ORDER BY identity_key`).all()).resolves.toMatchObject({
      results: [
        { identity_key: 'plaid:item-rbc:provider-1', transaction_id: 'plaid-account-rbc-provider-1', provider_transaction_id: 'provider-1' },
        { identity_key: 'plaid:item-rbc:provider-2', transaction_id: 'plaid-account-rbc-provider-2', provider_transaction_id: 'provider-2' },
      ],
    });
  });

  it('retains pending and current provider lineage when later payloads omit one side', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task18MigrationNames);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('account-rbc', 'Synthetic RBC', 'RBC', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv) VALUES (?, ?, ?)')
        .bind('item-rbc', 'ciphertext-fixture', 'iv-fixture'),
    ]);

    const pending = mapPlaidTransaction({
      transaction_id: 'pending-1',
      account_id: 'plaid-account-rbc',
      amount: 12,
      iso_currency_code: 'CAD',
      date: '2026-10-12',
      merchant_name: 'Synthetic Cafe',
      name: 'Synthetic Cafe',
      pending: true,
    }, 'account-rbc', 'item-rbc');
    const posted = mapPlaidTransaction({
      transaction_id: 'posted-1',
      pending_transaction_id: 'pending-1',
      account_id: 'plaid-account-rbc',
      amount: 12,
      iso_currency_code: 'CAD',
      date: '2026-10-12',
      merchant_name: 'Synthetic Cafe',
      name: 'Synthetic Cafe',
      pending: false,
    }, 'account-rbc', 'item-rbc');
    const modified = mapPlaidTransaction({
      transaction_id: 'posted-1',
      account_id: 'plaid-account-rbc',
      amount: 13,
      iso_currency_code: 'CAD',
      date: '2026-10-12',
      merchant_name: 'Synthetic Cafe',
      name: 'Synthetic Cafe',
      pending: false,
    }, 'account-rbc', 'item-rbc');
    expect(pending).not.toBeNull();
    expect(posted).not.toBeNull();
    expect(modified).not.toBeNull();
    await upsertPlaidTransaction(fixture.db, pending!);
    await upsertPlaidTransaction(fixture.db, posted!);
    await upsertPlaidTransaction(fixture.db, modified!);

    await expect(fixture.db.prepare(`SELECT id, amount_minor, provider_transaction_id, provider_pending_transaction_id
      FROM transactions`).all()).resolves.toMatchObject({
      results: [{ id: pending!.id, amount_minor: -1300, provider_transaction_id: 'posted-1', provider_pending_transaction_id: 'pending-1' }],
    });
    await expect(fixture.db.prepare(`SELECT identity_key, transaction_id
      FROM transaction_source_records ORDER BY identity_key`).all()).resolves.toMatchObject({
      results: [
        { identity_key: 'plaid:item-rbc:pending:pending-1', transaction_id: pending!.id },
        { identity_key: 'plaid:item-rbc:posted-1', transaction_id: pending!.id },
      ],
    });
  });

  it('keeps provider lineage while allowing equal non-unique candidate fingerprints', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('account-rbc', 'Synthetic RBC', 'RBC', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv) VALUES (?, ?, ?)')
        .bind('item-rbc', 'ciphertext-fixture', 'iv-fixture'),
      fixture.db.prepare(`INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint,
         plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('provider-a', 'account-rbc', '2026-10-12', 'Synthetic Cafe', -1200, 'CAD', 'Food', 'expense', 'confirmed', 'plaid', 'same-candidate', 'item-rbc', 'provider-a', 'pending-a'),
      fixture.db.prepare(`INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint,
         plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('provider-b', 'account-rbc', '2026-10-12', 'Synthetic Cafe', -1200, 'CAD', 'Food', 'expense', 'confirmed', 'plaid', 'legacy-candidate-b', 'item-rbc', 'provider-b', 'pending-b'),
    ]);
    await applyMigrations(fixture.db, task18MigrationNames);

    await fixture.db.prepare('UPDATE transactions SET fingerprint = ? WHERE id = ?').bind('same-candidate', 'provider-b').run();

    const records = await fixture.db.prepare(`SELECT source_kind, identity_key, transaction_id,
        provider_item_id, provider_transaction_id, provider_pending_transaction_id
      FROM transaction_source_records ORDER BY transaction_id`).all();
    expect(records.results).toEqual([
      {
        source_kind: 'plaid',
        identity_key: 'plaid:item-rbc:provider-a',
        transaction_id: 'provider-a',
        provider_item_id: 'item-rbc',
        provider_transaction_id: 'provider-a',
        provider_pending_transaction_id: 'pending-a',
      },
      {
        source_kind: 'plaid',
        identity_key: 'plaid:item-rbc:provider-b',
        transaction_id: 'provider-b',
        provider_item_id: 'item-rbc',
        provider_transaction_id: 'provider-b',
        provider_pending_transaction_id: 'pending-b',
      },
    ]);

    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'statement-equal', 'account-rbc', '2026-10-12', 'Synthetic Cafe', -1200, 'CAD', 'Food', 'expense', 'confirmed', 'statement', 'same-candidate',
    ).run();
    await fixture.db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, bank_source_id, bank_row_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'source-record:statement-equal', 'statement', 'statement:account-rbc:synthetic:row-1', 'statement-equal', 'account-rbc', 'synthetic', 'row-1', 'digest-row-1',
    ).run();

    await fixture.db.prepare('UPDATE transactions SET amount_minor = ? WHERE id = ?').bind(-1300, 'provider-a').run();
    await expect(fixture.db.prepare('SELECT amount_minor FROM transactions WHERE id = ?').bind('provider-b').all()).resolves.toMatchObject({ results: [{ amount_minor: -1200 }] });

    await expect(fixture.db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, bank_source_id, bank_row_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'source-record:statement-equal-duplicate', 'statement', 'statement:account-rbc:synthetic:row-1', 'statement-equal', 'account-rbc', 'synthetic', 'row-1', 'digest-row-1',
    ).run()).rejects.toThrow();

    const candidates = await fixture.db.prepare('SELECT id, fingerprint, provider_transaction_id FROM transactions WHERE fingerprint = ? ORDER BY id').bind('same-candidate').all();
    expect(candidates.results).toEqual([
      { id: 'provider-a', fingerprint: 'same-candidate', provider_transaction_id: 'provider-a' },
      { id: 'provider-b', fingerprint: 'same-candidate', provider_transaction_id: 'provider-b' },
      { id: 'statement-equal', fingerprint: 'same-candidate', provider_transaction_id: null },
    ]);
  });

  it('keeps a legacy transaction identity without rewriting its transaction ID', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('legacy-account', 'Synthetic legacy', 'BOC', 'CNY', 'credit', 'import_only').run();
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'legacy-transaction', 'legacy-account', '2026-10-11', 'Synthetic legacy merchant', -900, 'CNY', 'Other', 'expense', 'confirmed', 'statement', 'legacy-fingerprint',
    ).run();
    await applyMigrations(fixture.db, task18MigrationNames);

    const row = await fixture.db.prepare(`SELECT t.id, t.note, r.identity_key
      FROM transactions t JOIN transaction_source_records r ON r.transaction_id = t.id
      WHERE t.id = ?`).bind('legacy-transaction').all();
    expect(row.results).toEqual([{ id: 'legacy-transaction', note: null, identity_key: 'legacy:legacy-transaction' }]);
  });
});
