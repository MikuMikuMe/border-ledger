import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database } from '../worker/db-types';

const ORIGIN = 'https://pf.example.com';
const ENVIRONMENT = 'sandbox';
const SESSION_KEY = 'task3-fx-route-session-key';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const fixtures: Array<{ close(): void }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) fixtures.pop()!.close();
});

function fixture() {
  const value = createSqliteD1Fixture();
  fixtures.push(value);
  return value;
}

function env(db: D1Database) {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    LEDGER_API_KEY: 'route-key',
    LEDGER_APP_ORIGIN: ORIGIN,
    MOBILE_ENVIRONMENT: ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
    MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
    now: () => NOW,
  };
}

async function ownerCredential(db: D1Database, scopes: readonly string[] = ['ledger:read'], familyId = 'task3-route-family') {
  const expiresAt = '2026-10-14T13:00:00.000Z';
  const environmentHash = await hashSecret(ENVIRONMENT);
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`).bind(
    familyId,
    'task3-route-owner',
    expiresAt,
    expiresAt,
    JSON.stringify(scopes),
    environmentHash,
    NOW.toISOString(),
  ).run();
  return createOpaqueCredential({
    kind: 'owner-access', familyId, generation: 1, expiresAt, environmentHash,
  }, {
    canonicalOrigin: ORIGIN,
    callbackUrl: `${ORIGIN}/android/auth/callback`,
    environment: ENVIRONMENT,
    accessAuthorizationUrl: 'https://access.example.com/authorize',
    sessionEncryptionKey: SESSION_KEY,
    now: () => NOW,
  });
}

describe('FX report route contracts', () => {
  it('accepts a bounded registered browser reporting target and preserves source-only omission', async () => {
    const { db } = fixture();
    const runtime = env(db);
    const request = (query: string) => new Request(`${ORIGIN}/api/reports/summary${query}`, {
      headers: { authorization: 'Bearer route-key', origin: ORIGIN },
    });

    const selected = await worker.fetch(request('?reportingCurrency=CAD'), runtime as never);
    expect(selected.status).toBe(200);
    await expect(selected.json()).resolves.toMatchObject({
      reportingCurrency: 'CAD',
      convertedTotals: { confirmedMinorUnits: 0, provisionalMinorUnits: 0, confirmedCount: 0, provisionalCount: 0 },
      convertedDailyTotals: [],
      fx: { provider: 'frankfurter', complete: true, unavailableSourceCurrencies: [], lockedDateCount: 0 },
    });

    const omitted = await worker.fetch(request(''), runtime as never);
    await expect(omitted.json()).resolves.toMatchObject({ reportingCurrency: null, convertedTotals: null, convertedDailyTotals: [] });

    const invalid = await worker.fetch(request('?reportingCurrency=https%3A%2F%2Fevil.example%2Frates'), runtime as never);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'The reporting currency is not valid.' });
  });

  it('validates the owner/mobile target and returns additive fields in the wrapper and nested report', async () => {
    const { db } = fixture();
    const credential = await ownerCredential(db);
    const runtime = env(db);
    const request = (reportingCurrency: string) => new Request(
      `${ORIGIN}/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&reportingCurrency=${encodeURIComponent(reportingCurrency)}`,
      { headers: { authorization: `Bearer ${credential}` } },
    );

    const response = await worker.fetch(request('CAD'), runtime as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reportingCurrency: 'CAD',
      convertedTotals: { confirmedMinorUnits: 0, provisionalMinorUnits: 0, confirmedCount: 0, provisionalCount: 0 },
      convertedDailyTotals: [],
      fx: { provider: 'frankfurter', complete: true },
      report: {
        reportingCurrency: 'CAD',
        convertedTotals: { confirmedMinorUnits: 0, provisionalMinorUnits: 0, confirmedCount: 0, provisionalCount: 0 },
        convertedDailyTotals: [],
        fx: { provider: 'frankfurter', complete: true },
      },
    });

    const invalid = await worker.fetch(request('ZZZ'), runtime as never);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'invalid_request', message: 'The reporting currency is not valid.', retryable: false });
  });

  it('keeps browser and mobile authorization/origin guards ahead of report/provider access', async () => {
    const { db } = fixture();
    const runtime = env(db);
    const provider = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider must not be reached'));

    const browserMissing = await worker.fetch(new Request(`${ORIGIN}/api/reports/summary?reportingCurrency=CAD`), runtime as never);
    expect(browserMissing.status).toBe(401);

    const browserDisallowed = await worker.fetch(new Request('https://border-ledger.workers.dev/api/reports/summary?reportingCurrency=CAD', {
      headers: { authorization: 'Bearer route-key' },
    }), runtime as never);
    expect(browserDisallowed.status).toBe(404);

    const mobileMissing = await worker.fetch(new Request(`${ORIGIN}/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&reportingCurrency=CAD`), runtime as never);
    expect(mobileMissing.status).toBe(401);

    const mobileInvalid = await worker.fetch(new Request(`${ORIGIN}/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&reportingCurrency=CAD`, {
      headers: { authorization: 'Bearer invalid-owner-credential' },
    }), runtime as never);
    expect(mobileInvalid.status).toBe(401);

    const insufficient = await ownerCredential(db, [], 'task3-insufficient-scope');
    const mobileInsufficient = await worker.fetch(new Request(`${ORIGIN}/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&reportingCurrency=CAD`, {
      headers: { authorization: `Bearer ${insufficient}` },
    }), runtime as never);
    expect(mobileInsufficient.status).toBe(403);

    const mobileDisallowed = await worker.fetch(new Request(`https://border-ledger.workers.dev/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&reportingCurrency=CAD`, {
      headers: { authorization: `Bearer ${insufficient}` },
    }), runtime as never);
    expect(mobileDisallowed.status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
});
