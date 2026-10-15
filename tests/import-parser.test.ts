import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from '../src/domain/imports';
import { createCurrencyRegistry } from '../src/domain/currencies';

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

  it('keeps USD and HKD rows as their own currency and scale', () => {
    const result = parseStatementCsv('Date,Description,Amount,Currency\n2026-10-13,USD shop,-12.34,USD\n2026-10-13,HKD shop,-56.78,HKD', { accountId: 'multi-card', source: 'statement' });
    expect(result.errors).toEqual([]);
    expect(result.transactions.map(({ currency, amountMinor }) => ({ currency, amountMinor }))).toEqual([
      { currency: 'USD', amountMinor: -1234 },
      { currency: 'HKD', amountMinor: -5678 },
    ]);
  });

  it('uses a registered account currency only when the statement omits its currency column', () => {
    const jpy = parseStatementCsv(
      'Date,Description,Amount\n2026-10-13,Yen shop,-123',
      { accountId: 'jpy-account', source: 'statement', defaultCurrency: 'JPY' },
    );
    const unknown = parseStatementCsv(
      'Date,Description,Amount\n2026-10-13,Unknown shop,-1.00',
      { accountId: 'unknown-account', source: 'statement', defaultCurrency: 'XYZ' },
    );

    expect(jpy).toMatchObject({ errors: [], transactions: [{ currency: 'JPY', amountMinor: -123 }] });
    expect(unknown.transactions).toEqual([]);
    expect(unknown.errors).toContain('Row 2: currency must be registered.');
  });

  it('uses injected zero- and three-decimal metadata and rejects excessive scale', () => {
    const registry = createCurrencyRegistry([{ code: 'JPY', minorUnitDigits: 0 }, { code: 'KWD', minorUnitDigits: 3 }]);
    const result = parseStatementCsv('Date,Description,Amount,Currency\n2026-10-13,JPY shop,-123,JPY\n2026-10-13,KWD shop,-1.234,KWD\n2026-10-13,Bad yen,-1.2,JPY\n2026-10-13,Bad dinar,-1.2345,KWD', { accountId: 'multi-card', source: 'statement', registry });
    expect(result.transactions.map(({ currency, amountMinor }) => ({ currency, amountMinor }))).toEqual([
      { currency: 'JPY', amountMinor: -123 },
      { currency: 'KWD', amountMinor: -1234 },
    ]);
    expect(result.errors).toHaveLength(2);
  });

  it('keeps valid rows while rejecting unknown currency and unsafe minor-unit amounts', () => {
    const result = parseStatementCsv('Date,Description,Amount,Currency\n2026-10-13,Good,-1.00,USD\n2026-10-13,Unknown,-1.00,ZZZ\n2026-10-13,Overflow,-90071992547409.92,CAD', { accountId: 'multi-card', source: 'statement' });
    expect(result.transactions.map(({ currency, amountMinor }) => ({ currency, amountMinor }))).toEqual([{ currency: 'USD', amountMinor: -100 }]);
    expect(result.errors).toHaveLength(3);
  });
});
