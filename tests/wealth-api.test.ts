import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Fixture, task24MigrationNames } from './helpers/d1';
import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import worker from '../worker/index';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import { computeFxSnapshotDigest } from '../worker/ledger-reports';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const wealthMigrations = [
  ...task24MigrationNames,
  '0025-lunchflow-platform.sql',
  '0026-lunchflow-connection-mappings.sql',
  '0027-hosted-users-activation.sql',
  '0028-recurring-plans.sql',
  '0029-budget.sql',
  '0030-ai-settings.sql',
  '0031-budget-tracking.sql',
  '0032-ai-official-providers.sql',
  '0033-wealth.sql',
  '0034-manual-matches.sql',
] as const;

afterEach(async () => {
  vi.unstubAllGlobals();
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

async function fixture() {
  const value = await createD1Fixture(wealthMigrations);
  fixtures.push(value);
  await provisionWebOwner(value.db);
  return value;
}

function webEnv(db: Parameters<typeof worker.fetch>[1]) {
  return {
    ...db,
    ...VERIFIED_WEB_ENV,
    LEDGER_APP_ORIGIN: 'https://pf.example.com',
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  };
}

describe('wealth web API', () => {
  it('creates a tenant-scoped account and rejects a stale aggregate revision', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const url = 'https://pf.example.com/api/wealth/accounts';
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const create = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: 'home',
        name: 'Home',
        kind: 'manual_asset',
        mode: 'aggregate',
        currency: 'CAD',
        amountMinor: 450000,
        expectedRevision: 0,
      }),
    }), env as never);
    expect(create.status).toBe(200);
    expect(await create.json()).toMatchObject({ account: { id: 'home', name: 'Home' }, revision: 1 });

    const rename = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ id: 'home', name: 'Home updated', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', amountMinor: 450000, expectedRevision: 1 }),
    }), env as never);
    expect(rename.status).toBe(200);
    expect(await rename.json()).toMatchObject({ account: { name: 'Home updated' }, revision: 2 });

    const stale = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: 'home',
        name: 'Old Home',
        kind: 'manual_asset',
        mode: 'aggregate',
        currency: 'CAD',
        amountMinor: 1,
        expectedRevision: 0,
      }),
    }), env as never);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'revision_conflict', currentRevision: 2 });
  }, 30000);

  it('replays an account and instrument creation receipt when the client retries its original revision', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (path: string, body: unknown) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const accountBody = { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0, operationId: 'account-receipt' };
    expect((await put('/api/wealth/accounts', accountBody)).status).toBe(200);
    const accountRetry = await put('/api/wealth/accounts', accountBody);
    expect(accountRetry.status).toBe(200);
    const instrumentBody = { id: 'shop', exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD', expectedRevision: 1, operationId: 'instrument-receipt' };
    expect((await put('/api/wealth/instruments', instrumentBody)).status).toBe(200);
    const instrumentRetry = await put('/api/wealth/instruments', instrumentBody);
    expect(instrumentRetry.status).toBe(200);
    expect((await f.db.prepare('SELECT revision FROM wealth_state WHERE ledger_id=?').bind('personal').first<{ revision: number }>())?.revision).toBe(2);
  }, 30000);

  it('uses the HTTP Idempotency-Key for account, instrument, and valuation writes', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (path: string, body: unknown, idempotencyKey: string) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) }), env as never);
    const account = { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 };
    expect((await put('/api/wealth/accounts', account, 'account-header-key')).status).toBe(200);
    expect((await put('/api/wealth/accounts', account, 'account-header-key')).status).toBe(200);
    const instrument = { id: 'shop', exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD', expectedRevision: 1 };
    expect((await put('/api/wealth/instruments', instrument, 'instrument-header-key')).status).toBe(200);
    expect((await put('/api/wealth/instruments', instrument, 'instrument-header-key')).status).toBe(200);
    const valuation = { id: 'shop-value', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 2 };
    expect((await put('/api/wealth/valuations', valuation, 'valuation-header-key')).status).toBe(200);
    const conflictingRetry = await put('/api/wealth/valuations', { ...valuation, id: 'shop-value-correction', priceMinor: 1100 }, 'valuation-header-key');
    expect(conflictingRetry.status).toBe(409);
    expect(await conflictingRetry.json()).toMatchObject({ code: 'idempotency_conflict' });
  }, 30000);

  it('returns snapshot and report data without exposing another tenant', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const write = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }),
    }), env as never);
    expect(write.status).toBe(200);
    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ accounts: [{ id: 'brokerage', mode: 'holdings' }], totalByCurrency: {} });
    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-01-01&to=2026-12-31', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ cashFlows: [], modifiedDietz: { available: false } });
  }, 30000);

  it('marks a history point incomplete when an account lacks an observation for that date', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'asset', name: 'Asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'debt', name: 'Debt', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await valuation({ id: 'asset-start', accountId: 'asset', asOf: '2026-11-01', priceMinor: 150000, source: 'manual', expectedRevision: 2 })).status).toBe(200);
    expect((await valuation({ id: 'asset-middle', accountId: 'asset', asOf: '2026-11-02', priceMinor: 150000, source: 'manual', expectedRevision: 3 })).status).toBe(200);
    expect((await valuation({ id: 'asset-end', accountId: 'asset', asOf: '2026-11-03', priceMinor: 150000, source: 'manual', expectedRevision: 4 })).status).toBe(200);
    expect((await valuation({ id: 'debt-start', accountId: 'debt', asOf: '2026-11-01', priceMinor: 30000, source: 'manual', expectedRevision: 5 })).status).toBe(200);
    expect((await valuation({ id: 'debt-end', accountId: 'debt', asOf: '2026-11-03', priceMinor: 30000, source: 'manual', expectedRevision: 6 })).status).toBe(200);

    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-11-03', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { history: Array<{ date: string; totals: Record<string, number>; convertedCadMinor: number | null; complete: boolean; stale: boolean; missingData: string[] }> };
    expect(report.history).toEqual([
      { date: '2026-11-01', totals: { CAD: 120000 }, convertedCadMinor: null, complete: true, stale: false, missingData: [] },
      { date: '2026-11-02', totals: { CAD: 120000 }, convertedCadMinor: null, complete: false, stale: false, missingData: ['account:debt:observation'] },
      { date: '2026-11-03', totals: { CAD: 120000 }, convertedCadMinor: null, complete: true, stale: false, missingData: [] },
    ]);
  }, 30000);

  it('warms report FX through the worker fetch fallback', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const provider = vi.fn(async () => Response.json([
      { base: 'EUR', quote: 'CAD', date: '2026-01-02', rate: 1.4 },
      { base: 'EUR', quote: 'USD', date: '2026-01-02', rate: 1.4 },
    ]));
    vi.stubGlobal('fetch', provider);
    const account = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'usd-asset', name: 'USD asset', kind: 'manual_asset', mode: 'aggregate', currency: 'USD', expectedRevision: 0 }),
    }), env as never);
    expect(account.status).toBe(200);
    const valuation = await worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'usd-asset-2026-01-03', accountId: 'usd-asset', asOf: '2026-01-03', priceMinor: 10000, expectedRevision: 1 }),
    }), env as never);
    expect(valuation.status).toBe(200);
    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-01-03&reportingCurrency=CAD', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(report.status).toBe(200);
    expect(provider).toHaveBeenCalled();
    expect(await report.json()).toMatchObject({
      fx: {
        complete: true,
        convertedCadMinor: 10000,
        effectiveDate: '2026-01-02',
        provider: 'frankfurter',
        baseCurrency: 'EUR',
        rates: { CAD: '1.4', USD: '1.4' },
      },
    });
    expect(provider).toHaveBeenCalledWith(expect.stringContaining('api.frankfurter.dev'), expect.objectContaining({ method: 'GET' }));
  }, 30000);

  it('reports cached FX provenance using the actual prior business-day rate date without fetching', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const account = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'usd-asset', name: 'USD asset', kind: 'manual_asset', mode: 'aggregate', currency: 'USD', expectedRevision: 0 }),
    }), env as never);
    expect(account.status).toBe(200);
    const valuation = await worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'usd-asset-2026-01-03', accountId: 'usd-asset', asOf: '2026-01-03', priceMinor: 10000, expectedRevision: 1 }),
    }), env as never);
    expect(valuation.status).toBe(200);

    const ratesJson = JSON.stringify({ CAD: '1.4', USD: '1.4' });
    await f.db.prepare(`INSERT INTO fx_rate_snapshots
      (requested_date,effective_date,provider,rates_json,content_digest,fetched_at)
      VALUES (?,?,?,?,?,?)`).bind(
      '2026-01-03',
      '2026-01-02',
      'frankfurter',
      ratesJson,
      await computeFxSnapshotDigest('2026-01-02', ratesJson),
      '2026-01-03T12:00:00.000Z',
    ).run();
    const provider = vi.fn(async () => { throw new Error('unexpected FX fetch'); });
    vi.stubGlobal('fetch', provider);

    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-01-03&reportingCurrency=CAD', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({
      fx: {
        complete: true,
        convertedCadMinor: 10000,
        effectiveDate: '2026-01-02',
        provider: 'frankfurter',
        baseCurrency: 'EUR',
        rates: { CAD: '1.4', USD: '1.4' },
      },
    });
    expect(provider).not.toHaveBeenCalled();
  }, 30000);

  it('does not report a converted total as complete when a source currency lacks a dated valuation', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const provider = vi.fn(async () => Response.json([
      { base: 'EUR', quote: 'CAD', date: '2026-01-02', rate: 1.4 },
      { base: 'EUR', quote: 'USD', date: '2026-01-02', rate: 1.4 },
    ]));
    vi.stubGlobal('fetch', provider);
    const putAccount = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const putValuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await putAccount({ id: 'usd-asset', name: 'USD asset', kind: 'manual_asset', mode: 'aggregate', currency: 'USD', expectedRevision: 0 })).status).toBe(200);
    expect((await putAccount({ id: 'cad-debt', name: 'CAD debt', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await putValuation({ id: 'usd-asset-2026-01-03', accountId: 'usd-asset', asOf: '2026-01-03', priceMinor: 10000, expectedRevision: 2 })).status).toBe(200);

    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-01-03&reportingCurrency=CAD', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({
      fx: {
        complete: false,
        convertedCadMinor: null,
        effectiveDate: '2026-01-02',
        provider: 'frankfurter',
        baseCurrency: 'EUR',
        rates: { CAD: '1.4', USD: '1.4' },
      },
    });
  }, 30000);

  it('rejects non-CAD wealth reporting targets instead of labeling another currency as convertedCadMinor', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-01-03&reportingCurrency=USD', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  }, 30000);

  it('preserves append order for same-day replay and exposes correction history', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const account = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }) }), env as never);
    expect(account.status).toBe(200);
    const instrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' } as const;
    const opening = { id: 'opening-order', sourceId: 'z-opening', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 10000 } };
    const sale = { id: 'sale-order', sourceId: 'a-sale', date: '2026-01-01', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: { currency: 'CAD', amountMinor: 12000 }, fee: null };
    const firstEvent = await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: opening, expectedRevision: 1 }) }), env as never);
    expect(firstEvent.status).toBe(201);
    const secondEvent = await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: sale, expectedRevision: 2 }) }), env as never);
    expect(secondEvent.status).toBe(201);
    const events = await worker.fetch(new Request('https://pf.example.com/api/wealth/events?accountId=brokerage', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await events.json()).toMatchObject({ events: [{ sourceId: 'z-opening', sequence: 1 }, { sourceId: 'a-sale', sequence: 2 }] });
    const valuations = await worker.fetch(new Request('https://pf.example.com/api/wealth/valuations?accountId=brokerage', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await valuations.json()).toMatchObject({ valuations: [] });
  }, 30000);

  it('derives unlinked manual portfolio flows for Modified Dietz', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'manual-contribution', sourceId: 'manual-contribution', date: '2026-11-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50000 } }, 2)).status).toBe(201);

    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { modifiedDietz: { available: boolean; value: number | null }; investmentCashFlows: Array<{ sourceId: string; classification: string; includedInPerformance: boolean }> };
    expect(report.modifiedDietz).toMatchObject({ available: true, value: 0 });
    expect(report.investmentCashFlows).toEqual([expect.objectContaining({ sourceId: 'manual-contribution', classification: 'external_contribution', includedInPerformance: true })]);
  }, 30000);

  it('reports independent Modified Dietz results for each portfolio currency', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'cad-brokerage', name: 'CAD Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'usd-brokerage', name: 'USD Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'USD', expectedRevision: 1 })).status).toBe(200);
    expect((await post({ id: 'cad-opening', sourceId: 'cad-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'cad-brokerage', money: { currency: 'CAD', amountMinor: 100000 } }, 2)).status).toBe(201);
    expect((await post({ id: 'usd-opening', sourceId: 'usd-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'usd-brokerage', money: { currency: 'USD', amountMinor: 100000 } }, 3)).status).toBe(201);
    expect((await post({ id: 'cad-contribution', sourceId: 'cad-contribution', date: '2026-11-02', kind: 'contribution', accountId: 'cad-brokerage', money: { currency: 'CAD', amountMinor: 50000 } }, 4)).status).toBe(201);
    expect((await post({ id: 'usd-contribution', sourceId: 'usd-contribution', date: '2026-11-02', kind: 'contribution', accountId: 'usd-brokerage', money: { currency: 'USD', amountMinor: 50000 } }, 5)).status).toBe(201);

    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { modifiedDietz: { available: boolean }; modifiedDietzByCurrency: Record<string, { available: boolean; value: number | null }> };
    expect(report.modifiedDietz.available).toBe(false);
    expect(report.modifiedDietzByCurrency).toEqual({ CAD: { available: true, value: 0, reason: null }, USD: { available: true, value: 0, reason: null } });
  }, 30000);

  it('updates portfolio flows when a contribution is corrected or reversed', async () => {
    const corrected = await fixture();
    const correctedEnv = webEnv({ DB: corrected.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const postCorrected = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), correctedEnv as never);
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }) }), correctedEnv as never)).status).toBe(200);
    expect((await postCorrected({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100000 } }, 1)).status).toBe(201);
    expect((await postCorrected({ id: 'original-contribution', sourceId: 'original-contribution', date: '2026-11-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50000 } }, 2)).status).toBe(201);
    expect((await postCorrected({ id: 'correction', sourceId: 'correction', date: '2026-11-02', kind: 'correction', targetSourceId: 'original-contribution', replacement: { kind: 'withdrawal', date: '2026-11-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 20000 } } }, 3)).status).toBe(201);
    const correctedReport = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), correctedEnv as never);
    expect((await correctedReport.json())).toMatchObject({ modifiedDietz: { available: true, value: 0 }, investmentCashFlows: [expect.objectContaining({ sourceId: 'correction:replacement', classification: 'external_withdrawal' })] });

    const reversed = await fixture();
    const reversedEnv = webEnv({ DB: reversed.db } as never);
    const postReversed = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), reversedEnv as never);
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }) }), reversedEnv as never)).status).toBe(200);
    expect((await postReversed({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100000 } }, 1)).status).toBe(201);
    expect((await postReversed({ id: 'original-contribution', sourceId: 'original-contribution', date: '2026-11-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50000 } }, 2)).status).toBe(201);
    expect((await postReversed({ id: 'reversal', sourceId: 'reversal', date: '2026-11-02', kind: 'reversal', targetSourceId: 'original-contribution' }, 3)).status).toBe(201);
    const reversedReport = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), reversedEnv as never);
    expect((await reversedReport.json())).toMatchObject({ modifiedDietz: { available: true, value: 0 }, investmentCashFlows: [] });
  }, 30000);

  it('excludes explicitly linked internal transfers from household cash totals', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('transfer-tx','bank-1','2026-11-02','Internal move',100,'CAD','Transfer','expense','confirmed','manual','transfer-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES('transfer-source','personal','manual','transfer-source','transfer-tx','bank-1','transfer-manual','transfer-digest')").run();
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'cash-a', name: 'Cash A', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'cash-b', name: 'Cash B', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await post({ id: 'cash-a-opening', sourceId: 'cash-a-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'cash-a', money: { currency: 'CAD', amountMinor: 1000 } }, 2)).status).toBe(201);
    expect((await post({ id: 'cash-b-opening', sourceId: 'cash-b-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'cash-b', money: { currency: 'CAD', amountMinor: 0 } }, 3)).status).toBe(201);
    expect((await post({ id: 'cash-transfer', sourceId: 'cash-transfer', date: '2026-11-02', kind: 'transfer', transferKind: 'cash', fromAccountId: 'cash-a', toAccountId: 'cash-b', money: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId: 'transfer-source' }, 4)).status).toBe(201);

    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { householdCashFlows: Array<{ classification: string }>; cashFlowTotals: Record<string, { outflowMinor: number; expenseMinor: number; netMinor: number }> };
    expect(report.householdCashFlows).toEqual([expect.objectContaining({ classification: 'internal_transfer' })]);
    expect(report.cashFlowTotals).not.toHaveProperty('CAD');
  }, 30000);

  it('reports standalone and bank-linked investment income once, while excluding transfers', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('dividend-tx','bank-1','2026-11-02','Brokerage dividend',200,'CAD','Dividend','income','confirmed','manual','dividend-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES('linked-source','personal','manual','linked-source','dividend-tx','bank-1','dividend-manual','dividend-digest')").run();
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'standalone-dividend', sourceId: 'standalone-dividend', date: '2026-11-02', kind: 'dividend', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, 2)).status).toBe(201);
    expect((await post({ id: 'linked-dividend', sourceId: 'linked-dividend', date: '2026-11-02', kind: 'dividend', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 200 }, linkedBankSourceId: 'linked-source' }, 3)).status).toBe(201);
    expect((await post({ id: 'standalone-fee', sourceId: 'standalone-fee', date: '2026-11-02', kind: 'fee', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 30 } }, 4)).status).toBe(201);
    const reportResponse = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as { investmentCashFlows: Array<{ sourceId: string; transactionId?: string; eventKind?: string; bankKind?: string }>; investmentCashFlowTotals: Record<string, { inflowMinor: number; outflowMinor: number; netMinor: number; incomeMinor: number; expenseMinor: number; feeMinor: number }> };
    expect(report.investmentCashFlows.map((flow) => flow.sourceId)).toEqual(['linked-source', 'standalone-dividend', 'standalone-fee']);
    expect(report.investmentCashFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'linked-source', transactionId: 'dividend-tx', eventKind: 'dividend', bankKind: 'income' }),
      expect.objectContaining({ sourceId: 'standalone-dividend', eventKind: 'dividend', bankKind: 'income' }),
      expect.objectContaining({ sourceId: 'standalone-fee', eventKind: 'fee', bankKind: 'fee' }),
    ]));
    expect(report.investmentCashFlowTotals).toEqual({ CAD: { inflowMinor: 300, outflowMinor: 30, netMinor: 270, incomeMinor: 300, expenseMinor: 30, refundMinor: 0, feeMinor: 30 } });
  }, 30000);

  it('reports an embedded trade fee once as investment expense without treating the trade as a capital flow', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    const instrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' } as const;
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'trade-buy', sourceId: 'trade-buy', date: '2026-11-02', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: { currency: 'CAD', amountMinor: 500 }, fee: { currency: 'CAD', amountMinor: 25 } }, 2)).status).toBe(201);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { investmentCashFlows: Array<{ sourceId: string; eventKind?: string; bankKind?: string; includedInPerformance: boolean; money: { currency: string; amountMinor: number } }>; investmentCashFlowTotals: Record<string, { inflowMinor: number; outflowMinor: number; netMinor: number; incomeMinor: number; expenseMinor: number; refundMinor: number; feeMinor: number }>; cashFlowTotals: Record<string, unknown> };
    expect(report.investmentCashFlows).toEqual([expect.objectContaining({ sourceId: 'trade-buy:fee', eventKind: 'fee', bankKind: 'fee', includedInPerformance: false, money: { currency: 'CAD', amountMinor: 25 } })]);
    expect(report.investmentCashFlowTotals).toEqual({ CAD: { inflowMinor: 0, outflowMinor: 25, netMinor: -25, incomeMinor: 0, expenseMinor: 25, refundMinor: 0, feeMinor: 25 } });
    expect(report.cashFlowTotals).toEqual({});
  }, 30000);

  it('returns authoritative per-currency portfolio allocation rows only', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (path: string, body: unknown) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    const instrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' } as const;
    expect((await put('/api/wealth/accounts', { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'cash', sourceId: 'cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'position', sourceId: 'position', date: '2026-11-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 1000 } }, 2)).status).toBe(201);
    expect((await put('/api/wealth/valuations', { id: 'price', accountId: 'brokerage', instrument, asOf: '2026-11-02', priceMinor: 2000, source: 'manual', expectedRevision: 3 })).status).toBe(200);
    expect((await put('/api/wealth/accounts', { id: 'loan', name: 'Loan', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 4 })).status).toBe(200);
    expect((await put('/api/wealth/valuations', { id: 'loan-value', accountId: 'loan', asOf: '2026-11-02', priceMinor: 500, source: 'manual', expectedRevision: 5 })).status).toBe(200);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    const report = await response.json() as { allocations: Array<{ currency: string; accountId: string; kind: string; instrument: { ticker: string } | null; valueMinor: number | null; share: number | null; available: boolean }> };
    expect(report.allocations).toEqual([
      expect.objectContaining({ currency: 'CAD', accountId: 'brokerage', kind: 'cash', instrument: null, valueMinor: 1000, share: 1 / 3, available: true }),
      expect.objectContaining({ currency: 'CAD', accountId: 'brokerage', kind: 'holding', instrument: expect.objectContaining({ ticker: 'SHOP' }), valueMinor: 2000, share: 2 / 3, available: true }),
    ]);
    expect(report.allocations.some((row) => row.accountId === 'loan')).toBe(false);
  }, 30000);

  it('marks portfolio allocation shares unavailable when a dated price is missing', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    const instrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' } as const;
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'cash', sourceId: 'cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'position', sourceId: 'position', date: '2026-11-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 1000 } }, 2)).status).toBe(201);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    const report = await response.json() as { allocations: Array<{ share: number | null; available: boolean }> };
    expect(report.allocations).toEqual(expect.arrayContaining([
      expect.objectContaining({ share: null, available: false }),
    ]));
    expect(report.allocations.every((row) => row.share === null)).toBe(true);
  }, 30000);

  it('includes aggregate brokerage values in portfolio performance without counting household debt', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Aggregate brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await valuation({ id: 'brokerage-start', accountId: 'brokerage', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 1 })).status).toBe(200);
    expect((await valuation({ id: 'brokerage-end', accountId: 'brokerage', asOf: '2026-11-02', priceMinor: 1200, source: 'manual', expectedRevision: 2 })).status).toBe(200);
    expect((await put({ id: 'loan', name: 'Loan', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 3 })).status).toBe(200);
    expect((await valuation({ id: 'loan-start', accountId: 'loan', asOf: '2026-11-01', priceMinor: 500, source: 'manual', expectedRevision: 4 })).status).toBe(200);
    expect((await valuation({ id: 'loan-end', accountId: 'loan', asOf: '2026-11-02', priceMinor: 700, source: 'manual', expectedRevision: 5 })).status).toBe(200);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02&asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ modifiedDietz: { available: true, value: 0.2 }, investmentCashFlows: [], allocations: [expect.objectContaining({ accountId: 'brokerage', kind: 'aggregate', valueMinor: 1200, share: 1 })] });
  }, 30000);

  it('reports mixed aggregate and holdings brokerage accounts without treating aggregate values as instruments', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const event = (body: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: body, expectedRevision }) }), env as never);
    const valuation = (body: Record<string, unknown>, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify({ ...body, expectedRevision }) }), env as never);
    const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' } as const;
    expect((await put({ id: 'holdings', name: 'Holdings', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'aggregate', name: 'Aggregate', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await event({ id: 'cash', sourceId: 'cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'holdings', money: { currency: 'CAD', amountMinor: 1000 } }, 2)).status).toBe(201);
    expect((await event({ id: 'position', sourceId: 'position', date: '2026-11-01', kind: 'opening_position', accountId: 'holdings', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 1000 } }, 3)).status).toBe(201);
    expect((await valuation({ id: 'holding-value', accountId: 'holdings', instrument, asOf: '2026-11-02', priceMinor: 1100, source: 'manual' }, 4)).status).toBe(200);
    expect((await valuation({ id: 'aggregate-value', accountId: 'aggregate', asOf: '2026-11-02', priceMinor: 2000, source: 'manual' }, 5)).status).toBe(200);

    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-02&asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allocations: expect.arrayContaining([
      expect.objectContaining({ accountId: 'aggregate', kind: 'aggregate', valueMinor: 2000 }),
      expect.objectContaining({ accountId: 'holdings', kind: 'holding', valueMinor: 1100 }),
    ]) });
  }, 30000);

  it('deduplicates same-date valuations and supports revision-guarded manual correction', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const account = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'home', name: 'Home', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 }) }), env as never);
    expect(account.status).toBe(200);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const first = await valuation({ id: 'home-value-1', accountId: 'home', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 1 });
    expect(first.status).toBe(200);
    const retryWithNewId = await valuation({ id: 'home-value-retry', accountId: 'home', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 2 });
    expect(retryWithNewId.status).toBe(200);
    expect(await retryWithNewId.json()).toMatchObject({ valuation: { priceMinor: 1000 }, revision: 2 });
    const correction = await valuation({ id: 'home-value-2', accountId: 'home', asOf: '2026-11-01', priceMinor: 1200, source: 'manual', expectedRevision: 2 });
    expect(correction.status).toBe(200);
    expect(await correction.json()).toMatchObject({ valuation: { id: 'home-value-2', priceMinor: 1200 }, revision: 3 });
    const stale = await valuation({ id: 'home-value-3', accountId: 'home', asOf: '2026-11-01', priceMinor: 1300, source: 'manual', expectedRevision: 2 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'revision_conflict', currentRevision: 3 });
    const history = await worker.fetch(new Request('https://pf.example.com/api/wealth/valuations?accountId=home', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await history.json()).toMatchObject({ valuations: [expect.objectContaining({ id: 'home-value-2', priceMinor: 1200 })] });
  }, 30000);

  it('atomically records an aggregate account opening value when its effective date is supplied', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'home', name: 'Home', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', amountMinor: 1000, asOf: '2026-11-01', expectedRevision: 0 }) }), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ initialValuation: { accountId: 'home', asOf: '2026-11-01', priceMinor: 1000 } });
    const valuations = await worker.fetch(new Request('https://pf.example.com/api/wealth/valuations?accountId=home', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await valuations.json()).toMatchObject({ valuations: [expect.objectContaining({ accountId: 'home', asOf: '2026-11-01', priceMinor: 1000 })] });
    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-01', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await snapshot.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, accounts: [expect.objectContaining({ id: 'home', valueState: 'fresh', valueObservedAt: '2026-11-01' })] });
  }, 30000);

  it('rejects valuation and portfolio events that do not match account mode', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const event = (body: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: body, expectedRevision }) }), env as never);
    expect((await put({ id: 'aggregate', name: 'Aggregate', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'holdings', name: 'Holdings', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await valuation({ id: 'aggregate-instrument', accountId: 'aggregate', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, asOf: '2026-11-01', priceMinor: 100, source: 'manual', expectedRevision: 2 })).status).toBe(400);
    expect((await valuation({ id: 'holdings-account', accountId: 'holdings', asOf: '2026-11-01', priceMinor: 100, source: 'manual', expectedRevision: 2 })).status).toBe(400);
    const contribution = await event({ id: 'aggregate-contribution', sourceId: 'aggregate-contribution', date: '2026-11-01', kind: 'contribution', accountId: 'aggregate', money: { currency: 'CAD', amountMinor: 100 } }, 2);
    expect(contribution.status).toBe(400);
    expect(await contribution.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('rejects holdings representation for non-brokerage wealth accounts', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const asset = await put({ id: 'asset', name: 'Asset', kind: 'manual_asset', mode: 'holdings', currency: 'CAD', expectedRevision: 0 });
    expect(asset.status).toBe(400);
    expect(await asset.json()).toMatchObject({ code: 'account_mode_conflict' });
    const debt = await put({ id: 'debt', name: 'Debt', kind: 'debt', mode: 'holdings', currency: 'CAD', expectedRevision: 0 });
    expect(debt.status).toBe(400);
    expect(await debt.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('requires an explicit dated zero opening when changing an empty account representation', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    const missingOpening = await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 1 });
    expect(missingOpening.status).toBe(400);
    expect(await missingOpening.json()).toMatchObject({ code: 'invalid_request' });
    const zeroOpening = await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-11-01', openingCashMinor: 0, expectedRevision: 1 });
    expect(zeroOpening.status).toBe(200);
  }, 30000);

  it('rejects invalid or duplicate priced opening positions before persistence', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    const position = (quantity: string, id: string, priceMinor = 1000) => ({ id, sourceId: id, instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity, priceMinor });
    const zero = await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-11-01', openingPositions: [position('0', 'zero')], expectedRevision: 1 });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toMatchObject({ code: 'invalid_quantity' });
    const decimal = await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-11-01', openingPositions: [position('1.0000000000000000001', 'decimal')], expectedRevision: 1 });
    expect(decimal.status).toBe(400);
    expect(await decimal.json()).toMatchObject({ code: 'invalid_quantity' });
    const duplicatePrices = await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-11-01', openingPositions: [position('1', 'lot-a'), position('2', 'lot-b', 1100)], expectedRevision: 1 });
    expect(duplicatePrices.status).toBe(400);
    expect(await duplicatePrices.json()).toMatchObject({ code: 'invalid_request' });
  }, 30000);

  it('rejects opening cash events for aggregate accounts', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'asset', name: 'Asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', amountMinor: 1000, asOf: '2026-11-01', expectedRevision: 0 })).status).toBe(200);
    const openingCash = await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-02', kind: 'opening_cash', accountId: 'asset', money: { currency: 'CAD', amountMinor: 100 } }, 1);
    expect(openingCash.status).toBe(409);
    expect(await openingCash.json()).toMatchObject({ code: 'account_mode_conflict' });
    expect((await put({ id: 'cash-only', name: 'Cash only', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    const cashOnlyOpening = await post({ id: 'cash-only-opening', sourceId: 'cash-only-opening', date: '2026-11-02', kind: 'opening_cash', accountId: 'cash-only', money: { currency: 'CAD', amountMinor: 100 } }, 2);
    expect(cashOnlyOpening.status).toBe(409);
    expect(await cashOnlyOpening.json()).toMatchObject({ code: 'account_mode_conflict' });
    expect((await put({ id: 'debt', name: 'Debt', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 2 })).status).toBe(200);
    const debtOpeningCash = await post({ id: 'debt-opening', sourceId: 'debt-opening', date: '2026-11-02', kind: 'opening_cash', accountId: 'debt', money: { currency: 'CAD', amountMinor: 100 } }, 3);
    expect(debtOpeningCash.status).toBe(409);
    expect(await debtOpeningCash.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('rejects debt opening cash inside a correction replacement as well', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'debt', name: 'Debt', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await post({ id: 'opening', sourceId: 'opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, 2)).status).toBe(201);
    const correction = await post({ id: 'debt-correction', sourceId: 'debt-correction', date: '2026-11-02', kind: 'correction', targetSourceId: 'opening', replacement: { kind: 'opening_cash', date: '2026-11-01', accountId: 'debt', money: { currency: 'CAD', amountMinor: 100 } } }, 3);
    expect(correction.status).toBe(409);
    expect(await correction.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('rejects changing the representation mode after dated history exists', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    const event = await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: { id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, expectedRevision: 1 }) }), env as never);
    expect(event.status).toBe(201);
    const changed = await put({ id: 'brokerage', name: 'Aggregate now', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 2 });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('atomically transitions an aggregate brokerage to holdings at an effective date', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await valuation({ id: 'aggregate-start', accountId: 'brokerage', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 1 })).status).toBe(200);

    const transition = await put({
      id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD',
      effectiveDate: '2026-11-02', openingCashMinor: 1000, expectedRevision: 2, operationId: 'aggregate-to-holdings',
    });
    expect(transition.status).toBe(200);
    expect(await transition.json()).toMatchObject({ transition: { fromMode: 'aggregate', toMode: 'holdings', effectiveDate: '2026-11-02' }, revision: 3 });
    const retry = await put({
      id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD',
      effectiveDate: '2026-11-02', openingCashMinor: 1000, expectedRevision: 2, operationId: 'aggregate-to-holdings',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ transition: { fromMode: 'aggregate', toMode: 'holdings', effectiveDate: '2026-11-02' }, revision: 3 });

    const before = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-01', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await before.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, accounts: [expect.objectContaining({ id: 'brokerage', mode: 'aggregate' })] });
    const after = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await after.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, accounts: [expect.objectContaining({ id: 'brokerage', mode: 'holdings' })], cash: [expect.objectContaining({ accountId: 'brokerage', amountMinor: 1000 })] });
    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await report.json()).toMatchObject({ history: [{ date: '2026-11-01', totals: { CAD: 1000 } }, { date: '2026-11-02', totals: { CAD: 1000 } }] });
  }, 30000);

  it('atomically transitions holdings back to an aggregate value without hiding prior history', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const event = (body: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: body, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await event({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);

    const transition = await put({
      id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD',
      effectiveDate: '2026-11-02', amountMinor: 1200, expectedRevision: 2,
    });
    expect(transition.status).toBe(200);
    expect(await transition.json()).toMatchObject({ transition: { fromMode: 'holdings', toMode: 'aggregate', effectiveDate: '2026-11-02' }, revision: 3 });

    const before = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-01', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await before.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, accounts: [expect.objectContaining({ id: 'brokerage', mode: 'holdings' })], cash: [expect.objectContaining({ accountId: 'brokerage', amountMinor: 1000 })] });
    const after = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await after.json()).toMatchObject({ totalByCurrency: { CAD: 1200 }, accounts: [expect.objectContaining({ id: 'brokerage', mode: 'aggregate', valueMinor: 1200 })], cash: [] });
  }, 30000);

  it('validates a new holdings event against only its effective mode segment', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'old-opening', sourceId: 'old-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 10000 } }, 1)).status).toBe(201);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-11-02', openingValueMinor: 10000, expectedRevision: 2 })).status).toBe(200);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-11-03', openingCashMinor: 1000, expectedRevision: 3 })).status).toBe(200);

    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-03', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await snapshot.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, cash: [{ accountId: 'brokerage', amountMinor: 1000 }] });
    const oversizedBuy = await post({ id: 'oversized-buy', sourceId: 'oversized-buy', date: '2026-11-04', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '1', consideration: { currency: 'CAD', amountMinor: 5000 }, fee: null }, 4);
    expect(oversizedBuy.status).toBe(400);
    expect(await oversizedBuy.json()).toMatchObject({ code: 'negative_cash' });
  }, 30000);

  it('keeps external flows from earlier representation segments in Modified Dietz', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }, 1)).status).toBe(201);
    expect((await post({ id: 'contribution', sourceId: 'contribution', date: '2026-11-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, 2)).status).toBe(201);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-11-03', amountMinor: 1100, expectedRevision: 3 })).status).toBe(200);
    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-03&asOf=2026-11-03', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ modifiedDietz: { available: true, value: 0 }, modifiedDietzByCurrency: { CAD: { available: true, value: 0 } } });
  }, 30000);

  it('validates correction transfer modes using the replacement date', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'from', name: 'From', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await put({ id: 'to', name: 'To', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    expect((await post({ id: 'from-opening', sourceId: 'from-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'from', money: { currency: 'CAD', amountMinor: 1000 } }, 2)).status).toBe(201);
    expect((await post({ id: 'to-opening', sourceId: 'to-opening', date: '2026-11-01', kind: 'opening_cash', accountId: 'to', money: { currency: 'CAD', amountMinor: 0 } }, 3)).status).toBe(201);
    const transfer = { id: 'transfer', sourceId: 'transfer', date: '2026-11-02', kind: 'transfer', transferKind: 'cash', fromAccountId: 'from', toAccountId: 'to', money: { currency: 'CAD', amountMinor: 100 } };
    expect((await post(transfer, 4)).status).toBe(201);
    expect((await put({ id: 'from', name: 'From', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-11-05', amountMinor: 900, expectedRevision: 5 })).status).toBe(200);
    const correction = await post({ id: 'transfer-correction', sourceId: 'transfer-correction', date: '2026-11-10', kind: 'correction', targetSourceId: 'transfer', replacement: { kind: 'transfer', transferKind: 'cash', date: '2026-11-02', fromAccountId: 'from', toAccountId: 'to', money: { currency: 'CAD', amountMinor: 100 } } }, 6);
    expect(correction.status).toBe(201);
  }, 30000);

  it('rejects changing the account kind after dated history exists', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'asset', name: 'Asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await valuation({ id: 'asset-value', accountId: 'asset', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 1 })).status).toBe(200);
    const changed = await put({ id: 'asset', name: 'Asset now debt', kind: 'debt', mode: 'aggregate', currency: 'CAD', expectedRevision: 2 });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'account_mode_conflict' });
  }, 30000);

  it('rejects changing the account currency after dated history exists and preserves the original currency', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const valuation = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/valuations', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put({ id: 'asset', name: 'Asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await valuation({ id: 'asset-value', accountId: 'asset', asOf: '2026-11-01', priceMinor: 1000, source: 'manual', expectedRevision: 1 })).status).toBe(200);
    const changed = await put({ id: 'asset', name: 'Asset in USD', kind: 'manual_asset', mode: 'aggregate', currency: 'USD', expectedRevision: 2 });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'account_mode_conflict' });
    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-11-01', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await snapshot.json()).toMatchObject({ totalByCurrency: { CAD: 1000 }, accounts: [expect.objectContaining({ id: 'asset', currency: 'CAD', valueMinor: 1000 })] });
  }, 30000);

  it('returns conflicts for duplicate linked bank and canonical instrument identities', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    const put = (path: string, body: unknown) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    expect((await put('/api/wealth/accounts', { id: 'linked-one', name: 'Linked one', kind: 'linked_bank', mode: 'aggregate', currency: 'CAD', linkedBankAccountId: 'bank-1', expectedRevision: 0 })).status).toBe(200);
    const duplicateAccount = await put('/api/wealth/accounts', { id: 'linked-two', name: 'Linked two', kind: 'linked_bank', mode: 'aggregate', currency: 'CAD', linkedBankAccountId: 'bank-1', expectedRevision: 1 });
    expect(duplicateAccount.status).toBe(409);
    expect(await duplicateAccount.json()).toMatchObject({ code: 'linked_bank_conflict' });
    expect((await put('/api/wealth/instruments', { id: 'shop-one', exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD', expectedRevision: 1 })).status).toBe(200);
    const duplicateInstrument = await put('/api/wealth/instruments', { id: 'shop-two', exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD', expectedRevision: 2 });
    expect(duplicateInstrument.status).toBe(409);
    expect(await duplicateInstrument.json()).toMatchObject({ code: 'instrument_conflict' });
  }, 30000);

  it('rejects a bank source reused through a correction replacement link', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'opening-cash', sourceId: 'opening-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, 1)).status).toBe(201);
    expect((await post({ id: 'original', sourceId: 'original', date: '2026-11-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50 } }, 2)).status).toBe(201);
    expect((await post({ id: 'correction', sourceId: 'correction', date: '2026-11-02', kind: 'correction', targetSourceId: 'original', replacement: { kind: 'withdrawal', date: '2026-11-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50 }, linkedBankSourceId: 'bank-source' } }, 3)).status).toBe(201);
    const conflict = await post({ id: 'second', sourceId: 'second', date: '2026-11-03', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50 }, linkedBankSourceId: 'bank-source' }, 4);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'bank_link_conflict' });
  }, 30000);

  it('rejects transfers between aggregate and holdings accounts', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = (id: string, kind: string, mode: string, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', {
      method: 'PUT', headers,
      body: JSON.stringify({ id, name: id, kind, mode, currency: 'CAD', expectedRevision }),
    }), env as never);
    expect((await put('cash', 'manual_asset', 'aggregate', 0)).status).toBe(200);
    expect((await put('brokerage', 'brokerage', 'holdings', 1)).status).toBe(200);
    const transfer = await worker.fetch(new Request('https://pf.example.com/api/wealth/events', {
      method: 'POST', headers,
      body: JSON.stringify({ event: { id: 'mixed-transfer', sourceId: 'mixed-transfer', date: '2026-01-01', kind: 'transfer', transferKind: 'cash', fromAccountId: 'cash', toAccountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, expectedRevision: 2 }),
    }), env as never);
    expect(transfer.status).toBe(400);
    expect(await transfer.json()).toMatchObject({ code: 'mixed_account_mode' });
  }, 30000);

  it('includes reversal controls in portfolio history and removes the reversed position', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }) }), env as never)).status).toBe(200);
    const opening = { id: 'opening-position', sourceId: 'opening-position', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '1', basis: { currency: 'CAD', amountMinor: 10000 } };
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: opening, expectedRevision: 1 }) }), env as never)).status).toBe(201);
    const reversal = { id: 'reverse-opening', sourceId: 'reverse-opening', date: '2026-01-01', kind: 'reversal', targetSourceId: 'opening-position' };
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: reversal, expectedRevision: 2 }) }), env as never)).status).toBe(201);
    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-01-01', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await snapshot.json()).toMatchObject({ positions: [] });
  }, 30000);

  it('returns CSV through the JSON transport wrapper', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const response = await worker.fetch(new Request('https://pf.example.com/api/wealth/export?format=json', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ csv: expect.stringContaining('record_type') });
  }, 30000);

  it('rejects a second wealth event claiming any alias of the same bank transaction', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx-1','bank-1','2026-01-01','Deposit',100,'CAD','Income','income','confirmed','manual','tx-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES('source-1','personal','manual','bank-identity','tx-1','bank-1','manual-1','digest')").run();
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }) }), env as never)).status).toBe(200);
    const event = (sourceId: string, id: string, linkedBankSourceId: string) => ({ id, sourceId, date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId });
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: event('contribution-1', 'contribution-1', 'source-1'), expectedRevision: 1 }) }), env as never)).status).toBe(201);
    const duplicate = await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event: event('contribution-2', 'contribution-2', 'bank-identity'), expectedRevision: 2 }) }), env as never);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'bank_link_conflict' });
  }, 30000);

  it('allows a correction to retain its target bank link without creating a second claim', async () => {
    const f = await fixture();
    const env = webEnv({ DB: f.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx-1','bank-1','2026-01-01','Deposit',100,'CAD','Income','income','confirmed','manual','tx-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES('source-1','personal','manual','bank-identity','tx-1','bank-1','manual-1','digest')").run();
    const put = (body: unknown) => worker.fetch(new Request('https://pf.example.com/api/wealth/accounts', { method: 'PUT', headers, body: JSON.stringify(body) }), env as never);
    const post = (event: unknown, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), env as never);
    expect((await put({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 })).status).toBe(200);
    expect((await post({ id: 'contribution-1', sourceId: 'contribution-1', date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId: 'source-1' }, 1)).status).toBe(201);
    const correction = await post({ id: 'correction-1', sourceId: 'correction-1', date: '2026-01-02', kind: 'correction', targetSourceId: 'contribution-1', replacement: { kind: 'contribution', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId: 'source-1' } }, 2);
    expect(correction.status).toBe(201);
    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-01-01&to=2026-01-02', { headers: VERIFIED_WEB_HEADERS }), env as never);
    expect(await report.json()).toMatchObject({ investmentCashFlows: [expect.objectContaining({ transactionId: 'tx-1', classification: 'external_contribution' })] });
  }, 30000);
});

