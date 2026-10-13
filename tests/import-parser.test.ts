import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from '../src/domain/imports';

describe('statement import parser', () => {
  it('normalizes a CSV statement with currency and date fields', () => {
    const result = parseStatementCsv(
      'Date,Description,Amount,Currency,Category\n2026-10-09,Metro Toronto,-12.50,CAD,Transport\n2026-10-08,Refund - Cafe,4.00,CAD,',
      { accountId: 'rbc-chequing', source: 'statement' },
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions).toMatchObject([
      { date: '2026-10-09', merchant: 'Metro Toronto', amountMinor: -1250, currency: 'CAD', category: 'Transport' },
      { date: '2026-10-08', merchant: 'Refund - Cafe', amountMinor: 400, kind: 'refund' },
    ]);
  });

  it('reports malformed rows without discarding the valid rows', () => {
    const result = parseStatementCsv(
      'Date,Description,Amount,Currency\n2026-10-09,Good row,-12.50,CAD\nnot-a-date,Bad date,-1.00,CAD\n2026-10-08,Missing amount,,CNY',
      { accountId: 'boc-cny', source: 'statement' },
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
  });
});
