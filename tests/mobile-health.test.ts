import { describe, expect, it } from 'vitest';
import worker from '../worker/index';

const baseEnvironment = {
  LEDGER_APP_ORIGIN: 'https://pf.example.com',
  MOBILE_ENVIRONMENT: 'production',
  MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
  MOBILE_SESSION_ENCRYPTION_KEY: 'a-valid-session-key',
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
