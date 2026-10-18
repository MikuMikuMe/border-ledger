import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';

describe('production Worker routing', () => {
  it('sends the production API hostname path to the Worker', () => {
    const config = unstable_readConfig({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      env: 'production',
    });

    expect(config.routes ?? []).toContainEqual({
      pattern: 'pf.lofuyu.com/api/*',
      zone_name: 'lofuyu.com',
    });
  });

  it('runs API paths in Worker code before static asset and SPA handling', () => {
    const config = unstable_readConfig({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      env: 'production',
    });
    const workerFirstPaths = Array.isArray(config.assets?.run_worker_first)
      ? config.assets.run_worker_first
      : [];

    expect(workerFirstPaths).toContain('/api/*');
  });
  
  it('preserves the full-site custom-host route alongside the API route', () => {
    const config = unstable_readConfig({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      env: 'production',
    });

    expect(config.routes ?? []).toContainEqual({
      pattern: 'pf.lofuyu.com/*',
      zone_name: 'lofuyu.com',
    });
  });

  it('keeps the workers.dev trigger enabled when custom routes are configured', () => {
    const config = unstable_readConfig({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      env: 'production',
    });

    expect(config.workers_dev).toBe(true);
  });

});
