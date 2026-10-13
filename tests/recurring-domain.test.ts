import { describe, expect, it } from 'vitest';
import { analyzeRecurring, equivalentMinor } from '../src/domain/recurring';
import type { RecurringStream } from '../src/domain/recurring';

function stream(overrides: Partial<RecurringStream> = {}): RecurringStream {
  return {
    id: 'stream-1',
    itemId: 'item-1',
    streamId: 'source-1',
    accountId: 'account-1',
    merchantName: 'Transit pass',
    merchantEntityId: null,
    currency: 'CAD',
    sourceStatus: 'MATURE',
    sourceFrequency: 'MONTHLY',
    frequency: 'MONTHLY',
    isOutflow: true,
    firstDate: '2026-01-01',
    lastDate: '2026-10-01',
    predictedNextDate: '2026-10-13',
    averageAmountMinor: -1200,
    lastAmountMinor: -1200,
    predictedAmountMinor: -1200,
    memberships: [
      { providerTransactionId: 'tx-1', pendingProviderTransactionId: null, date: '2026-09-01', amountMinor: -1200, currency: 'CAD', status: 'posted', kind: 'expense' },
      { providerTransactionId: 'tx-2', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1500, currency: 'CAD', status: 'posted', kind: 'expense' },
    ],
    sourceUpdatedAt: '2026-10-13T14:00:00.000Z',
    classification: 'subscription',
    ...overrides,
  };
}

describe('recurring estimate rules', () => {
  it('converts supported frequencies with integer minor-unit rounding', () => {
    expect(equivalentMinor(-1200, 'WEEKLY', 'month')).toBe(-5200);
    expect(equivalentMinor(-2000, 'BIWEEKLY', 'month')).toBe(-4333);
    expect(equivalentMinor(-2000, 'BIWEEKLY', 'year')).toBe(-52000);
    expect(equivalentMinor(-12000, 'ANNUALLY', 'month')).toBe(-1000);
    expect(equivalentMinor(-1200, 'UNKNOWN', 'month')).toBeNull();
  });

  it('keeps currency totals separate, uses last amount for upcoming, and bounds day 29 inclusively', () => {
    const result = analyzeRecurring([
      stream(),
      stream({
        id: 'stream-cny',
        accountId: 'account-cny',
        currency: 'CNY',
        frequency: 'BIWEEKLY',
        sourceFrequency: 'BIWEEKLY',
        averageAmountMinor: -1000,
        lastAmountMinor: -2500,
        predictedAmountMinor: -1000,
        predictedNextDate: '2026-11-11',
        memberships: [{ providerTransactionId: 'cny-1', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -2500, currency: 'CNY', status: 'posted', kind: 'expense' }],
      }),
      stream({ id: 'day-30', predictedNextDate: '2026-11-12' }),
    ], '2026-10-13');
    expect(result.monthlyByCurrency).toEqual({ CAD: -2400, CNY: -2167 });
    expect(result.yearlyByCurrency).toEqual({ CAD: -28800, CNY: -26000 });
    expect(result.subscriptionByCurrency).toEqual({ CAD: -2400, CNY: -2167 });
    expect(result.upcoming.map((item) => [item.id, item.nextExpectedAmountMinor])).toEqual([['stream-1', -1200], ['stream-cny', -2500]]);
  });

  it('excludes transfers, inactive/tombstoned streams, user exclusions, and flags real latest-payment changes only', () => {
    const result = analyzeRecurring([
      stream(),
      stream({ id: 'transfer', isOutflow: true, classification: 'other', memberships: [{ providerTransactionId: 'transfer-1', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -5000, currency: 'CAD', status: 'posted', kind: 'transfer' }] }),
      stream({ id: 'inactive', sourceStatus: 'INACTIVE' }),
      stream({ id: 'excluded', classification: 'excluded' }),
      stream({ id: 'one-payment', memberships: [{ providerTransactionId: 'same', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1200, currency: 'CAD', status: 'posted', kind: 'expense' }, { providerTransactionId: 'same', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1500, currency: 'CAD', status: 'posted', kind: 'expense' }] }),
    ], '2026-10-13');
    expect(result.monthlyByCurrency.CAD).toBe(-2400);
    expect(result.subscriptionByCurrency.CAD).toBe(-2400);
    expect(result.latestPaymentChanges.map((item) => item.id)).toEqual(['stream-1']);
  });
});
