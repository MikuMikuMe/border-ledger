import { afterEach, describe, expect, it } from 'vitest';
import { handleMobileRequest } from '../worker/mobile';
import { authenticateOwner, pkceChallenge } from '../worker/mobile-auth';
import { exchangeOwnerCode, refreshOwnerSession } from '../worker/mobile-owner-auth';
import { issueCaptureAuthorization } from '../worker/mobile-device-service';
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

describe('owner login from an unpaired installation', () => {
  it.each([false, true])('retains the login binding without granting capture access (existing device: %s)', async (existingDevice) => {
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
    await expect(issueCaptureAuthorization(fixture.db, owner, {
      consent: true, credentialHash: 'a'.repeat(64), sourceConfig: { expectedRevision: 0, mappings: [] },
    }, config)).rejects.toMatchObject({ code: 'device_required' });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM capture_credentials').first()).resolves.toMatchObject({ count: 0 });
    if (existingDevice) await expect(fixture.db.prepare('SELECT source_config_revision FROM mobile_devices WHERE id = ?').bind(DEVICE_ID).first()).resolves.toMatchObject({ source_config_revision: 0 });
    const refreshed = await refreshOwnerSession(fixture.db, { refreshToken: tokens.refreshToken, idempotencyKey: 'new-device-refresh' }, config);
    await expect(authenticateOwner(refreshed.accessToken, fixture.db, config)).resolves.toMatchObject({ deviceId: null });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: existingDevice ? 1 : 0 });
  });
});
