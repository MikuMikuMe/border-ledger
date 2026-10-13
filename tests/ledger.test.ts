import { describe, expect, it } from 'vitest';
import { calculateSpending, classifyTransaction, filterTransactions, mergeImportedTransactions } from '../src/domain/ledger';
import type { Transaction } from '../src/domain/types';

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  accountId: 'rbc-chequing',
  date: '2026-10-10',
  merchant: 'Harbour Market',
  amountMinor: -4200,
  currency: 'CAD',
  category: 'Groceries',
  kind: 'expense',
  status: 'confirmed',
  source: 'statement',
  fingerprint: 'market-2026-10-10-4200',
  ...overrides,
});

describe('ledger rules', () => {
  it('counts only confirmed expenses and excludes transfers and repayments', () => {
    const result = calculateSpending([
      tx({ id: 'expense', amountMinor: -4200 }),
      tx({ id: 'income', amountMinor: 10000, kind: 'income' }),
      tx({ id: 'transfer', amountMinor: -5000, kind: 'transfer' }),
      tx({ id: 'repayment', amountMinor: -8000, kind: 'transfer', merchant: 'RBC Visa payment' }),
      tx({ id: 'refund', amountMinor: 1200, kind: 'refund' }),
      tx({ id: 'pending', amountMinor: -900, status: 'provisional', source: 'alert' }),
    ], { includeProvisional: false });

    expect(result.CAD).toBe(3000);
  });

  it('keeps provisional alerts out of confirmed totals unless requested', () => {
    const result = calculateSpending([
      tx({ amountMinor: -4200 }),
      tx({ id: 'alert', amountMinor: -1800, status: 'provisional', source: 'alert' }),
    ], { includeProvisional: true });

    expect(result.CAD).toBe(6000);
  });

  it('classifies negative and positive statement amounts without losing refunds', () => {
    expect(classifyTransaction({ amountMinor: -100, description: 'Coffee shop' })).toBe('expense');
    expect(classifyTransaction({ amountMinor: 100, description: 'Refund - Coffee shop' })).toBe('refund');
    expect(classifyTransaction({ amountMinor: -100, description: 'Transfer to savings' })).toBe('transfer');
  });

  it('deduplicates identical imports but keeps two legitimate same-day purchases', () => {
    const existing = [tx({ id: 'existing', fingerprint: 'same' })];
    const imported = [
      tx({ id: 'duplicate', fingerprint: 'same' }),
      tx({ id: 'new-a', fingerprint: 'different-a', merchant: 'Cafe' }),
      tx({ id: 'new-b', fingerprint: 'different-b', merchant: 'Cafe' }),
    ];

    expect(mergeImportedTransactions(existing, imported).map((item) => item.id)).toEqual(['existing', 'new-a', 'new-b']);
  });

  it('filters transactions by source for the additional transaction filters', () => {
    const result = filterTransactions([
      tx({ id: 'plaid', source: 'plaid' }),
      tx({ id: 'statement', source: 'statement' }),
      tx({ id: 'alert', source: 'alert' }),
    ], { source: 'plaid' });

    expect(result.map((item) => item.id)).toEqual(['plaid']);
  });
});
