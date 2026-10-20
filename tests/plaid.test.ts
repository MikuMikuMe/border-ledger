import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_PLAID_SYNC_PAGES,
  buildPlaidRequest,
  decryptAccessToken,
  encryptAccessToken,
  fetchAllPlaidTransactions,
  mapPlaidTransaction,
  upsertPlaidTransaction,
} from '../worker/plaid';
import { buildPlaidLinkTokenPayload } from '../worker/index';
import { createD1Fixture, task18MigrationNames } from './helpers/d1';

const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

describe('Plaid integration primitives', () => {
  it('maps a CAD debit into a confirmed ledger expense', () => {
    const transaction = mapPlaidTransaction({
      transaction_id: 'txn-1',
      account_id: 'plaid-account-1',
      amount: 12.34,
      iso_currency_code: 'CAD',
      date: '2026-10-09',
      merchant_name: 'Metro Toronto',
      name: 'Metro Toronto',
      pending: false,
      personal_finance_category: { primary: 'FOOD_AND_DRINK' },
    }, 'account-rbc');

    expect(transaction).toMatchObject({
      id: 'plaid-account-rbc-txn-1',
      accountId: 'account-rbc',
      amountMinor: -1234,
      currency: 'CAD',
      category: 'Dining',
      kind: 'expense',
      status: 'confirmed',
      source: 'plaid',
      fingerprint: 'plaid:account-rbc:txn-1',
    });
  });

  it('maps registered non-CAD/CNY currencies using each currency minor-unit scale', () => {
    const euro = mapPlaidTransaction({
      transaction_id: 'txn-eur',
      account_id: 'plaid-account-1',
      amount: 12.34,
      iso_currency_code: 'EUR',
      date: '2026-10-09',
      name: 'Euro merchant',
      pending: false,
    }, 'account-eur');
    const yen = mapPlaidTransaction({
      transaction_id: 'txn-jpy',
      account_id: 'plaid-account-1',
      amount: 123,
      iso_currency_code: 'JPY',
      date: '2026-10-09',
      name: 'Yen merchant',
      pending: false,
    }, 'account-jpy');
    const dinar = mapPlaidTransaction({
      transaction_id: 'txn-tnd',
      account_id: 'plaid-account-1',
      amount: 1.234,
      iso_currency_code: 'TND',
      date: '2026-10-09',
      name: 'Dinar merchant',
      pending: false,
    }, 'account-tnd');

    expect(euro).toMatchObject({ currency: 'EUR', amountMinor: -1234 });
    expect(yen).toMatchObject({ currency: 'JPY', amountMinor: -123 });
    expect(dinar).toMatchObject({ currency: 'TND', amountMinor: -1234 });
  });

  it('rejects an unknown Plaid currency code', () => {
    expect(mapPlaidTransaction({
      transaction_id: 'txn-unknown',
      account_id: 'plaid-account-1',
      amount: 12.34,
      iso_currency_code: 'XYZ',
      date: '2026-10-09',
      name: 'Unknown currency merchant',
      pending: false,
    }, 'account-unknown')).toBeNull();
  });

  it('uses the pending transaction id so a posted transaction updates the same record', () => {
    const pending = mapPlaidTransaction({
      transaction_id: 'pending-1',
      account_id: 'plaid-account-1',
      amount: 20,
      iso_currency_code: 'CAD',
      date: '2026-10-09',
      merchant_name: 'Cafe',
      name: 'Cafe',
      pending: true,
    }, 'account-rbc');
    const posted = mapPlaidTransaction({
      transaction_id: 'posted-1',
      pending_transaction_id: 'pending-1',
      account_id: 'plaid-account-1',
      amount: 20,
      iso_currency_code: 'CAD',
      date: '2026-10-09',
      merchant_name: 'Cafe',
      name: 'Cafe',
      pending: false,
    }, 'account-rbc');

    expect(pending).not.toBeNull();
    expect(posted).not.toBeNull();
    expect(posted?.id).toBe(pending?.id);
    expect(posted?.fingerprint).toBe(pending?.fingerprint);
    expect(posted?.status).toBe('confirmed');
  });

  it('locks a Plaid row on its pending date and preserves that lock when the posted date changes', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
        VALUES ('account-rbc', 'Synthetic RBC', 'RBC', 'CAD', 'single', 'chequing', 'connected')`),
      fixture.db.prepare(`INSERT INTO plaid_items (item_id, access_token_ciphertext, access_token_iv)
        VALUES ('item-rbc', 'ciphertext-fixture', 'iv-fixture')`),
    ]);
    await fixture.db.prepare('DROP TRIGGER transactions_fx_lock_date_default').run();

    const pending = mapPlaidTransaction({
      transaction_id: 'pending-lock-1',
      account_id: 'plaid-account-rbc',
      amount: 20,
      iso_currency_code: 'CAD',
      date: '2026-10-09',
      merchant_name: 'Cafe',
      name: 'Cafe',
      pending: true,
    }, 'account-rbc', 'item-rbc');
    const posted = mapPlaidTransaction({
      transaction_id: 'posted-lock-1',
      pending_transaction_id: 'pending-lock-1',
      account_id: 'plaid-account-rbc',
      amount: 20,
      iso_currency_code: 'CAD',
      date: '2026-10-11',
      merchant_name: 'Cafe posted',
      name: 'Cafe posted',
      pending: false,
    }, 'account-rbc', 'item-rbc');
    expect(pending).not.toBeNull();
    expect(posted).not.toBeNull();

    await upsertPlaidTransaction(fixture.db, pending!);
    await upsertPlaidTransaction(fixture.db, posted!);

    await expect(fixture.db.prepare(`SELECT date, fx_lock_date, status, COUNT(*) AS count
      FROM transactions WHERE id = ?`).bind(pending!.id).all()).resolves.toMatchObject({
      results: [{ date: '2026-10-11', fx_lock_date: '2026-10-09', status: 'confirmed', count: 1 }],
    });
  });

  it('collects every sync page before returning the cursor', async () => {
    const cursors: string[] = [];
    const result = await fetchAllPlaidTransactions(async (cursor) => {
      cursors.push(cursor);
      if (!cursor) return {
        added: [{ transaction_id: 'txn-1' }],
        modified: [],
        removed: [],
        next_cursor: 'cursor-1',
        has_more: true,
      };
      return {
        added: [{ transaction_id: 'txn-2' }],
        modified: [{ transaction_id: 'txn-3' }],
        removed: [{ transaction_id: 'txn-4' }],
        next_cursor: 'cursor-2',
        has_more: false,
      };
    });

    expect(cursors).toEqual(['', 'cursor-1']);
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.added.map((item) => item.transaction_id)).toEqual(['txn-1', 'txn-2']);
    expect(result.modified.map((item) => item.transaction_id)).toEqual(['txn-3']);
    expect(result.removed.map((item) => item.transaction_id)).toEqual(['txn-4']);
  });

  it('bounds a malformed or unexpectedly large Plaid pagination run', async () => {
    let pageCount = 0;
    await expect(fetchAllPlaidTransactions(async () => {
      pageCount += 1;
      return { added: [], modified: [], removed: [], next_cursor: `cursor-${pageCount}`, has_more: true };
    })).rejects.toThrow('maximum page limit');
    expect(pageCount).toBe(MAX_PLAID_SYNC_PAGES);
  });

  it('encrypts and decrypts an access token without storing plaintext', async () => {
    const sealed = await encryptAccessToken('access-sandbox-token', key);

    expect(sealed.ciphertext).not.toContain('access-sandbox-token');
    await expect(decryptAccessToken(sealed, key)).resolves.toBe('access-sandbox-token');
  });

  it('builds an environment-specific Plaid request with credentials only server-side', async () => {
    const request = buildPlaidRequest('sandbox', '/link/token/create', {
      client_id: 'client-id',
      secret: 'secret-value',
      client_name: 'Border Ledger',
    });

    expect(request.url).toBe('https://sandbox.plaid.com/link/token/create');
    expect(request.headers.get('content-type')).toBe('application/json');
    await expect(request.json()).resolves.toMatchObject({ client_id: 'client-id', secret: 'secret-value' });
  });

  it('uses a fixed HTTPS webhook and narrows Link to supported account types', () => {
    expect(buildPlaidLinkTokenPayload({
      PLAID_CLIENT_USER_ID: 'owner-1',
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      PLAID_WEBHOOK_URL: 'https://pf.example.com/api/webhooks/plaid',
    })).toMatchObject({
      user: { client_user_id: 'owner-1' },
      products: ['transactions'],
      transactions: { days_requested: 730 },
      webhook: 'https://pf.example.com/api/webhooks/plaid',
      account_filters: {
        depository: { account_subtypes: ['checking', 'savings'] },
        credit: { account_subtypes: ['credit card'] },
      },
    });
  });
});

describe('local sandbox Plaid configuration', () => {
  it('omits the optional webhook when local sandbox has no public HTTPS endpoint', () => {
    const payload = buildPlaidLinkTokenPayload({
      PLAID_ENV: 'sandbox',
      PLAID_CLIENT_USER_ID: 'local-owner',
      LEDGER_APP_ORIGIN: 'http://localhost:8787',
    });

    expect(payload).not.toHaveProperty('webhook');
  });

  it('requires a webhook outside sandbox', () => {
    expect(() => buildPlaidLinkTokenPayload({
      PLAID_ENV: 'production',
      PLAID_CLIENT_USER_ID: 'production-owner',
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
    })).toThrow('Plaid webhook URL is not configured.');
  });
});
