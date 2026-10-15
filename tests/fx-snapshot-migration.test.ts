import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task17MigrationNames, task18MigrationNames } from './helpers/d1';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { insertFxSnapshotIfAbsent, readFxSnapshot, type FxRateSnapshotRow } from '../worker/db-types';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const bootstrapFixtures: Array<{ close(): void }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
  while (bootstrapFixtures.length > 0) bootstrapFixtures.pop()?.close();
});

type FixtureDatabase = Awaited<ReturnType<typeof createD1Fixture>>['db'];

async function seedPopulatedPreFxFixture(db: FixtureDatabase) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('fx-account', 'FX migration account', 'Synthetic bank', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO account_currencies (account_id, currency) VALUES (?, ?)')
      .bind('fx-account', 'USD'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
      .bind('fx-item', 'ciphertext', 'iv', 'Synthetic bank'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)')
      .bind('fx-plaid-account', 'fx-item', 'fx-account', 'FX migration account'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note,
       plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-provider', 'fx-account', '2026-10-12', 'Provider purchase', -1234, 'USD', 'Food', 'expense', 'confirmed', 'plaid', 'fx-provider-fingerprint', 'Provider note', 'fx-item', 'provider-transaction-1', 'provider-pending-1'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-statement', 'fx-account', '2026-10-11', 'Statement purchase', -2000, 'CAD', 'Travel', 'expense', 'confirmed', 'statement', 'fx-statement-fingerprint', 'Statement note'),
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-stream', 'fx-item', 'provider-stream-1', 'fx-account', 'Provider service', 'USD', 'MATURE', 'MONTHLY', 'monthly', 1),
    db.prepare(`INSERT INTO recurring_stream_transactions
      (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow, membership_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-stream', 'fx-item', 'provider-transaction-1', 'fx-provider', 'fx-account', '2026-10-12', -1234, 'USD', 'expense', 1, 'fx-membership'),
  ]);
}

async function createPreFxFixture() {
  const fixture = await createD1Fixture(task17MigrationNames);
  fixtures.push(fixture);
  await seedPopulatedPreFxFixture(fixture.db);
  await applyMigrations(fixture.db, task18MigrationNames);
  return fixture;
}

type SnapshotValues = {
  requested_date: string;
  effective_date: string;
  provider: string;
  rates_json: string;
  content_digest: string;
  fetched_at: string;
};

function snapshotValues(requestedDate = '2026-10-20'): SnapshotValues {
  return {
    requested_date: requestedDate,
    effective_date: requestedDate,
    provider: 'frankfurter',
    rates_json: '{}',
    content_digest: 'd',
    fetched_at: 'f',
  };
}

function insertSnapshot(db: FixtureDatabase, values: SnapshotValues) {
  return db.prepare(`INSERT INTO fx_rate_snapshots
    (requested_date, effective_date, provider, rates_json, content_digest, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(
    values.requested_date,
    values.effective_date,
    values.provider,
    values.rates_json,
    values.content_digest,
    values.fetched_at,
  ).run();
}

describe('Task 2 FX snapshot migration', () => {
  it('backfills lock dates without changing source amounts, currencies, provider IDs, notes, or relationships', async () => {
    const fixture = await createPreFxFixture();

    await expect(fixture.db.prepare(`SELECT id, date, fx_lock_date, amount_minor, currency, note,
      plaid_item_id, provider_transaction_id, provider_pending_transaction_id
      FROM transactions ORDER BY id`).all()).resolves.toMatchObject({
      results: [
        {
          id: 'fx-provider', date: '2026-10-12', fx_lock_date: '2026-10-12', amount_minor: -1234, currency: 'USD', note: 'Provider note',
          plaid_item_id: 'fx-item', provider_transaction_id: 'provider-transaction-1', provider_pending_transaction_id: 'provider-pending-1',
        },
        {
          id: 'fx-statement', date: '2026-10-11', fx_lock_date: '2026-10-11', amount_minor: -2000, currency: 'CAD', note: 'Statement note',
          plaid_item_id: null, provider_transaction_id: null, provider_pending_transaction_id: null,
        },
      ],
    });
    await expect(fixture.db.prepare('SELECT recurring_stream_id, provider_transaction_id, transaction_id, currency, membership_id FROM recurring_stream_transactions').all())
      .resolves.toMatchObject({ results: [{ recurring_stream_id: 'fx-stream', provider_transaction_id: 'provider-transaction-1', transaction_id: 'fx-provider', currency: 'USD', membership_id: 'fx-membership' }] });
    await expect(fixture.db.prepare('SELECT plaid_account_id, item_id, account_id FROM plaid_accounts').all())
      .resolves.toMatchObject({ results: [{ plaid_account_id: 'fx-plaid-account', item_id: 'fx-item', account_id: 'fx-account' }] });
    await expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
  });

  it('fills an omitted lock date from the insert date and rejects changing an established lock', async () => {
    const fixture = await createPreFxFixture();

    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-omitted-lock', 'fx-account', '2026-10-13', 'Omitted lock purchase', -300, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'fx-omitted-lock-fingerprint', 'Omitted lock note')
      .run();
    await expect(fixture.db.prepare('SELECT date, fx_lock_date FROM transactions WHERE id = ?').bind('fx-omitted-lock').all())
      .resolves.toMatchObject({ results: [{ date: '2026-10-13', fx_lock_date: '2026-10-13' }] });

    await expect(fixture.db.prepare('UPDATE transactions SET fx_lock_date = ? WHERE id = ?').bind('2026-10-01', 'fx-provider').run())
      .rejects.toThrow(/immutable|lock date/i);
    await expect(fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, fx_lock_date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-invalid-initial-lock', 'fx-account', '2026-10-14', '2026-10-01', 'Invalid lock purchase', -100, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'fx-invalid-initial-lock-fingerprint')
      .run()).rejects.toThrow(/date|lock/i);
  });

  it('keeps the first snapshot for a requested date and rejects updates and deletes', async () => {
    const fixture = await createPreFxFixture();
    const firstSnapshot: FxRateSnapshotRow = {
      requested_date: '2026-10-12',
      effective_date: '2026-10-11',
      provider: 'frankfurter',
      rates_json: '{"CAD":"1.5200","USD":"1.1000"}',
      content_digest: 'first-digest',
      fetched_at: '2026-10-14T12:00:00.000Z',
    };
    const secondSnapshot: FxRateSnapshotRow = {
      ...firstSnapshot,
      effective_date: '2026-10-12',
      rates_json: '{"CAD":"1.5300","USD":"1.1100"}',
      content_digest: 'second-digest',
    };

    await expect(insertFxSnapshotIfAbsent(fixture.db, firstSnapshot)).resolves.toBe(true);
    await expect(insertFxSnapshotIfAbsent(fixture.db, secondSnapshot)).resolves.toBe(false);

    await expect(readFxSnapshot(fixture.db, firstSnapshot.requested_date)).resolves.toEqual(firstSnapshot);
    await expect(fixture.db.prepare('UPDATE fx_rate_snapshots SET rates_json = ? WHERE requested_date = ?').bind(secondSnapshot.rates_json, firstSnapshot.requested_date).run())
      .rejects.toThrow(/immutable|snapshot/i);
    await expect(fixture.db.prepare('DELETE FROM fx_rate_snapshots WHERE requested_date = ?').bind(firstSnapshot.requested_date).run())
      .rejects.toThrow(/immutable|snapshot/i);
    await expect(fixture.db.prepare(`INSERT INTO fx_rate_snapshots
      (requested_date, effective_date, provider, rates_json, content_digest, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('2026-10-13', '2026-10-13', 'other-provider', '{}', 'digest', '2026-10-14T12:00:00.000Z')
      .run()).rejects.toThrow(/provider|constraint/i);
  });

  it('preserves account and currency foreign-key enforcement after the migration', async () => {
    const fixture = await createPreFxFixture();

    await expect(fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-invalid-account', 'missing-account', '2026-10-14', 'Invalid account', -100, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'fx-invalid-account-fingerprint')
      .run()).rejects.toThrow(/foreign key|constraint/i);
    await expect(fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('fx-unapproved-currency', 'fx-account', '2026-10-14', 'Unapproved currency', -100, 'EUR', 'Other', 'expense', 'confirmed', 'manual', 'fx-unapproved-currency-fingerprint')
      .run()).rejects.toThrow(/foreign key|currency|constraint/i);
  });

  it('enforces every bounded snapshot field at its accepted boundary', async () => {
    const fixture = await createPreFxFixture();
    const invalidCases: Array<[string, Partial<SnapshotValues>]> = [
      ['short requested date', { requested_date: '2026-1-01' }],
      ['malformed requested date', { requested_date: '2026/01/01' }],
      ['long effective date', { effective_date: '2026-01-011' }],
      ['malformed effective date', { effective_date: '20260101' }],
      ['empty rates JSON', { rates_json: '' }],
      ['oversized rates JSON', { rates_json: `{"x":"${'a'.repeat(65529)}"}` }],
      ['empty digest', { content_digest: '' }],
      ['oversized digest', { content_digest: 'd'.repeat(129) }],
      ['empty fetched timestamp', { fetched_at: '' }],
      ['oversized fetched timestamp', { fetched_at: 'f'.repeat(65) }],
    ];

    for (const [name, overrides] of invalidCases) {
      await expect(insertSnapshot(fixture.db, { ...snapshotValues(), ...overrides }), name)
        .rejects.toThrow(/constraint|check/i);
    }

    const maxRatesJson = `{"x":"${'a'.repeat(65528)}"}`;
    await expect(insertSnapshot(fixture.db, { ...snapshotValues('2026-10-21'), rates_json: '{}', content_digest: 'd', fetched_at: 'f' })).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(insertSnapshot(fixture.db, { ...snapshotValues('2026-10-22'), rates_json: maxRatesJson, content_digest: 'd'.repeat(128), fetched_at: 'f'.repeat(64) })).resolves.toMatchObject({ meta: { changes: 1 } });
  });

  it('boots the FX schema from worker/schema.sql with lock defaults, constraints, and triggers', async () => {
    const fixture = createSqliteD1Fixture();
    bootstrapFixtures.push(fixture);
    await fixture.db.prepare('PRAGMA foreign_keys = ON').run();

    const columns = await fixture.db.prepare('PRAGMA table_info(transactions)').all<{ name: string; notnull: number }>();
    expect(columns.results.find((column) => column.name === 'fx_lock_date')).toMatchObject({ name: 'fx_lock_date', notnull: 0 });
    const objects = await fixture.db.prepare(`SELECT type, name FROM sqlite_master
      WHERE name IN ('fx_rate_snapshots', 'transactions_fx_lock_date_insert', 'transactions_fx_lock_date_default',
        'transactions_fx_lock_date_immutable', 'fx_rate_snapshots_immutable_update', 'fx_rate_snapshots_immutable_delete')
      ORDER BY type, name`).all<{ type: string; name: string }>();
    expect(objects.results).toEqual([
      { type: 'table', name: 'fx_rate_snapshots' },
      { type: 'trigger', name: 'fx_rate_snapshots_immutable_delete' },
      { type: 'trigger', name: 'fx_rate_snapshots_immutable_update' },
      { type: 'trigger', name: 'transactions_fx_lock_date_default' },
      { type: 'trigger', name: 'transactions_fx_lock_date_immutable' },
      { type: 'trigger', name: 'transactions_fx_lock_date_insert' },
    ]);
    const snapshotDefinition = await fixture.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fx_rate_snapshots'").first<{ sql: string }>();
    expect(snapshotDefinition?.sql).toContain("CHECK (provider = 'frankfurter')");
    expect(snapshotDefinition?.sql).toContain('length(rates_json) BETWEEN 2 AND 65536');
    expect(snapshotDefinition?.sql).toContain('length(content_digest) BETWEEN 1 AND 128');
    expect(snapshotDefinition?.sql).toContain('length(fetched_at) BETWEEN 1 AND 64');

    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('bootstrap-fx-account', 'Bootstrap FX account', 'Synthetic bank', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare(`INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('bootstrap-fx-transaction', 'bootstrap-fx-account', '2026-10-15', 'Bootstrap purchase', -100, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'bootstrap-fx-fingerprint'),
    ]);
    await expect(fixture.db.prepare('SELECT date, fx_lock_date FROM transactions WHERE id = ?').bind('bootstrap-fx-transaction').all())
      .resolves.toMatchObject({ results: [{ date: '2026-10-15', fx_lock_date: '2026-10-15' }] });
    await expect(fixture.db.prepare(`INSERT INTO fx_rate_snapshots
      (requested_date, effective_date, provider, rates_json, content_digest, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('2026/10/15', '2026-10-15', 'frankfurter', '{}', 'd', 'f').run()).rejects.toThrow(/constraint|check/i);
  });
});