describe('wealth native API', () => {
  it('requires explicit wealth scopes and rechecks the owner session on write', async () => {
    const f = await fixture();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
    const environmentHash = await hashSecret('sandbox');
    await f.db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash,created_at)
      VALUES('family','personal','subject',1,1,?,?,?, ?,?)`)
      .bind(expiresAt, expiresAt, JSON.stringify(['ledger:read']), environmentHash, now.toISOString()).run();
    const config = {
      canonicalOrigin: 'https://pf.example.com',
      callbackUrl: 'https://pf.example.com/android/auth/callback',
      environment: 'sandbox',
      accessAuthorizationUrl: 'https://pf.example.com/mobile/authorize',
      sessionEncryptionKey: 'synthetic-mobile-key',
    };
    const credential = await createOpaqueCredential({ kind: 'owner-access', familyId: 'family', generation: 1, expiresAt, environmentHash }, config);
    const env = {
      DB: f.db,
      LEDGER_APP_ORIGIN: config.canonicalOrigin,
      MOBILE_ENVIRONMENT: config.environment,
      MOBILE_ACCESS_AUTHORIZATION_URL: config.accessAuthorizationUrl,
      MOBILE_SESSION_ENCRYPTION_KEY: config.sessionEncryptionKey,
    };
    const response = await worker.fetch(new Request('https://pf.example.com/api/mobile/owner/wealth/accounts', {
      method: 'PUT',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'home', name: 'Home', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', expectedRevision: 0 }),
    }), env as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  }, 30000);

  it('allows a write-scoped owner session to append events without a read scope', async () => {
    const f = await fixture();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
    const environmentHash = await hashSecret('sandbox');
    await f.db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash,created_at)
      VALUES('write-family','personal','subject',1,1,?,?,?, ?,?)`)
      .bind(expiresAt, expiresAt, JSON.stringify(['wealth:write']), environmentHash, now.toISOString()).run();
    const config = {
      canonicalOrigin: 'https://pf.example.com',
      callbackUrl: 'https://pf.example.com/android/auth/callback',
      environment: 'sandbox',
      accessAuthorizationUrl: 'https://pf.example.com/mobile/authorize',
      sessionEncryptionKey: 'synthetic-mobile-key',
    };
    const credential = await createOpaqueCredential({ kind: 'owner-access', familyId: 'write-family', generation: 1, expiresAt, environmentHash }, config);
    const env = {
      DB: f.db,
      LEDGER_APP_ORIGIN: config.canonicalOrigin,
      MOBILE_ENVIRONMENT: config.environment,
      MOBILE_ACCESS_AUTHORIZATION_URL: config.accessAuthorizationUrl,
      MOBILE_SESSION_ENCRYPTION_KEY: config.sessionEncryptionKey,
    };
    const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
    const account = await worker.fetch(new Request('https://pf.example.com/api/mobile/owner/wealth/accounts', {
      method: 'PUT', headers,
      body: JSON.stringify({ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', expectedRevision: 0 }),
    }), env as never);
    expect(account.status).toBe(200);
    const event = await worker.fetch(new Request('https://pf.example.com/api/mobile/owner/wealth/events', {
      method: 'POST', headers,
      body: JSON.stringify({ event: { id: 'opening-cash', sourceId: 'opening-cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } }, expectedRevision: 1 }),
    }), env as never);
    expect(event.status).toBe(201);
  }, 30000);
});

describe('wealth canonical CSV API', () => {
  it('round-trips accounts, instruments, dated values, and events atomically', async () => {
    const source = await fixture();
    const target = await fixture();
    const sourceEnv = webEnv({ DB: source.db } as never);
    const targetEnv = webEnv({ DB: target.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = async (env: unknown, path: string, body: unknown, expectedRevision: number) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers, body: JSON.stringify({ ...(body as Record<string, unknown>), expectedRevision }) }), env as never);
    expect((await put(sourceEnv, '/api/wealth/accounts', { id: 'brokerage', name: 'Quoted, "Name"\nSecond', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }, 0)).status).toBe(200);
    expect((await put(sourceEnv, '/api/wealth/instruments', { id: 'shop', exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, 1)).status).toBe(200);
    const event = { id: 'opening-1', sourceId: 'opening-source-1', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2', basis: { currency: 'CAD', amountMinor: 10000 }, memo: 'Quoted, "note"\nline' };
    expect((await worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision: 2 }) }), sourceEnv as never)).status).toBe(201);
    expect((await put(sourceEnv, '/api/wealth/valuations', { id: 'shop-value-1', accountId: 'brokerage', instrument: event.instrument, asOf: '2026-01-01', priceMinor: 6000, source: 'manual' }, 3)).status).toBe(200);

    const exported = await worker.fetch(new Request('https://pf.example.com/api/wealth/export', { headers: VERIFIED_WEB_HEADERS }), sourceEnv as never);
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    expect(csv).toContain('record_type');
    expect(csv).toContain('Quoted, ""Name""');
    expect(csv).toContain('opening-source-1');

    const previewResponse = await worker.fetch(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', headers, body: JSON.stringify({ csv, operationId: 'roundtrip-preview' }) }), targetEnv as never);
    expect(previewResponse.status).toBe(201);
    const preview = await previewResponse.json() as { previewId: string; rows: Array<{ error: string | null; duplicateOf: string | null }>; errors: unknown[] };
    expect(preview.errors).toEqual([]);
    expect(preview.rows.every((row) => !row.error && !row.duplicateOf)).toBe(true);

    const commitResponse = await worker.fetch(new Request(`https://pf.example.com/api/wealth/imports/${preview.previewId}/commit`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 0, operationId: 'roundtrip-commit' }) }), targetEnv as never);
    expect(commitResponse.status).toBe(200);
    expect(await commitResponse.json()).toMatchObject({ committed: 4, revision: 1 });
    const snapshot = await worker.fetch(new Request('https://pf.example.com/api/wealth/snapshot?asOf=2026-01-01', { headers: VERIFIED_WEB_HEADERS }), targetEnv as never);
    expect(await snapshot.json()).toMatchObject({ accounts: [{ id: 'brokerage', name: 'Quoted, "Name"\nSecond' }], positions: [{ accountId: 'brokerage', marketValueMinor: 12000 }] });

    const duplicatePreviewResponse = await worker.fetch(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', headers: { ...headers, 'idempotency-key': 'roundtrip-repeat' }, body: JSON.stringify({ csv }) }), targetEnv as never);
    const duplicatePreview = await duplicatePreviewResponse.json() as { previewId: string; duplicates: unknown[]; errors: unknown[] };
    expect(duplicatePreviewResponse.status).toBe(201);
    expect(duplicatePreview.errors).toEqual([]);
    expect(duplicatePreview.duplicates).toHaveLength(4);
    const staleCommit = await worker.fetch(new Request(`https://pf.example.com/api/wealth/imports/${duplicatePreview.previewId}/commit`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 0 }) }), targetEnv as never);
    expect(staleCommit.status).toBe(409);
  }, 30000);

  it('round-trips a mixed portfolio with zero aggregate brokerage and manual asset/debt observations', async () => {
    const source = await fixture();
    const target = await fixture();
    const sourceEnv = webEnv({ DB: source.db } as never);
    const targetEnv = webEnv({ DB: target.db } as never);
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const put = async (path: string, body: Record<string, unknown>, expectedRevision: number) => worker.fetch(new Request(`https://pf.example.com${path}`, { method: 'PUT', headers, body: JSON.stringify({ ...body, expectedRevision }) }), sourceEnv as never);
    const post = async (event: Record<string, unknown>, expectedRevision: number) => worker.fetch(new Request('https://pf.example.com/api/wealth/events', { method: 'POST', headers, body: JSON.stringify({ event, expectedRevision }) }), sourceEnv as never);
    const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' } as const;
    const usdInstrument = { exchange: 'NYSEARCA', ticker: 'VTI', type: 'etf', currency: 'USD' } as const;
    expect((await put('/api/wealth/accounts', { id: 'cad', name: 'CAD portfolio', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }, 0)).status).toBe(200);
    expect((await put('/api/wealth/accounts', { id: 'usd', name: 'USD portfolio', kind: 'brokerage', mode: 'holdings', currency: 'USD' }, 1)).status).toBe(200);
    expect((await put('/api/wealth/accounts', { id: 'zero', name: 'Zero brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', amountMinor: 0, asOf: '2026-11-01' }, 2)).status).toBe(200);
    expect((await put('/api/wealth/accounts', { id: 'asset', name: 'Reserve', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD' }, 3)).status).toBe(200);
    expect((await put('/api/wealth/accounts', { id: 'debt', name: 'Credit', kind: 'debt', mode: 'aggregate', currency: 'CAD' }, 4)).status).toBe(200);
    expect((await put('/api/wealth/instruments', { id: 'ry', ...instrument }, 5)).status).toBe(200);
    expect((await put('/api/wealth/instruments', { id: 'vti', ...usdInstrument }, 6)).status).toBe(200);
    expect((await post({ id: 'cad-cash', sourceId: 'cad-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'cad', money: { currency: 'CAD', amountMinor: 100000 } }, 7)).status).toBe(201);
    expect((await post({ id: 'cad-position', sourceId: 'cad-position', date: '2026-11-01', kind: 'opening_position', accountId: 'cad', instrument, quantity: '4', basis: { currency: 'CAD', amountMinor: 40000 } }, 8)).status).toBe(201);
    expect((await post({ id: 'usd-cash', sourceId: 'usd-cash', date: '2026-11-01', kind: 'opening_cash', accountId: 'usd', money: { currency: 'USD', amountMinor: 50000 } }, 9)).status).toBe(201);
    expect((await post({ id: 'usd-position', sourceId: 'usd-position', date: '2026-11-01', kind: 'opening_position', accountId: 'usd', instrument: usdInstrument, quantity: '2', basis: { currency: 'USD', amountMinor: 40000 } }, 10)).status).toBe(201);
    expect((await put('/api/wealth/valuations', { id: 'cad-price', accountId: 'cad', instrument, asOf: '2026-11-01', priceMinor: 10000, source: 'manual' }, 11)).status).toBe(200);
    expect((await put('/api/wealth/valuations', { id: 'usd-price', accountId: 'usd', instrument: usdInstrument, asOf: '2026-11-01', priceMinor: 20000, source: 'manual' }, 12)).status).toBe(200);
    expect((await put('/api/wealth/valuations', { id: 'asset-value', accountId: 'asset', asOf: '2026-11-02', priceMinor: 150000, source: 'manual' }, 13)).status).toBe(200);
    expect((await put('/api/wealth/valuations', { id: 'debt-value', accountId: 'debt', asOf: '2026-11-03', priceMinor: 30000, source: 'manual' }, 14)).status).toBe(200);

    const exported = await worker.fetch(new Request('https://pf.example.com/api/wealth/export', { headers: VERIFIED_WEB_HEADERS }), sourceEnv as never);
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    const previewResponse = await worker.fetch(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', headers, body: JSON.stringify({ csv, operationId: 'mixed-preview' }) }), targetEnv as never);
    expect(previewResponse.status).toBe(201);
    const preview = await previewResponse.json() as { previewId: string; errors: unknown[]; rows: Array<{ error: string | null; duplicateOf: string | null }> };
    expect(preview.errors).toEqual([]);
    expect(preview.rows.every((row) => !row.error && !row.duplicateOf)).toBe(true);
    const commit = await worker.fetch(new Request(`https://pf.example.com/api/wealth/imports/${preview.previewId}/commit`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 0, operationId: 'mixed-commit' }) }), targetEnv as never);
    expect(commit.status).toBe(200);

    const report = await worker.fetch(new Request('https://pf.example.com/api/wealth/report?from=2026-11-01&to=2026-11-03&asOf=2026-11-03', { headers: VERIFIED_WEB_HEADERS }), targetEnv as never);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ totalByCurrency: { CAD: 260000, USD: 90000 } });
  }, 30000);
});
