import { handleWealthApi } from '../worker/wealth-http';
import { afterEach, describe, expect, it } from 'vitest';
import type { WealthEvent } from '../src/domain/wealth';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthEvents, upsertWealthAccount, upsertWealthValuation, wealthExportCsv } from '../worker/wealth-store';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
const scope = { userId: 'owner', ledgerId: 'personal' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
const money = (amountMinor: number) => ({ currency: 'CAD', amountMinor });
async function fixture() {
  const f = createSqliteD1Fixture(); fixtures.push(f);
  await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('bank','Bank','Synthetic','CAD','checking','active','personal')").run();
  for (const id of ['T', 'U']) {
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES(?,'bank','2026-01-02','Synthetic',100,'CAD','Investment','income','confirmed','manual',?,'personal')").bind(id,id).run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES(?,'personal','manual',?,?,'bank',?,'synthetic')").bind(`row-${id}`, `identity-${id}`, id, `alias-${id}`).run();
  }
  await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
  return f;
}
function linkedChain(withReversal: boolean): WealthEvent[] {
  return [
    { id: 'base', sourceId: 'base', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'T' },
    { id: 'c1', sourceId: 'c1', kind: 'correction', date: '2026-01-03', targetSourceId: 'base', replacement: { kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: withReversal ? 'T' : 'U' } },
    ...(withReversal ? [{ id: 'r1', sourceId: 'r1', kind: 'reversal', date: '2026-01-04', targetSourceId: 'c1' } as WealthEvent] : []),
    { id: 'c2', sourceId: 'c2', kind: 'correction', date: '2026-01-05', targetSourceId: withReversal ? 'r1' : 'c1', replacement: { kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'identity-T' } },
  ];
}
function eventCsv(events: readonly WealthEvent[]): string {
  return 'record_type,event_json\n' + events.map(event => 'event,"' + JSON.stringify(event).replaceAll('"', '""') + '"').join('\n');
}
describe('Wealth bank and audit control lineage', () => {
  it.each([false, true])('allows bank-link reuse only within its control lineage (reversal=%s)', async withReversal => {
    const f = await fixture();
    for (const event of linkedChain(withReversal)) await appendWealthEvent(f.db, scope, event);
    await expect(appendWealthEvent(f.db, scope, { id: 'unrelated', sourceId: 'unrelated', date: '2026-01-06', kind: 'contribution', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'identity-T' })).rejects.toMatchObject({ code: 'bank_link_conflict' });
    const restored = await fixture();
    const preview = await createWealthImportPreview(restored.db, scope, { csv: await wealthExportCsv(f.db, scope), operationId: 'restore' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(restored.db, scope, preview.previewId, { expectedRevision: preview.revision })).resolves.toMatchObject({ committed: linkedChain(withReversal).length });
  });
  it('validates a batch control chain that extends stored linked history', async () => {
    const f = await fixture(); const chain = linkedChain(true);
    await appendWealthEvent(f.db, scope, chain[0]);
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv(chain.slice(1)), operationId: 'extend' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: preview.revision })).resolves.toMatchObject({ committed: 3 });
  });
  it('includes controls in every affected account and instrument audit history', async () => {
    const f = await fixture();
    await upsertWealthAccount(f.db, scope, { id: 'other', name: 'Other', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock' as const, currency: 'CAD' };
    const replacementInstrument = { ...instrument, ticker: 'SHOP' };
    for (const event of [
      { id: 'position', sourceId: 'position', kind: 'opening_position', date: '2026-01-01', accountId: 'brokerage', instrument, quantity: '1', basis: null },
      { id: 'move', sourceId: 'move', kind: 'correction', date: '2026-01-02', targetSourceId: 'position', replacement: { kind: 'opening_position', date: '2026-01-01', accountId: 'other', instrument: replacementInstrument, quantity: '1', basis: null } },
      { id: 'undo', sourceId: 'undo', kind: 'reversal', date: '2026-01-03', targetSourceId: 'move' },
    ] as WealthEvent[]) await appendWealthEvent(f.db, scope, event);
    expect((await readWealthEvents(f.db, scope, { accountId: 'brokerage', instrumentKey: 'TSX:RY:stock:CAD' })).events.map(event => event.id)).toEqual(['position','move','undo']);
    expect((await readWealthEvents(f.db, scope, { accountId: 'other', instrumentKey: 'TSX:SHOP:stock:CAD' })).events.map(event => event.id)).toEqual(['move','undo']);
    await appendWealthEvent(f.db, scope, { id: 'unrelated-position', sourceId: 'unrelated-position', kind: 'opening_position', date: '2026-01-01', accountId: 'brokerage', instrument: replacementInstrument, quantity: '1', basis: null });
    for (const value of [instrument, replacementInstrument]) await upsertWealthValuation(f.db, scope, { id: value.ticker, accountId: 'brokerage', instrument: value, asOf: '2026-01-01', priceMinor: 100, source: 'manual' });
    const query = '?accountId=brokerage&instrumentKey=TSX%3ARY%3Astock%3ACAD';
    const eventsResponse = await handleWealthApi(new Request('https://fixture.test/api/wealth/events' + query), f.db, scope);
    expect((await eventsResponse!.json() as { events: WealthEvent[] }).events.map(event => event.id)).toEqual(['position','move','undo']);
    const valuationsResponse = await handleWealthApi(new Request('https://fixture.test/api/wealth/valuations' + query), f.db, scope);
    expect((await valuationsResponse!.json() as { valuations: { id: string }[] }).valuations.map(value => value.id)).toEqual(['RY']);

  });
});
