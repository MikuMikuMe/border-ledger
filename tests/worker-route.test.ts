import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS } from './helpers/web-identity';
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { encryptAccessToken } from '../worker/plaid';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function responseJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('Worker route boundaries', () => {
  it('does not let the raw Worker hostname use the API key as an alternate API origin', async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ all: async () => ({ results: [] }) }) }));
    const response = await worker.fetch(new Request('https://border-ledger.workers.dev/api/accounts', {
      headers: { ...VERIFIED_WEB_HEADERS },
    }), {
      DB: { prepare, batch: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      ...VERIFIED_WEB_ENV,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
    } as never);

    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('revokes the Plaid Item before deleting local credentials', async () => {
    const sealed = await encryptAccessToken('access-token', encryptionKey);
    const events: string[] = [];
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            statements.push({ sql, values });
            return statement;
          },
          async first<T>() {
            if (sql.includes('FROM user_identities')) return { userId: 'owner', ledgerId: 'personal' } as T;
            return null;
          },
          async all<T>() {
            if (sql.includes('FROM plaid_items')) return { results: [{ item_id: 'item-1', access_token_ciphertext: sealed.ciphertext, access_token_iv: sealed.iv, institution_name: 'RBC Royal Bank' }] as T[] };
            if (sql.includes('FROM plaid_accounts')) return { results: [{ account_id: 'plaid-account-1' }] as T[] };
            return { results: [] as T[] };
          },
          async run() { return {}; },
        };
        return statement;
      },
      async batch() { events.push('db:batch'); return {}; },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/item/remove')) {
        events.push('plaid:item-remove');
        return responseJson({ removed: true });
      }
      return responseJson({});
    });

    const response = await worker.fetch(new Request('https://pf.example.com/api/plaid/disconnect', {
      method: 'POST',
      headers: { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item-1' }),
    }), {
      DB: db,
      ASSETS: { fetch: vi.fn() },
      ...VERIFIED_WEB_ENV,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      PLAID_CLIENT_ID: 'client-id',
      PLAID_SECRET: 'secret',
      PLAID_ENV: 'sandbox',
      PLAID_ENCRYPTION_KEY: encryptionKey,
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ disconnected: true, itemId: 'item-1' });
    expect(events).toEqual(['plaid:item-remove', 'db:batch']);
    expect(fetchMock).toHaveBeenCalled();
    expect(statements.some((statement) => statement.sql.includes('DELETE FROM plaid_items'))).toBe(true);
  });
});
