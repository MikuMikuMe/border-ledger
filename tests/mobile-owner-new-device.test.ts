import { afterEach, describe, expect, it } from 'vitest';
import { handleMobileRequest } from '../worker/mobile';
import { authenticateCapture, authenticateOwner, hashSecret, pkceChallenge } from '../worker/mobile-auth';
import { exchangeOwnerCode, logoutOwnerSession, refreshOwnerSession } from '../worker/mobile-owner-auth';
import type { D1Database } from '../worker/db-types';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

const ORIGIN = 'https://pf.example.test';
const DEVICE_ID = 'fresh-android-installation';
const VERIFIER = 'new-device-pkce-verifier-012345678901234567890123456789';
const STATE = 'new-device-state-012345678901234567890123456789';
const config = {
  canonicalOrigin: ORIGIN,
  callbackUrl: ORIGIN + '/android/auth/callback',
  environment: 'production',
  accessAuthorizationUrl: ORIGIN + '/mobile/authorize',
  sessionEncryptionKey: 'synthetic-new-device-session-key',
  approvedAccessIssuers: ['https://team.cloudflareaccess.com'],
  approvedAccessAudiences: ['mobile-audience'],
  approvedAccessSubjects: ['owner-subject'],
};
const identity = { subject: 'owner-subject', issuer: config.approvedAccessIssuers[0], audience: 'mobile-audience' };
const fixtures: Array<{ close(): void }> = [];
afterEach(() => { while (fixtures.length) fixtures.pop()?.close(); });

async function seedCaptureSource(db: D1Database) {
  await db.batch([
    db.prepare("INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES ('capture-account', 'Capture account', 'Synthetic bank', 'CAD', 'multi', 'credit', 'connected')"),
    db.prepare("INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('capture-account', 'CAD')"),
    db.prepare("INSERT INTO source_profiles (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json) VALUES ('capture-source', 'personal', 'synthetic', 'notification', 'Synthetic source', 'test', 'approved', '{}')"),
    db.prepare("INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at) VALUES ('capture-mapping', 'personal', 'capture-source', 'none', '', 'capture-account', 'approved', '2026-10-01T00:00:00Z')"),
  ]);
  return { expectedRevision: 0, mappings: [{ sourceProfileId: 'capture-source', accountId: 'capture-account', allowedCurrencies: ['CAD'] }] };
}

async function assertCaptureIsolation(db: D1Database, existingDevice: boolean) {
  await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: Number(existingDevice) + 1 });
  if (existingDevice) {
    await expect(db.prepare('SELECT source_config_revision FROM mobile_devices WHERE id = ?').bind(DEVICE_ID).first()).resolves.toMatchObject({ source_config_revision: 0 });
    await expect(db.prepare('SELECT COUNT(*) AS count FROM capture_credentials WHERE device_id = ?').bind(DEVICE_ID).first()).resolves.toMatchObject({ count: 0 });
  }
}

async function verifyCaptureConsent(db: D1Database, accessToken: string, env: Parameters<typeof handleMobileRequest>[1], existingDevice: boolean) {
  const sourceConfig = await seedCaptureSource(db);
  const secret = 'synthetic-capture-secret';
  const payload = { consent: true, credentialHash: await hashSecret(secret), sourceConfig };
  const authorize = (body: unknown) => handleMobileRequest(new Request(ORIGIN + '/api/mobile/v1/devices/self/capture-authorization', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken }, body: JSON.stringify(body),
  }), env);
  const declined = await authorize({ ...payload, consent: false });
  expect(declined!.status).toBe(403);
  await expect(declined!.json()).resolves.toMatchObject({ code: 'consent_required' });
  await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: Number(existingDevice) });
  expect((await authorize({ ...payload, sourceConfig: { ...sourceConfig, mappings: [] } }))!.status).toBe(400);
  await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: Number(existingDevice) });
  expect((await authorize({ ...payload, sourceConfig: { ...sourceConfig, mappings: [{ ...sourceConfig.mappings[0], accountId: 'unapproved-account' }] } }))!.status).toBe(403);
  await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: Number(existingDevice) });
  const authorized = await authorize(payload);
  expect(authorized!.status).toBe(200);
  const grant = await authorized!.json() as { deviceId: string; generation: number; revocationCapability: string };
  expect(grant.deviceId).not.toBe(DEVICE_ID);
  expect(grant).toMatchObject({ generation: 1, revocationCapability: expect.any(String) });
  await expect(authenticateOwner(accessToken, db, config)).resolves.toMatchObject({ deviceId: grant.deviceId });
  await expect(authenticateCapture(secret, db, config)).resolves.toMatchObject({ deviceId: grant.deviceId });
  await assertCaptureIsolation(db, existingDevice);
  await logoutOwnerSession(db, { accessToken }, config);
  await expect(authenticateCapture(secret, db, config)).rejects.toMatchObject({ code: 'revoked' });
}

