import { afterEach, describe, expect, it } from 'vitest';
import { createWealthSnapshot, replayWealthEvents, type WealthEvent } from '../src/domain/wealth';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthReport, readWealthSnapshot, upsertWealthAccount, wealthExportCsv } from '../worker/wealth-store';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

const money = (amountMinor: number) => ({ currency: 'CAD', amountMinor });
const opening: WealthEvent = { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(10000) };
const withdrawal: WealthEvent = { id: 'withdrawal', sourceId: 'withdrawal', date: '2026-01-02', kind: 'withdrawal', accountId: 'brokerage', money: money(10000) };
const scope = { ledgerId: 'personal', userId: 'owner' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
function fixture() { const f = createSqliteD1Fixture(); fixtures.push(f); return f; }
function controls(kinds: readonly ('reversal' | number)[]): WealthEvent[] {
  return kinds.map((kind, index) => ({ id: `control-${index}`, sourceId: `control-${index}`, date: `2026-01-0${index + 3}`, targetSourceId: index ? `control-${index - 1}` : 'withdrawal', ...(kind === 'reversal' ? { kind } : { kind: 'correction', replacement: { kind: 'withdrawal', date: '2026-01-02', accountId: 'brokerage', money: money(kind) } }) } as WealthEvent));
}

const cases: { controls: ('reversal' | number)[]; remaining: number }[] = [
  { controls: [], remaining: 0 },
  { controls: ['reversal'], remaining: 10000 },
  { controls: ['reversal', 'reversal'], remaining: 0 },
  { controls: ['reversal', 'reversal', 'reversal'], remaining: 10000 },
  { controls: [6000, 2000], remaining: 8000 },
  { controls: [6000, 2000, 'reversal'], remaining: 4000 },
  { controls: [6000, 'reversal', 'reversal'], remaining: 4000 },
  { controls: ['reversal', 2500], remaining: 7500 },
  { controls: ['reversal', 2500, 'reversal'], remaining: 10000 },
];

describe('Wealth lifecycle contracts', () => {
  it.each(cases)('resolves the complete control chain $controls to $remaining', value => {
    const events = [opening, withdrawal, ...controls(value.controls)];
    const expected = [{ accountId: 'brokerage', currency: 'CAD', amountMinor: value.remaining }];
    expect(replayWealthEvents(events).cash).toEqual(expected);
    expect(replayWealthEvents([...events].reverse()).cash).toEqual(expected);
  });

  it('keeps known zero coverage and zero returns after withdrawing all cash', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    for (const event of [opening, withdrawal]) await appendWealthEvent(f.db, scope, event);
    const report = await readWealthReport(f.db, scope, { asOf: '2026-01-02', from: '2026-01-01', to: '2026-01-02' });
    expect(report.totalByCurrency).toEqual({ CAD: 0 });
    expect(report.modifiedDietzByCurrency.CAD).toMatchObject({ available: true, value: 0 });
  });

  it('does not turn a missing holding price into complete zero coverage', () => {
    const snapshot = createWealthSnapshot([opening, withdrawal, { id: 'unknown', sourceId: 'unknown', date: '2026-01-02', kind: 'opening_position', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' }, quantity: '1', basis: null }], { asOf: '2026-01-02', accounts: [{ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }], valuations: [] });
    expect(snapshot.cash[0].amountMinor).toBe(0);
    expect(snapshot.positions[0].marketValueMinor).toBeNull();
    expect(snapshot.totalStatusByCurrency.CAD).toBe('incomplete');
  });
  it('replays accepted controls consistently through reports, historical cutoffs and CSV round trips', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    for (const event of [opening, withdrawal, ...controls(['reversal', 'reversal', 'reversal'])]) await appendWealthEvent(f.db, scope, event);
    const restored = fixture();
    const preview = await createWealthImportPreview(restored.db, scope, { csv: await wealthExportCsv(f.db, scope), operationId: 'restore-preview' });
    expect(preview.errors).toEqual([]);
    await commitWealthImport(restored.db, scope, preview.previewId, { expectedRevision: preview.revision, operationId: 'restore-commit' });
    for (const [asOf, amount] of [['2026-01-02', 0], ['2026-01-03', 10000], ['2026-01-04', 0], ['2026-01-05', 10000]] as const) {
      for (const db of [f.db, restored.db]) {
        const snapshot = await readWealthSnapshot(db, scope, { asOf });
        const report = await readWealthReport(db, scope, { asOf });
        expect(snapshot.totalByCurrency).toEqual({ CAD: amount });
        expect(report.totalByCurrency).toEqual(snapshot.totalByCurrency);
      }
    }
  });
});
