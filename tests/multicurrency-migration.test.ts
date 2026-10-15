import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task3MigrationNames, task4MigrationNames, task15MigrationNames, task16MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

async function seedPopulatedLegacyCopy(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('card-boc', 'Synthetic multi-currency card', 'BOC', 'CNY', 'credit', 'connected'),
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('account-rbc', 'Synthetic chequing', 'RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
      .bind('item-rbc', 'ciphertext-only-fixture', 'iv-only-fixture', 'RBC'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)')
      .bind('plaid-account-rbc', 'item-rbc', 'account-rbc', 'Synthetic chequing'),
    db.prepare('INSERT INTO sync_state (connection_id, provider, cursor, last_success_at) VALUES (?, ?, ?, ?)')
      .bind('plaid:item-rbc', 'plaid', 'cursor-before-task-3', '2026-10-12T12:00:00.000Z'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note,
       plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-provider', 'account-rbc', '2026-10-12', 'Synthetic provider purchase', -1234, 'CAD', 'Food', 'expense', 'confirmed', 'plaid', 'same-candidate', 'Keep classification', 'item-rbc', 'provider-1', 'pending-1'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-legacy', 'card-boc', '2026-10-11', 'Synthetic statement purchase', -2000, 'CNY', 'Travel', 'expense', 'confirmed', 'statement', 'legacy-candidate', 'Legacy annotation remains'),
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('stream-1', 'item-rbc', 'stream-provider-1', 'account-rbc', 'Synthetic recurring merchant', 'CAD', 'MATURE', 'MONTHLY', 'monthly', 1),
    db.prepare(`INSERT INTO recurring_stream_transactions
      (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow, membership_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('stream-1', 'item-rbc', 'provider-1', 'tx-provider', 'account-rbc', '2026-10-12', -1234, 'CAD', 'expense', 1, 'membership-1'),
    db.prepare('INSERT INTO recurring_classifications (recurring_stream_id, classification, note) VALUES (?, ?, ?)')
      .bind('stream-1', 'subscription', 'Keep classification'),
    db.prepare('INSERT INTO recurring_sync_state (item_id, history_complete, requested_generation, completed_generation, source_updated_at, lifecycle, scope_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('item-rbc', 1, 4, 3, '2026-10-12T12:00:00.000Z', 'active', 7),
  ]);
}

describe('Task 3 populated D1 migrations', () => {
  it('requires every transaction currency to be approved for its account, including single-mode accounts', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task3MigrationNames);

    await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('single-account', 'Synthetic single currency account', 'RBC', 'CAD', 'chequing', 'connected').run();
    await expect(fixture.db.prepare('SELECT currency FROM account_currencies WHERE account_id = ?').bind('single-account').all())
      .resolves.toMatchObject({ results: [{ currency: 'CAD' }] });
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'single-approved', 'single-account', '2026-10-13', 'Synthetic approved', -100, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'single-approved',
    ).run();
    await expect(fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'single-rejected', 'single-account', '2026-10-13', 'Synthetic rejected', -100, 'USD', 'Other', 'expense', 'confirmed', 'manual', 'single-rejected',
    ).run()).rejects.toThrow(/currency|foreign key|approved/i);

    await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('multi-account', 'Synthetic multi currency account', 'BOC', 'CNY', 'multi', 'credit', 'connected').run();
    await fixture.db.prepare('INSERT INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('multi-account', 'USD').run();
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'multi-approved', 'multi-account', '2026-10-13', 'Synthetic USD', -100, 'USD', 'Other', 'expense', 'confirmed', 'manual', 'multi-approved',
    ).run();
    await expect(fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'multi-rejected', 'multi-account', '2026-10-13', 'Synthetic HKD', -100, 'HKD', 'Other', 'expense', 'confirmed', 'manual', 'multi-rejected',
    ).run()).rejects.toThrow(/currency|foreign key|approved/i);
  });

  it('adds the currency, identity, alert, device, session, import, preference, and annotation tables', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task3MigrationNames);

    const objects = await fixture.db.prepare(`SELECT name FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger')
        AND name IN (
          'ledgers', 'currencies', 'account_currencies', 'transaction_source_records',
          'source_profiles', 'source_profile_hints', 'source_account_mappings',
          'mobile_devices', 'device_pairings', 'capture_credentials', 'device_source_scopes',
          'alert_events', 'alert_event_digests', 'alert_event_links', 'alert_projections',
          'alert_projection_provenance', 'annotation_revisions', 'mobile_auth_requests',
          'owner_session_families', 'owner_refresh_generations', 'owner_replay_records',
          'import_previews', 'import_chunks', 'ledger_preferences'
        )
      ORDER BY name`).all<{ name: string }>();

    expect(objects.results.map((row) => row.name)).toEqual([
      'account_currencies',
      'alert_event_digests',
      'alert_event_links',
      'alert_events',
      'alert_projection_provenance',
      'alert_projections',
      'annotation_revisions',
      'capture_credentials',
      'currencies',
      'device_pairings',
      'device_source_scopes',
      'import_chunks',
      'import_previews',
      'ledger_preferences',
      'ledgers',
      'mobile_auth_requests',
      'mobile_devices',
      'owner_refresh_generations',
      'owner_replay_records',
      'owner_session_families',
      'source_account_mappings',
      'source_profile_hints',
      'source_profiles',
      'transaction_source_records',
    ]);
  });

  it('preserves populated IDs, provider lineage, recurring relationships and classifications', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await seedPopulatedLegacyCopy(fixture.db);
    await applyMigrations(fixture.db, task3MigrationNames);

    const before = await fixture.db.prepare(`SELECT
      (SELECT COUNT(*) FROM accounts) AS accounts,
      (SELECT COUNT(*) FROM transactions) AS transactions,
      (SELECT COUNT(*) FROM recurring_streams) AS streams,
      (SELECT COUNT(*) FROM recurring_stream_transactions) AS memberships,
      (SELECT COUNT(*) FROM recurring_classifications) AS classifications`).all<Record<string, number>>();
    expect(before.results[0]).toEqual({ accounts: 2, transactions: 2, streams: 1, memberships: 1, classifications: 1 });

    const after = await fixture.db.prepare(`SELECT
      (SELECT COUNT(*) FROM accounts) AS accounts,
      (SELECT COUNT(*) FROM transactions) AS transactions,
      (SELECT COUNT(*) FROM recurring_streams) AS streams,
      (SELECT COUNT(*) FROM recurring_stream_transactions) AS memberships,
      (SELECT COUNT(*) FROM recurring_classifications) AS classifications`).all<Record<string, number>>();
    expect(after.results[0]).toEqual(before.results[0]);

    await fixture.db.prepare('INSERT INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('card-boc', 'USD').run();
    await fixture.db.prepare('INSERT INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('card-boc', 'HKD').run();
    await expect(fixture.db.prepare('SELECT currency_mode, currency FROM accounts WHERE id = ?').bind('card-boc').all()).resolves.toMatchObject({ results: [{ currency_mode: 'single', currency: 'CNY' }] });
    await expect(fixture.db.prepare('SELECT currency FROM account_currencies WHERE account_id = ? ORDER BY currency').bind('card-boc').all()).resolves.toMatchObject({ results: [{ currency: 'CNY' }, { currency: 'HKD' }, { currency: 'USD' }] });

    const provider = await fixture.db.prepare(`SELECT id, amount_minor, provider_transaction_id, provider_pending_transaction_id
      FROM transactions WHERE id = ?`).bind('tx-provider').all();
    expect(provider.results).toEqual([{ id: 'tx-provider', amount_minor: -1234, provider_transaction_id: 'provider-1', provider_pending_transaction_id: 'pending-1' }]);

    const legacy = await fixture.db.prepare('SELECT id, amount_minor, note FROM transactions WHERE id = ?').bind('tx-legacy').all();
    expect(legacy.results).toEqual([{ id: 'tx-legacy', amount_minor: -2000, note: 'Legacy annotation remains' }]);
  });
});

describe('post-capture currency and recurring migrations', () => {
  it('seeds the complete registry and rebuilds recurring tables without changing provider identity', async () => {
    const fixture = await createD1Fixture(task15MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('migration-account', 'Migration account', 'Synthetic bank', 'USD', 'chequing', 'connected'),
      fixture.db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
        .bind('migration-item', 'ciphertext', 'iv', 'Synthetic bank'),
      fixture.db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)')
        .bind('migration-plaid-account', 'migration-item', 'migration-account', 'Migration account'),
      fixture.db.prepare(`INSERT INTO recurring_streams
        (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow, average_amount_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('migration-stream', 'migration-item', 'provider-stream', 'migration-account', 'Provider service', 'USD', 'MATURE', 'MONTHLY', 'MONTHLY', 1, -500),
      fixture.db.prepare(`INSERT INTO recurring_stream_transactions
        (recurring_stream_id, item_id, provider_transaction_id, account_id, date, amount_minor, currency, kind, is_outflow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('migration-stream', 'migration-item', 'provider-transaction', 'migration-account', '2026-10-01', -500, 'USD', 'expense', 1),
      fixture.db.prepare('INSERT INTO recurring_classifications (recurring_stream_id, classification, revision) VALUES (?, ?, ?)')
        .bind('migration-stream', 'subscription', 4),
    ]);

    await applyMigrations(fixture.db, task16MigrationNames);

    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM currencies').all<{ count: number }>())
      .resolves.toMatchObject({ results: [{ count: 162 }] });
    await expect(fixture.db.prepare('SELECT id, item_id, stream_id, currency FROM recurring_streams WHERE id = ?').bind('migration-stream').all())
      .resolves.toMatchObject({ results: [{ id: 'migration-stream', item_id: 'migration-item', stream_id: 'provider-stream', currency: 'USD' }] });
    await expect(fixture.db.prepare('SELECT recurring_stream_id, provider_transaction_id, item_id, currency FROM recurring_stream_transactions WHERE recurring_stream_id = ?').bind('migration-stream').all())
      .resolves.toMatchObject({ results: [{ recurring_stream_id: 'migration-stream', provider_transaction_id: 'provider-transaction', item_id: 'migration-item', currency: 'USD' }] });
    await expect(fixture.db.prepare('SELECT classification, revision FROM recurring_classifications WHERE recurring_stream_id = ?').bind('migration-stream').all())
      .resolves.toMatchObject({ results: [{ classification: 'subscription', revision: 4 }] });

    const streamDefinition = await fixture.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recurring_streams'").first<{ sql: string }>();
    expect(streamDefinition?.sql).toContain('currency TEXT NOT NULL REFERENCES currencies(code)');
    expect(streamDefinition?.sql).not.toMatch(/currency\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*currency\s+IN/i);
  });
});

describe('Task 8 receipt ownership migration', () => {
  it('adds nullable device ownership to alert events and an ownership lookup index', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task4MigrationNames);

    const columns = await fixture.db.prepare('PRAGMA table_info(alert_events)').all<{ name: string; notnull: number }>();
    expect(columns.results.find((column) => column.name === 'device_id')).toMatchObject({ name: 'device_id', notnull: 0 });
    const indexes = await fixture.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'alert_events_device_idx'").all<{ name: string }>();
    expect(indexes.results).toEqual([{ name: 'alert_events_device_idx' }]);
  });
});
