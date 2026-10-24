import { afterEach, describe, expect, it } from 'vitest';
import { handleMobileRequest } from '../worker/mobile';
import { createOpaqueCredential, hashSecret, type OwnerScope } from '../worker/mobile-auth';
import { createD1Fixture, task22MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const ORIGIN = 'https://pf.example.com';
const ENVIRONMENT = 'sandbox';
const SESSION_KEY = 'task13-mobile-recurring-session-key';

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

async function seed(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  const recentSyncAt = new Date(Date.now() - 60_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('account-cad', 'CAD account', 'RBC', 'CAD', 'chequing', 'connected'),
    db.prepare('INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv, institution_name) VALUES (?, ?, ?, ?)')
      .bind('item-1', 'ciphertext', 'iv', 'RBC'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, plaid_item_id, provider_transaction_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('transaction-1', 'account-cad', '2026-10-01', 'Transit pass', -1234, 'CAD', 'Transit', 'expense', 'confirmed', 'plaid', 'fingerprint-1', 'item-1', 'posted-1'),
    db.prepare(`INSERT INTO recurring_sync_state (item_id, history_complete, source_updated_at, last_success_at, lifecycle)
      VALUES (?, 1, ?, ?, 'active')`)
      .bind('item-1', '2026-10-13T14:00:00.000Z', recentSyncAt),
    db.prepare(`INSERT INTO recurring_streams
      (id, item_id, stream_id, account_id, merchant_name, currency, source_status, source_frequency, frequency, is_outflow,
       first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor, source_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('item-1:stream-1', 'item-1', 'stream-1', 'account-cad', 'Transit pass', 'CAD', 'MATURE', 'MONTHLY', 'MONTHLY', 1,
        '2026-01-01', '2026-10-01', '2026-10-20', -1234, -1234, -1234, '2026-10-13T14:00:00.000Z'),
    db.prepare(`INSERT INTO recurring_stream_transactions
      (recurring_stream_id, item_id, provider_transaction_id, transaction_id, account_id, date, amount_minor, currency, kind, is_outflow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('item-1:stream-1', 'item-1', 'posted-1', 'transaction-1', 'account-cad', '2026-10-01', -1234, 'CAD', 'expense', 1),
  ]);
}

async function ownerCredential(
  db: Awaited<ReturnType<typeof createD1Fixture>>['db'],
  scopes: readonly OwnerScope[],
  familyId = 'task13-family',
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const environmentHash = await hashSecret(ENVIRONMENT);
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`)
    .bind(familyId, `task13-owner-${familyId}`, expiresAt, expiresAt, JSON.stringify(scopes), environmentHash, now.toISOString())
    .run();
  return createOpaqueCredential({
    kind: 'owner-access',
    familyId,
    generation: 1,
    expiresAt,
    environmentHash,
  }, {
    canonicalOrigin: ORIGIN,
    callbackUrl: `${ORIGIN}/android/auth/callback`,
    environment: ENVIRONMENT,
    accessAuthorizationUrl: 'https://access.example.com/authorize',
    sessionEncryptionKey: SESSION_KEY,
  });
}

function env(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  return {
    DB: db,
    LEDGER_APP_ORIGIN: ORIGIN,
    MOBILE_ENVIRONMENT: ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: `${ORIGIN}/mobile/authorize`,
    MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
  };
}

function request(path: string, credential: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${credential}`,
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('Task 13 mobile recurring routes', () => {
  it('returns owner-authorized list, summary, and detail DTOs with bounded paging', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const credential = await ownerCredential(fixture.db, ['ledger:read']);
    const runtime = env(fixture.db);

    const list = await handleMobileRequest(request('/api/mobile/v1/recurring?limit=1', credential), runtime);
    expect(list?.status).toBe(200);
    await expect(list?.json()).resolves.toMatchObject({
      items: [{ id: 'item-1:stream-1', currency: 'CAD', classification: 'unclassified' }],
      page: { limit: 1, nextCursor: null },
      state: 'ready',
      coverageWarnings: [],
    });

    const summary = await handleMobileRequest(request('/api/mobile/v1/recurring/summary?startDate=2026-10-01&endDate=2026-10-31', credential), runtime);
    expect(summary?.status).toBe(200);
    await expect(summary?.json()).resolves.toMatchObject({
      monthlyByCurrency: { CAD: expect.any(Number) },
      actualCostByCurrency: { CAD: 1234 },
      state: 'ready',
    });

    const detail = await handleMobileRequest(request('/api/mobile/v1/recurring/item-1%3Astream-1?limit=1', credential), runtime);
    expect(detail?.status).toBe(200);
    await expect(detail?.json()).resolves.toMatchObject({
      stream: { id: 'item-1:stream-1', currency: 'CAD' },
      history: [{ providerTransactionId: 'posted-1', amountMinor: -1234, currency: 'CAD' }],
      page: { limit: 1, nextCursor: null },
    });
  }, 30_000);

  it('keeps read and classification scopes separate and rejects stale revisions', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const reader = await ownerCredential(fixture.db, ['ledger:read']);
    const classifier = await ownerCredential(fixture.db, ['recurring:classify'], 'task13-classifier-family');
    const runtime = env(fixture.db);

    expect((await handleMobileRequest(request('/api/mobile/v1/recurring', classifier), runtime))?.status).toBe(403);
    expect((await handleMobileRequest(request('/api/mobile/v1/recurring/item-1%3Astream-1/classification', reader, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, classification: 'subscription' }),
    }), runtime))?.status).toBe(403);

    const update = await handleMobileRequest(request('/api/mobile/v1/recurring/item-1%3Astream-1/classification', classifier, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, classification: 'subscription' }),
    }), runtime);
    expect(update?.status).toBe(200);
    await expect(update?.json()).resolves.toMatchObject({ id: 'item-1:stream-1', revision: 1 });

    const stale = await handleMobileRequest(request('/api/mobile/v1/recurring/item-1%3Astream-1/classification', classifier, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0, classification: 'bill' }),
    }), runtime);
    expect(stale?.status).toBe(409);
    await expect(stale?.json()).resolves.toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
  }, 30_000);

  it('does not permit captures or unsupported mobile paths to read recurring data', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const credential = await ownerCredential(fixture.db, ['ledger:read']);
    const runtime = env(fixture.db);

    const missing = await handleMobileRequest(new Request(`${ORIGIN}/api/mobile/v1/recurring`), runtime);
    expect(missing?.status).toBe(401);
    expect((await handleMobileRequest(request('/api/mobile/v1/recurring/summary/extra', credential), runtime))?.status).toBe(404);
  }, 30_000);
});
