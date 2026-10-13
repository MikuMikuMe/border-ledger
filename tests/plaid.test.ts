import { describe, expect, it } from 'vitest';
import {
  MAX_PLAID_SYNC_PAGES,
  buildPlaidRequest,
  decryptAccessToken,
  encryptAccessToken,
  fetchAllPlaidTransactions,
  mapPlaidTransaction,
} from '../worker/plaid';
import { buildPlaidLinkTokenPayload } from '../worker/index';

const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
