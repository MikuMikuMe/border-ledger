import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthAccounts, readWealthSnapshot, upsertWealthAccount, upsertWealthInstrument, upsertWealthValuation, wealthExportCsv } from '../worker/wealth-store';

const scope = { userId: 'owner', ledgerId: 'personal' };
const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock' as const, currency: 'CAD' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
function fixture() { const f = createSqliteD1Fixture(); fixtures.push(f); return f; }

type TransitionFixtureInput = { mode: 'aggregate' | 'holdings'; value: number; positionSource?: string };
async function correctedTransition({ mode, value, positionSource = 'opening-ry' }: TransitionFixtureInput) {
  const f = fixture();
  await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: mode === 'aggregate' ? 'holdings' : 'aggregate', currency: 'CAD' });
  await upsertWealthInstrument(f.db, scope, { id: 'ry', ...instrument });
  await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode, currency: 'CAD', effectiveDate: '2026-01-02', ...(mode === 'aggregate' ? { openingValueMinor: 10000 } : { openingPositions: [{ id: 'opening-ry', sourceId: positionSource, instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 10000 }, priceMinor: 10000 }] }) });
  for (const [id, priceMinor] of [['first-correction', 15000], ['latest-correction', value]] as const) {
    const { revision } = await readWealthAccounts(f.db, scope);
    await upsertWealthValuation(f.db, scope, { id, accountId: 'brokerage', instrument: mode === 'holdings' ? instrument : null, asOf: '2026-01-02', priceMinor, source: 'manual', expectedRevision: revision });
  }
  return f;
}

