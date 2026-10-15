import { describe, expect, it } from 'vitest';
import { aggregateReportTransactions } from '../src/domain/reporting';

describe('full-window report aggregation', () => {
  it('aggregates every selected row instead of inheriting the activity page cap', () => {
    const transactions = Array.from({ length: 501 }, (_, index) => ({
      date: '2026-10-13',
      amountMinor: 100,
      currency: 'CAD' as const,
      kind: 'expense' as const,
      status: 'confirmed' as const,
      source: index % 2 === 0 ? 'plaid' as const : 'statement' as const,
    }));

    const report = aggregateReportTransactions(transactions);

    expect(report.currencyTotals).toEqual([
      { currency: 'CAD', confirmedMinorUnits: 50_100, provisionalMinorUnits: 0, confirmedCount: 501, provisionalCount: 0 },
    ]);
    expect(report.dailyTotals).toEqual([
      { date: '2026-10-13', currency: 'CAD', confirmedMinorUnits: 50_100, provisionalMinorUnits: 0 },
    ]);
    expect(report.sourceCoverage).toEqual({ plaid: 251, statement: 250 });
  });

  it('keeps refunds negative and excludes review, void-like, and transfer rows', () => {
    const report = aggregateReportTransactions([
      { date: '2026-10-12', amountMinor: 1_000, currency: 'CAD', kind: 'expense', status: 'confirmed', source: 'alert' },
      { date: '2026-10-12', amountMinor: 250, currency: 'CAD', kind: 'refund', status: 'confirmed', source: 'plaid' },
      { date: '2026-10-12', amountMinor: 2_000, currency: 'CAD', kind: 'expense', status: 'needs_review', source: 'statement' },
      { date: '2026-10-12', amountMinor: 500, currency: 'CAD', kind: 'transfer', status: 'confirmed', source: 'plaid' },
      { date: '2026-10-12', amountMinor: 700, currency: 'CAD', kind: 'expense', status: 'provisional', source: 'alert' },
    ]);

    expect(report.currencyTotals).toEqual([
      { currency: 'CAD', confirmedMinorUnits: 750, provisionalMinorUnits: 0, confirmedCount: 2, provisionalCount: 0 },
    ]);
    expect(report.excludedCount).toBe(1);
    expect(report.reviewCount).toBe(1);
  });

  it('can include provisional additions without changing confirmed totals', () => {
    const transactions = [{ date: '2026-10-12', amountMinor: 700, currency: 'CNY', kind: 'expense' as const, status: 'provisional' as const, source: 'alert' as const }];

    expect(aggregateReportTransactions(transactions).currencyTotals).toEqual([]);
    expect(aggregateReportTransactions(transactions, { includeProvisional: true }).currencyTotals).toEqual([
      { currency: 'CNY', confirmedMinorUnits: 0, provisionalMinorUnits: 700, confirmedCount: 0, provisionalCount: 1 },
    ]);
  });

  it('rejects invalid calendar ranges', () => {
    expect(() => aggregateReportTransactions([], { from: '2026-02-30' })).toThrow();
    expect(() => aggregateReportTransactions([], { from: '2026-10-14', to: '2026-10-13' })).toThrow();
  });
});
