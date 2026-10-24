import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { createD1Fixture, task22MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const env = (db: Awaited<ReturnType<typeof createD1Fixture>>['db']) => ({
  DB: db,
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  ...VERIFIED_WEB_ENV,
  LEDGER_APP_ORIGIN: 'https://pf.example.com',
});

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

async function seed(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await provisionWebOwner(db);
  const recentSyncAt = new Date(Date.now() - 60_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)').bind('account-cad', 'CAD account', 'RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)').bind('item-1', 'ciphertext', 'iv', 'RBC'),
    db.prepare(`INSERT INTO recurring_sync_state (item_id, history_complete, source_updated_at, last_success_at, lifecycle)
      VALUES (?, 1, ?, ?, 'active')`).bind('item-1', '2026-10-13T14:00:00.000Z', recentSyncAt),
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow,
       first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor, source_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'item-1:stream-1', 'item-1', 'stream-1', 'account-cad', 'Transit pass', 'CAD', 'MATURE', 'MONTHLY', 'MONTHLY', 1,
      '2026-01-01', '2026-10-01', '2026-10-20', -1234, -1234, -1234, '2026-10-13T14:00:00.000Z',
    ),
  ]);
}

describe('recurring API routes', () => {
  it('does not expose the recurring projection without private authorization', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const response = await worker.fetch(new Request('https://pf.example.com/api/recurring'), env(fixture.db) as never);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Ledger API access is not configured.' });
  });

  it('reads the private recurring projection and summary without contacting Plaid', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const runtime = env(fixture.db);

    const pageResponse = await worker.fetch(new Request('https://pf.example.com/api/recurring?limit=1', { headers: { ...VERIFIED_WEB_HEADERS } }), runtime as never);
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.json()).toMatchObject({ streams: [{ id: 'item-1:stream-1' }], state: 'ready' });

    const summaryResponse = await worker.fetch(new Request('https://pf.example.com/api/recurring/summary?start=2026-01-01&end=2026-10-31&today=2026-10-13', { headers: { ...VERIFIED_WEB_HEADERS } }), runtime as never);
    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toMatchObject({ streamCount: 1, monthlyByCurrency: { CAD: expect.any(Number) } });
  });

  it('requires bounded queries and same-origin classification mutations', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const runtime = env(fixture.db);

    const invalid = await worker.fetch(new Request('https://pf.example.com/api/recurring?limit=101', { headers: { ...VERIFIED_WEB_HEADERS } }), runtime as never);
    expect(invalid.status).toBe(400);

    const invalidSummary = await worker.fetch(new Request('https://pf.example.com/api/recurring/summary?start=2026-10-31&end=2026-01-01&today=2026-10-13', { headers: { ...VERIFIED_WEB_HEADERS } }), runtime as never);
    expect(invalidSummary.status).toBe(400);

    const mutation = await worker.fetch(new Request('https://pf.example.com/api/recurring/item-1%3Astream-1/classification', {
      method: 'PATCH',
      headers: { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ classification: 'subscription' }),
    }), runtime as never);
    expect(mutation.status).toBe(200);
    expect(await mutation.json()).toEqual({ id: 'item-1:stream-1', classification: 'subscription' });

    const foreignMutation = await worker.fetch(new Request('https://pf.example.com/api/recurring/item-1%3Astream-1/classification', {
      method: 'PATCH',
      headers: { ...VERIFIED_WEB_HEADERS, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ classification: 'bill' }),
    }), runtime as never);
    expect(foreignMutation.status).toBe(403);

    const invalidClassification = await worker.fetch(new Request('https://pf.example.com/api/recurring/item-1%3Astream-1/classification', {
      method: 'PATCH',
      headers: { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ classification: 'admin' }),
    }), runtime as never);
    expect(invalidClassification.status).toBe(400);
  });
});
