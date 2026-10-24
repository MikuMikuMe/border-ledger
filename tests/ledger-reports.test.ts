import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it } from 'vitest';
import { readLedgerReport } from '../worker/ledger-reports';
import { readOwnerLedgerSnapshot } from '../worker/owner-ledger-snapshot';
import { createD1Fixture, task22MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

describe('ledger report and owner snapshot reads', () => {
  it('rejects an unknown currency filter before reading the ledger', async () => {
    await expect(readLedgerReport({} as never, OWNER_LEDGER, { currency: 'XYZ' })).rejects.toThrow('The report currency is not valid.');
  });

  it('excludes superseded alert transactions from both aggregates and snapshot activity', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
        VALUES ('report-account', 'Report account', 'Synthetic bank', 'USD', 'single', 'chequing', 'import_only')`),
      fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('report-account', 'USD')`),
      fixture.db.prepare(`INSERT INTO source_profiles (id, provider, source_kind, display_name, parser_version, status)
        VALUES ('report-profile', 'synthetic', 'credit_alert', 'Synthetic USD', 'test', 'approved')`),
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('report-visible', 'report-account', '2026-10-13', 'Visible statement', -1234, 'USD', 'Other', 'expense', 'confirmed', 'statement', 'report-visible')`),
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('report-superseded-alert', 'report-account', '2026-10-13', 'Superseded alert', -1234, 'USD', 'Other', 'expense', 'provisional', 'alert', 'report-superseded-alert')`),
      fixture.db.prepare(`INSERT INTO alert_events
        (id, event_id, observation_id, source_profile_id, parser_version, captured_at, event_time_basis, event_type, direction, account_id, event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, completeness_json, payload_digest)
        VALUES ('report-event', 'report-event', 'report-observation', 'report-profile', 'test', '2026-10-13T00:00:00.000Z', 'notification_posted', 'purchase_notice', 'outflow', 'report-account', 'USD', 1234, 'transaction', '[]', 'unknown', '{}', 'report-digest')`),
      fixture.db.prepare(`INSERT INTO alert_projections (id, event_id, transaction_id, state, reason_codes_json, revision)
        VALUES ('report-event', 'report-event', 'report-superseded-alert', 'superseded', '["confirmed_elsewhere"]', 2)`),
    ]);

    const report = await readLedgerReport(fixture.db, OWNER_LEDGER, { includeProvisional: true });
    expect(report.currencyTotals).toEqual([
      { currency: 'USD', confirmedMinorUnits: 1234, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
    ]);
    expect(report.sourceCoverage).toEqual({ statement: 1 });

    const snapshot = await readOwnerLedgerSnapshot(fixture.db, OWNER_LEDGER);
    expect(snapshot.transactions.map((transaction) => transaction.id)).toEqual(['report-visible']);
    expect(snapshot.report.sourceCoverage).toEqual({ statement: 1 });
  });

  it('excludes an annotated alert row when reconciliation rebinds its superseded projection to the statement', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
        VALUES ('rebound-account', 'Rebound account', 'Synthetic bank', 'USD', 'single', 'chequing', 'import_only')`),
      fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('rebound-account', 'USD')`),
      fixture.db.prepare(`INSERT INTO source_profiles (id, provider, source_kind, display_name, parser_version, status)
        VALUES ('rebound-profile', 'synthetic', 'credit_alert', 'Synthetic USD', 'test', 'approved')`),
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('rebound-alert', 'rebound-account', '2026-10-13', 'Annotated alert', -1234, 'USD', 'Other', 'expense', 'provisional', 'alert', 'rebound-alert')`),
      fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('rebound-statement', 'rebound-account', '2026-10-13', 'Statement row', -1234, 'USD', 'Other', 'expense', 'confirmed', 'statement', 'rebound-statement')`),
      fixture.db.prepare(`INSERT INTO alert_events
        (id, event_id, observation_id, source_profile_id, parser_version, captured_at, event_time_basis, event_type, direction, account_id, event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, completeness_json, payload_digest)
        VALUES ('rebound-event', 'rebound-event', 'rebound-observation', 'rebound-profile', 'test', '2026-10-13T00:00:00.000Z', 'notification_posted', 'purchase_notice', 'outflow', 'rebound-account', 'USD', 1234, 'transaction', '[]', 'unknown', '{}', 'rebound-digest')`),
      fixture.db.prepare(`INSERT INTO transaction_source_records
        (id, ledger_id, source_kind, identity_key, transaction_id, account_id, event_id, content_digest)
        VALUES ('rebound-source', 'personal', 'alert', 'alert:rebound-event', 'rebound-alert', 'rebound-account', 'rebound-event', 'rebound-source-digest')`),
      fixture.db.prepare(`INSERT INTO alert_projections (id, event_id, transaction_id, state, reason_codes_json, revision)
        VALUES ('rebound-projection', 'rebound-event', 'rebound-statement', 'superseded', '["confirmed_elsewhere"]', 2)`),
      fixture.db.prepare(`INSERT INTO annotation_revisions (id, transaction_id, author_subject_hash, revision, category, note)
        VALUES ('rebound-annotation', 'rebound-alert', 'reviewer', 1, 'Groceries', 'Keep this evidence')`),
    ]);

    const report = await readLedgerReport(fixture.db, OWNER_LEDGER, { includeProvisional: true });
    expect(report.currencyTotals).toEqual([
      { currency: 'USD', confirmedMinorUnits: 1234, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
    ]);
    expect(report.sourceCoverage).toEqual({ statement: 1 });

    const snapshot = await readOwnerLedgerSnapshot(fixture.db, OWNER_LEDGER);
    expect(snapshot.transactions.map((transaction) => transaction.id)).toEqual(['rebound-statement']);
    expect(snapshot.report.sourceCoverage).toEqual({ statement: 1 });
    await expect(fixture.db.prepare('SELECT transaction_id, note FROM annotation_revisions WHERE id = ?').bind('rebound-annotation').all()).resolves.toMatchObject({
      results: [{ transaction_id: 'rebound-alert', note: 'Keep this evidence' }],
    });
  });

  it('keeps snapshot account arrays within the declared render bounds', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`WITH RECURSIVE account_numbers(number) AS (
        SELECT 1
        UNION ALL
        SELECT number + 1 FROM account_numbers WHERE number < 501
      )
      INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      SELECT 'bounded-account-' || number, 'Account ' || number, 'Synthetic bank', 'USD', 'single', 'chequing', 'import_only'
      FROM account_numbers`).run();

    const snapshot = await readOwnerLedgerSnapshot(fixture.db, OWNER_LEDGER);

    expect(snapshot.accounts).toHaveLength(500);
    expect(snapshot.accounts.every((account) => account.currencies.length <= 16)).toBe(true);
  });
});
