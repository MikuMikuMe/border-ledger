import { describe, expect, it } from 'vitest';
import {
  calculateModifiedDietz,
  classifyWealthCashFlows,
  canonicalEventFingerprint,
  createWealthAccountRegistry,
  createWealthReport,
  createWealthSnapshot,
  replayWealthEvents,
  resolveWealthEvents,
  type WealthEvent,
} from '../src/domain/wealth';

const stock = { exchange: 'TSX', ticker: 'SHOP', type: 'stock' as const, currency: 'CAD' };
const etf = { exchange: 'NYSE', ticker: 'VTI', type: 'etf' as const, currency: 'USD' };

function event<T extends WealthEvent>(value: T): T {
  return value;
}

function openingPosition(overrides: Partial<Extract<WealthEvent, { kind: 'opening_position' }>> = {}): Extract<WealthEvent, { kind: 'opening_position' }> {
  return event({
    id: 'open', sourceId: 'open', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument: stock,
    quantity: '10', basis: { currency: 'CAD', amountMinor: 10000 }, ...overrides,
  });
}

describe('wealth domain replay', () => {
  it('replays a long-only partial sale with weighted average basis', () => {
    const result = replayWealthEvents([
      openingPosition(),
      event({ id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50000 } }),
      event({ id: 'buy', sourceId: 'buy', date: '2026-01-10', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '10', consideration: { currency: 'CAD', amountMinor: 12000 } }),
      event({ id: 'sell', sourceId: 'sell', date: '2026-02-01', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '3', proceeds: { currency: 'CAD', amountMinor: 6000 }, fee: { currency: 'CAD', amountMinor: 100 } }),
    ]);

    expect(result.positions).toEqual([{ accountId: 'brokerage', instrument: stock, quantity: '17', costBasisMinor: 18700, basisKnown: true, realizedGainMinor: 2600 }]);
  });

  it('keeps fractional quantities exact and preserves money minor units', () => {
    const result = replayWealthEvents([
      event({ id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'USD', amountMinor: 1000 } }),
      event({ id: 'one', sourceId: 'one', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: etf, quantity: '0.1', consideration: { currency: 'USD', amountMinor: 100 } }),
      event({ id: 'two', sourceId: 'two', date: '2026-01-02', kind: 'buy', accountId: 'brokerage', instrument: etf, quantity: '0.2', consideration: { currency: 'USD', amountMinor: 201 } }),
      event({ id: 'three', sourceId: 'three', date: '2026-01-03', kind: 'sell', accountId: 'brokerage', instrument: etf, quantity: '0.1', proceeds: { currency: 'USD', amountMinor: 150 } }),
    ]);

    expect(result.positions[0]).toMatchObject({ quantity: '0.2', costBasisMinor: 201, realizedGainMinor: 50 });
    expect(result.cash).toEqual([{ accountId: 'brokerage', currency: 'USD', amountMinor: 849 }]);
  });

  it('applies a split without changing total basis and rounds a partial basis deterministically', () => {
    const result = replayWealthEvents([
      openingPosition(),
      event({ id: 'split', sourceId: 'split', date: '2026-01-05', kind: 'split', accountId: 'brokerage', instrument: stock, numerator: 3, denominator: 2 }),
      event({ id: 'sell', sourceId: 'sell', date: '2026-01-06', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '1', proceeds: { currency: 'CAD', amountMinor: 1000 } }),
    ]);

    expect(result.positions[0]).toMatchObject({ quantity: '14', costBasisMinor: 9333, realizedGainMinor: 333 });
  });

  it('keeps realized and unrealized gains unavailable when opening basis is unknown', () => {
    const result = replayWealthEvents([
      openingPosition({ basis: null }),
      event({ id: 'sell', sourceId: 'sell', date: '2026-01-06', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '2', proceeds: { currency: 'CAD', amountMinor: 4000 } }),
    ]);

    expect(result.positions[0]).toMatchObject({ quantity: '8', costBasisMinor: null, basisKnown: false, realizedGainMinor: null });
  });

  it('retains a closed position row so realized gains remain auditable after full liquidation', () => {
    const result = replayWealthEvents([
      openingPosition(),
      event({ id: 'sell-all', sourceId: 'sell-all', date: '2026-01-06', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '10', proceeds: { currency: 'CAD', amountMinor: 12000 } }),
    ]);

    expect(result.positions).toEqual([{ accountId: 'brokerage', instrument: stock, quantity: '0', costBasisMinor: 0, basisKnown: true, realizedGainMinor: 2000 }]);
  });

  it('rejects invalid quantities, currency mismatches, and short sells', () => {
    expect(() => replayWealthEvents([openingPosition({ quantity: '0' })])).toThrow(/quantity/i);
    expect(() => replayWealthEvents([openingPosition(), event({ id: 'sell', sourceId: 'sell', date: '2026-01-02', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '11', proceeds: { currency: 'CAD', amountMinor: 1 } })])).toThrow(/short|quantity/i);
    expect(() => replayWealthEvents([event({ id: 'buy', sourceId: 'buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1/3', consideration: { currency: 'CAD', amountMinor: 1 } })])).toThrow(/decimal|quantity/i);
    expect(() => replayWealthEvents([event({ id: 'buy', sourceId: 'buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'USD', amountMinor: 1 } })])).toThrow(/currency/i);
    expect(() => replayWealthEvents([event({ id: 'dividend', sourceId: 'dividend', date: '2026-01-01', kind: 'dividend', accountId: 'brokerage', instrument: stock, money: { currency: 'USD', amountMinor: 1 } })])).toThrow(/currency/i);
  });

  it('canonicalizes money currencies and rejects duplicate ledger sequences', () => {
    const result = replayWealthEvents([
      event({ id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'cad', amountMinor: 1000 } }),
      event({ id: 'buy', sourceId: 'buy', sequence: 2, date: '2026-01-02', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'cad', amountMinor: 100 } }),
    ]);
    expect(result.cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: 900 }]);
    expect(() => replayWealthEvents([
      event({ id: 'first', sourceId: 'first', sequence: 7, date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }),
      event({ id: 'second', sourceId: 'second', sequence: 7, date: '2026-01-02', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }),
    ])).toThrow(/sequence/i);
  });

  it('deduplicates identical source retries and rejects conflicting source reuse', () => {
    const opening = event({ id: 'cash', sourceId: 'same-source', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } } as const);
    expect(replayWealthEvents([opening, { ...opening, id: 'retry' }]).cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: 1000 }]);
    expect(() => replayWealthEvents([opening, { ...opening, id: 'conflict', money: { currency: 'CAD', amountMinor: 1001 } }])).toThrow(/source/i);
    expect(replayWealthEvents([{ ...opening, id: 'first', sequence: 1, money: { currency: 'cad', amountMinor: 1000 } }, { ...opening, id: 'retry-sequence', sequence: 2 }]).cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: 1000 }]);
    expect(canonicalEventFingerprint({ ...opening, id: 'first', sequence: 1, money: { currency: 'cad', amountMinor: 1000 } })).toBe(canonicalEventFingerprint({ ...opening, id: 'retry-sequence', sequence: 2, money: { currency: 'CAD', amountMinor: 1000 } }));
  });

  it('preserves transfer basis and supports correction and reversal events', () => {
    const result = replayWealthEvents([
      openingPosition({ accountId: 'a' }),
      event({ id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'a', toAccountId: 'b', instrument: stock, quantity: '4' }),
      event({ id: 'cash', sourceId: 'cash', date: '2026-01-03', kind: 'opening_cash', accountId: 'a', money: { currency: 'CAD', amountMinor: 1000 } }),
      event({ id: 'reverse-cash', sourceId: 'reverse-cash', date: '2026-01-04', kind: 'reversal', targetSourceId: 'cash' }),
      event({ id: 'correction', sourceId: 'correction', date: '2026-01-05', kind: 'correction', targetSourceId: 'open', replacement: { kind: 'opening_position', date: '2026-01-01', accountId: 'a', instrument: stock, quantity: '12', basis: { currency: 'CAD', amountMinor: 12000 } } }),
    ]);

    expect(result.positions).toEqual([
      { accountId: 'a', instrument: stock, quantity: '8', costBasisMinor: 8000, basisKnown: true, realizedGainMinor: 0 },
      { accountId: 'b', instrument: stock, quantity: '4', costBasisMinor: 4000, basisKnown: true, realizedGainMinor: 0 },
    ]);
    expect(result.cash).toEqual([]);
  });

  it('rejects ambiguous multiple controls for one source and supports reversing a correction lineage', () => {
    const original = event({ id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } });
    expect(() => replayWealthEvents([
      original,
      event({ id: 'correction-a', sourceId: 'correction-a', date: '2026-01-02', kind: 'correction', targetSourceId: 'cash', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 2000 } } }),
      event({ id: 'correction-b', sourceId: 'correction-b', date: '2026-01-03', kind: 'correction', targetSourceId: 'cash', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 3000 } } }),
    ])).toThrow(/control|source|correction/i);

    const reversedCorrection = replayWealthEvents([
      original,
      event({ id: 'correction-a', sourceId: 'correction-a', date: '2026-01-02', kind: 'correction', targetSourceId: 'cash', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 2000 } } }),
      event({ id: 'reverse-correction', sourceId: 'reverse-correction', date: '2026-01-03', kind: 'reversal', targetSourceId: 'correction-a' }),
    ]);
    expect(reversedCorrection.cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: 1000 }]);
    expect(() => replayWealthEvents([
      original,
      event({ id: 'early-reversal', sourceId: 'early-reversal', date: '2025-12-31', kind: 'reversal', targetSourceId: 'cash' }),
    ])).toThrow(/date|order/i);
    expect(() => replayWealthEvents([
      original,
      event({ id: 'correction-a', sourceId: 'correction-a', date: '2026-01-02', kind: 'correction', targetSourceId: 'correction-b', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 2000 } } }),
      event({ id: 'correction-b', sourceId: 'correction-b', date: '2026-01-02', kind: 'correction', targetSourceId: 'correction-a', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 3000 } } }),
    ])).toThrow(/cycle|lineage/i);
    expect(() => replayWealthEvents([
      original,
      event({ id: 'correction', sourceId: 'correction', date: '2026-01-02', kind: 'correction', targetSourceId: 'cash', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 2000 } } }),
      event({ id: 'replacement-collision', sourceId: 'correction:replacement', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 3000 } }),
    ])).toThrow(/source|collision/i);
    const resolved = resolveWealthEvents([
      original,
      event({ id: 'linked-correction', sourceId: 'linked-correction', date: '2026-01-02', kind: 'correction', targetSourceId: 'cash', linkedBankSourceId: 'control-bank', replacement: { kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 2000 }, linkedBankSourceId: 'replacement-bank' } }),
    ]);
    expect(resolved).toEqual([expect.objectContaining({ sourceId: 'linked-correction:replacement', linkedBankSourceId: 'replacement-bank' })]);
  });

  it('does not imply brokerage margin when a buy or withdrawal would make cash negative', () => {
    expect(() => replayWealthEvents([
      event({ id: 'buy', sourceId: 'buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'CAD', amountMinor: 1 } }),
    ])).toThrow(/cash|margin/i);
    expect(() => replayWealthEvents([
      event({ id: 'withdrawal', sourceId: 'withdrawal', date: '2026-01-01', kind: 'withdrawal', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1 } }),
    ])).toThrow(/cash|margin/i);
  });

  it('uses an explicit same-day sequence instead of random source-id ordering', () => {
    const sequenceEvent = (value: unknown): WealthEvent => value as WealthEvent;
    const result = replayWealthEvents([
      sequenceEvent({ id: 'sell', sourceId: '000-sell', sequence: 4, date: '2026-01-01', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '1', proceeds: { currency: 'CAD', amountMinor: 120 } }),
      sequenceEvent({ id: 'buy', sourceId: '999-buy', sequence: 3, date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'CAD', amountMinor: 100 } }),
      sequenceEvent({ id: 'open-position', sourceId: '998-position', sequence: 2, date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument: stock, quantity: '1', basis: { currency: 'CAD', amountMinor: 100 } }),
      sequenceEvent({ id: 'open-cash', sourceId: '997-cash', sequence: 1, date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }),
    ]);
    expect(result.positions[0]).toMatchObject({ quantity: '1', costBasisMinor: 100, realizedGainMinor: 20 });
    const fallback = replayWealthEvents([
      { id: 'cash-fallback', sourceId: 'z-cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } },
      { id: 'position-fallback', sourceId: 'y-position', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument: stock, quantity: '1', basis: { currency: 'CAD', amountMinor: 100 } },
      { id: 'buy-fallback', sourceId: 'x-buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'CAD', amountMinor: 100 } },
      { id: 'sell-fallback', sourceId: 'w-sell', date: '2026-01-01', kind: 'sell', accountId: 'brokerage', instrument: stock, quantity: '1', proceeds: { currency: 'CAD', amountMinor: 120 } },
    ]);
    expect(fallback.positions[0]).toMatchObject({ quantity: '1', realizedGainMinor: 20 });
  });
});

