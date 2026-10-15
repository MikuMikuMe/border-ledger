import { afterEach, describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { createD1Fixture, task18MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

describe('Worker reconciliation routes', () => {
  it('uses a stable import operation and response identity when a commit is retried', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('route-account', 'Route account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();

    const body = {
      accountId: 'route-account',
      filename: 'statement.csv',
      fileSha256: '3'.repeat(64),
      transactions: [{
        id: 'route-row',
        date: '2026-10-13',
        merchant: 'Route merchant',
        amountMinor: -100,
        currency: 'CAD',
        category: 'Other',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'route-fingerprint',
      }],
    };
    const request = () => new Request('https://pf.example.com/api/imports/commit', {
      method: 'POST',
      headers: { authorization: 'Bearer route-key', origin: 'https://pf.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const env = { DB: fixture.db, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) }, LEDGER_API_KEY: 'route-key', LEDGER_APP_ORIGIN: 'https://pf.example.com' } as never;

    const first = await worker.fetch(request(), env);
    const firstPayload = await first.json() as { importId: string; accepted: number };
    const replay = await worker.fetch(request(), env);
    const replayPayload = await replay.json() as { importId: string; accepted: number; duplicates: number };

    expect(first.status).toBe(201);
    expect(firstPayload).toMatchObject({ accepted: 1 });
    expect(replay.status).toBe(200);
    expect(replayPayload).toMatchObject({ importId: firstPayload.importId, accepted: 0, duplicates: 1 });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM imports').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM import_commit_operations').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('uses registered currencies for reads and reports while hiding superseded alert evidence', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('route-usd-account', 'USD account', 'Synthetic bank', 'USD', 'single', 'chequing', 'import_only')`).run();
    await fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('route-usd-account', 'USD')`).run();
    await fixture.db.prepare(`INSERT INTO source_profiles (id, provider, source_kind, display_name, parser_version, status)
      VALUES ('route-usd-profile', 'synthetic', 'credit_alert', 'Synthetic USD', 'test', 'approved')`).run();
    await fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES ('route-usd-statement', 'route-usd-account', '2026-10-13', 'USD merchant', -1234, 'USD', 'Other', 'expense', 'confirmed', 'statement', 'route-usd-statement')`).run();
    await fixture.db.prepare(`INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES ('route-usd-alert', 'route-usd-account', '2026-10-13', 'USD merchant', -1234, 'USD', 'Other', 'expense', 'provisional', 'alert', 'route-usd-alert')`).run();
    await fixture.db.prepare(`INSERT INTO alert_events
      (id, event_id, observation_id, source_profile_id, parser_version, captured_at, event_time_basis, event_type, direction, account_id, event_money_currency, event_money_amount_minor, primary_money_role, amounts_json, fee_treatment, completeness_json, payload_digest)
      VALUES ('route-usd-event', 'route-usd-event', 'route-usd-observation', 'route-usd-profile', 'test', '2026-10-13T00:00:00.000Z', 'notification_posted', 'purchase_notice', 'outflow', 'route-usd-account', 'USD', 1234, 'transaction', '[]', 'unknown', '{}', 'route-usd-digest')`).run();
    await fixture.db.prepare(`INSERT INTO alert_projections
      (id, event_id, transaction_id, state, reason_codes_json, revision)
      VALUES ('route-usd-event', 'route-usd-event', 'route-usd-alert', 'superseded', '["confirmed_elsewhere"]', 2)`).run();

    const env = { DB: fixture.db, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) }, LEDGER_API_KEY: 'route-key', LEDGER_APP_ORIGIN: 'https://pf.example.com' } as never;
    const request = (path: string) => new Request(`https://pf.example.com${path}`, {
      headers: { authorization: 'Bearer route-key', origin: 'https://pf.example.com' },
    });

    const transactionsResponse = await worker.fetch(request('/api/transactions?currency=USD'), env);
    expect(transactionsResponse.status).toBe(200);
    expect(await transactionsResponse.json()).toMatchObject({ transactions: [{ id: 'route-usd-statement', currency: 'USD' }] });

    const summaryResponse = await worker.fetch(request('/api/reports/summary?currency=USD'), env);
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = await summaryResponse.json() as Record<string, unknown> & { currencyTotals: unknown[]; dailyTotals: unknown[]; sourceCoverage: Record<string, number>; summary: Record<string, number> };
    expect(summaryPayload).toMatchObject({
      ledgerId: 'personal',
      timeBasis: 'accounting_date',
      timeZone: 'America/Toronto',
      from: null,
      to: null,
      includeProvisional: false,
      reviewCount: 0,
      excludedCount: 0,
      sourceCoverage: { statement: 1 },
      transactionCount: 1,
      summary: { USD: 1234 },
    });
    expect(summaryPayload.asOf).toEqual(expect.any(String));
    expect(summaryPayload.currencyTotals).toEqual([{
      currency: 'USD',
      confirmedMinorUnits: 1234,
      provisionalMinorUnits: 0,
      confirmedCount: 1,
      provisionalCount: 0,
    }]);
    expect(summaryPayload.dailyTotals).toEqual([{
      date: '2026-10-13',
      currency: 'USD',
      confirmedMinorUnits: 1234,
      provisionalMinorUnits: 0,
    }]);
  });
});
