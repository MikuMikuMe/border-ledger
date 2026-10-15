import { afterEach, describe, expect, it } from 'vitest';
import { handleMobileRequest } from '../worker/mobile';
import { createOpaqueCredential, hashSecret, type OwnerScope } from '../worker/mobile-auth';
import { createD1Fixture, task16MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];
const ORIGIN = 'https://pf.example.com';
const ENVIRONMENT = 'sandbox';
const SESSION_KEY = 'task17-mobile-transactions-session-key';

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

async function ownerCredential(db: Awaited<ReturnType<typeof createD1Fixture>>['db'], scopes: readonly OwnerScope[], familyId = 'task17-family') {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`)
    .bind(familyId, `task17-owner-${familyId}`, expiresAt, expiresAt, JSON.stringify(scopes), await hashSecret(ENVIRONMENT), now.toISOString())
    .run();
  return createOpaqueCredential({ kind: 'owner-access', familyId, generation: 1, expiresAt, environmentHash: await hashSecret(ENVIRONMENT) }, {
    canonicalOrigin: ORIGIN,
    callbackUrl: `${ORIGIN}/android/auth/callback`,
    environment: ENVIRONMENT,
    accessAuthorizationUrl: 'https://access.example.com/authorize',
    sessionEncryptionKey: SESSION_KEY,
  });
}

function runtime(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  return {
    DB: db,
    LEDGER_APP_ORIGIN: ORIGIN,
    MOBILE_ENVIRONMENT: ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: `${ORIGIN}/mobile/authorize`,
    MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
  };
}

function request(path: string, credential: string) {
  return new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${credential}`, accept: 'application/json' } });
}

async function seed(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('account-cad', 'CAD account', 'Synthetic Bank', 'CAD', 'chequing', 'connected'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('transaction-old', 'account-cad', '2026-10-01', 'Old transit', -100, 'CAD', 'Transit', 'expense', 'confirmed', 'statement', 'fp-old', null),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('transaction-new-b', 'account-cad', '2026-10-12', 'Book shop', -2500, 'CAD', 'Books', 'expense', 'provisional', 'manual', 'fp-new-b', 'draft note'),
    db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .bind('transaction-new-a', 'account-cad', '2026-10-12', 'Transit pass', -1234, 'CAD', 'Transit', 'expense', 'confirmed', 'plaid', 'fp-new-a', null),
  ]);
}

describe('Task 17 mobile transaction route', () => {
  it('returns stable bounded pages, filters, and annotation revisions', async () => {
    const fixture = await createD1Fixture(task16MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const credential = await ownerCredential(fixture.db, ['ledger:read']);
    const env = runtime(fixture.db);

    const first = await handleMobileRequest(request('/api/mobile/v1/transactions?limit=2', credential), env);
    expect(first?.status).toBe(200);
    const firstBody = await first!.json() as { items: Array<{ id: string }>; page: { nextCursor: string | null; limit: number } };
    expect(firstBody.items.map((item) => item.id)).toEqual(['transaction-new-b', 'transaction-new-a']);
    expect(firstBody.page.limit).toBe(2);
    expect(firstBody.page.nextCursor).toBeTruthy();

    const second = await handleMobileRequest(request(`/api/mobile/v1/transactions?limit=2&cursor=${firstBody.page.nextCursor}&query=transit`, credential), env);
    expect(second?.status).toBe(200);
    await expect(second?.json()).resolves.toMatchObject({ items: [{ id: 'transaction-old', revision: 0 }] });

    const invalidCurrency = await handleMobileRequest(request('/api/mobile/v1/transactions?currency=ZZZ', credential), env);
    expect(invalidCurrency?.status).toBe(400);
    await expect(invalidCurrency?.json()).resolves.toMatchObject({ code: 'invalid_request' });
  }, 30_000);

  it('keeps ledger reads owner-scoped', async () => {
    const fixture = await createD1Fixture(task16MigrationNames);
    fixtures.push(fixture);
    await seed(fixture.db);
    const credential = await ownerCredential(fixture.db, ['connections:manage']);
    const response = await handleMobileRequest(request('/api/mobile/v1/transactions', credential), runtime(fixture.db));
    expect(response?.status).toBe(403);
  }, 30_000);
});
