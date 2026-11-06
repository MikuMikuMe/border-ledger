import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { appendWealthEvent, readWealthSnapshot, upsertWealthAccount, upsertWealthValuation } from '../worker/wealth-store';
import type { CanonicalInstrument } from '../src/domain/wealth-types';

const scope = { userId: 'owner', ledgerId: 'personal' };
const instrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' };
const fixtures: Array<ReturnType<typeof createSqliteD1Fixture>> = [];
const money = (amountMinor: number) => ({ currency: 'CAD', amountMinor });

function fixture() {
  const value = createSqliteD1Fixture();
  fixtures.push(value);
  return value;
}

afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });

async function cashFixture() {
  const f = fixture();
  await upsertWealthAccount(f.db, scope, { id: 'cash', name: 'Cash', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
  await appendWealthEvent(f.db, scope, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'cash', money: money(10000) });
  await appendWealthEvent(f.db, scope, { id: 'later', sourceId: 'later', date: '2026-01-03', kind: 'withdrawal', accountId: 'cash', money: money(8000) });
  return f;
}

async function positionFixture() {
  const f = fixture();
  for (const id of ['source', 'destination']) {
    await upsertWealthAccount(f.db, scope, { id, name: id, kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    await upsertWealthValuation(f.db, scope, { id: `${id}-price`, accountId: id, instrument, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' });
  }
  await appendWealthEvent(f.db, scope, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'source', instrument, quantity: '2', basis: money(20000) });
  return f;
}

async function resetAccount(f: ReturnType<typeof fixture>, id: string) {
  await upsertWealthAccount(f.db, scope, { id, name: id, kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 10000 });
  await upsertWealthAccount(f.db, scope, {
    id, name: id, kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-01-04',
    openingPositions: [{ id: `${id}-fresh`, sourceId: `${id}-fresh`, instrument, quantity: '1', basis: money(15000), priceMinor: 10000 }],
  });
}

async function transferOne(f: ReturnType<typeof fixture>) {
  await appendWealthEvent(f.db, scope, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '1', transferId: 'linked-transfer' });
}

describe('PR 85 historical write and segment isolation regressions', () => {
  it('rejects a backdated cash withdrawal and preserves the subsequent readable state', async () => {
    const f = await cashFixture();
    const before = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' });
    await expect(appendWealthEvent(f.db, scope, { id: 'backdated', sourceId: 'backdated', date: '2026-01-02', kind: 'withdrawal', accountId: 'cash', money: money(5000) })).rejects.toMatchObject({ code: 'negative_cash' });
    const after = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' });
    expect(after.revision).toBe(before.revision);
    expect(after.cash).toEqual([{ accountId: 'cash', currency: 'CAD', amountMinor: 2000 }]);
  });

  it('rejects a backdated opening correction that breaks a later withdrawal', async () => {
    const f = await cashFixture();
    await expect(appendWealthEvent(f.db, scope, {
      id: 'correction', sourceId: 'correction', date: '2026-01-04', kind: 'correction', targetSourceId: 'opening',
      replacement: { date: '2026-01-01', kind: 'opening_cash', accountId: 'cash', money: money(5000) },
    })).rejects.toMatchObject({ code: 'negative_cash' });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' })).cash[0].amountMinor).toBe(2000);
  });

  it('rejects a historical sale that would overdraw a later sale', async () => {
    const f = await positionFixture();
    await appendWealthEvent(f.db, scope, { id: 'later-sale', sourceId: 'later-sale', date: '2026-01-03', kind: 'sell', accountId: 'source', instrument, quantity: '1', proceeds: money(10000) });
    await expect(appendWealthEvent(f.db, scope, { id: 'early-sale', sourceId: 'early-sale', date: '2026-01-02', kind: 'sell', accountId: 'source', instrument, quantity: '2', proceeds: money(20000) })).rejects.toMatchObject({ code: 'missing_position' });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-05' })).positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'source', quantity: '1', costBasisMinor: 10000 })]));
  });

  it('checks historical dates even when a later reversal removes the dependent withdrawal', async () => {
    const f = await cashFixture();
    await appendWealthEvent(f.db, scope, { id: 'reverse', sourceId: 'reverse', date: '2026-01-05', kind: 'reversal', targetSourceId: 'later' });
    await expect(appendWealthEvent(f.db, scope, { id: 'backdated', sourceId: 'backdated', date: '2026-01-02', kind: 'withdrawal', accountId: 'cash', money: money(5000) })).rejects.toMatchObject({ code: 'negative_cash' });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' })).cash[0].amountMinor).toBe(2000);
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-06' })).cash[0].amountMinor).toBe(10000);
  });

  it('checks the old segment even when a later holdings opening replaces its balance', async () => {
    const f = await cashFixture();
    await upsertWealthAccount(f.db, scope, { id: 'cash', name: 'Cash', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-04', openingValueMinor: 2000 });
    await upsertWealthAccount(f.db, scope, { id: 'cash', name: 'Cash', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-01-05', openingCashMinor: 10000 });
    await expect(appendWealthEvent(f.db, scope, { id: 'backdated', sourceId: 'backdated', date: '2026-01-02', kind: 'withdrawal', accountId: 'cash', money: money(5000) })).rejects.toMatchObject({ code: 'negative_cash' });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-03' })).cash[0].amountMinor).toBe(2000);
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-06' })).cash[0].amountMinor).toBe(10000);
  });

  it('accepts a valid historical withdrawal and includes it in the later balance', async () => {
    const f = await cashFixture();
    await expect(appendWealthEvent(f.db, scope, { id: 'valid', sourceId: 'valid', date: '2026-01-02', kind: 'withdrawal', accountId: 'cash', money: money(1000) })).resolves.toMatchObject({ event: { sourceId: 'valid' } });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' })).cash[0].amountMinor).toBe(1000);
  });
  it('keeps real accounts whose identifiers overlap replay-only segment names', async () => {
    const f = await positionFixture();
    await transferOne(f);
    const id = '__wealth_segment__source__initial';
    await upsertWealthAccount(f.db, scope, { id, name: 'Real account', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    await resetAccount(f, 'source');
    await expect(readWealthSnapshot(f.db, scope, { asOf: '2026-01-05' })).resolves.toMatchObject({ totalByCurrency: { CAD: 20000 } });
  });
  it('retains real events whose source IDs overlap generated historical event IDs', async () => {
    const f = await positionFixture();
    await transferOne(f);
    await resetAccount(f, 'source');
    await appendWealthEvent(f.db, scope, {
      id: 'real-contribution', sourceId: 'opening:segment:__wealth_segment__source__initial', date: '2026-01-05',
      kind: 'contribution', accountId: 'destination', money: money(10000),
    });
    const snapshot = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-06' });
    expect(snapshot.cash).toEqual([{ accountId: 'destination', currency: 'CAD', amountMinor: 10000 }]);
    expect(snapshot.totalByCurrency).toEqual({ CAD: 30000 });
  });

  it('does not replay a current source cash transfer twice through an old intermediate segment', async () => {
    const f = await positionFixture();
    for (const id of ['cash-source', 'final']) await upsertWealthAccount(f.db, scope, { id, name: id, kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    await appendWealthEvent(f.db, scope, { id: 'cash-opening', sourceId: 'cash-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'cash-source', money: money(10000) });
    await appendWealthEvent(f.db, scope, { id: 'cash-transfer', sourceId: 'cash-transfer', date: '2026-01-01', kind: 'transfer', transferKind: 'cash', fromAccountId: 'cash-source', toAccountId: 'source', money: money(6000), transferId: 'cash-linked' });
    await transferOne(f);
    await appendWealthEvent(f.db, scope, { id: 'onward', sourceId: 'onward', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'destination', toAccountId: 'final', instrument, quantity: '1', transferId: 'onward-linked' });
    await resetAccount(f, 'destination');
    await upsertWealthValuation(f.db, scope, { id: 'final-price', accountId: 'final', instrument, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' });
    const snapshot = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-05' });
    expect(snapshot.cash).toEqual(expect.arrayContaining([
      { accountId: 'source', currency: 'CAD', amountMinor: 6000 },
      { accountId: 'cash-source', currency: 'CAD', amountMinor: 4000 },
    ]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 40000 });
  });

  it.each(['source', 'destination'])('isolates old transfer legs when %s reopens with fresh holdings', async id => {
    const f = await positionFixture();
    await transferOne(f);
    await resetAccount(f, id);
    const snapshot = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-05' });
    expect(snapshot.positions.filter(position => position.quantity !== '0')).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'source', quantity: '1', costBasisMinor: id === 'source' ? 15000 : 10000 }),
      expect.objectContaining({ accountId: 'destination', quantity: '1', costBasisMinor: id === 'destination' ? 15000 : 10000 }),
    ]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 20000 });
    expect(JSON.stringify(snapshot)).not.toContain('__wealth_segment__');
  });
});
