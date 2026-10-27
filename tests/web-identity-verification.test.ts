import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../worker/index';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
afterEach(() => { vi.restoreAllMocks(); });

describe('verified web identity boundary', () => {
  it('requires a valid signature, issuer and audience before resolving a provisioned subject', async () => {
    const fixture = createSqliteD1Fixture();
    const issuer = 'https://signature-test.cloudflareaccess.com';
    const audience = 'signature-test-audience';
    const key = await generateKeyPair('RS256', { extractable: true });
    const wrongKey = await generateKeyPair('RS256');
    const publicKey = { ...await exportJWK(key.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) !== issuer + '/cdn-cgi/access/certs') throw new Error('Unexpected external request');
      return new Response(JSON.stringify({ keys: [publicKey] }), { headers: { 'content-type': 'application/json' } });
    });
    const token = (subject: string, tokenIssuer = issuer, tokenAudience = audience, privateKey = key.privateKey) => new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject(subject).setIssuer(tokenIssuer)
      .setAudience(tokenAudience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const call = async (assertion: string) => worker.fetch(new Request('https://pf.example.com/api/accounts', { headers: { 'Cf-Access-Jwt-Assertion': assertion } }), {
      DB: fixture.db, LEDGER_APP_ORIGIN: 'https://pf.example.com', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUDIENCE: audience,
      ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    } as never);
    try {
      await fixture.db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES (?, 'known', 'owner')").bind(issuer).run();
      expect((await call(await token('known', issuer, audience, wrongKey.privateKey))).status).toBe(401);
      expect((await call(await token('known', 'https://wrong.example.com'))).status).toBe(401);
      expect((await call(await token('known', issuer, 'wrong-audience'))).status).toBe(401);
      expect((await call(await token('unknown'))).status).toBe(403);
      expect((await call(await token('known'))).status).toBe(200);
    } finally { fixture.close(); }
  });
});
