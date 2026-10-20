import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_PENDING_TTL_MS,
  buildNativePlaidLinkTokenPayload,
  createConnectionService,
  selectVerifiedPlaidAccounts,
  type NativePlaidAccount,
  type PlaidProvider,
} from '../worker/connection-service';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { OwnerContext } from '../worker/mobile-auth';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import worker from '../worker/index';

const fixtures: Array<{ close(): void }> = [];
const owner: OwnerContext = {
  credentialType: 'owner',
  ledgerId: 'personal',
  familyId: 'task14-owner-family',
  subjectHash: 'task14-owner-subject',
  deviceId: 'task14-device',
  accessGeneration: 1,
  scopes: ['connections:manage', 'ledger:read'],
  expiresAt: '2026-10-14T13:00:00.000Z',
  environmentHash: 'task14-environment',
};

const ROUTE_ORIGIN = 'https://pf.example.com';
const ROUTE_ENVIRONMENT = 'sandbox';
const ROUTE_SESSION_KEY = 'task14-route-session-key';

const providerAccounts: NativePlaidAccount[] = [
  { account_id: 'provider-checking', name: 'Checking', type: 'depository', subtype: 'checking', mask: '1234', balances: { iso_currency_code: 'CAD' } },
  { account_id: 'provider-savings', name: 'Savings', type: 'depository', subtype: 'savings', mask: '5678', balances: { iso_currency_code: 'CNY' } },
];

function mockProvider(accounts: NativePlaidAccount[] = providerAccounts) {
  const calls: string[] = [];
  let removeError: Error | null = null;
  const provider: PlaidProvider = {
    async createLinkToken() { calls.push('link-token'); return { link_token: 'link-token-server-only' }; },
    async exchangePublicToken() { calls.push('exchange'); return { access_token: 'provider-access-secret', item_id: 'item-task14' }; },
    async getItem() { calls.push('item'); return { item: { item_id: 'item-task14', institution_name: 'Synthetic Bank' } }; },
    async getAccounts() { calls.push('accounts'); return { accounts }; },
    async removeItem() { calls.push('remove'); if (removeError) throw removeError; },
  };
  return { provider, calls, failRemove(error: Error) { removeError = error; }, clearRemoveFailure() { removeError = null; } };
}

async function fixture() {
  const value = createSqliteD1Fixture();
  await value.db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`)
    .bind(owner.familyId, owner.subjectHash, '2026-10-14T13:00:00.000Z', '2026-10-14T13:00:00.000Z', JSON.stringify(owner.scopes), owner.environmentHash, '2026-10-14T12:00:00.000Z').run();
  fixtures.push(value);
  return value;
}

async function routeOwner(db: import('../worker/db-types').D1Database) {
  const expiresAt = '2026-10-14T13:00:00.000Z';
  const environmentHash = await hashSecret(ROUTE_ENVIRONMENT);
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`)
    .bind('route-task14-family', 'route-task14-owner', expiresAt, expiresAt, JSON.stringify(['connections:manage', 'ledger:read']), environmentHash, '2026-10-14T12:00:00.000Z').run();
  return createOpaqueCredential({
    kind: 'owner-access', familyId: 'route-task14-family', generation: 1, expiresAt, environmentHash,
  }, {
    canonicalOrigin: ROUTE_ORIGIN,
    callbackUrl: `${ROUTE_ORIGIN}/android/auth/callback`,
    environment: ROUTE_ENVIRONMENT,
    accessAuthorizationUrl: 'https://access.example.com/authorize',
    sessionEncryptionKey: ROUTE_SESSION_KEY,
  });
}

function routeEnv(db: import('../worker/db-types').D1Database) {
  return {
    DB: db,
    LEDGER_APP_ORIGIN: ROUTE_ORIGIN,
    MOBILE_ENVIRONMENT: ROUTE_ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: `${ROUTE_ORIGIN}/mobile/authorize`,
    MOBILE_SESSION_ENCRYPTION_KEY: ROUTE_SESSION_KEY,
    PLAID_CLIENT_ID: 'server-client-id',
    PLAID_SECRET: 'server-secret',
    PLAID_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_USER_ID: 'stable-owner',
    PLAID_WEBHOOK_URL: 'https://pf.example.com/api/webhooks/plaid',
    PLAID_ANDROID_PACKAGE_NAME: 'com.lofuyu.borderledger',
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  };
}