describe('wealth snapshots and performance', () => {
  const accounts = createWealthAccountRegistry([
    { id: 'aggregate', name: 'Bank total', kind: 'linked_bank', mode: 'aggregate', currency: 'CAD' },
    { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
  ]);

  it('values holdings only on dated quotes and never substitutes zero for missing values', () => {
    const snapshot = createWealthSnapshot([
      event({ id: 'aggregate-cash', sourceId: 'aggregate-cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'aggregate', money: { currency: 'CAD', amountMinor: 100000 } }),
      openingPosition(),
      event({ id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 10000 } }),
    ], {
      asOf: '2026-02-01', accounts, valuations: [{ accountId: 'brokerage', instrument: stock, asOf: '2026-02-01', priceMinor: 1200, source: 'manual' }],
    });

    expect(snapshot.positions[0]).toMatchObject({ marketValueMinor: 12000, unrealizedGainMinor: 2000 });
    expect(snapshot.totalByCurrency).toEqual({ CAD: 122000 });
    expect(snapshot.totalStatusByCurrency).toEqual({ CAD: 'complete' });
    const canonicalValuation = createWealthSnapshot([openingPosition()], { asOf: '2026-02-01', accounts, valuations: [{ accountId: 'brokerage', instrument: { exchange: 'tsx', ticker: 'shop', type: 'stock', currency: 'cad' }, asOf: '2026-02-01', priceMinor: 1200, source: 'manual' }] });
    expect(canonicalValuation.positions[0].valuation?.instrument).toEqual(stock);
    const incomplete = createWealthSnapshot([openingPosition()], { asOf: '2026-02-01', accounts, valuations: [] });
    expect(incomplete.totalByCurrency).toEqual({});
    expect(incomplete.totalStatusByCurrency).toEqual({ CAD: 'incomplete' });
    const asOf = createWealthSnapshot([
      openingPosition(),
      event({ id: 'future', sourceId: 'future', date: '2026-03-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 999 } }),
    ], { asOf: '2026-02-01', accounts, valuations: [] });
    expect(asOf.cash).toEqual([]);
  });

  it('invalidates pre-split valuations until a post-split observation exists', () => {
    const splitEvents = [
      openingPosition({ quantity: '1', basis: { currency: 'CAD', amountMinor: 10000 } }),
      event({ id: 'split', sourceId: 'split', date: '2026-01-02', kind: 'split', accountId: 'brokerage', instrument: stock, numerator: 2, denominator: 1 }),
    ];
    const beforePostSplitQuote = createWealthSnapshot(splitEvents, { asOf: '2026-01-03', accounts, valuations: [{ accountId: 'brokerage', instrument: stock, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' }] });
    expect(beforePostSplitQuote.positions[0]).toMatchObject({ quantity: '2', marketValueMinor: null, unrealizedGainMinor: null });
    expect(beforePostSplitQuote.totalStatusByCurrency).toEqual({ CAD: 'incomplete' });
    const postSplitQuote = createWealthSnapshot(splitEvents, { asOf: '2026-01-03', accounts, valuations: [{ accountId: 'brokerage', instrument: stock, asOf: '2026-01-03', priceMinor: 6000, source: 'manual' }] });
    expect(postSplitQuote.positions[0]).toMatchObject({ quantity: '2', marketValueMinor: 12000, unrealizedGainMinor: 2000 });
    const sameDayPostSplitQuote = createWealthSnapshot(splitEvents, { asOf: '2026-01-02', accounts, valuations: [{ accountId: 'brokerage', instrument: stock, asOf: '2026-01-02', priceMinor: 6000, source: 'manual' }] });
    expect(sameDayPostSplitQuote.positions[0]).toMatchObject({ quantity: '2', marketValueMinor: 12000, unrealizedGainMinor: 2000 });
  });

  it('requires actual start/end valuations and complete dated external flows for Modified Dietz', () => {
    const flows = [{ sourceId: 'contribution', date: '2026-01-11', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, direction: 'inflow' as const, kind: 'contribution' as const }];
    expect(calculateModifiedDietz(10000, 12000, flows, '2026-01-01', '2026-01-31')).toMatchObject({ available: true, value: expect.closeTo(1000 / (10000 + 1000 * (20 / 30)), 8) });
    expect(calculateModifiedDietz(null, 12000, flows, '2026-01-01', '2026-01-31')).toMatchObject({ available: false, value: null, reason: 'missing_start_valuation' });
    expect(calculateModifiedDietz(10000, 12000, [{ ...flows[0], date: null as unknown as string }], '2026-01-01', '2026-01-31')).toMatchObject({ available: false, reason: 'incomplete_flows' });
    expect(calculateModifiedDietz(10000, 12000, [{ ...flows[0], date: '2026-01-01' }], '2026-01-01', '2026-01-31')).toMatchObject({ available: true, value: 0.2 });
    expect(calculateModifiedDietz(10000, 13000, [{ ...flows[0], date: '2026-01-31' }], '2026-01-01', '2026-01-31')).toMatchObject({ available: true, value: 0.2 });
    expect(calculateModifiedDietz(10000, 12000, [flows[0], { ...flows[0], sourceId: 'usd', money: { currency: 'USD', amountMinor: 100 } }], '2026-01-01', '2026-01-31')).toMatchObject({ available: false, value: null, reason: 'incomplete_flows' });
    expect(calculateModifiedDietz(10000, 12000, [{ ...flows[0], money: { currency: 'USD', amountMinor: 1000 }, date: '2026-01-01' }, { ...flows[0], sourceId: 'cad-active' }], '2026-01-01', '2026-01-31')).toMatchObject({ available: false, value: null, reason: 'incomplete_flows' });
  });

  it('does not let unrelated household cash enter a portfolio return', () => {
    const portfolioEvent = event({ id: 'portfolio-contribution', sourceId: 'portfolio-contribution', date: '2026-01-11', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } });
    const report = createWealthReport([portfolioEvent], [
      { sourceId: 'portfolio-bank', date: '2026-01-11', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, direction: 'inflow', kind: 'bank', linkedWealthSourceId: 'portfolio-contribution' },
      { sourceId: 'household-expense', date: '2026-01-12', accountId: 'household', money: { currency: 'CAD', amountMinor: 500 }, direction: 'outflow', kind: 'bank' },
    ], {
      asOf: '2026-01-31', accounts, periodStart: '2026-01-01', periodEnd: '2026-01-31', startValuation: { CAD: 10000 }, endValuation: { CAD: 12000 },
    });
    expect(report.cashFlows.find((flow) => flow.sourceId === 'household-expense')).toMatchObject({ classification: 'ambiguous', includedInPerformance: false });
    expect(report.modifiedDietz).toMatchObject({ available: false, value: null, reason: 'incomplete_flows' });
  });

  it('requires an explicit incomplete-history allowance when snapshot replay has no opening cash', () => {
    const buy: WealthEvent = event({ id: 'buy-without-cash', sourceId: 'buy-without-cash', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'CAD', amountMinor: 100 } });
    expect(() => createWealthSnapshot([buy], { asOf: '2026-01-02', accounts, valuations: [] })).toThrow(/cash|margin/i);
    expect(createWealthSnapshot([buy], { asOf: '2026-01-02', accounts, valuations: [], allowNegativeCash: true }).cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: -100 }]);
  });

  it('classifies only explicitly linked external cash flows and flags ambiguous records', () => {
    const events: WealthEvent[] = [
      event({ id: 'contribution', sourceId: 'contribution', date: '2026-01-02', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 } }),
      event({ id: 'buy', sourceId: 'buy', date: '2026-01-03', kind: 'buy', accountId: 'brokerage', instrument: stock, quantity: '1', consideration: { currency: 'CAD', amountMinor: 1000 } }),
    ];
    const result = classifyWealthCashFlows([
      { sourceId: 'bank-contribution', date: '2026-01-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, direction: 'inflow', kind: 'bank', linkedWealthSourceId: 'contribution' },
      { sourceId: 'bank-duplicate', date: '2026-01-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, direction: 'inflow', kind: 'bank', linkedWealthSourceId: 'contribution' },
      { sourceId: 'trade', date: '2026-01-03', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, direction: 'outflow', kind: 'trade', linkedWealthSourceId: 'buy' },
      { sourceId: 'unknown', date: '2026-01-04', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 50 }, direction: null, kind: 'bank' },
    ], events);

    expect(result).toEqual([
      expect.objectContaining({ sourceId: 'bank-contribution', classification: 'external_contribution', includedInPerformance: true }),
      expect.objectContaining({ sourceId: 'trade', classification: 'trade', includedInPerformance: false }),
      expect.objectContaining({ sourceId: 'unknown', classification: 'ambiguous', includedInPerformance: false }),
    ]);
  });

  it('builds a JSON-safe report with unavailable Dietz when the period is incomplete', () => {
    const report = createWealthReport([], [], { asOf: '2026-01-31', accounts, periodStart: '2026-01-01', periodEnd: '2026-01-31', startValuation: null, endValuation: { CAD: 1 } });
    expect(report.modifiedDietz).toMatchObject({ available: false, value: null });
    expect(JSON.stringify(report)).not.toContain('bigint');
  });
});
