import { describe, expect, it } from 'vitest';
import { serializeTransactionsCsv } from '../src/domain/export';
import type { Transaction } from '../src/domain/types';

describe('transaction export', () => {
  it('serializes ledger records as an escaped CSV document', () => {
    const transaction: Transaction = {
      id: 'tx-1',
      accountId: 'rbc-chequing',
      date: '2026-10-10',
      merchant: 'Harbour, Market',
      amountMinor: -4200,
      currency: 'CAD',
      category: 'Groceries',
      kind: 'expense',
      status: 'confirmed',
      source: 'statement',
      fingerprint: 'market-2026-10-10-4200',
      note: 'Weekly "shop"',
    };

    expect(serializeTransactionsCsv([transaction])).toBe([
      'Date,Merchant,Category,Source,State,Amount,Currency,Note',
      '2026-10-10,"Harbour, Market",Groceries,Statement,Confirmed,-42.00,CAD,"Weekly ""shop"""',
    ].join('\n'));
  });
});
