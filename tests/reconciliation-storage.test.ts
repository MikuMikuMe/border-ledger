import { afterEach, describe, expect, it } from 'vitest';
import { applyAlertReview, commitStatementRows, type StatementCommitRow } from '../worker/reconciliation-store';
import { applyMigrations, createD1Fixture, task10MigrationNames, task10PreUniquenessMigrationNames, task18MigrationNames } from './helpers/d1';
import { createAlertFixture, event, postAlerts } from './helpers/alerts';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const task10PreUniquenessWithFx = [...task10PreUniquenessMigrationNames, '0018-fx-snapshots.sql'] as const;

async function seededFixture(migrationNames: readonly string[] = task18MigrationNames) {
  const fixture = await createD1Fixture(migrationNames);
  fixtures.push(fixture);
  await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
    VALUES ('statement-account', 'Synthetic BOC card', 'Bank of China', 'CNY', 'multi', 'credit', 'import_only')`).run();
  await fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('statement-account', 'USD')`).run();
  return fixture;
}

function row(overrides: Partial<StatementCommitRow> = {}): StatementCommitRow {
  return {
    id: 'row-1',
    accountId: 'statement-account',
    date: '2026-10-13',
    merchant: 'Harbour Market',
    amountMinor: -4200,
    currency: 'CNY',
    category: 'Groceries',
    kind: 'expense',
    status: 'confirmed',
    source: 'statement',
    fingerprint: 'candidate-not-identity',
    sourceIdentity: { accountId: 'statement-account', fileSha256: 'a'.repeat(64), rowIndex: 0 },
    ...overrides,
  };
}

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

