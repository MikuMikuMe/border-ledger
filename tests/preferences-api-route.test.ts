import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { applyMigrations, createD1Fixture, task22MigrationNames } from './helpers/d1';

const ORIGIN = 'https://pf.example.com';
const fixtures: Array<{ dispose(): Promise<void> }> = [];

function env(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    ...VERIFIED_WEB_ENV,
    LEDGER_APP_ORIGIN: ORIGIN,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      ...VERIFIED_WEB_HEADERS,
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function fixture() {
  const value = await createD1Fixture();
  await applyMigrations(value.db, task22MigrationNames);
  await provisionWebOwner(value.db);
  fixtures.push(value);
  return value;
}

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

describe('legacy reporting preferences route', () => {
  it('reads shared preferences', async () => {
    const value = await fixture();

    const response = await worker.fetch(request('/api/preferences'), env(value.db) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ledgerId: 'personal',
      reportingTimezone: 'America/Toronto',
      weekStart: 1,
      preferredCurrency: null,
      revision: 0,
    });
  });

  it('updates shared preferences with a registered currency and expected revision', async () => {
    const value = await fixture();

    const response = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY' }),
    }), env(value.db) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reportingTimezone: 'Asia/Shanghai',
      weekStart: 0,
      preferredCurrency: 'CNY',
      revision: 1,
    });
  });

  it('rejects malformed and unregistered preferred currencies', async () => {
    const value = await fixture();
    const base = { expectedRevision: 0, reportingTimezone: 'UTC', weekStart: 1 };

    const malformed = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ ...base, preferredCurrency: 123 }),
    }), env(value.db) as never);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Preferred currency is not bounded.' });

    const unknown = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ ...base, preferredCurrency: 'XYZ' }),
    }), env(value.db) as never);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'Preferred currency is not registered.' });
  });

  it('rejects invalid timezone and week-start values', async () => {
    const value = await fixture();
    const base = { expectedRevision: 0, preferredCurrency: null };

    const timezone = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ ...base, reportingTimezone: 'Not/AZone', weekStart: 1 }),
    }), env(value.db) as never);
    expect(timezone.status).toBe(400);
    expect(await timezone.json()).toEqual({ error: 'Reporting timezone is not recognized.' });

    const weekStart = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ ...base, reportingTimezone: 'UTC', weekStart: 7 }),
    }), env(value.db) as never);
    expect(weekStart.status).toBe(400);
    expect(await weekStart.json()).toEqual({ error: 'Week start is not valid.' });
  });

  it('returns the current revision when an update uses a stale expected revision', async () => {
    const value = await fixture();
    const runtime = env(value.db);

    const first = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'UTC', weekStart: 1, preferredCurrency: null }),
    }), runtime as never);
    expect(first.status).toBe(200);

    const stale = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY' }),
    }), runtime as never);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Preference revision conflict.', currentRevision: 1 });
  });

  it('enforces legacy authorization and same-origin mutation boundaries', async () => {
    const value = await fixture();
    const runtime = env(value.db);

    const unauthorized = await worker.fetch(new Request(`${ORIGIN}/api/preferences`), runtime as never);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'Ledger API access is not configured.' });

    const foreignMutation = await worker.fetch(request('/api/preferences', {
      method: 'PATCH',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'UTC', weekStart: 1, preferredCurrency: null }),
    }), runtime as never);
    expect(foreignMutation.status).toBe(403);
    expect(await foreignMutation.json()).toEqual({ error: 'A same-origin request is required.' });
  });
});
