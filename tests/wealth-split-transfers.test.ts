import { describe, expect, it } from 'vitest';
import {
  createWealthAccountRegistry,
  createWealthSnapshot,
  resolveWealthEvents,
  type WealthEvent,
} from '../src/domain/wealth';
import type { CanonicalInstrument } from '../src/domain/wealth-types';

const instrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' };
const otherInstrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' };
const accounts = createWealthAccountRegistry([
  { id: 'source', name: 'Source', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
  { id: 'destination', name: 'Destination', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
  { id: 'other', name: 'Other', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
]);

function event<T extends WealthEvent>(value: T): T {
  return value;
}

interface OpeningFixture { readonly sourceId: string; readonly accountId: string; readonly quantity: string; readonly options?: { readonly dated?: string; readonly security?: CanonicalInstrument } }

function opening({ sourceId, accountId, quantity, options = {} }: OpeningFixture) {
  const dated = options.dated ?? '2026-01-01';
  const security = options.security ?? instrument;
  return event({ id: sourceId, sourceId, date: dated, kind: 'opening_position', accountId, instrument: security, quantity, basis: { currency: security.currency, amountMinor: 10000 } });
}

interface PriceFixture { readonly accountId: string; readonly asOf: string; readonly security?: CanonicalInstrument; readonly priceMinor?: number }

function valuation({ accountId, asOf, security = instrument, priceMinor = 10000 }: PriceFixture) {
  return { accountId, instrument: security, asOf, priceMinor, source: 'manual' as const };
}

describe('split-aware position transfer valuation', () => {
  it('requires a post-split quote after a split position moves to another account', () => {
    const snapshot = createWealthSnapshot([
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'transfer', sourceId: 'transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '2' }),
    ], { asOf: '2026-01-04', accounts, valuations: [valuation({ accountId: 'destination', asOf: '2026-01-02' })] });

    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'destination', quantity: '2', marketValueMinor: null, valuation: null }),
    ]));
    expect(snapshot.totalStatusByCurrency).toEqual({ CAD: 'incomplete' });
  });

  it('propagates split boundaries through multiple position-transfer hops and preserves fractional quantities', () => {
    const snapshot = createWealthSnapshot([
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'first-transfer', sourceId: 'first-transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '1.5' }),
      event({ id: 'second-transfer', sourceId: 'second-transfer', date: '2026-01-05', kind: 'transfer', transferKind: 'position', fromAccountId: 'destination', toAccountId: 'other', instrument, quantity: '0.5' }),
    ], { asOf: '2026-01-05', accounts, valuations: [valuation({ accountId: 'other', asOf: '2026-01-02' })] });

    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'other', quantity: '0.5', marketValueMinor: null }),
      expect.objectContaining({ accountId: 'destination', quantity: '1', marketValueMinor: null }),
    ]));
  });

  it('keeps split boundaries scoped to the receiving account and security', () => {
    const snapshot = createWealthSnapshot([
      opening({ sourceId: 'opening-source', accountId: 'source', quantity: '1' }),
      opening({ sourceId: 'opening-other-security', accountId: 'source', quantity: '1', options: { security: otherInstrument } }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'transfer', sourceId: 'transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '2' }),
    ], { asOf: '2026-01-04', accounts, valuations: [
      valuation({ accountId: 'destination', asOf: '2026-01-02' }),
      valuation({ accountId: 'source', asOf: '2026-01-02', security: otherInstrument }),
    ] });

    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'destination', instrument, marketValueMinor: null }),
      expect.objectContaining({ accountId: 'source', instrument: otherInstrument, marketValueMinor: 10000 }),
    ]));
  });

  it('keeps a known split price boundary when the same security is reopened after liquidation', () => {
    const events = [
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'sell', sourceId: 'sell', date: '2026-01-04', kind: 'sell', accountId: 'source', instrument, quantity: '2', proceeds: { currency: 'CAD', amountMinor: 20000 } }),
      opening({ sourceId: 'fresh-opening', accountId: 'source', quantity: '1', options: { dated: '2026-01-05' } }),
    ];
    const snapshot = createWealthSnapshot(events, { asOf: '2026-01-05', accounts, valuations: [valuation({ accountId: 'source', asOf: '2026-01-02' })] });
    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'source', instrument, quantity: '1', marketValueMinor: null }),
    ]));
    const current = createWealthSnapshot(events, { asOf: '2026-01-05', accounts, valuations: [valuation({ accountId: 'source', asOf: '2026-01-05', security: instrument, priceMinor: 5000 })] });
    expect(current.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'source', quantity: '1', marketValueMinor: 5000 }),
    ]));
  });

  it('retains the source price boundary after all split shares transfer out and the source reopens', () => {
    const snapshot = createWealthSnapshot([
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'transfer', sourceId: 'transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '2' }),
      opening({ sourceId: 'fresh-opening', accountId: 'source', quantity: '1', options: { dated: '2026-01-05' } }),
    ], { asOf: '2026-01-05', accounts, valuations: [valuation({ accountId: 'source', asOf: '2026-01-02' }), valuation({ accountId: 'destination', asOf: '2026-01-04', security: instrument, priceMinor: 5000 })] });
    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'source', quantity: '1', marketValueMinor: null }),
      expect.objectContaining({ accountId: 'destination', quantity: '2', marketValueMinor: 10000 }),
    ]));
    expect(snapshot.totalStatusByCurrency.CAD).toBe('incomplete');
  });

  it('uses resolved chronological events so reversed splits do not poison transfers', () => {
    const events: WealthEvent[] = [
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-03', kind: 'split', accountId: 'source', instrument, numerator: 2, denominator: 1 }),
      event({ id: 'transfer', sourceId: 'transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '1' }),
      event({ id: 'reverse', sourceId: 'reverse', date: '2026-01-05', kind: 'reversal', targetSourceId: 'split' }),
    ];
    const snapshot = createWealthSnapshot(events, { asOf: '2026-01-05', accounts, valuations: [valuation({ accountId: 'destination', asOf: '2026-01-02' })] });

    expect(resolveWealthEvents(events).some((item) => item.kind === 'split')).toBe(false);
    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'destination', quantity: '1', marketValueMinor: 10000 }),
    ]));
  });

  it('applies same-day sequence order when a split and transfer share a date', () => {
    const snapshot = createWealthSnapshot([
      opening({ sourceId: 'opening', accountId: 'source', quantity: '1' }),
      event({ id: 'transfer', sourceId: 'transfer', sequence: 1, date: '2026-01-03', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '1' }),
      event({ id: 'split', sourceId: 'split', sequence: 2, date: '2026-01-03', kind: 'split', accountId: 'destination', instrument, numerator: 2, denominator: 1 }),
    ], { asOf: '2026-01-03', accounts, valuations: [valuation({ accountId: 'destination', asOf: '2026-01-02' })] });

    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'destination', quantity: '2', marketValueMinor: null }),
    ]));
  });
});