describe('durable statement reconciliation', () => {
  it('installs unique confirmation indexes at 0008 and upgrades an existing database safely', async () => {
    const fixture = await createD1Fixture(task10MigrationNames.slice(0, -1));
    fixtures.push(fixture);
    const beforeUpgrade = await fixture.db.prepare(`SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND name IN ('alert_event_links_confirms_target_idx', 'alert_event_links_confirms_source_idx')
      ORDER BY name`).all<{ name: string; sql: string }>();
    expect(beforeUpgrade.results).toHaveLength(2);
    expect(beforeUpgrade.results.every((index) => index.sql.toUpperCase().includes('CREATE UNIQUE INDEX'))).toBe(true);

    await applyMigrations(fixture.db, task10MigrationNames);
    const afterUpgrade = await fixture.db.prepare(`SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND name IN ('alert_event_links_confirms_target_idx', 'alert_event_links_confirms_source_idx')
      ORDER BY name`).all<{ name: string; sql: string }>();
    expect(afterUpgrade.results.map((index) => index.name)).toEqual(beforeUpgrade.results.map((index) => index.name));
    await expect(fixture.db.prepare(`SELECT name FROM __migrations WHERE name = '0009-statement-reconciliation-target-uniqueness.sql'`).all()).resolves.toMatchObject({ results: [{ name: '0009-statement-reconciliation-target-uniqueness.sql' }] });
  }, 15_000);

  it('archives duplicate confirmation evidence before installing the 0009 unique indexes', async () => {
    const fixture = await createAlertFixture({ migrationNames: task10PreUniquenessWithFx, historicalSchema: true });
    await applyMigrations(fixture.db, task10PreUniquenessMigrationNames);
    await seedHistoricalAlertInputs(fixture.db);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('migration-target-1', 'account-boc', '2026-10-13', 'Synthetic merchant', -1234, 'CAD', 'Groceries', 'expense', 'confirmed', 'statement', 'migration-target-1')`),
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('migration-target-2', 'account-boc', '2026-10-13', 'Synthetic merchant', -1234, 'CAD', 'Groceries', 'expense', 'confirmed', 'statement', 'migration-target-2')`),
    ]);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO transaction_source_records
        (id, ledger_id, source_kind, identity_key, transaction_id, account_id, file_sha256, row_index, content_digest)
        VALUES ('migration-source-1', 'personal', 'statement', 'statement:migration-source-1', 'migration-target-1', 'account-boc', ?, 0, 'digest-1')`).bind('a'.repeat(64)),
      fixture.db.prepare(`INSERT INTO transaction_source_records
        (id, ledger_id, source_kind, identity_key, transaction_id, account_id, file_sha256, row_index, content_digest)
        VALUES ('migration-source-2', 'personal', 'statement', 'statement:migration-source-2', 'migration-target-2', 'account-boc', ?, 0, 'digest-2')`).bind('b'.repeat(64)),
    ]);
    await fixture.db.batch([
      fixture.db.prepare('DROP INDEX alert_event_links_confirms_target_idx'),
      fixture.db.prepare('DROP INDEX alert_event_links_confirms_source_idx'),
    ]);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO alert_event_links
        (id, ledger_id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
        VALUES ('migration-link-a', 'personal', '00000000-0000-4000-8000-000000000041', 'migration-target-1', 'confirms', 'user_review', 2)`),
      fixture.db.prepare(`INSERT INTO alert_event_links
        (id, ledger_id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
        VALUES ('migration-link-b', 'personal', '00000000-0000-4000-8000-000000000042', 'migration-target-1', 'confirms', 'user_review', 2)`),
      fixture.db.prepare(`INSERT INTO alert_event_links
        (id, ledger_id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
        VALUES ('migration-link-c', 'personal', '00000000-0000-4000-8000-000000000042', 'migration-target-2', 'confirms', 'user_review', 3)`),
    ]);

    await applyMigrations(fixture.db, task10MigrationNames);
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM alert_event_links_immutable_evidence`).all()).resolves.toMatchObject({ results: [{ count: 3 }] });
    await expect(fixture.db.prepare(`SELECT original_link_id, conflict_reason FROM alert_event_link_conflicts`).all()).resolves.toMatchObject({ results: [{ original_link_id: 'migration-link-b', conflict_reason: 'target_and_source' }] });
    await expect(fixture.db.prepare(`SELECT id, relation FROM alert_event_links ORDER BY id`).all()).resolves.toMatchObject({ results: [
      { id: 'migration-link-a', relation: 'confirms' },
      { id: 'migration-link-b', relation: 'possible_duplicate' },
      { id: 'migration-link-c', relation: 'confirms' },
    ] });
    await expect(fixture.db.prepare(`SELECT state, counted_currency, counted_amount_minor FROM alert_projections WHERE event_id = '00000000-0000-4000-8000-000000000042'`).all()).resolves.toMatchObject({ results: [{ state: 'needs_review', counted_currency: null, counted_amount_minor: null }] });
    await expect(fixture.db.prepare(`SELECT status FROM transactions WHERE id = '00000000-0000-4000-8000-000000000042'`).all()).resolves.toMatchObject({ results: [{ status: 'needs_review' }] });
    await expect(fixture.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('alert_event_links_confirms_target_idx', 'alert_event_links_confirms_source_idx') ORDER BY name`).all()).resolves.toMatchObject({ results: [{ name: 'alert_event_links_confirms_source_idx' }, { name: 'alert_event_links_confirms_target_idx' }] });
    await expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
  });

  it('keeps two equal rows as two source identities and replays the same file/rows idempotently', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    const first = await commitStatementRows(fixture.db, {
      importId: 'import-equal-1',
      accountId: 'statement-account',
      filename: 'statement.csv',
      fileSha256: 'a'.repeat(64),
      rows: [row({ id: 'row-a', sourceIdentity: { accountId: 'statement-account', fileSha256: 'a'.repeat(64), rowIndex: 0 } }), row({ id: 'row-b', sourceIdentity: { accountId: 'statement-account', fileSha256: 'a'.repeat(64), rowIndex: 1 } })],
    });
    expect(first.accepted).toBe(2);
    expect(first.needsReview).toBe(0);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE source = \'statement\'').all()).resolves.toMatchObject({ results: [{ count: 2 }] });

    const replay = await commitStatementRows(fixture.db, {
      importId: 'import-equal-replay',
      accountId: 'statement-account',
      filename: 'statement.csv',
      fileSha256: 'a'.repeat(64),
      rows: [row({ id: 'different-client-id', sourceIdentity: { accountId: 'statement-account', fileSha256: 'a'.repeat(64), rowIndex: 0 } }), row({ id: 'different-client-id-2', sourceIdentity: { accountId: 'statement-account', fileSha256: 'a'.repeat(64), rowIndex: 1 } })],
    });
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(2);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_source_records WHERE source_kind = \'statement\'').all()).resolves.toMatchObject({ results: [{ count: 2 }] });
  });

  it('locks statement rows on their accounting date and preserves the lock on replay', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    await fixture.db.prepare('DROP TRIGGER transactions_fx_lock_date_default').run();
    const input = {
      importId: 'import-lock-date',
      accountId: 'statement-account',
      filename: 'statement.csv',
      fileSha256: '6'.repeat(64),
      rows: [row({
        id: 'statement-lock-row',
        date: '2026-10-08',
        sourceIdentity: { accountId: 'statement-account', fileSha256: '6'.repeat(64), rowIndex: 0 },
      })],
    };

    await expect(commitStatementRows(fixture.db, input)).resolves.toMatchObject({ accepted: 1, duplicates: 0 });
    await expect(commitStatementRows(fixture.db, { ...input, importId: 'import-lock-date-replay' }))
      .resolves.toMatchObject({ accepted: 0, duplicates: 1 });

    await expect(fixture.db.prepare(`SELECT date, fx_lock_date, COUNT(*) AS count
      FROM transactions WHERE id = 'statement-lock-row'`).all()).resolves.toMatchObject({
      results: [{ date: '2026-10-08', fx_lock_date: '2026-10-08', count: 1 }],
    });
  });

  it('rejects changed content for an existing statement source identity instead of replaying it', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    const identity = { accountId: 'statement-account', fileSha256: 'f'.repeat(64), rowIndex: 0 };
    await commitStatementRows(fixture.db, {
      importId: 'import-source-conflict',
      accountId: 'statement-account',
      filename: 'statement.csv',
      fileSha256: 'f'.repeat(64),
      rows: [row({ id: 'original-row', sourceIdentity: identity })],
    });

    await expect(commitStatementRows(fixture.db, {
      importId: 'import-source-conflict-retry',
      accountId: 'statement-account',
      filename: 'statement.csv',
      fileSha256: 'f'.repeat(64),
      rows: [row({ id: 'different-row', merchant: 'Changed merchant', sourceIdentity: identity })],
    })).rejects.toMatchObject({ code: 'source_identity_conflict' });
    await expect(fixture.db.prepare('SELECT merchant, COUNT(*) AS count FROM transactions WHERE source = \'statement\' GROUP BY merchant').all()).resolves.toMatchObject({
      results: [{ merchant: 'Harbour Market', count: 1 }],
    });
  });

  it('does not treat another statement export as an alert reconciliation candidate', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    await commitStatementRows(fixture.db, {
      importId: 'import-overlap-base',
      accountId: 'statement-account',
      filename: 'first.csv',
      fileSha256: 'b'.repeat(64),
      rows: [row({ id: 'base-row', sourceIdentity: { accountId: 'statement-account', fileSha256: 'b'.repeat(64), rowIndex: 0 } })],
    });
    const overlapping = await commitStatementRows(fixture.db, {
      importId: 'import-overlap-new',
      accountId: 'statement-account',
      filename: 'overlap.csv',
      fileSha256: 'c'.repeat(64),
      rows: [row({ id: 'overlap-row', sourceIdentity: { accountId: 'statement-account', fileSha256: 'c'.repeat(64), rowIndex: 0 } })],
    });
    expect(overlapping.accepted).toBe(1);
    expect(overlapping.needsReview).toBe(0);
    expect(overlapping.candidateCount).toBe(0);
    await expect(fixture.db.prepare('SELECT status FROM transactions WHERE id = \'overlap-row\'').all()).resolves.toMatchObject({ results: [{ status: 'confirmed' }] });
  });

  it('does not publish any row when a later row violates account currency scope', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    await expect(commitStatementRows(fixture.db, {
      importId: 'import-atomic-failure',
      accountId: 'statement-account',
      filename: 'bad.csv',
      fileSha256: 'd'.repeat(64),
      rows: [row({ id: 'good-row', sourceIdentity: { accountId: 'statement-account', fileSha256: 'd'.repeat(64), rowIndex: 0 } }), row({ id: 'bad-row', currency: 'CAD', sourceIdentity: { accountId: 'statement-account', fileSha256: 'd'.repeat(64), rowIndex: 1 } })],
    })).rejects.toThrow(/approved/);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('supersedes an alert projection only through an audited confirmed statement link', async () => {
    const fixture = await seededFixture(task18MigrationNames);
    await fixture.db.prepare(`INSERT INTO source_profiles (id, provider, source_kind, display_name, parser_version, status)
      VALUES ('boc-profile', 'boc', 'credit_alert', 'Synthetic BOC', 'test', 'approved')`).run();
    await fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES ('alert-tx', 'statement-account', '2026-10-13', 'Harbour Market', -4200, 'CNY', 'Uncategorized', 'expense', 'provisional', 'alert', 'alert:alert-1')`).run();
    await fixture.db.prepare(`INSERT INTO alert_events
      (id, event_id, observation_id, source_profile_id, parser_version, captured_at, event_time_basis, event_type, direction, account_id, event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, completeness_json, payload_digest)
      VALUES ('alert-1', 'alert-1', 'obs-1', 'boc-profile', 'test', '2026-10-13T00:00:00.000Z', 'notification_posted', 'purchase_notice', 'outflow', 'statement-account', 'CNY', 4200, 'transaction', '[]', 'unknown', '{}', 'digest')`).run();
    await fixture.db.prepare(`INSERT INTO alert_projections (id, event_id, transaction_id, state, reason_codes_json, counted_currency, counted_amount_minor, revision)
      VALUES ('projection-1', 'alert-1', 'alert-tx', 'provisional', '[]', 'CNY', 4200, 1)`).run();
    await fixture.db.prepare(`INSERT INTO annotation_revisions (id, transaction_id, author_subject_hash, revision, category, note)
      VALUES ('annotation-alert-1', 'alert-tx', 'reviewer', 1, 'Groceries', 'Keep this note')`).run();
    await commitStatementRows(fixture.db, {
      importId: 'import-confirm',
      accountId: 'statement-account',
      filename: 'confirm.csv',
      fileSha256: 'e'.repeat(64),
      rows: [row({ id: 'statement-tx', sourceIdentity: { accountId: 'statement-account', fileSha256: 'e'.repeat(64), rowIndex: 0 } })],
    });
    const result = await applyAlertReview(fixture.db, {
      id: 'review-link-1',
      alertEventId: 'alert-1',
      candidateTransactionId: 'alert-tx',
      statementTransactionId: 'statement-tx',
      relation: 'confirms',
      evidenceBasis: 'user_review',
      revision: 2,
    });
    expect(result.projectionSuperseded).toBe(true);
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE account_id = 'statement-account'`).all()).resolves.toMatchObject({ results: [{ count: 2 }] });
    await expect(fixture.db.prepare(`SELECT source, status FROM transactions WHERE account_id = 'statement-account' ORDER BY id`).all()).resolves.toMatchObject({ results: [{ source: 'alert', status: 'needs_review' }, { source: 'statement', status: 'confirmed' }] });
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM alert_events WHERE event_id = 'alert-1'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare('SELECT state, revision, counted_currency, counted_amount_minor FROM alert_projections WHERE id = \'projection-1\'').all()).resolves.toMatchObject({ results: [{ state: 'superseded', revision: 2, counted_currency: null, counted_amount_minor: null }] });
    await expect(fixture.db.prepare('SELECT status FROM transactions WHERE id = \'statement-tx\'').all()).resolves.toMatchObject({ results: [{ status: 'confirmed' }] });
    await expect(fixture.db.prepare('SELECT transaction_id, note FROM annotation_revisions WHERE id = \'annotation-alert-1\'').all()).resolves.toMatchObject({ results: [{ transaction_id: 'alert-tx', note: 'Keep this note' }] });
  });

  it('matches a statement committed before its alert by bank reference and records provenance', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await commitStatementRows(fixture.db, {
      importId: 'statement-before-alert',
      accountId: 'account-boc',
      filename: 'statement.csv',
      fileSha256: '1'.repeat(64),
      rows: [{
        id: 'statement-before-alert-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -1234,
        currency: 'CAD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'not-an-identity',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '1'.repeat(64), rowIndex: 0 },
        bankReference: 'bank-ref-1',
      }],
    });

    const response = await postAlerts(fixture.db, [event({ bankReference: 'bank-ref-1' })]);
    expect(await response.json()).toMatchObject({ acks: [{ status: 'accepted', projectionState: 'superseded' }] });
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE account_id = 'account-boc'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare(`SELECT source FROM transactions WHERE account_id = 'account-boc'`).all()).resolves.toMatchObject({ results: [{ source: 'statement' }] });
    await expect(fixture.db.prepare('SELECT state, transaction_id FROM alert_projections WHERE event_id = ?').bind('00000000-0000-4000-8000-000000000001').all()).resolves.toMatchObject({
      results: [{ state: 'superseded', transaction_id: 'statement-before-alert-row' }],
    });
    await expect(fixture.db.prepare('SELECT relation, to_transaction_id, evidence_basis FROM alert_event_links WHERE from_event_id = ?').bind('00000000-0000-4000-8000-000000000001').all()).resolves.toMatchObject({
      results: [{ relation: 'confirms', to_transaction_id: 'statement-before-alert-row', evidence_basis: 'bank_reference' }],
    });
    await expect(fixture.db.prepare('SELECT source_kind, source_id, basis FROM alert_projection_provenance WHERE projection_id = ? AND source_kind = \'statement\'').bind('00000000-0000-4000-8000-000000000001').all()).resolves.toMatchObject({
      results: [{ source_kind: 'statement', source_id: 'statement-source:statement%3Aaccount-boc%3A1111111111111111111111111111111111111111111111111111111111111111%3A0', basis: 'statement' }],
    });
  });

  it('reconciles an alert committed before its statement by one strong bank reference', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const alertId = '00000000-0000-4000-8000-000000000031';
    const alertResponse = await postAlerts(fixture.db, [event({ eventId: alertId, observationId: 'observation-31', bankReference: 'arrival-order-ref' })]);
    expect(await alertResponse.json()).toMatchObject({ acks: [{ status: 'accepted', projectionState: 'provisional' }] });

    const result = await commitStatementRows(fixture.db, {
      importId: 'statement-after-alert',
      accountId: 'account-boc',
      filename: 'statement.csv',
      fileSha256: '3'.repeat(64),
      rows: [{
        id: 'statement-after-alert-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -1234,
        currency: 'CAD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'arrival-order-fingerprint',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '3'.repeat(64), rowIndex: 0 },
        bankReference: 'arrival-order-ref',
      }],
    });

    expect(result).toMatchObject({ accepted: 1, needsReview: 0, candidateCount: 0 });
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE account_id = 'account-boc'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare(`SELECT source, status FROM transactions WHERE account_id = 'account-boc'`).all()).resolves.toMatchObject({ results: [{ source: 'statement', status: 'confirmed' }] });
    await expect(fixture.db.prepare('SELECT state, transaction_id, revision FROM alert_projections WHERE event_id = ?').bind(alertId).all()).resolves.toMatchObject({
      results: [{ state: 'superseded', transaction_id: 'statement-after-alert-row', revision: 2 }],
    });
    await expect(fixture.db.prepare('SELECT relation, to_transaction_id, evidence_basis FROM alert_event_links WHERE from_event_id = ?').bind(alertId).all()).resolves.toMatchObject({
      results: [{ relation: 'confirms', to_transaction_id: 'statement-after-alert-row', evidence_basis: 'bank_reference' }],
    });
  });

  it('keeps a cross-currency bank-reference candidate review-only without an automatic link', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const alertId = '00000000-0000-4000-8000-000000000032';
    await postAlerts(fixture.db, [event({ eventId: alertId, observationId: 'observation-32', bankReference: 'fx-settlement-ref' })]);

    const result = await commitStatementRows(fixture.db, {
      importId: 'statement-cross-currency',
      accountId: 'account-boc',
      filename: 'statement.csv',
      fileSha256: '4'.repeat(64),
      rows: [{
        id: 'statement-cross-currency-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -987,
        currency: 'USD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'cross-currency-fingerprint',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '4'.repeat(64), rowIndex: 0 },
        bankReference: 'fx-settlement-ref',
      }],
    });

    expect(result).toMatchObject({ accepted: 1, needsReview: 1, candidateCount: 1 });
    await expect(fixture.db.prepare('SELECT status, evidence_basis FROM statement_reconciliation_candidates WHERE statement_transaction_id = ?').bind('statement-cross-currency-row').all()).resolves.toMatchObject({ results: [{ status: 'open', evidence_basis: 'candidate_rank' }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_event_links WHERE from_event_id = ?').bind(alertId).all()).resolves.toMatchObject({ results: [{ count: 0 }] });
    await expect(fixture.db.prepare('SELECT state FROM alert_projections WHERE event_id = ?').bind(alertId).all()).resolves.toMatchObject({ results: [{ state: 'provisional' }] });
  });

  it('allows only one concurrent strong alert to reuse a statement target', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await commitStatementRows(fixture.db, {
      importId: 'statement-concurrent-target',
      accountId: 'account-boc',
      filename: 'statement.csv',
      fileSha256: '5'.repeat(64),
      rows: [{
        id: 'statement-concurrent-target-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -1234,
        currency: 'CAD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'concurrent-target-fingerprint',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '5'.repeat(64), rowIndex: 0 },
        bankReference: 'concurrent-target-ref',
      }],
    });

    const firstId = '00000000-0000-4000-8000-000000000033';
    const secondId = '00000000-0000-4000-8000-000000000034';
    const [first, second] = await Promise.all([
      postAlerts(fixture.db, [event({ eventId: firstId, observationId: 'observation-33', bankReference: 'concurrent-target-ref' })]),
      postAlerts(fixture.db, [event({ eventId: secondId, observationId: 'observation-34', bankReference: 'concurrent-target-ref' })]),
    ]);
    const firstPayload = await first.json() as { acks: Array<{ status: string }> };
    const secondPayload = await second.json() as { acks: Array<{ status: string }> };
    expect(firstPayload.acks[0].status).toBe('accepted');
    expect(secondPayload.acks[0].status).toBe('accepted');

    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM alert_event_links WHERE relation = 'confirms' AND to_transaction_id = 'statement-concurrent-target-row'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM alert_projections WHERE state = 'superseded' AND transaction_id = 'statement-concurrent-target-row'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM statement_reconciliation_candidates WHERE statement_transaction_id = 'statement-concurrent-target-row' AND status = 'open'`).all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('keeps weak statement-before-alert matches open until explicit user review', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await commitStatementRows(fixture.db, {
      importId: 'statement-review-before-alert',
      accountId: 'account-boc',
      filename: 'statement.csv',
      fileSha256: '2'.repeat(64),
      rows: [{
        id: 'statement-review-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -1234,
        currency: 'CAD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'not-an-identity',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '2'.repeat(64), rowIndex: 0 },
      }],
    });

    const response = await postAlerts(fixture.db, [event({ bankReference: null })]);
    expect(await response.json()).toMatchObject({ acks: [{ status: 'accepted', projectionState: 'provisional' }] });
    await expect(fixture.db.prepare('SELECT status FROM statement_reconciliation_candidates WHERE statement_transaction_id = ? AND candidate_transaction_id = ?').bind('statement-review-row', '00000000-0000-4000-8000-000000000001').all()).resolves.toMatchObject({ results: [{ status: 'open' }] });

    const result = await applyAlertReview(fixture.db, {
      id: 'explicit-review-before-alert',
      alertEventId: '00000000-0000-4000-8000-000000000001',
      statementTransactionId: 'statement-review-row',
      candidateTransactionId: '00000000-0000-4000-8000-000000000001',
      relation: 'confirms',
      evidenceBasis: 'user_review',
      revision: 2,
    });
    expect(result.projectionSuperseded).toBe(true);
    await expect(fixture.db.prepare('SELECT basis FROM alert_projection_provenance WHERE projection_id = ? AND basis = \'user_review\'').bind('00000000-0000-4000-8000-000000000001').all()).resolves.toMatchObject({ results: [{ basis: 'user_review' }] });
  });

  it('applies a same-currency partial event cancellation with durable remaining arithmetic', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const purchaseId = '00000000-0000-4000-8000-000000000021';
    const reversalId = '00000000-0000-4000-8000-000000000022';
    const response = await postAlerts(fixture.db, [
      event({ eventId: purchaseId }),
      event({ eventId: reversalId, observationId: 'observation-22', eventType: 'authorization_reversal', direction: 'none', eventMoney: { currency: 'CAD', amountMinor: 500 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 500 }] }),
    ]);
    expect(await response.json()).toMatchObject({ acks: [{ eventId: purchaseId, projectionState: 'provisional' }, { eventId: reversalId, projectionState: 'needs_review' }] });
    await expect(fixture.db.prepare('SELECT date, fx_lock_date, amount_minor FROM transactions WHERE id = ?').bind(purchaseId).all()).resolves.toMatchObject({
      results: [{ date: '2026-10-13', fx_lock_date: '2026-10-13', amount_minor: -1234 }],
    });

    await applyAlertReview(fixture.db, {
      id: 'partial-event-cancellation',
      alertEventId: reversalId,
      targetAlertEventId: purchaseId,
      relation: 'partially_reverses',
      allocatedCurrency: 'CAD',
      allocatedAmountMinor: 500,
      evidenceBasis: 'user_review',
      revision: 2,
    });
    await expect(fixture.db.prepare('SELECT state, counted_amount_minor FROM alert_projections WHERE event_id = ?').bind(purchaseId).all()).resolves.toMatchObject({
      results: [{ state: 'provisional', counted_amount_minor: 734 }],
    });
    await expect(fixture.db.prepare('SELECT date, fx_lock_date, amount_minor FROM transactions WHERE id = ?').bind(purchaseId).all()).resolves.toMatchObject({
      results: [{ date: '2026-10-13', fx_lock_date: '2026-10-13', amount_minor: -734 }],
    });
    await expect(fixture.db.prepare('SELECT to_event_id, allocated_amount_minor FROM alert_event_links WHERE from_event_id = ?').bind(reversalId).all()).resolves.toMatchObject({
      results: [{ to_event_id: purchaseId, allocated_amount_minor: 500 }],
    });
  });
});

// Migration 0009 is tested against its historical schema, without invoking current auth APIs.
async function seedHistoricalAlertInputs(db: import('../worker/db-types').D1Database) {
  for (const suffix of ['41', '42']) {
    const id = '00000000-0000-4000-8000-0000000000' + suffix;
    await db.batch([
      db.prepare(`INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint)
        VALUES (?,'account-boc','2026-10-13','Synthetic merchant',-1234,'CAD','Other','expense','provisional','alert',?)`).bind(id,id),
      db.prepare(`INSERT INTO alert_events(id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,account_id,payload_digest)
        VALUES (?,?,?,'source-boc','test','2026-10-13T00:00:00Z','notification_posted','purchase_notice','outflow','account-boc',?)`).bind(id,id,'observation-'+suffix,'digest-'+suffix),
      db.prepare(`INSERT INTO alert_projections(id,event_id,transaction_id,state,counted_currency,counted_amount_minor)
        VALUES (?,?,?,'provisional','CAD',-1234)`).bind(id,id,id),
    ]);
  }
}
