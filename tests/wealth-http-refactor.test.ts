import { describe, expect, it } from 'vitest';
import type { D1Database } from '../worker/db-types';
import { handleWealthApi } from '../worker/wealth-http';

const context = { userId: 'owner', ledgerId: 'personal' };
const db = {} as D1Database;

describe('wealth HTTP route table', () => {
  it('preserves root boundaries and the template JSON/CSV variants', async () => {
    await expect(handleWealthApi(new Request('https://pf.example.com/api/wealthy/template'), db, context)).resolves.toBeNull();

    const rootTemplate = await handleWealthApi(new Request('https://pf.example.com/api/wealth?view=csv-template'), db, context, { root: '/api/wealth' });
    expect(rootTemplate?.status).toBe(200);
    expect(rootTemplate?.headers.get('content-type')).toContain('text/csv');

    const jsonTemplate = await handleWealthApi(new Request('https://pf.example.com/api/wealth/template?format=json'), db, context, { root: '/api/wealth' });
    expect(jsonTemplate?.status).toBe(200);
    expect(await jsonTemplate?.json()).toMatchObject({ csv: expect.stringContaining('record_type') });

    const csvTemplate = await handleWealthApi(new Request('https://pf.example.com/api/wealth/template'), db, context, { root: '/api/wealth' });
    expect(csvTemplate?.status).toBe(200);
    expect(csvTemplate?.headers.get('content-disposition')).toContain('wealth-template.csv');
  });

  it('returns the stable JSON 404 for an in-root unknown route', async () => {
    const response = await handleWealthApi(new Request('https://pf.example.com/api/wealth/unknown'), db, context, { root: '/api/wealth' });
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({ code: 'not_found', error: 'Not found' });
  });

  it('accepts the grouped root and environment options without widening the handler signature', async () => {
    const response = await handleWealthApi(new Request('https://pf.example.com/v1/wealth/template'), db, context, {
      root: '/v1/wealth',
      env: { WEALTH_CREDENTIAL_ENCRYPTION_KEY: 'test-only-key' },
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-disposition')).toContain('wealth-template.csv');
  });
});
