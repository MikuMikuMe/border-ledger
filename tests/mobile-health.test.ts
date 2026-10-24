import { describe, expect, it } from 'vitest';
import worker from '../worker/index';

const baseEnvironment = {
  LEDGER_APP_ORIGIN: 'https://pf.example.com',
  MOBILE_ENVIRONMENT: 'production',
  MOBILE_ACCESS_AUTHORIZATION_URL: 'https://pf.example.com/mobile/authorize',
  MOBILE_SESSION_ENCRYPTION_KEY: 'a-valid-session-key',
  MOBILE_APPROVED_ACCESS_ISSUERS: 'https://team.cloudflareaccess.com',
  MOBILE_APPROVED_ACCESS_AUDIENCES: 'mobile-audience',
  MOBILE_APPROVED_ACCESS_SUBJECTS: 'owner-subject',
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};

describe('production health mobile-auth configuration signal', () => {
  it('reports a valid mobile authorization configuration', async () => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      baseEnvironment as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: true,
    });
  });

  it.each([
    'MOBILE_APPROVED_ACCESS_ISSUERS',
    'MOBILE_APPROVED_ACCESS_AUDIENCES',
  ])('reports a missing %s allowlist as unavailable', async (field) => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      { ...baseEnvironment, [field]: '' } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: false,
    });
  });

  it('does not require the removed subject allowlist when identity enrollment is database-backed', async () => {
    const response = await worker.fetch(new Request('https://pf.example.com/api/health'), { ...baseEnvironment, MOBILE_APPROVED_ACCESS_SUBJECTS: '' } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, mobileAuthConfigured: true });
  });

  it('reports a malformed authorization URL as unavailable', async () => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      {
        ...baseEnvironment,
        MOBILE_ACCESS_AUTHORIZATION_URL: 'not-an-https-url',
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: false,
    });
  });

  it('reports an authorization URL outside the app route as unavailable', async () => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      {
        ...baseEnvironment,
        MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: false,
    });
  });

  it('reports a non-canonical Android callback as unavailable', async () => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      {
        ...baseEnvironment,
        MOBILE_CALLBACK_URL: 'https://pf.example.com/android/auth/other',
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: false,
    });
  });

  it('reports a short encryption key as unavailable', async () => {
    const response = await worker.fetch(
      new Request('https://pf.example.com/api/health'),
      { ...baseEnvironment, MOBILE_SESSION_ENCRYPTION_KEY: 'short' } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mobileAuthConfigured: false,
    });
  });
});
