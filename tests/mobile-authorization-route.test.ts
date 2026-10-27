import { afterEach, describe, expect, it } from 'vitest';
import { handleMobileRequest } from '../worker/mobile';
import { pkceChallenge } from '../worker/mobile-auth';
import { startOwnerLogin } from '../worker/mobile-owner-auth';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

const ORIGIN = 'https://pf.example.test';
const CALLBACK_URL = `${ORIGIN}/android/auth/callback`;
const ENVIRONMENT = 'production';
const SESSION_KEY = 'mobile-authorization-route-test-key';

const fixtures: Array<{ close(): void }> = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

describe('mobile authorization approval route', () => {
  it('returns the fixed callback URL the browser approval page must validate', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    await fixture.db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES ('https://team.cloudflareaccess.com', 'owner-subject', 'owner')").run();
    const config = {
      canonicalOrigin: ORIGIN,
      callbackUrl: CALLBACK_URL,
      environment: ENVIRONMENT,
      accessAuthorizationUrl: `${ORIGIN}/mobile/authorize`,
      sessionEncryptionKey: SESSION_KEY,
      approvedAccessIssuers: ['https://team.cloudflareaccess.com'],
      approvedAccessAudiences: ['mobile-audience'],
      approvedAccessSubjects: ['owner-subject'],
      now: () => new Date('2026-10-15T12:00:00.000Z'),
    } as const;
    const start = await startOwnerLogin(fixture.db, {
      codeChallenge: await pkceChallenge('mobile-authorization-verifier-012345678901234567890123456789'),
      state: 'state-for-mobile-authorization-route-0123456789',
      environment: ENVIRONMENT,
      callbackUrl: CALLBACK_URL,
    }, config);
    const env = {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: ORIGIN,
      MOBILE_ENVIRONMENT: ENVIRONMENT,
      MOBILE_CALLBACK_URL: CALLBACK_URL,
      MOBILE_ACCESS_AUTHORIZATION_URL: config.accessAuthorizationUrl,
      MOBILE_SESSION_ENCRYPTION_KEY: SESSION_KEY,
      MOBILE_APPROVED_ACCESS_ISSUERS: config.approvedAccessIssuers.join(','),
      MOBILE_APPROVED_ACCESS_AUDIENCES: config.approvedAccessAudiences.join(','),
      MOBILE_APPROVED_ACCESS_SUBJECTS: config.approvedAccessSubjects.join(','),
      now: config.now,
    } as const;
    const identity = {
      subject: 'owner-subject',
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'mobile-audience',
    } as const;
    const approvalRequest = () => new Request(`${ORIGIN}/api/mobile-auth/requests/${start.requestId}/approval`, {
      method: 'POST',
      headers: { origin: ORIGIN },
    });
    const response = await handleMobileRequest(approvalRequest(), env, identity);

    expect(response?.status).toBe(200);
    const firstBody = await response?.json() as { approved: boolean; code: string; callbackUrl: string; expiresAt: string };
    expect(firstBody).toMatchObject({ approved: true, callbackUrl: CALLBACK_URL });

    const retryResponse = await handleMobileRequest(approvalRequest(), env, identity);
    expect(retryResponse?.status).toBe(200);
    await expect(retryResponse?.json()).resolves.toEqual(firstBody);
  }, 30_000);
});