describe('owner login from an unpaired installation', () => {
  it.each([false, true])('binds capture only after consent without reusing an installation ID (collision: %s)', async (existingDevice) => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    if (existingDevice) await fixture.db.prepare("INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES (?, 'personal', 'Existing capture device', 'android', 'paired')").bind(DEVICE_ID).run();
    const env = {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: ORIGIN,
      MOBILE_ENVIRONMENT: config.environment,
      MOBILE_CALLBACK_URL: config.callbackUrl,
      MOBILE_ACCESS_AUTHORIZATION_URL: config.accessAuthorizationUrl,
      MOBILE_SESSION_ENCRYPTION_KEY: config.sessionEncryptionKey,
      MOBILE_APPROVED_ACCESS_ISSUERS: config.approvedAccessIssuers.join(','),
      MOBILE_APPROVED_ACCESS_AUDIENCES: config.approvedAccessAudiences.join(','),
      MOBILE_APPROVED_ACCESS_SUBJECTS: config.approvedAccessSubjects.join(','),
    };
    const startResponse = await handleMobileRequest(new Request(ORIGIN + '/api/mobile/v1/auth/requests', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codeChallenge: await pkceChallenge(VERIFIER), state: STATE, deviceId: DEVICE_ID }),
    }), env);
    expect(startResponse?.status).toBe(201);
    const start = await startResponse!.json() as { requestId: string; authorizationUrl: string };
    expect(new URL(start.authorizationUrl).searchParams.get('request_id')).toBe(start.requestId);

    const approvalResponse = await handleMobileRequest(new Request(ORIGIN + '/api/mobile-auth/requests/' + start.requestId + '/approval', {
      method: 'POST', headers: { origin: ORIGIN },
    }), env, identity);
    expect(approvalResponse?.status).toBe(200);
    const approval = await approvalResponse!.json() as { code: string };
    const exchange = { requestId: start.requestId, code: approval.code, verifier: VERIFIER, state: STATE, deviceId: DEVICE_ID, staySignedIn: true };
    await expect(exchangeOwnerCode(fixture.db, { ...exchange, deviceId: 'different-installation' }, config)).rejects.toMatchObject({ code: 'device_mismatch' });
    const tokens = await exchangeOwnerCode(fixture.db, exchange, config);
    const owner = await authenticateOwner(tokens.accessToken, fixture.db, config);
    expect(owner.deviceId).toBeNull();
    await expect(fixture.db.prepare('SELECT installation_id FROM owner_session_families WHERE id = ?').bind(owner.familyId).first()).resolves.toMatchObject({ installation_id: DEVICE_ID });
    const refreshed = await refreshOwnerSession(fixture.db, { refreshToken: tokens.refreshToken, idempotencyKey: 'new-device-refresh' }, config);
    await expect(authenticateOwner(refreshed.accessToken, fixture.db, config)).resolves.toMatchObject({ deviceId: null });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: existingDevice ? 1 : 0 });
    await verifyCaptureConsent(fixture.db, refreshed.accessToken, env, existingDevice);
  });
});
