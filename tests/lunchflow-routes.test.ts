import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { D1Database } from '../worker/db-types';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

const ORIGIN = 'https://pf.example.com';
const ENVIRONMENT = 'test';
const SESSION_KEY = 'lunchflow-route-session-key';
const LEGACY_API_KEY = 'legacy-route-key';
const LUNCHFLOW_API_KEY = 'server-only-lunchflow-key';
const NOW = new Date('2026-10-22T12:00:00.000Z');
// Store authority uses the database clock, independently of the injected route clock.
const OWNER_EXPIRY = '2099-01-01T00:00:00.000Z';

const fixtures: Array<{ close(): void }> = [];

const providerAccounts = {
  accounts: [{
    id: 'rbc-chequing',
    name: 'Chequing',
    institution_name: 'RBC Royal Bank',
    status: 'ACTIVE',
    currency: 'CAD',
  }],
  total: 1,
};

function providerResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockLunchFlowFetch(payload: unknown = providerAccounts) {
  const calls: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    if (new URL(request.url).pathname.endsWith('/accounts')) return providerResponse(payload);
    return providerResponse({ transactions: [], total: 0 });
  });
  return calls;
}

function webEnv(db: D1Database, queue?: { send(message: unknown): Promise<void> }) {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    ...VERIFIED_WEB_ENV,
    LEDGER_APP_ORIGIN: ORIGIN,
    LUNCHFLOW_API_KEY,
    SYNC_QUEUE: queue,
  };
}

function mobileEnv(db: D1Database, queue?: { send(message: unknown): Promise<void> }) {
  return {
    ...webEnv(db, queue),
    MOBILE_ENVIRONMENT: ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: `${ORIGIN}/mobile/authorize`,
    MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
    now: () => NOW,
  };
}

function webRequest(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      ...VERIFIED_WEB_HEADERS,
      origin: ORIGIN,
      ...(init.headers ?? {}),
    },
  });
}

function webSelectionRequest(providerAccountId: string) {
  return webRequest('/api/lunchflow/account-selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accounts: [{ providerAccountId, currency: 'CAD', kind: 'chequing' }] }),
  });
}

function mobileRequest(path: string, token: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function fixture() {
  const value = createSqliteD1Fixture();
  await provisionWebOwner(value.db);
  fixtures.push(value);
  return value;
}

async function lunchFlowSelectionCount(db: D1Database) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM lunchflow_accounts').first<{ count: number }>();
  return row?.count ?? 0;
}

async function seedLocalLunchFlowMappings(db: D1Database) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('local-route-disabled', 'Disabled route account', 'Synthetic Bank', 'CAD', 'savings', 'connected'),
    db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('local-route-enabled', 'Enabled route account', 'Synthetic Bank', 'CAD', 'chequing', 'connected'),
    db.prepare(`INSERT INTO lunchflow_accounts
      (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, last_synced_at, last_error)
      VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('local-route-disabled', 'local-route-disabled', 'Disabled route account', 'Synthetic Bank', 'CAD', 'savings', 0, 2, null, null),
    db.prepare(`INSERT INTO lunchflow_accounts
      (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, last_synced_at, last_error)
      VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('local-route-enabled', 'local-route-enabled', 'Enabled route account', 'Synthetic Bank', 'CAD', 'chequing', 1, 4, '2026-10-22T12:00:00.000Z', 'Provider unavailable.'),
  ]);
}

