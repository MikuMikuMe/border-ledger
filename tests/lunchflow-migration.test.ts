import { describe, expect, it } from 'vitest';
import { serializeTransactionsCsv } from '../src/domain/export';
import type { Account, Transaction } from '../src/domain/types';
import { applyMigrations, createD1Fixture, task19MigrationNames } from './helpers/d1';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

const MIGRATION = '0020-lunchflow.sql';
const dependencyCountSql = `SELECT
  (SELECT COUNT(*) FROM transactions) AS transactions,
  (SELECT COUNT(*) FROM transaction_source_records) AS source_records,
  (SELECT COUNT(*) FROM recurring_stream_transactions) AS recurring_memberships,
  (SELECT COUNT(*) FROM statement_reconciliation_candidates) AS reconciliation_candidates,
  (SELECT COUNT(*) FROM alert_projections) AS projections,
  (SELECT COUNT(*) FROM alert_projection_provenance) AS provenance,
  (SELECT COUNT(*) FROM alert_event_links) AS event_links,
  (SELECT COUNT(*) FROM annotation_revisions) AS annotations`;
const dependencySnapshotTables = [
  ['transactions', 'id'],
  ['recurring_stream_transactions', 'recurring_stream_id, provider_transaction_id'],
  ['statement_reconciliation_candidates', 'id'],
  ['alert_projections', 'id'],
  ['alert_projection_provenance', 'id'],
  ['alert_event_links', 'id'],
  ['annotation_revisions', 'id'],
] as const;
const sourceRecordSnapshotSql = `SELECT id, ledger_id, source_kind, identity_key, transaction_id, account_id,
  provider_item_id, NULL AS provider_account_id, provider_transaction_id, provider_pending_transaction_id,
  bank_source_id, bank_row_id, file_sha256, row_index, event_id, manual_id, bank_reference, content_digest,
  created_at
  FROM transaction_source_records ORDER BY id`;

type MigrationDb = Awaited<ReturnType<typeof createD1Fixture>>['db'];
type DependencySnapshot = Record<string, Array<Record<string, unknown>>>;

