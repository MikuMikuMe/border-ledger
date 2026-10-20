import { describe, expect, it } from 'vitest';
import { serializeTransactionsCsv } from '../src/domain/export';
import type { Transaction } from '../src/domain/types';

describe('transaction export', () => {
  it('serializes ledger records as an escaped CSV document', () => {
    const transaction: Transaction = {
      id: 'tx-1',
      accountId: 'rbc-chequing',
      date: '2026-10-10',
      merchant: 'Harbour, - Market',
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
      '2026-10-10,"Harbour, - Market",Groceries,Statement,Confirmed,-42.00,CAD,"Weekly ""shop"""',
    ].join('\n'));
  });

  it('neutralizes spreadsheet formulas and quotes carriage returns', () => {
    const transaction: Transaction = {
      id: 'tx-unsafe',
      accountId: 'rbc-chequing',
      date: '2026-10-10',
      merchant: ' =2+3',
      amountMinor: -4200,
      currency: 'CAD',
      category: '=1+1',
      kind: 'expense',
      status: 'confirmed',
      source: 'statement',
      fingerprint: 'unsafe-merchant',
      note: 'first line\rsecond line',
    };
    const csv = serializeTransactionsCsv([transaction]);

    expect(csv).toContain("2026-10-10,' =2+3,'=1+1");
    expect(csv).toContain('"first line\rsecond line"');
    expect(csv).toContain(',-42.00,CAD,');
  });
});
