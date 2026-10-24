import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import registeredCurrencies from '../contracts/currencies.json';
import worker from '../worker/index';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import { MAX_ALLOWED_CURRENCIES } from '../worker/mobile-device-service';
import { applyMigrations, createD1Fixture, task15CurrencyMigrationNames, task15MigrationNames, task22MigrationNames } from './helpers/d1';

const ORIGIN = 'https://pf.example.com';
const ENVIRONMENT = 'sandbox';
const SESSION_KEY = 'task15-session-key-which-is-long-enough';
const CONFIG = {
  canonicalOrigin: ORIGIN,
  callbackUrl: `${ORIGIN}/android/auth/callback`,
  environment: ENVIRONMENT,
  accessAuthorizationUrl: `${ORIGIN}/mobile/authorize`,
  sessionEncryptionKey: SESSION_KEY,
};

const fixtures: Array<{ dispose(): Promise<void> }> = [];

async function fixture(options: { oldApproval?: boolean } = {}, migrationNames: readonly string[] = task15MigrationNames) {
  const value = await createD1Fixture();
  await applyMigrations(value.db, migrationNames);
  await applyMigrations(value.db, task22MigrationNames);
  const suffix = crypto.randomUUID();
  const accountId = `task15-account-${suffix}`;
  const sourceId = `task15-source-${suffix}`;
  const mappingId = `task15-mapping-${suffix}`;
  const selfId = `task15-self-${suffix}`;
  const otherId = `task15-other-${suffix}`;
  const familyId = `task15-owner-family-${suffix}`;
  const now = '2026-10-14T12:00:00.000Z';
  const approval = options.oldApproval ? '2026-10-14T11:00:00.000Z' : now;
  const ownerToken = await createOpaqueCredential({
    kind: 'owner-access',
    familyId,
    generation: 1,
    expiresAt: '2026-10-14T13:00:00.000Z',
    environmentHash: await hashSecret(ENVIRONMENT),
  }, CONFIG);
  await value.db.batch([
    value.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES (?, 'Task 15 account', 'Synthetic bank', 'CAD', 'multi', 'credit', 'connected')`).bind(accountId),
    value.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, 'CAD')`).bind(accountId),
    value.db.prepare(`INSERT INTO source_profiles (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json)
      VALUES (?, 'personal', ?, ?, 'Synthetic source', 'task15', 'approved', '{}')`).bind(sourceId, `synthetic-${suffix}`, `notification-${suffix}`),
    value.db.prepare(`INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
      VALUES (?, 'personal', ?, 'none', '', ?, 'approved', ?)`).bind(mappingId, sourceId, accountId, now),
    value.db.prepare(`INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status, expires_at)
      VALUES (?, 'personal', 'Task 15 phone', 'android', 'paired', '2027-01-12T12:00:00.000Z')`).bind(selfId),
    value.db.prepare(`INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status, expires_at)
      VALUES (?, 'personal', 'Other phone', 'android', 'paired', '2027-01-12T12:00:00.000Z')`).bind(otherId),
    value.db.prepare(`INSERT INTO owner_session_families
      (id, ledger_id, subject_hash, device_id, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
      VALUES (?, 'personal', 'task15-subject', ?, 1, 1, '2026-10-14T13:00:00.000Z', '2026-11-14T12:00:00.000Z', ?, ?, ?)`)
      .bind(familyId, selfId,
      JSON.stringify(['ledger:read', 'preferences:write', 'devices:manage']), await hashSecret(ENVIRONMENT), approval),
  ]);
  fixtures.push(value);
  return { ...value, ownerToken, now, accountId, sourceId, selfId, otherId };
}

function env(db: Awaited<ReturnType<typeof fixture>>['db']) {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    LEDGER_APP_ORIGIN: ORIGIN,
    MOBILE_ENVIRONMENT: ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: CONFIG.accessAuthorizationUrl,
    MOBILE_CALLBACK_URL: CONFIG.callbackUrl,
    MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  };
}