async function seedDependencyGraph(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('account-rbc', 'Synthetic RBC chequing', 'Synthetic RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
      .bind('item-rbc', 'ciphertext-fixture', 'iv-fixture', 'Synthetic RBC'),
    db.prepare('INSERT INTO plaid_accounts (plaid_account_id, item_id, account_id, name) VALUES (?, ?, ?, ?)')
      .bind('plaid-account-rbc', 'item-rbc', 'account-rbc', 'Synthetic RBC chequing'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint,
       plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-plaid', 'account-rbc', '2026-10-21', 'Synthetic provider purchase', -1234, 'CAD', 'Food', 'expense', 'confirmed', 'plaid', 'fp-plaid', 'item-rbc', 'provider-tx-1', 'provider-pending-1'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-statement', 'account-rbc', '2026-10-20', 'Synthetic statement purchase', -500, 'CAD', 'Food', 'expense', 'confirmed', 'statement', 'fp-statement'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-alert', 'account-rbc', '2026-10-19', 'Synthetic alert purchase', -300, 'CAD', 'Food', 'expense', 'provisional', 'alert', 'fp-alert'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('tx-manual', 'account-rbc', '2026-10-18', 'Synthetic manual purchase', -200, 'CAD', 'Food', 'expense', 'confirmed', 'manual', 'fp-manual'),
    db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, provider_item_id, provider_transaction_id,
       provider_pending_transaction_id, bank_source_id, bank_row_id, event_id, manual_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('record-plaid', 'plaid', 'plaid:item-rbc:provider-tx-1', 'tx-plaid', 'account-rbc', 'item-rbc', 'provider-tx-1', 'provider-pending-1', null, null, null, null, 'digest-plaid'),
    db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, bank_source_id, bank_row_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('record-statement', 'statement', 'statement:synthetic:row-1', 'tx-statement', 'account-rbc', 'synthetic-bank', 'row-1', 'digest-statement'),
    db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, event_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('record-alert', 'alert', 'alert:event-1', 'tx-alert', 'account-rbc', 'event-1', 'digest-alert'),
    db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, manual_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('record-manual', 'manual', 'manual:1', 'tx-manual', 'account-rbc', 'manual-1', 'digest-manual'),
    db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('record-legacy', 'legacy', 'legacy:1', 'tx-manual', 'account-rbc', 'digest-legacy'),
    db.prepare(`INSERT INTO statement_reconciliation_candidates
      (id, source_record_id, statement_transaction_id, candidate_transaction_id, score, evidence_basis)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('candidate-1', 'record-statement', 'tx-statement', 'tx-plaid', 75, 'candidate_rank'),
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('stream-1', 'item-rbc', 'provider-stream-1', 'account-rbc', 'Synthetic recurring', 'CAD', 'MATURE', 'MONTHLY', 'monthly', 1),
    db.prepare(`INSERT INTO recurring_stream_transactions
      (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('stream-1', 'item-rbc', 'provider-tx-1', 'tx-plaid', 'account-rbc', '2026-10-21', -1234, 'CAD', 'expense', 1),
    db.prepare('INSERT INTO recurring_classifications (recurring_stream_id, classification, revision) VALUES (?, ?, ?)')
      .bind('stream-1', 'subscription', 2),
    db.prepare('INSERT INTO recurring_sync_state (item_id, history_complete, requested_generation, completed_generation, lifecycle) VALUES (?, ?, ?, ?, ?)')
      .bind('item-rbc', 1, 3, 3, 'active'),
    db.prepare(`INSERT INTO source_profiles (id, provider, source_kind, display_name, parser_version, status)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('source-profile-alert', 'synthetic', 'alert', 'Synthetic alert', 'test', 'approved'),
    db.prepare(`INSERT INTO alert_events
      (id, event_id, observation_id, source_profile_id, parser_version, captured_at, event_time_basis,
       event_type, direction, account_id, event_money_currency, event_money_amount_minor, primary_money_role,
       payload_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('event-1', 'event-1', 'observation-1', 'source-profile-alert', 'test', '2026-10-19T10:00:00Z', 'bank_transaction_date', 'purchase_notice', 'outflow', 'account-rbc', 'CAD', -300, 'transaction', 'payload-digest'),
    db.prepare(`INSERT INTO alert_projections
      (id, event_id, transaction_id, state, counted_currency, counted_amount_minor)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('projection-1', 'event-1', 'tx-alert', 'provisional', 'CAD', -300),
    db.prepare(`INSERT INTO alert_projection_provenance
      (id, projection_id, source_kind, source_id, basis, revision)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('projection-provenance-1', 'projection-1', 'alert', 'event-1', 'alert_event', 1),
    db.prepare(`INSERT INTO alert_event_links
      (id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('event-link-1', 'event-1', 'tx-plaid', 'confirms', 'bank_reference', 1),
    db.prepare(`INSERT INTO annotation_revisions
      (id, transaction_id, author_subject_hash, revision, category, note)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('annotation-1', 'tx-manual', 'owner-hash', 1, 'Food', 'Preserve this annotation'),
  ]);
}

async function dependencyCounts(db: MigrationDb) {
  const result = await db.prepare(dependencyCountSql).all<Record<string, number>>();
  return result.results[0];
}

async function dependencySnapshot(db: MigrationDb, includeNewColumns = false): Promise<DependencySnapshot> {
  const snapshot: DependencySnapshot = {};
  const sourceRecords = await db.prepare(includeNewColumns
    ? 'SELECT * FROM transaction_source_records ORDER BY id'
    : sourceRecordSnapshotSql).all<Record<string, unknown>>();
  snapshot.transaction_source_records = sourceRecords.results;
  for (const [table, orderBy] of dependencySnapshotTables) {
    const result = await db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all<Record<string, unknown>>();
    snapshot[table] = result.results;
  }
  return snapshot;
}

async function assertPreservedGraph(
  db: MigrationDb,
  beforeCounts: Record<string, number>,
  beforeSnapshot: DependencySnapshot,
) {
  expect(await dependencyCounts(db)).toEqual(beforeCounts);
  expect(await dependencySnapshot(db, true)).toEqual(beforeSnapshot);
  await expect(db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
  const temporaryObjects = await db.prepare(`SELECT type, name FROM sqlite_master
    WHERE name LIKE '%_lunchflow_v20%' OR COALESCE(sql, '') LIKE '%_lunchflow_v20%'`).all();
  expect(temporaryObjects.results).toEqual([]);

  const indexes = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (
    'transactions_date_idx', 'transactions_currency_idx', 'transactions_status_idx', 'transactions_fingerprint_candidate_idx',
    'transactions_plaid_item_current_id_idx', 'transactions_plaid_pending_id_idx', 'transaction_source_records_transaction_idx',
    'transaction_source_records_provider_idx', 'transaction_source_records_account_idx', 'transaction_source_records_lunchflow_idx',
    'recurring_stream_transactions_provider_idx', 'recurring_stream_transactions_date_idx',
    'statement_reconciliation_candidates_statement_idx', 'statement_reconciliation_candidates_candidate_idx',
    'alert_projections_state_idx', 'alert_event_links_target_event_idx', 'alert_event_links_target_transaction_idx',
    'alert_event_links_confirms_target_idx', 'alert_event_links_confirms_source_idx',
    'lunchflow_accounts_ledger_idx', 'lunchflow_operations_owner_idx'
  ) ORDER BY name`).all<{ name: string }>();
  expect(indexes.results.map((row) => row.name)).toEqual(expect.arrayContaining([
    'transactions_date_idx', 'transactions_currency_idx', 'transactions_status_idx', 'transactions_fingerprint_candidate_idx',
    'transactions_plaid_item_current_id_idx', 'transactions_plaid_pending_id_idx', 'transaction_source_records_transaction_idx',
    'transaction_source_records_provider_idx', 'transaction_source_records_account_idx', 'transaction_source_records_lunchflow_idx',
    'recurring_stream_transactions_provider_idx', 'recurring_stream_transactions_date_idx',
    'statement_reconciliation_candidates_statement_idx', 'statement_reconciliation_candidates_candidate_idx',
    'alert_projections_state_idx', 'alert_event_links_target_event_idx', 'alert_event_links_target_transaction_idx',
    'alert_event_links_confirms_target_idx', 'alert_event_links_confirms_source_idx',
    'lunchflow_accounts_ledger_idx', 'lunchflow_operations_owner_idx',
  ]));
  await expect(db.prepare('SELECT provider_transaction_id, provider_pending_transaction_id FROM transactions WHERE id = ?').bind('tx-plaid').all())
    .resolves.toMatchObject({ results: [{ provider_transaction_id: 'provider-tx-1', provider_pending_transaction_id: 'provider-pending-1' }] });
  await expect(db.prepare('SELECT classification, revision FROM recurring_classifications WHERE recurring_stream_id = ?').bind('stream-1').all())
    .resolves.toMatchObject({ results: [{ classification: 'subscription', revision: 2 }] });
  await expect(db.prepare('UPDATE transactions SET fx_lock_date = ? WHERE id = ?')
    .bind('2026-10-20', 'tx-plaid').run()).rejects.toThrow(/immutable/i);
  await expect(db.prepare('UPDATE annotation_revisions SET note = ? WHERE id = ?')
    .bind('must remain immutable', 'annotation-1').run()).rejects.toThrow(/immutable/i);
  await expect(db.prepare('DELETE FROM alert_event_links WHERE id = ?')
    .bind('event-link-1').run()).rejects.toThrow(/immutable/i);
}

async function assertLunchFlowWrites(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.prepare(`INSERT INTO lunchflow_accounts
    (provider_account_id, account_id, name, institution, currency, kind)
    VALUES (?, ?, ?, ?, ?, ?)`).bind('provider-account-1', 'account-rbc', 'Synthetic chequing', 'Synthetic RBC', 'CAD', 'chequing').run();
  await db.prepare(`INSERT INTO lunchflow_operations
    (id, owner_subject_hash, operation_kind, idempotency_key, response_json)
    VALUES (?, ?, ?, ?, ?)`).bind('operation-1', 'owner-hash', 'sync', 'replay-key-1', '{"queued":true}').run();
  await db.prepare(`INSERT INTO transactions
    (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    'tx-lunchflow', 'account-rbc', '2026-10-22', 'Synthetic Lunch Flow purchase', -750, 'CAD', 'Food', 'expense', 'confirmed', 'lunchflow', 'fp-lunchflow',
  ).run();
  await db.prepare(`INSERT INTO transaction_source_records
    (id, source_kind, identity_key, transaction_id, account_id, provider_account_id, provider_transaction_id, content_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    'record-lunchflow', 'lunchflow', 'lunchflow:provider-account-1:provider-transaction-1', 'tx-lunchflow', 'account-rbc', 'provider-account-1', 'provider-transaction-1', 'digest-lunchflow',
  ).run();
  await expect(db.prepare('SELECT source, source_kind, provider_account_id, provider_item_id FROM transactions JOIN transaction_source_records ON transaction_source_records.transaction_id = transactions.id WHERE transactions.id = ?').bind('tx-lunchflow').all())
    .resolves.toMatchObject({ results: [{ source: 'lunchflow', source_kind: 'lunchflow', provider_account_id: 'provider-account-1', provider_item_id: null }] });
  await expect(db.prepare('INSERT INTO lunchflow_operations (id, owner_subject_hash, operation_kind, idempotency_key, response_json) VALUES (?, ?, ?, ?, ?)')
    .bind('operation-2', 'owner-hash', 'sync', 'replay-key-1', '{"queued":true}').run()).rejects.toThrow(/unique/i);
  await expect(db.prepare(`INSERT INTO transaction_source_records
    (id, source_kind, identity_key, transaction_id, account_id, provider_transaction_id, content_digest)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    'record-invalid-lunchflow', 'lunchflow', 'lunchflow:missing-account:provider-transaction-2', 'tx-lunchflow', 'account-rbc', 'provider-transaction-2', 'digest-invalid',
  ).run()).rejects.toThrow(/check|constraint/i);
  await expect(db.prepare(`INSERT INTO transactions
    (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    'tx-invalid-source', 'account-rbc', '2026-10-22', 'Synthetic invalid source', -1, 'CAD', 'Other', 'expense', 'confirmed', 'unsupported', 'fp-invalid',
  ).run()).rejects.toThrow(/check|constraint/i);
}

describe('Lunch Flow migration', () => {
  it('preserves the populated transaction dependency graph and accepts Lunch Flow provenance', async () => {
    const fixture = await createD1Fixture(task19MigrationNames);
    try {
      await seedDependencyGraph(fixture.db);
      const before = await dependencyCounts(fixture.db);
      const beforeSnapshot = await dependencySnapshot(fixture.db);
      expect(before).toEqual({ transactions: 4, source_records: 5, recurring_memberships: 1, reconciliation_candidates: 1, projections: 1, provenance: 1, event_links: 1, annotations: 1 });
      await applyMigrations(fixture.db, [MIGRATION]);
      await assertPreservedGraph(fixture.db, before, beforeSnapshot);
      await assertLunchFlowWrites(fixture.db);
      await fixture.db.prepare('DELETE FROM transactions WHERE id = ?').bind('tx-statement').run();
      await expect(fixture.db.prepare('SELECT id FROM transaction_source_records WHERE id = ?').bind('record-statement').all()).resolves.toMatchObject({ results: [] });
      await expect(fixture.db.prepare('SELECT id FROM statement_reconciliation_candidates WHERE id = ?').bind('candidate-1').all()).resolves.toMatchObject({ results: [] });
      await expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
    } finally {
      await fixture.dispose();
    }
  });

  it('keeps the canonical schema aligned with the migration and labels Lunch Flow exports', async () => {
    const accountMetadata: Account = {
      id: 'schema-account', name: 'Synthetic account', institution: 'Synthetic bank', currency: 'CAD',
      kind: 'chequing', status: 'connected', lastSyncedAt: null, provider: 'lunchflow',
    };
    expect(accountMetadata.provider).toBe('lunchflow');
    const transaction: Transaction = {
      id: 'export-lunchflow', accountId: 'account-rbc', date: '2026-10-22', merchant: 'Synthetic merchant',
      amountMinor: -100, currency: 'CAD', category: 'Food', kind: 'expense', status: 'confirmed', source: 'lunchflow', fingerprint: 'export-lunchflow',
    };
    expect(serializeTransactionsCsv([transaction])).toContain('Lunch Flow');

    const fixture = createSqliteD1Fixture();
    try {
      await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('schema-account', 'Synthetic account', 'Synthetic bank', 'CAD', 'chequing', 'connected').run();
      const lunchflowAccountColumns = await fixture.db.prepare('PRAGMA table_info(lunchflow_accounts)').all<{ name: string }>();
      expect(lunchflowAccountColumns.results.map((column) => column.name)).toEqual([
        'provider_account_id', 'account_id', 'ledger_id', 'name', 'institution', 'currency', 'kind', 'enabled',
        'revision', 'last_synced_at', 'last_error', 'created_at', 'updated_at',
      ]);
      const lunchflowOperationColumns = await fixture.db.prepare('PRAGMA table_info(lunchflow_operations)').all<{ name: string }>();
      expect(lunchflowOperationColumns.results.map((column) => column.name)).toEqual([
        'id', 'ledger_id', 'owner_subject_hash', 'operation_kind', 'idempotency_key', 'response_json', 'created_at',
      ]);
      const sourceRecordColumns = await fixture.db.prepare('PRAGMA table_info(transaction_source_records)').all<{ name: string }>();
      expect(sourceRecordColumns.results.map((column) => column.name)).toContain('provider_account_id');
      await fixture.db.prepare(`INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        'schema-lunchflow', 'schema-account', '2026-10-22', 'Synthetic merchant', -100, 'CAD', 'Food', 'expense', 'confirmed', 'lunchflow', 'schema-lunchflow',
      ).run();
      await expect(fixture.db.prepare('SELECT source FROM transactions WHERE id = ?').bind('schema-lunchflow').all())
        .resolves.toMatchObject({ results: [{ source: 'lunchflow' }] });
    } finally {
      fixture.close();
    }
  });
});