async function ownerToken(db: D1Database, scopes: readonly string[], familySuffix: string) {
  const familyId = `lunchflow-route-family-${familySuffix}`;
  const subjectHash = `lunchflow-route-subject-${familySuffix}`;
  const environmentHash = await hashSecret(ENVIRONMENT);
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at,
      refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`)
    .bind(
      familyId,
      subjectHash,
      OWNER_EXPIRY,
      OWNER_EXPIRY,
      JSON.stringify(scopes),
      environmentHash,
      '2026-10-22T11:00:00.000Z',
    )
    .run();
  return createOpaqueCredential({
    kind: 'owner-access',
    familyId,
    generation: 1,
    expiresAt: OWNER_EXPIRY,
    environmentHash,
  }, {
    canonicalOrigin: ORIGIN,
    callbackUrl: `${ORIGIN}/android/auth/callback`,
    environment: ENVIRONMENT,
    accessAuthorizationUrl: `${ORIGIN}/mobile/authorize`,
    sessionEncryptionKey: SESSION_KEY,
  });
}

async function typedCredential(kind: 'capture' | 'pair-verifier') {
  const environmentHash = await hashSecret(ENVIRONMENT);
  return createOpaqueCredential({
    kind,
    expiresAt: OWNER_EXPIRY,
    environmentHash,
  }, {
    canonicalOrigin: ORIGIN,
    callbackUrl: `${ORIGIN}/android/auth/callback`,
    environment: ENVIRONMENT,
    accessAuthorizationUrl: `${ORIGIN}/mobile/authorize`,
    sessionEncryptionKey: SESSION_KEY,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) fixtures.pop()!.close();
});

describe('Lunch Flow web route boundaries', () => {
  it('rejects an unauthenticated account discovery request', async () => {
    const value = await fixture();

    const response = await worker.fetch(new Request(`${ORIGIN}/api/lunchflow/accounts`), webEnv(value.db) as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Ledger API access is not configured.' });
  });

  it('rejects a cross-origin account selection before durable writes', async () => {
    const value = await fixture();

    const response = await worker.fetch(new Request(`${ORIGIN}/api/lunchflow/account-selection`, {
      method: 'POST',
      headers: {
        ...VERIFIED_WEB_HEADERS,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ accounts: [{ providerAccountId: 'rbc-chequing', currency: 'CAD', kind: 'chequing' }] }),
    }), webEnv(value.db) as never);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'A same-origin request is required.' });
    expect(await lunchFlowSelectionCount(value.db)).toBe(0);
  });

  it('uses the Worker-only Lunch Flow key upstream and never returns it', async () => {
    const value = await fixture();
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(webRequest('/api/lunchflow/accounts'), webEnv(value.db) as never);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      configured: true,
      accounts: [{
        providerAccountId: 'rbc-chequing',
        name: 'Chequing',
        institution: 'RBC Royal Bank',
        currencies: ['CAD'],
        selected: false,
        accountId: null,
        kind: null,
        currency: null,
        lastSyncedAt: null,
        lastError: null,
      }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('x-api-key')).toBe(LUNCHFLOW_API_KEY);
    expect(calls[0].headers.get('authorization')).toBeNull();
    expect(JSON.stringify(body)).not.toContain(LUNCHFLOW_API_KEY);
  });

  it('serves local account status without contacting Lunch Flow', async () => {
    const value = await fixture();
    await seedLocalLunchFlowMappings(value.db);
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(webRequest('/api/lunchflow/accounts?status=local'), webEnv(value.db) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      accounts: [
        {
          providerAccountId: 'local-route-enabled',
          name: 'Enabled route account',
          institution: 'Synthetic Bank',
          currencies: ['CAD'],
          selected: true,
          accountId: 'local-route-enabled',
          kind: 'chequing',
          currency: 'CAD',
          lastSyncedAt: '2026-10-22T12:00:00.000Z',
          lastError: 'Provider unavailable.',
           lastAttemptAt: expect.any(String),
        },
        {
          providerAccountId: 'local-route-disabled',
          name: 'Disabled route account',
          institution: 'Synthetic Bank',
          currencies: ['CAD'],
          selected: false,
          accountId: 'local-route-disabled',
          kind: 'savings',
          currency: 'CAD',
          lastSyncedAt: null,
          lastError: null,
           lastAttemptAt: expect.any(String),
        },
      ],
    });
    expect(calls).toHaveLength(0);
  });

  it('fails account selection when the sync queue is unavailable without claiming queued work', async () => {
    const value = await fixture();
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(webSelectionRequest('rbc-chequing'), webEnv(value.db) as never);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'The Lunch Flow sync could not be queued.' });
    expect(calls).toHaveLength(0);
    expect(await lunchFlowSelectionCount(value.db)).toBe(0);
  });

  it('does not publish a selection after provider validation fails', async () => {
    const value = await fixture();
    const queue = { send: vi.fn(async () => undefined) };
    mockLunchFlowFetch();

    const response = await worker.fetch(webSelectionRequest('client-invented-id'), webEnv(value.db, queue) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'One or more selected Lunch Flow accounts are no longer available.' });
    expect(queue.send).not.toHaveBeenCalled();
    expect(await lunchFlowSelectionCount(value.db)).toBe(0);
  });
});

describe('Lunch Flow mobile route boundaries', () => {
  it('requires a bearer credential for account discovery', async () => {
    const value = await fixture();

    const response = await worker.fetch(new Request(`${ORIGIN}/api/mobile/v1/lunchflow/accounts`), mobileEnv(value.db) as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects an owner session that lacks connections:manage', async () => {
    const value = await fixture();
    const token = await ownerToken(value.db, ['ledger:read'], 'read-only');

    const response = await worker.fetch(mobileRequest('/api/mobile/v1/lunchflow/accounts', token), mobileEnv(value.db) as never);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });

  it('allows a live owner session with connections:manage and keeps the upstream key server-side', async () => {
    const value = await fixture();
    const token = await ownerToken(value.db, ['connections:manage'], 'connections-manager');
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(mobileRequest('/api/mobile/v1/lunchflow/accounts', token), mobileEnv(value.db) as never);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ configured: true, accounts: [{ providerAccountId: 'rbc-chequing', selected: false }] });
    expect(JSON.stringify(body)).not.toContain(LUNCHFLOW_API_KEY);
    expect(calls[0].headers.get('x-api-key')).toBe(LUNCHFLOW_API_KEY);
  });

  it('serves local account status without contacting Lunch Flow', async () => {
    const value = await fixture();
    await seedLocalLunchFlowMappings(value.db);
    const token = await ownerToken(value.db, ['connections:manage'], 'local-status');
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(mobileRequest('/api/mobile/v1/lunchflow/accounts?status=local', token), mobileEnv(value.db) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configured: true,
      accounts: [
        { providerAccountId: 'local-route-enabled', selected: true, lastError: 'Provider unavailable.' },
        { providerAccountId: 'local-route-disabled', selected: false, lastError: null },
      ],
    });
    expect(calls).toHaveLength(0);
  });

  it('requires an idempotency key for mobile account-selection writes', async () => {
    const value = await fixture();
    const token = await ownerToken(value.db, ['connections:manage'], 'write-without-key');
    const calls = mockLunchFlowFetch();

    const response = await worker.fetch(mobileRequest('/api/mobile/v1/lunchflow/account-selection', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accounts: [{ providerAccountId: 'rbc-chequing', currency: 'CAD', kind: 'chequing' }] }),
    }), mobileEnv(value.db, { send: async () => undefined }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request', message: 'An idempotency key is required.' });
    expect(calls).toHaveLength(0);
    expect(await lunchFlowSelectionCount(value.db)).toBe(0);
  });

  it('denies capture and device credentials on owner-only Lunch Flow routes', async () => {
    const value = await fixture();
    const captureCredential = await typedCredential('capture');
    const deviceCredential = await typedCredential('pair-verifier');

    for (const credential of [captureCredential, deviceCredential]) {
      const response = await worker.fetch(mobileRequest('/api/mobile/v1/lunchflow/accounts', credential), mobileEnv(value.db) as never);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'wrong_credential_type' });
    }
  });
});