function request(path: string, ownerToken: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ownerToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

describe('Task 15 mobile preferences and device routes', () => {
  it('keeps the OpenAPI currency-array bound at the complete shared registry size', () => {
    const contract = readFileSync(new URL('../contracts/mobile-v1.openapi.yaml', import.meta.url), 'utf8');
    const bounds = [...contract.matchAll(/allowedCurrencies: \{[^\n]*maxItems: (\d+)/g)].map((match) => Number(match[1]));
    expect(registeredCurrencies).toHaveLength(MAX_ALLOWED_CURRENCIES);
    expect(bounds).toEqual([MAX_ALLOWED_CURRENCIES, MAX_ALLOWED_CURRENCIES]);
    expect(contract).not.toContain('Recurring accounts initially use CAD, CNY, USD, and HKD');
  });

  it('models preferredCurrency as a nullable CurrencyCode for source-currency mode', () => {
    const contract = readFileSync(new URL('../contracts/mobile-v1.openapi.yaml', import.meta.url), 'utf8');
    expect(contract).toContain("preferredCurrency: { anyOf: [{ $ref: '#/components/schemas/CurrencyCode' }, { type: 'null' }] }");
    expect(contract).toContain('preferredCurrency is the reporting target; null keeps source-currency mode.');
  });

  it('reads and updates shared reporting preferences with optimistic revision conflicts', async () => {
    const value = await fixture();
    const read = await worker.fetch(request('/api/mobile/v1/preferences', value.ownerToken), env(value.db) as never);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ reportingTimezone: 'America/Toronto', weekStart: 1, preferredCurrency: null });

    const updated = await worker.fetch(request('/api/mobile/v1/preferences', value.ownerToken, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY' }),
    }), env(value.db) as never);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY', revision: 1 });

    const conflict = await worker.fetch(request('/api/mobile/v1/preferences', value.ownerToken, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, reportingTimezone: 'UTC', weekStart: 1, preferredCurrency: null }),
    }), env(value.db) as never);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
  }, 30_000);

  it('lists only the personal ledger devices and revokes another device only with recent approval', async () => {
    const value = await fixture({ oldApproval: true });
    const list = await worker.fetch(request('/api/mobile/v1/devices', value.ownerToken), env(value.db) as never);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ devices: expect.arrayContaining([
      expect.objectContaining({ id: value.selfId }),
      expect.objectContaining({ id: value.otherId }),
    ]) });

    const denied = await worker.fetch(request(`/api/mobile/v1/devices/${value.otherId}`, value.ownerToken, { method: 'DELETE' }), env(value.db) as never);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'recent_approval_required' });

    const fresh = await fixture();
    const revoked = await worker.fetch(request(`/api/mobile/v1/devices/${fresh.otherId}`, fresh.ownerToken, { method: 'DELETE' }), env(fresh.db) as never);
    expect(revoked.status).toBe(204);
    await expect(fresh.db.prepare(`SELECT status, revoked_at FROM mobile_devices WHERE id = ?`).bind(fresh.otherId).first()).resolves.toMatchObject({ status: 'revoked', revoked_at: expect.any(String) });
  }, 30_000);

  it('replaces source configuration by revision and keeps capture expiry separate from owner expiry', async () => {
    const value = await fixture();
    const sourceConfig = { expectedRevision: 0, mappings: [{ sourceProfileId: value.sourceId, accountId: value.accountId, allowedCurrencies: ['CAD'] }] };
    const configured = await worker.fetch(request('/api/mobile/v1/devices/self/source-config', value.ownerToken, { method: 'PUT', body: JSON.stringify(sourceConfig) }), env(value.db) as never);
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({ id: value.selfId, revision: 1, sourceConfig: { mappings: sourceConfig.mappings } });

    const stale = await worker.fetch(request('/api/mobile/v1/devices/self/source-config', value.ownerToken, { method: 'PUT', body: JSON.stringify(sourceConfig) }), env(value.db) as never);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'revision_conflict', currentRevision: 1 });

    const authorized = await worker.fetch(request('/api/mobile/v1/devices/self/capture-authorization', value.ownerToken, {
      method: 'POST',
      body: JSON.stringify({
        credentialHash: 'a'.repeat(64),
        consent: true,
        sourceConfig: { expectedRevision: 1, mappings: sourceConfig.mappings },
      }),
    }), env(value.db) as never);
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ deviceId: value.selfId, generation: 1, credentialExpiresAt: expect.any(String), revocationCapability: expect.any(String) });
    const credential = await value.db.prepare(`SELECT expires_at FROM capture_credentials WHERE device_id = ?`).bind(value.selfId).first<{ expires_at: string }>();
    expect(credential?.expires_at).toEqual(expect.any(String));
  }, 30_000);

  it('preserves two approved instrument hints on one account through source-config read-back', async () => {
    const value = await fixture();
    await value.db.batch([
      value.db.prepare(`INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
        VALUES (?, 'personal', ?, 'card_suffix', '1111', ?, 'approved', ?)`).bind(`mapping-1111-${value.accountId}`, value.sourceId, value.accountId, value.now),
      value.db.prepare(`INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
        VALUES (?, 'personal', ?, 'card_suffix', '2222', ?, 'approved', ?)`).bind(`mapping-2222-${value.accountId}`, value.sourceId, value.accountId, value.now),
    ]);
    const sourceConfig = {
      expectedRevision: 0,
      mappings: [
        { sourceProfileId: value.sourceId, accountId: value.accountId, instrumentHint: { kind: 'card_suffix', value: '1111' }, allowedCurrencies: ['CAD'] },
        { sourceProfileId: value.sourceId, accountId: value.accountId, instrumentHint: { kind: 'card_suffix', value: '2222' }, allowedCurrencies: ['CAD'] },
      ],
    };

    const configured = await worker.fetch(request('/api/mobile/v1/devices/self/source-config', value.ownerToken, { method: 'PUT', body: JSON.stringify(sourceConfig) }), env(value.db) as never);
    expect(configured.status).toBe(200);
    expect((await configured.json()).sourceConfig.mappings).toEqual(sourceConfig.mappings);

    const readBack = await worker.fetch(request(`/api/mobile/v1/devices/${value.selfId}`, value.ownerToken), env(value.db) as never);
    expect(readBack.status).toBe(200);
    expect((await readBack.json()).sourceConfig.mappings).toEqual(sourceConfig.mappings);
    await expect(value.db.prepare(`SELECT instrument_hint_kind, instrument_hint_value FROM device_source_scopes WHERE device_id = ? ORDER BY instrument_hint_value`).bind(value.selfId).all()).resolves.toMatchObject({ results: [
      { instrument_hint_kind: 'card_suffix', instrument_hint_value: '1111' },
      { instrument_hint_kind: 'card_suffix', instrument_hint_value: '2222' },
    ] });
  }, 30_000);

  it('authorizes the complete shared currency registry and rejects an unknown code', async () => {
    const value = await fixture({}, task15CurrencyMigrationNames);
    await value.db.batch(registeredCurrencies
      .filter(({ code }) => code !== 'CAD')
      .map(({ code }) => value.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)`)
        .bind(value.accountId, code)));
    const allCurrencies = registeredCurrencies.map(({ code }) => code);
    const sourceConfig = { expectedRevision: 0, mappings: [{ sourceProfileId: value.sourceId, accountId: value.accountId, allowedCurrencies: allCurrencies }] };

    const configured = await worker.fetch(request('/api/mobile/v1/devices/self/source-config', value.ownerToken, { method: 'PUT', body: JSON.stringify(sourceConfig) }), env(value.db) as never);
    expect(configured.status).toBe(200);
    expect((await configured.json()).sourceConfig.mappings[0].allowedCurrencies).toEqual(allCurrencies);

    const unknownCode = { ...sourceConfig, expectedRevision: 1, mappings: [{ ...sourceConfig.mappings[0], allowedCurrencies: [...allCurrencies.slice(0, -1), 'ZZZ'] }] };
    const rejected = await worker.fetch(request('/api/mobile/v1/devices/self/source-config', value.ownerToken, { method: 'PUT', body: JSON.stringify(unknownCode) }), env(value.db) as never);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: 'invalid_request' });
  }, 30_000);
});
