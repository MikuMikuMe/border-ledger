import { describe, expect, it } from 'vitest';
import {
  selectPlaidAccounts,
  validateImportPayload,
  validatePlaidExchangeInput,
  validateRecurringListQuery,
  validateRecurringSummaryQuery,
} from '../worker/validation';

describe('Worker input validation', () => {
  it('requires a non-empty, unique account selection for Plaid exchange', () => {
    expect(validatePlaidExchangeInput({ publicToken: 'public-sandbox-token', accountIds: ['acct-1', 'acct-1'] })).toEqual({
      error: 'Choose at least one unique Plaid account.',
    });
    expect(validatePlaidExchangeInput({ publicToken: 'public-sandbox-token' })).toEqual({
      error: 'Choose at least one Plaid account before connecting.',
    });
  });

  it('selects only accounts returned by Plaid', () => {
    const accounts = [{ account_id: 'acct-1' }, { account_id: 'acct-2' }];
    expect(selectPlaidAccounts(accounts, ['acct-2'])).toEqual([{ account_id: 'acct-2' }]);
    expect(selectPlaidAccounts(accounts, ['acct-3'])).toBeNull();
  });

  it('accepts every registered currency in recurring list and summary filters while rejecting unknown codes', () => {
    expect(validateRecurringListQuery(new URLSearchParams('currency=USD'))).toEqual({ currency: 'USD' });
    expect(validateRecurringSummaryQuery(new URLSearchParams('start=2026-10-01&end=2026-10-31&today=2026-10-13&currency=HKD'))).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      today: '2026-10-13',
      currency: 'HKD',
    });
    expect(validateRecurringListQuery(new URLSearchParams('currency=XYZ'))).toEqual({ error: 'The recurring currency filter is not valid.' });
    expect(validateRecurringSummaryQuery(new URLSearchParams('start=2026-10-01&end=2026-10-31&today=2026-10-13&currency=XYZ'))).toEqual({ error: 'The recurring currency filter is not valid.' });
  });

  it('rejects malformed imported transactions before persistence', () => {
    expect(validateImportPayload({
      accountId: 'account-1',
      filename: 'statement.csv',
      transactions: [{
        id: 'txn-1',
        date: '2026-10-12',
        merchant: 'Coffee',
        amountMinor: Number.NaN,
        currency: 'CAD',
        category: 'Dining',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'fingerprint-1',
      }],
    })).toEqual({ error: 'Each imported amount must be a finite integer.' });
  });

  it('accepts a bounded, well-formed import', () => {
    const result = validateImportPayload({
      accountId: 'account-1',
      filename: 'statement.csv',
      transactions: [{
        id: 'txn-1',
        date: '2026-10-12',
        merchant: 'Coffee',
        amountMinor: -450,
        currency: 'CAD',
        category: 'Dining',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'fingerprint-1',
      }],
    });

    expect(result).toMatchObject({ accountId: 'account-1', transactions: [{ id: 'txn-1', amountMinor: -450 }] });
  });
});
