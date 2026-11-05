import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { replayWealthEvents, type WealthEvent } from '../src/domain/wealth';
import { appendWealthEvent, readWealthReport, upsertWealthAccount, upsertWealthValuation } from '../worker/wealth-store';

const scope = { userId: 'owner', ledgerId: 'personal' };
const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock' as const, currency: 'CAD' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
const money = (amountMinor: number) => ({ currency: 'CAD', amountMinor });
function fixture() { const f = createSqliteD1Fixture(); fixtures.push(f); return f; }

function reopenedSaleEvents(): WealthEvent[] {
  return [
    { id: 'unknown', sourceId: 'unknown', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: null },
    { id: 'first-sale', sourceId: 'first-sale', date: '2026-01-02', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(100), fee: null },
    { id: 'repurchase', sourceId: 'repurchase', date: '2026-01-03', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(50), fee: null },
    { id: 'second-sale', sourceId: 'second-sale', date: '2026-01-04', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(70), fee: null },
  ];
}

async function aggregateAccounts(outsideKind: 'manual_asset' | 'brokerage' = 'manual_asset') {
  const f = fixture();
  for (const [id, kind, value] of [['brokerage', 'brokerage', 10000], ['outside', outsideKind, 20000]] as const) {
    await upsertWealthAccount(f.db, scope, { id, name: id, kind, mode: 'aggregate', currency: 'CAD' });
    await upsertWealthValuation(f.db, scope, { id: `${id}-start`, accountId: id, asOf: '2026-01-01', priceMinor: value, source: 'manual' });
  }
  return f;
}

async function transfer(f: ReturnType<typeof fixture>, outgoing = false, linkedBankSourceId?: string) {
  await appendWealthEvent(f.db, scope, { id: 'crossing', sourceId: 'crossing', date: '2026-01-02', kind: 'transfer', transferKind: 'cash', fromAccountId: outgoing ? 'brokerage' : 'outside', toAccountId: outgoing ? 'outside' : 'brokerage', money: money(10000), transferId: 'crossing', linkedBankSourceId });
}

async function report(f: ReturnType<typeof fixture>) {
  return readWealthReport(f.db, scope, { asOf: '2026-01-03', from: '2026-01-01', to: '2026-01-03' });
}

