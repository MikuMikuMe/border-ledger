import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../worker';

describe('Android App Links metadata', () => {
  it('runs the association route before the Worker static SPA fallback', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8'));

    expect(config.assets.run_worker_first).toContain('/.well-known/assetlinks.json');
  });

  it('defines security headers for static pages and assets', () => {
    const headersPath = resolve(process.cwd(), 'public/_headers');
    expect(existsSync(headersPath)).toBe(true);
    if (!existsSync(headersPath)) return;

    const headers = readFileSync(headersPath, 'utf8');
    expect(headers).toContain('Content-Security-Policy:');
    expect(headers).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(headers).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000');
  });

  it('defaults Plaid to production and keeps the local webhook unconfigured until an HTTPS endpoint is supplied', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8'));

    expect(config.vars.PLAID_ENV).toBe('production');
    expect(config.vars.LEDGER_APP_ORIGIN).toBe('http://localhost:8787');
    expect(config.vars).not.toHaveProperty('PLAID_WEBHOOK_URL');
    expect(config.env.production.vars.PLAID_ENV).toBe('production');
    expect(config.env.production.vars.LEDGER_APP_ORIGIN).toBe('https://pf.lofuyu.com');
    expect(config.env.production.vars.PLAID_WEBHOOK_URL).toBe('https://pf.lofuyu.com/api/webhooks/plaid');
  });
  it('ships a static well-known association file so SPA fallback cannot mask it', () => {
    const assetLinksPath = resolve(process.cwd(), 'public/.well-known/assetlinks.json');
    expect(existsSync(assetLinksPath)).toBe(true);
    if (!existsSync(assetLinksPath)) return;

    expect(JSON.parse(readFileSync(assetLinksPath, 'utf8'))).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.lofuyu.borderledger',
          sha256_cert_fingerprints: [
            '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17',
            '1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED',
          ],
        },
      },
    ]);
  });

  it('serves the production app association directly without an SPA response or redirect', async () => {
    const response = await worker.fetch(
      new Request('https://pf.lofuyu.com/.well-known/assetlinks.json'),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json(?:;|$)/);
    expect(response.headers.get('cache-control')).toContain('max-age=300');
    expect(response.headers.get('location')).toBeNull();
    const canonicalAssociation = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/.well-known/assetlinks.json'), 'utf8'),
    );
    expect(await response.json()).toEqual(canonicalAssociation);
  });

  it('serves the same metadata to HEAD without a response body', async () => {
    const response = await worker.fetch(
      new Request('https://pf.lofuyu.com/.well-known/assetlinks.json', { method: 'HEAD' }),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json(?:;|$)/);
    expect(await response.text()).toBe('');
  });

  it('does not serve app-link metadata for unsupported methods', async () => {
    const response = await worker.fetch(
      new Request('https://pf.lofuyu.com/.well-known/assetlinks.json', { method: 'POST' }),
      {} as never,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
