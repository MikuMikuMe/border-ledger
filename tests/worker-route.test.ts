import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
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
    const fixture=createSqliteD1Fixture();const db=fixture.db;
    await provisionWebOwner(db);
    await db.prepare('INSERT INTO plaid_items(item_id,access_token_ciphertext,access_token_iv) VALUES (?,?,?)').bind('item-1',sealed.ciphertext,sealed.iv).run();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/item/remove')) {
        expect(await db.prepare("SELECT item_id FROM plaid_items WHERE item_id='item-1'").first()).not.toBeNull();
        expect(await db.prepare("SELECT lifecycle FROM sync_state WHERE connection_id='plaid:item-1'").first()).toEqual({lifecycle:'disconnecting'});
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
    expect(await db.prepare("SELECT item_id FROM plaid_items WHERE item_id='item-1'").first()).toBeNull();
    expect(await db.prepare("SELECT lifecycle FROM sync_state WHERE connection_id='plaid:item-1'").first()).toEqual({lifecycle:'disconnected'});
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();fixture.close();
  });
});
