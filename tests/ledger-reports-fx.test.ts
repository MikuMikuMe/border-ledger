import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFxSnapshotDigest, FxSnapshotIntegrityError, readLedgerReport } from '../worker/ledger-reports';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database } from '../worker/db-types';

const fixtures: Array<{ close(): void }> = [];
const NOW = new Date('2026-10-14T12:00:00.000Z');

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.close();
});

function fixture() {
  const value = createSqliteD1Fixture();
  fixtures.push(value);
  return value;
}

async function account(db: D1Database, id: string, institution: string, currencies: string[]) {
  await db.prepare(`INSERT INTO accounts (id, name, institution, currency, kind, status)
    VALUES (?, ?, ?, ?, 'chequing', 'connected')`).bind(id, id, institution, currencies[0]).run();
  for (const currency of currencies.slice(1)) {
    await db.prepare('INSERT INTO account_currencies (account_id, currency) VALUES (?, ?)').bind(id, currency).run();
  }
}

async function transaction(db: D1Database, input: {
  id: string;
  accountId: string;
  date?: string;
  amountMinor?: number;
  currency?: string;
  kind?: 'expense' | 'refund' | 'fee';
  status?: 'confirmed' | 'provisional';
}) {
  await db.prepare(`INSERT INTO transactions
    (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, 'Other', ?, ?, 'statement', ?)`).bind(
    input.id,
    input.accountId,
    input.date ?? '2026-10-10',
    input.id,
    input.amountMinor ?? -100,
    input.currency ?? 'USD',
    input.kind ?? 'expense',
    input.status ?? 'confirmed',
    `${input.id}-fingerprint`,
  ).run();
}

async function snapshot(db: D1Database, input: {
  requestedDate?: string;
  effectiveDate?: string;
  rates?: Record<string, string>;
  contentDigest?: string;
}) {
  const requestedDate = input.requestedDate ?? '2026-10-10';
  const effectiveDate = input.effectiveDate ?? requestedDate;
  const ratesJson = JSON.stringify(input.rates ?? { USD: '2', CNY: '4', CAD: '1.5' });
  const contentDigest = input.contentDigest ?? await computeFxSnapshotDigest(effectiveDate, ratesJson);
  await db.prepare(`INSERT INTO fx_rate_snapshots
    (requested_date, effective_date, provider, rates_json, content_digest, fetched_at)
    VALUES (?, ?, 'frankfurter', ?, ?, ?)`).bind(
    requestedDate,
    effectiveDate,
    ratesJson,
    contentDigest,
    NOW.toISOString(),
  ).run();
}

