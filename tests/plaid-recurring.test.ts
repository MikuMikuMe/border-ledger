import { describe, expect, it } from 'vitest';
import { validRecurringResponse } from './fixtures/recurring/valid';
import { normalizeRecurringSnapshot, type PlaidRecurringResponse } from '../worker/plaid-recurring';

describe('Plaid recurring adapter', () => {
  it('normalizes approved CAD and CNY streams with signed minor units and membership IDs', () => {
    const snapshot = normalizeRecurringSnapshot(validRecurringResponse as unknown as PlaidRecurringResponse, 'item-1', new Map([
      ['plaid-cad', 'account-cad'],
      ['plaid-cny', 'account-cny'],
    ]));

    expect(snapshot.sourceUpdatedAt).toBe('2026-10-13T14:00:00.000Z');
    expect(snapshot.streams).toHaveLength(2);
    expect(snapshot.streams[0]).toMatchObject({
      id: 'item-1:stream-cad',
      accountId: 'account-cad',
      merchantName: 'Metro Toronto',
      currency: 'CAD',
      frequency: 'MONTHLY',
      sourceStatus: 'MATURE',
      averageAmountMinor: -1234,
      lastAmountMinor: -1300,
      predictedAmountMinor: -1234,
      predictedNextDate: '2026-11-01',
    });
    expect(snapshot.streams[0].memberships).toEqual([{ providerTransactionId: 'posted-cad-1', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1234, currency: 'CAD' }]);
    expect(snapshot.streams[1]).toMatchObject({
      id: 'item-1:stream-cny',
      accountId: 'account-cny',
      merchantName: null,
      currency: 'CNY',
      frequency: 'SEMI_MONTHLY',
      sourceStatus: 'EARLY_DETECTION',
      averageAmountMinor: 120000,
      lastAmountMinor: 120000,
      predictedNextDate: null,
    });
  });

  it('retains source status and frequency values while mapping unknown values safely', () => {
    const statuses = ['MATURE', 'EARLY_DETECTION', 'INACTIVE', 'TOMBSTONED'];
    const frequencies = ['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'ANNUALLY', 'UNKNOWN'];
    const response = {
      updated_at: null,
      outflow_streams: statuses.map((status, index) => ({
        ...(validRecurringResponse.outflow_streams[0]),
        stream_id: `status-${index}`,
        status,
        frequency: frequencies[index],
      })),
      inflow_streams: [],
    };
    const snapshot = normalizeRecurringSnapshot(response as unknown as PlaidRecurringResponse, 'item-1', new Map([['plaid-cad', 'account-cad']]));
    expect(snapshot.sourceUpdatedAt).toBeNull();
    expect(snapshot.streams.map((stream) => stream.sourceStatus)).toEqual(statuses);
    expect(snapshot.streams.map((stream) => stream.frequency)).toEqual(frequencies.slice(0, statuses.length));
  });

  it('reports unsupported currency and excludes unapproved accounts without publishing them', () => {
    const response = {
      updated_at: '2026-10-13T14:00:00.000Z',
      outflow_streams: [
        { ...validRecurringResponse.outflow_streams[0], stream_id: 'usd', account_id: 'plaid-usd', average_amount: { amount: 5, iso_currency_code: 'USD' } },
        { ...validRecurringResponse.outflow_streams[0], stream_id: 'unapproved', account_id: 'not-selected' },
      ],
      inflow_streams: [],
    };
    const snapshot = normalizeRecurringSnapshot(response as unknown as PlaidRecurringResponse, 'item-1', new Map([['plaid-usd', 'account-usd']]));
    expect(snapshot.streams).toHaveLength(0);
    expect(snapshot.coverageWarnings).toEqual(expect.arrayContaining(['unsupported_currency', 'unapproved_account']));
  });

  it('rejects malformed supported data before publication', () => {
    const malformed = {
      ...validRecurringResponse,
      outflow_streams: [{ ...validRecurringResponse.outflow_streams[0], first_date: '2026-02-30' }],
    };
    expect(() => normalizeRecurringSnapshot(malformed as unknown as PlaidRecurringResponse, 'item-1', new Map([['plaid-cad', 'account-cad']]))).toThrow('first_date');
    expect(() => normalizeRecurringSnapshot({ outflow_streams: 'not-an-array', inflow_streams: [] } as unknown as PlaidRecurringResponse, 'item-1', new Map())).toThrow('outflow_streams');
  });
});
