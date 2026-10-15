import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

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

function scheduledHandler() {
  return (worker as unknown as {
    scheduled(controller: { scheduledTime: number; cron: string }, env: { DB: import('../worker/db-types').D1Database }, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
  }).scheduled;
}

describe('daily FX snapshot warming', () => {
  it('warms the scheduled UTC date once and never rewrites the immutable observation', async () => {
    const { db } = fixture();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      { date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 1.1 },
      { date: '2026-10-13', base: 'EUR', quote: 'CAD', rate: 1.5 },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));
    const waitUntil = vi.fn();

    await scheduledHandler()({ scheduledTime: Date.parse('2026-10-14T06:15:00.000Z'), cron: '15 6 * * *' }, { DB: db }, { waitUntil });
    const first = await db.prepare('SELECT requested_date, effective_date, provider, rates_json FROM fx_rate_snapshots').first<Record<string, unknown>>();
    expect(first).toMatchObject({
      requested_date: '2026-10-14',
      effective_date: '2026-10-13',
      provider: 'frankfurter',
      rates_json: '{"USD":"1.1","CAD":"1.5"}',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValue(new Response(JSON.stringify([
      { date: '2026-10-14', base: 'EUR', quote: 'USD', rate: 9 },
      { date: '2026-10-14', base: 'EUR', quote: 'CAD', rate: 9 },
    ]), { status: 200 }));
    await scheduledHandler()({ scheduledTime: Date.parse('2026-10-14T18:00:00.000Z'), cron: '15 6 * * *' }, { DB: db }, { waitUntil });

    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(db.prepare('SELECT effective_date, rates_json FROM fx_rate_snapshots WHERE requested_date = ?').bind('2026-10-14').first())
      .resolves.toEqual({ effective_date: '2026-10-13', rates_json: '{"USD":"1.1","CAD":"1.5"}' });
  });

  it('logs only a safe error name and leaves provider failures retryable', async () => {
    const { db } = fixture();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret provider response', { status: 503 }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await scheduledHandler()({ scheduledTime: Date.parse('2026-10-14T06:15:00.000Z'), cron: '15 6 * * *' }, { DB: db }, { waitUntil: vi.fn() });

    expect(error).toHaveBeenCalledWith('fx_snapshot_refresh_failed', 'FxProviderError');
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret provider response');
    await expect(db.prepare('SELECT COUNT(*) AS count FROM fx_rate_snapshots').first()).resolves.toEqual({ count: 0 });
  });

  it('propagates database failures instead of classifying them as provider outages', async () => {
    const db = {
      prepare() {
        throw new Error('database unavailable');
      },
    };

    await expect(scheduledHandler()({ scheduledTime: Date.parse('2026-10-14T06:15:00.000Z'), cron: '15 6 * * *' }, { DB: db as never }, { waitUntil: vi.fn() }))
      .rejects.toThrow('database unavailable');
  });

  it('configures the same daily trigger for root and production', () => {
    const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
      triggers?: { crons?: string[] };
      env?: { production?: { triggers?: { crons?: string[] } } };
    };
    expect(config.triggers?.crons).toEqual(['15 6 * * *']);
    expect(config.env?.production?.triggers?.crons).toEqual(['15 6 * * *']);
  });
});