describe('canonical export of corrected transition valuations', () => {
  it.each([
    { mode: 'aggregate', value: 20000 }, { mode: 'aggregate', value: 0 },
    { mode: 'holdings', value: 20000 }, { mode: 'holdings', value: 0 },
  ] as const)('roundtrips the latest $mode opening value $value exactly once', async ({ mode, value }) => {
    const source = await correctedTransition({ mode, value });
    const csv = await wealthExportCsv(source.db, scope);
    const sourcePreview = await createWealthImportPreview(source.db, scope, { csv, operationId: 'repeat-source' });
    expect(sourcePreview.errors).toEqual([]);
    expect(sourcePreview.duplicates).toHaveLength(sourcePreview.rows.length);
    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, scope, { csv, operationId: 'fresh-preview' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(destination.db, scope, preview.previewId, { expectedRevision: 0, operationId: 'fresh-commit' })).resolves.toMatchObject({ committed: expect.any(Number) });
    expect((await readWealthSnapshot(destination.db, scope, { asOf: '2026-01-03' })).totalByCurrency).toEqual({ CAD: value });
    expect(await wealthExportCsv(destination.db, scope)).toBe(csv);
    const repeated = await createWealthImportPreview(destination.db, scope, { csv, operationId: 'repeat-destination' });
    expect(repeated.errors).toEqual([]);
    expect(repeated.duplicates).toHaveLength(repeated.rows.length);
    const { revision } = await readWealthAccounts(destination.db, scope);
    await expect(commitWealthImport(destination.db, scope, repeated.previewId, { expectedRevision: revision, operationId: 'duplicate-commit' })).resolves.toMatchObject({ committed: 0 });
  });

  it('preserves unrelated dates and stored transition audit values', async () => {
    const source = await correctedTransition({ mode: 'aggregate', value: 20000 });
    const before = await source.db.prepare('SELECT payload_json FROM wealth_account_mode_transitions').first<{ payload_json: string }>();
    await upsertWealthValuation(source.db, scope, { id: 'later-price', accountId: 'brokerage', asOf: '2026-01-03', priceMinor: 30000, source: 'manual' });
    const csv = await wealthExportCsv(source.db, scope);
    expect((await source.db.prepare('SELECT payload_json FROM wealth_account_mode_transitions').first<{ payload_json: string }>())?.payload_json).toBe(before?.payload_json);
    expect(JSON.parse(before!.payload_json).openingValueMinor).toBe(10000);
    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, scope, { csv, operationId: 'distinct-dates' });
    expect(preview.errors).toEqual([]);
    await commitWealthImport(destination.db, scope, preview.previewId, { expectedRevision: 0, operationId: 'distinct-dates-commit' });
    expect((await readWealthSnapshot(destination.db, scope, { asOf: '2026-01-02' })).totalByCurrency).toEqual({ CAD: 20000 });
    expect((await readWealthSnapshot(destination.db, scope, { asOf: '2026-01-03' })).totalByCurrency).toEqual({ CAD: 30000 });
  });

  it('preserves another security price on the same opening date', async () => {
    const source = await correctedTransition({ mode: 'holdings', value: 20000 });
    const other = { ...instrument, ticker: 'SHOP' };
    await upsertWealthInstrument(source.db, scope, { id: 'shop', ...other });
    await upsertWealthValuation(source.db, scope, { id: 'other-security', accountId: 'brokerage', instrument: other, asOf: '2026-01-02', priceMinor: 5000, source: 'manual' });
    const csv = await wealthExportCsv(source.db, scope);
    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, scope, { csv, operationId: 'distinct-security' });
    expect(preview.errors).toEqual([]);
    await commitWealthImport(destination.db, scope, preview.previewId, { expectedRevision: 0, operationId: 'distinct-security-commit' });
    expect((await destination.db.prepare('SELECT COUNT(*) AS n FROM wealth_valuations').first<{ n: number }>())?.n).toBe(2);
    const snapshot = await readWealthSnapshot(destination.db, scope, { asOf: '2026-01-03' });
    expect(snapshot.positions[0]).toMatchObject({ costBasisMinor: 10000, marketValueMinor: 20000 });
    expect(await wealthExportCsv(destination.db, scope)).toBe(csv);
  });

  it('keeps event IDs separate from opening source IDs when filtering generated rows', async () => {
    const source = await correctedTransition({ mode: 'holdings', value: 20000, positionSource: 'external-position-source' });
    await appendWealthEvent(source.db, scope, { id: 'external-position-source', sourceId: 'cash-source', date: '2026-01-03', kind: 'contribution', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } });
    const csv = await wealthExportCsv(source.db, scope);
    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, scope, { csv, operationId: 'separate-identities' });
    expect(preview.errors).toEqual([]);
    await commitWealthImport(destination.db, scope, preview.previewId, { expectedRevision: 0, operationId: 'separate-identities-commit' });
    expect((await readWealthSnapshot(destination.db, scope, { asOf: '2026-01-03' })).totalByCurrency).toEqual({ CAD: 20100 });
  });

  it('rejects a standalone event duplicating a generated opening cash row', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' });
    const id = 'opening-cash:brokerage:2026-01-02';
    const event = { id, sourceId: id, date: '2026-01-02', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 10000 } };
    const json = '"' + JSON.stringify(event).replaceAll('"', '""') + '"';
    const csv = 'record_type,id,account_id,date,effective_date,from_mode,to_mode,opening_cash_minor,currency,event_json\n' +
      'mode_transition,t,brokerage,2026-01-02,2026-01-02,aggregate,holdings,10000,CAD,\n' +
      `event,${id},brokerage,2026-01-02,,,,,CAD,${json}\n`;
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'opening-event-collision' });
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it.each(['id', 'source'] as const)('rejects a generated opening event colliding with an existing %s', async field => {
    const f = fixture();
    for (const [id, kind] of [['outside', 'manual_asset'], ['brokerage', 'brokerage']] as const) await upsertWealthAccount(f.db, scope, { id, name: id, kind, mode: 'aggregate', currency: 'CAD' });
    const generated = 'opening-cash:brokerage:2026-01-02';
    await appendWealthEvent(f.db, scope, { id: field === 'id' ? generated : 'existing-transfer', sourceId: field === 'source' ? generated : 'existing-transfer', date: '2026-01-01', kind: 'transfer', transferKind: 'cash', fromAccountId: 'outside', toAccountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, transferId: 'earlier' });
    const csv = 'record_type,id,account_id,effective_date,from_mode,to_mode,opening_cash_minor,currency\nmode_transition,t,brokerage,2026-01-02,aggregate,holdings,1000,CAD\n';
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: `existing-opening-${field}` });
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('rejects a generated valuation ID already stored beneath a correction on another account', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'other', name: 'Other', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD' });
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    await upsertWealthValuation(f.db, scope, { id: 'account-value:brokerage:2026-01-02', accountId: 'other', asOf: '2026-01-01', priceMinor: 10000, source: 'manual' });
    const { revision } = await readWealthAccounts(f.db, scope);
    await upsertWealthValuation(f.db, scope, { id: 'other-correction', accountId: 'other', asOf: '2026-01-01', priceMinor: 20000, source: 'manual', expectedRevision: revision });
    const csv = 'record_type,id,account_id,effective_date,from_mode,to_mode,opening_value_minor,currency\nmode_transition,t,brokerage,2026-01-02,holdings,aggregate,1000,CAD\n';
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'existing-opening-price-id' });
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it('rejects standalone CSV valuations that collide with a generated transition opening value', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    const csv = 'record_type,id,account_id,effective_date,from_mode,to_mode,opening_value_minor,currency,as_of,price_minor,source\nmode_transition,t,brokerage,2026-01-02,holdings,aggregate,10000,CAD,,,\nvaluation,v,brokerage,,,,,CAD,2026-01-02,20000,manual\n';
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'opening-collision' });
    expect(preview.errors.length).toBeGreaterThan(0);
  });
});