describe('FX ledger report aggregation', () => {
  it('keeps source totals and adds exact complete CAD totals plus the narrow BOC band', async () => {
    const { db } = fixture();
    await account(db, 'regular', 'Synthetic bank', ['USD', 'CNY', 'EUR']);
    await account(db, 'boc', 'Bank of China (Canada)', ['USD', 'CNY']);
    await account(db, 'generic-china', 'China Construction Bank', ['USD']);
    await Promise.all([
      transaction(db, { id: 'regular-usd', accountId: 'regular' }),
      transaction(db, { id: 'regular-cny', accountId: 'regular', currency: 'CNY' }),
      transaction(db, { id: 'regular-eur', accountId: 'regular', currency: 'EUR' }),
      transaction(db, { id: 'boc-usd', accountId: 'boc' }),
      transaction(db, { id: 'boc-refund', accountId: 'boc', amountMinor: -50, kind: 'refund' }),
      transaction(db, { id: 'boc-cny', accountId: 'boc', currency: 'CNY' }),
      transaction(db, { id: 'boc-provisional', accountId: 'boc', amountMinor: -200, status: 'provisional' }),
      transaction(db, { id: 'generic-china-usd', accountId: 'generic-china' }),
    ]);
    await snapshot(db, { effectiveDate: '2026-10-09' });

    const confirmedOnly = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW });
    expect(confirmedOnly.currencyTotals).toEqual([
      { currency: 'CNY', confirmedMinorUnits: 200, provisionalMinorUnits: 0, confirmedCount: 2, provisionalCount: 0 },
      { currency: 'EUR', confirmedMinorUnits: 100, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
      { currency: 'USD', confirmedMinorUnits: 250, provisionalMinorUnits: 0, confirmedCount: 4, provisionalCount: 0 },
    ]);
    expect(confirmedOnly.reportingCurrency).toBe('CAD');
    expect(confirmedOnly.convertedTotals).toEqual({
      confirmedMinorUnits: 413,
      provisionalMinorUnits: 0,
      confirmedCount: 7,
      provisionalCount: 0,
    });
    expect(confirmedOnly.convertedDailyTotals).toEqual([
      { date: '2026-10-10', confirmedMinorUnits: 413, provisionalMinorUnits: 0 },
    ]);
    expect(confirmedOnly.fx).toEqual({
      provider: 'frankfurter',
      complete: true,
      unavailableSourceCurrencies: [],
      lockedDateCount: 1,
      observedDateRange: { earliest: '2026-10-09', latest: '2026-10-09' },
      chineseBankBand: {
        eligible: true,
        currency: 'CAD',
        baseMinorUnits: 37,
        lowerMinorUnits: 36,
        upperMinorUnits: 38,
        percentageBasisPoints: 150,
      },
    });

    const withProvisional = await readLedgerReport(db, OWNER_LEDGER, {
      reportingCurrency: 'CAD',
      includeProvisional: true,
    }, { now: () => NOW });
    expect(withProvisional.convertedTotals).toEqual({
      confirmedMinorUnits: 413,
      provisionalMinorUnits: 150,
      confirmedCount: 7,
      provisionalCount: 1,
    });
    expect(withProvisional.fx.chineseBankBand).toMatchObject({
      baseMinorUnits: 187,
      lowerMinorUnits: 184,
      upperMinorUnits: 190,
    });
  });

  it('returns partial converted totals, unavailable codes, and no misleading incomplete BOC band', async () => {
    const { db } = fixture();
    await account(db, 'partial-regular', 'Synthetic bank', ['EUR']);
    await account(db, 'partial-boc', 'boc branch', ['USD']);
    await transaction(db, { id: 'partial-eur', accountId: 'partial-regular', currency: 'EUR' });
    await transaction(db, { id: 'partial-boc-usd', accountId: 'partial-boc' });
    await snapshot(db, { rates: { CAD: '1.5' } });

    const report = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW });

    expect(report.currencyTotals).toEqual([
      { currency: 'EUR', confirmedMinorUnits: 100, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
      { currency: 'USD', confirmedMinorUnits: 100, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
    ]);
    expect(report.convertedTotals).toEqual({ confirmedMinorUnits: 150, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 });
    expect(report.fx).toMatchObject({
      complete: false,
      unavailableSourceCurrencies: ['USD'],
      lockedDateCount: 1,
      chineseBankBand: null,
    });
  });

  it('degrades a provider outage to usable source totals and retries the missing snapshot later', async () => {
    const { db } = fixture();
    await account(db, 'outage', 'Synthetic bank', ['USD']);
    await transaction(db, { id: 'outage-usd', accountId: 'outage' });
    const fetcher = vi.fn(async () => { throw new Error('provider unavailable'); });

    const report = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { fetcher, now: () => NOW });

    expect(report.currencyTotals[0]).toMatchObject({ currency: 'USD', confirmedMinorUnits: 100, confirmedCount: 1 });
    expect(report.convertedTotals).toEqual({ confirmedMinorUnits: 0, provisionalMinorUnits: 0, confirmedCount: 0, provisionalCount: 0 });
    expect(report.fx).toEqual({
      provider: 'frankfurter',
      complete: false,
      unavailableSourceCurrencies: ['USD'],
      lockedDateCount: 1,
      observedDateRange: { earliest: null, latest: null },
      chineseBankBand: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(db.prepare('SELECT COUNT(*) AS count FROM fx_rate_snapshots').first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });

  it('converts source and target identity exactly without fetching or becoming incomplete', async () => {
    const { db } = fixture();
    await account(db, 'identity', 'Synthetic bank', ['CAD']);
    await transaction(db, { id: 'identity-cad', accountId: 'identity', currency: 'CAD', amountMinor: -123 });
    const fetcher = vi.fn(async () => { throw new Error('provider unavailable'); });

    const report = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { fetcher, now: () => NOW });

    expect(fetcher).not.toHaveBeenCalled();
    expect(report.convertedTotals).toEqual({ confirmedMinorUnits: 123, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 });
    expect(report.convertedDailyTotals).toEqual([{ date: '2026-10-10', confirmedMinorUnits: 123, provisionalMinorUnits: 0 }]);
    expect(report.fx).toMatchObject({
      complete: true,
      unavailableSourceCurrencies: [],
      lockedDateCount: 1,
      observedDateRange: { earliest: null, latest: null },
    });
  });

  it('locks the first fetched observation and ignores a later changed provider response', async () => {
    const { db } = fixture();
    await account(db, 'immutable', 'Synthetic bank', ['USD']);
    await transaction(db, { id: 'immutable-usd', accountId: 'immutable' });
    const firstFetch = vi.fn(async () => new Response(JSON.stringify([
      { date: '2026-10-09', base: 'EUR', quote: 'USD', rate: 2 },
      { date: '2026-10-09', base: 'EUR', quote: 'CAD', rate: 1.5 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const first = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { fetcher: firstFetch, now: () => NOW });
    const changedFetch = vi.fn(async () => new Response(JSON.stringify([
      { date: '2026-10-10', base: 'EUR', quote: 'USD', rate: 1 },
      { date: '2026-10-10', base: 'EUR', quote: 'CAD', rate: 2 },
    ]), { status: 200 }));
    const second = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { fetcher: changedFetch, now: () => NOW });

    expect(first.convertedTotals?.confirmedMinorUnits).toBe(75);
    expect(second.convertedTotals).toEqual(first.convertedTotals);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(changedFetch).not.toHaveBeenCalled();
  });

  it('uses the immutable FX lock date when the accounting date changes', async () => {
    const { db } = fixture();
    await account(db, 'locked-date', 'Synthetic bank', ['USD']);
    await transaction(db, { id: 'locked-date-usd', accountId: 'locked-date', date: '2026-10-10' });
    await db.prepare('UPDATE transactions SET date = ? WHERE id = ?').bind('2026-10-11', 'locked-date-usd').run();
    await snapshot(db, { requestedDate: '2026-10-10', rates: { USD: '2', CAD: '1.5' } });
    await snapshot(db, { requestedDate: '2026-10-11', rates: { USD: '2', CAD: '2' } });

    const report = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW });

    expect(report.convertedTotals?.confirmedMinorUnits).toBe(75);
    expect(report.convertedDailyTotals).toEqual([{ date: '2026-10-11', confirmedMinorUnits: 75, provisionalMinorUnits: 0 }]);
    expect(report.fx).toMatchObject({ lockedDateCount: 1, observedDateRange: { earliest: '2026-10-10', latest: '2026-10-10' } });
  });

  it('rejects a stored snapshot whose content digest does not match its canonical payload', async () => {
    const { db } = fixture();
    await account(db, 'tampered', 'Synthetic bank', ['USD']);
    await transaction(db, { id: 'tampered-usd', accountId: 'tampered' });
    await snapshot(db, { contentDigest: '0'.repeat(64) });

    await expect(readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW }))
      .rejects.toBeInstanceOf(FxSnapshotIntegrityError);
  });

  it('fails safely when individually safe monetary rows exceed the safe aggregate range', async () => {
    const { db } = fixture();
    await account(db, 'overflow', 'Synthetic bank', ['USD']);
    await transaction(db, { id: 'overflow-max', accountId: 'overflow', amountMinor: -Number.MAX_SAFE_INTEGER });
    await transaction(db, { id: 'overflow-one', accountId: 'overflow', amountMinor: -1 });
    await snapshot(db, { rates: { USD: '1', CAD: '1' } });

    await expect(readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW }))
      .rejects.toThrow(/safe integer range|too large to be represented/i);
  });

  it('aggregates every matching row beyond the 500-row Activity page', async () => {
    const { db } = fixture();
    await account(db, 'full-window', 'Synthetic bank', ['USD']);
    await db.prepare(`WITH RECURSIVE numbers(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 501
      )
      INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      SELECT 'full-window-' || value, 'full-window', '2026-10-10', 'Row ' || value, -1, 'USD', 'Other', 'expense', 'confirmed', 'statement', 'full-window-fp-' || value
      FROM numbers`).run();
    await snapshot(db, { rates: { USD: '1', CAD: '1' } });

    const report = await readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'CAD' }, { now: () => NOW });

    expect(report.currencyTotals).toEqual([
      { currency: 'USD', confirmedMinorUnits: 501, provisionalMinorUnits: 0, confirmedCount: 501, provisionalCount: 0 },
    ]);
    expect(report.convertedTotals).toEqual({ confirmedMinorUnits: 501, provisionalMinorUnits: 0, confirmedCount: 501, provisionalCount: 0 });
  });

  it('keeps omitted reporting currency source-only and rejects unregistered source and target codes', async () => {
    const { db } = fixture();
    const report = await readLedgerReport(db, OWNER_LEDGER, {}, { now: () => NOW });
    expect(report).toMatchObject({
      reportingCurrency: null,
      convertedTotals: null,
      convertedDailyTotals: [],
      fx: {
        provider: 'frankfurter',
        complete: true,
        unavailableSourceCurrencies: [],
        lockedDateCount: 0,
        observedDateRange: { earliest: null, latest: null },
        chineseBankBand: null,
      },
    });
    await expect(readLedgerReport(db, OWNER_LEDGER, { currency: 'XYZ' })).rejects.toThrow('The report currency is not valid.');
    await expect(readLedgerReport(db, OWNER_LEDGER, { reportingCurrency: 'XYZ' })).rejects.toThrow('The reporting currency is not valid.');
  });
});