function serviceEnv(db: import('../worker/db-types').D1Database, queue?: { send(message: unknown): Promise<void> }) {
  return {
    DB: db,
    PLAID_CLIENT_ID: 'server-client-id',
    PLAID_SECRET: 'server-secret',
    PLAID_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_USER_ID: 'stable-owner',
    PLAID_WEBHOOK_URL: 'https://pf.example.com/api/webhooks/plaid',
    LEDGER_APP_ORIGIN: 'https://pf.example.com',
    SYNC_QUEUE: queue,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  };
}

afterEach(async () => {
  while (fixtures.length > 0) fixtures.pop()!.close();
});

describe('Task 14 connection service boundaries', () => {
  it('keeps native Link identity server-side and never puts credentials in the payload', () => {
    const payload = buildNativePlaidLinkTokenPayload({
      PLAID_CLIENT_USER_ID: 'owner-stable-id',
      PLAID_ANDROID_PACKAGE_NAME: 'com.lofuyu.borderledger',
      PLAID_ANDROID_REDIRECT_URI: 'https://pf.example.com/android/plaid/oauth',
      PLAID_WEBHOOK_URL: 'https://pf.example.com/api/webhooks/plaid',
    });

    expect(payload).toMatchObject({
      user: { client_user_id: 'owner-stable-id' },
      android_package_name: 'com.lofuyu.borderledger',
      redirect_uri: 'https://pf.example.com/android/plaid/oauth',
      products: ['transactions'],
    });
    expect(JSON.stringify(payload)).not.toContain('access_token');
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('uses a fifteen-minute pending connection window', () => {
    expect(CONNECTION_PENDING_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('rejects client-selected provider IDs that were not returned by the provider', () => {
    const accounts = [
      { account_id: 'provider-1', name: 'Chequing', type: 'depository', subtype: 'checking', balances: { iso_currency_code: 'CAD' } },
    ];

    expect(selectVerifiedPlaidAccounts(accounts, ['provider-1'])).toEqual(accounts);
    expect(selectVerifiedPlaidAccounts(accounts, ['client-invented-id'])).toBeNull();
  });

  it('stages authoritative provider accounts without exposing the access token and replays a lost exchange response', async () => {
    const value = await fixture();
    const fake = mockProvider();
    const service = createConnectionService(serviceEnv(value.db), fake.provider);

    const first = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-1' });
    const replay = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-1' });

    expect(first).toMatchObject({ state: 'pending', pendingConnectionId: expect.any(String), accounts: [{ providerAccountId: 'provider-checking' }, { providerAccountId: 'provider-savings' }] });
    expect(replay).toEqual(first);
    expect(fake.calls).toEqual(['exchange', 'item', 'accounts']);
    const stored = await value.db.prepare('SELECT pending_access_token_ciphertext, provider_accounts_json FROM mobile_connections').all<{ pending_access_token_ciphertext: string; provider_accounts_json: string }>();
    expect(stored.results[0].pending_access_token_ciphertext).not.toContain('provider-access-secret');
    expect(stored.results[0].provider_accounts_json).toContain('provider-checking');
  });

  it('accepts registered non-CAD/CNY provider currencies', async () => {
    const value = await fixture();
    const fake = mockProvider([
      { account_id: 'provider-euro', name: 'Euro', type: 'depository', subtype: 'checking', balances: { iso_currency_code: 'EUR' } },
      { account_id: 'provider-yen', name: 'Yen', type: 'depository', subtype: 'checking', balances: { iso_currency_code: 'JPY' } },
      { account_id: 'provider-dinar', name: 'Dinar', type: 'depository', subtype: 'checking', balances: { iso_currency_code: 'TND' } },
    ]);
    const service = createConnectionService(serviceEnv(value.db), fake.provider);

    const pending = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-registered-currencies' });

    expect(pending.accounts).toMatchObject([
      { providerAccountId: 'provider-euro', currency: 'EUR' },
      { providerAccountId: 'provider-yen', currency: 'JPY' },
      { providerAccountId: 'provider-dinar', currency: 'TND' },
    ]);
  });

  it('rejects an unknown provider currency and cleans up the exchanged item', async () => {
    const value = await fixture();
    const fake = mockProvider([
      { account_id: 'provider-unknown', name: 'Unknown', type: 'depository', subtype: 'checking', balances: { iso_currency_code: 'XYZ' } },
    ]);
    const service = createConnectionService(serviceEnv(value.db), fake.provider);

    await expect(service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-unknown-currency' }))
      .rejects.toMatchObject({ code: 'unsupported_accounts' });
    expect(fake.calls).toEqual(['exchange', 'item', 'accounts', 'remove']);
  });

  it('rejects unverified selection before publishing any local provider mapping', async () => {
    const value = await fixture();
    const fake = mockProvider();
    const service = createConnectionService(serviceEnv(value.db), fake.provider);
    const pending = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-2' });

    await expect(service.selectPendingAccounts(owner, {
      pendingConnectionId: pending.pendingConnectionId!,
      accountIds: ['client-invented-id'],
      idempotencyKey: 'select-2',
    })).rejects.toMatchObject({ code: 'account_not_verified' });
    await expect(value.db.prepare('SELECT COUNT(*) AS count FROM plaid_items').first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it('confirms selected accounts, queues explicit sync, and does not call the provider for status reads', async () => {
    const value = await fixture();
    const fake = mockProvider();
    const queued: unknown[] = [];
    const service = createConnectionService(serviceEnv(value.db, { send: async (message) => { queued.push(message); } }), fake.provider);
    const pending = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-3' });
    const connected = await service.selectPendingAccounts(owner, {
      pendingConnectionId: pending.pendingConnectionId!,
      accountIds: ['provider-checking'],
      idempotencyKey: 'select-3',
    });
    expect(connected).toMatchObject({ state: 'connected', accounts: [{ providerAccountId: 'provider-checking' }] });

    fake.calls.length = 0;
    await expect(service.readConnections(owner)).resolves.toMatchObject([{ state: 'connected', institution: 'Synthetic Bank' }]);
    expect(fake.calls).toEqual([]);
    await expect(service.requestSync(owner, 'sync-3')).resolves.toMatchObject({ state: 'syncing', queued: true });
    expect(queued).toEqual([{ type: 'plaid-sync', itemId: 'item-task14' }]);
  });

  it('revokes with recent owner approval before deleting local credentials and keeps history', async () => {
    const value = await fixture();
    const fake = mockProvider();
    const service = createConnectionService(serviceEnv(value.db), fake.provider);
    const pending = await service.exchangePublicToken(owner, { publicToken: 'public-token', idempotencyKey: 'exchange-4' });
    const connected = await service.selectPendingAccounts(owner, {
      pendingConnectionId: pending.pendingConnectionId!,
      accountIds: ['provider-checking'],
      idempotencyKey: 'select-4',
    });

    fake.failRemove(new Error('provider temporarily unavailable'));
    await expect(service.disconnect(owner, connected.connectionId!, 'disconnect-4', true)).rejects.toMatchObject({ code: 'provider_revoke_failed' });
    await expect(value.db.prepare('SELECT COUNT(*) AS count FROM plaid_items').first<{ count: number }>()).resolves.toMatchObject({ count: 1 });

    fake.clearRemoveFailure();
    await expect(service.disconnect(owner, connected.connectionId!, 'disconnect-4-retry', true)).resolves.toMatchObject({ state: 'canceled' });
    await expect(value.db.prepare('SELECT COUNT(*) AS count FROM plaid_items').first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it('keeps capture credentials from reaching owner connection routes and emits the Android identity server-side', async () => {
    const value = await fixture();
    const env = routeEnv(value.db);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ link_token: 'route-link-token' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const captureAttempt = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/connections/link-tokens`, { method: 'POST', headers: { authorization: 'Bearer capture-token' } }), env as never);
      expect([401, 403]).toContain(captureAttempt.status);

      const token = await routeOwner(value.db);
      const response = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/connections/link-tokens`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env as never);
      expect(response.status).toBe(200);
      const responseBody = await response.json() as Record<string, unknown>;
      expect(responseBody).toMatchObject({ state: 'ready', linkToken: 'route-link-token' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = fetchMock.mock.calls[0][0] as Request;
      const payload = await request.clone().json() as Record<string, unknown>;
      expect(payload).toMatchObject({ android_package_name: 'com.lofuyu.borderledger' });
      expect(payload).toMatchObject({ client_id: 'server-client-id', secret: 'server-secret' });
      expect(JSON.stringify(responseBody)).not.toContain('server-secret');
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('local sandbox native Plaid configuration', () => {
  it('omits the optional webhook when local sandbox has no public HTTPS endpoint', () => {
    const payload = buildNativePlaidLinkTokenPayload({
      PLAID_ENV: 'sandbox',
      PLAID_ANDROID_PACKAGE_NAME: 'com.lofuyu.borderledger',
      LEDGER_APP_ORIGIN: 'http://localhost:8787',
    });

    expect(payload).not.toHaveProperty('webhook');
  });

  it('requires a webhook outside sandbox', () => {
    expect(() => buildNativePlaidLinkTokenPayload({
      PLAID_ENV: 'production',
      PLAID_ANDROID_PACKAGE_NAME: 'com.lofuyu.borderledger',
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
    })).toThrow('The Plaid webhook URL is not configured.');
  });
});
