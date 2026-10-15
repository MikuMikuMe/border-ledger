import assert from 'node:assert/strict';
import worker from '../worker/index';
import { createOpaqueCredential } from '../worker/mobile-auth';

const db = {
  prepare() {
    throw new Error('database should not be reached by this guard check');
  },
  batch() {
    throw new Error('database should not be reached by this guard check');
  },
};
const assets = { fetch: async () => new Response('not found', { status: 404 }) };
const baseEnv = {
  DB: db,
  ASSETS: assets,
  LEDGER_API_KEY: 'legacy-key',
  LEDGER_APP_ORIGIN: 'https://pf.example.com',
};

const rawHost = await worker.fetch(new Request('https://border-ledger.workers.dev/api/mobile/v1/pairings', { method: 'POST' }), baseEnv as never);
assert.equal(rawHost.status, 404);

const ownerCredential = await createOpaqueCredential({
  kind: 'owner-access',
  familyId: 'synthetic-family',
  generation: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  environmentHash: 'synthetic-environment-hash',
}, {
  canonicalOrigin: 'https://pf.example.com',
  callbackUrl: 'https://pf.example.com/android/auth/callback',
  environment: 'sandbox',
  accessAuthorizationUrl: 'https://access.example.com/authorize',
  sessionEncryptionKey: 'synthetic-session-key-for-route-test',
});
const legacyPath = await worker.fetch(new Request('https://pf.example.com/api/accounts', { headers: { authorization: `Bearer ${ownerCredential}` } }), baseEnv as never);
assert.equal(legacyPath.status, 401);

const webhook = await worker.fetch(new Request('https://pf.example.com/api/webhooks/plaid', { method: 'POST', body: '{}' }), baseEnv as never);
assert.equal(webhook.status, 401);
assert.deepEqual(await webhook.json(), { error: 'Invalid Plaid webhook.' });

console.log('TASK4_DIRECT_ROUTE_GUARDS_OK');