describe('Wealth cumulative gains and portfolio boundary returns', () => {
  it('keeps cumulative realized gains unavailable after reopening and selling a known-basis holding', () => {
    const result = replayWealthEvents(reopenedSaleEvents());
    expect(result.positions[0]).toMatchObject({ quantity: '0', costBasisMinor: 0, basisKnown: true, realizedGainMinor: null });
  });

  it('recalculates cumulative gains when a correction supplies the missing historical basis', () => {
    const result = replayWealthEvents([...reopenedSaleEvents(), { id: 'basis-correction', sourceId: 'basis-correction', date: '2026-01-05', kind: 'correction', targetSourceId: 'unknown', replacement: { kind: 'opening_position', date: '2026-01-01', accountId: 'brokerage', instrument, quantity: '1', basis: money(50) } }]);
    expect(result.positions[0]).toMatchObject({ realizedGainMinor: 70 });
  });

  it.each([false, true])('treats a boundary cash transfer as capital (outgoing=%s)', async outgoing => {
    const f = await aggregateAccounts();
    await transfer(f, outgoing);
    await upsertWealthValuation(f.db, scope, { id: 'brokerage-end', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: outgoing ? 0 : 20000, source: 'manual' });
    const result = await report(f);
    expect(result.modifiedDietz).toMatchObject({ available: true, value: 0 });
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: true, value: 0 });
    expect(result.investmentCashFlows).toEqual([expect.objectContaining({ classification: outgoing ? 'external_withdrawal' : 'external_contribution', includedInPerformance: true, linkedWealthSourceId: 'crossing' })]);
    expect(result.householdCashFlows).toEqual([]);
  });

  it('retains unknown realized gains after a partial sale of the reopened holding', () => {
    const events = reopenedSaleEvents();
    events[3] = { id: 'partial-sale', sourceId: 'partial-sale', date: '2026-01-04', kind: 'sell', accountId: 'brokerage', instrument, quantity: '0.5', proceeds: money(35), fee: null };
    expect(replayWealthEvents(events).positions[0]).toMatchObject({ quantity: '0.5', costBasisMinor: 25, realizedGainMinor: null });
  });

  it('uses a corrected boundary-transfer amount without duplicating capital', async () => {
    const f = await aggregateAccounts();
    await transfer(f);
    await appendWealthEvent(f.db, scope, { id: 'correct-crossing', sourceId: 'correct-crossing', date: '2026-01-03', kind: 'correction', targetSourceId: 'crossing', replacement: { kind: 'transfer', date: '2026-01-02', transferKind: 'cash', fromAccountId: 'outside', toAccountId: 'brokerage', money: money(5000), transferId: 'crossing' } });
    await upsertWealthValuation(f.db, scope, { id: 'corrected-end', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: 15000, source: 'manual' });
    const result = await report(f);
    expect(result.modifiedDietz).toMatchObject({ available: true, value: 0 });
    expect(result.investmentCashFlows).toEqual([expect.objectContaining({ money: money(5000), linkedWealthSourceId: 'correct-crossing:replacement' })]);
  });

  it('excludes a reversed boundary transfer from investment flows', async () => {
    const f = await aggregateAccounts();
    await transfer(f);
    await appendWealthEvent(f.db, scope, { id: 'reverse-crossing', sourceId: 'reverse-crossing', date: '2026-01-03', kind: 'reversal', targetSourceId: 'crossing' });
    await upsertWealthValuation(f.db, scope, { id: 'reversed-end', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: 10000, source: 'manual' });
    const result = await report(f);
    expect(result.modifiedDietz).toMatchObject({ available: true, value: 0 });
    expect(result.investmentCashFlows).toEqual([]);
  });

  it.each(['2026-01-01', '2026-01-03'])('uses end-of-day capital-flow treatment on %s', async date => {
    const f = await aggregateAccounts();
    await appendWealthEvent(f.db, scope, { id: 'boundary-day', sourceId: 'boundary-day', date, kind: 'transfer', transferKind: 'cash', fromAccountId: 'outside', toAccountId: 'brokerage', money: money(10000), transferId: 'boundary-day' });
    await upsertWealthValuation(f.db, scope, { id: 'boundary-end', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: date === '2026-01-01' ? 10000 : 20000, source: 'manual' });
    const result = await report(f);
    expect(result.modifiedDietz).toMatchObject({ available: true, value: 0 });
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: true, value: 0 });
  });

  it.each([
    { outgoing: false, bankKind: 'income', available: true },
    { outgoing: false, bankKind: 'expense', available: false },
    { outgoing: true, bankKind: 'expense', available: true },
    { outgoing: true, bankKind: 'transfer', available: true },
    { outgoing: true, bankKind: 'transfer', available: false, amount: 5000 },
  ])('deduplicates linked bank capital and reviews opposing bank directions ($outgoing/$bankKind)', async ({ outgoing, bankKind, available, ...options }) => {
    const f = await aggregateAccounts();
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('bank','Synthetic','Synthetic','CAD','chequing','import_only','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-crossing','bank','2026-01-02','Synthetic',?,'CAD','Transfer',?,'confirmed','manual','bank-crossing','personal')").bind('amount' in options ? options.amount : 10000, bankKind).run();
    await transfer(f, outgoing, 'bank-crossing');
    await upsertWealthValuation(f.db, scope, { id: 'linked-end', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: outgoing ? 0 : 20000, source: 'manual' });
    const result = await report(f);
    expect(result.modifiedDietz.available).toBe(available);
    expect(result.modifiedDietzByCurrency.CAD.available).toBe(available);
    expect(result.investmentCashFlows).toHaveLength(1);
    expect(result.householdCashFlows).toEqual(bankKind === 'transfer' ? [] : [expect.objectContaining({ classification: 'internal_transfer', includedInPerformance: false })]);
  });

  it('does not turn a transfer between brokerages into external capital', async () => {
    const f = await aggregateAccounts('brokerage');
    await transfer(f);
    for (const [accountId, priceMinor] of [['brokerage', 20000], ['outside', 10000]] as const) {
      await upsertWealthValuation(f.db, scope, { id: `${accountId}-end`, accountId, asOf: '2026-01-03', priceMinor, source: 'manual' });
    }
    const result = await report(f);
    expect(result.investmentCashFlows).toEqual([]);
    expect(result.modifiedDietz).toMatchObject({ available: true, value: 0 });
  });
});
