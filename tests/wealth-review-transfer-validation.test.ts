import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { appendWealthEvent, createWealthImportPreview, readWealthAccounts, readWealthEvents, readWealthReport, upsertWealthAccount } from '../worker/wealth-store';

const scope = { userId: 'owner', ledgerId: 'personal' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
async function fixture() {
  const f = createSqliteD1Fixture(); fixtures.push(f);
  await upsertWealthAccount(f.db, scope, { id: 'outside', name: 'Outside', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', amountMinor: 10000, asOf: '2026-01-01' });
  await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', amountMinor: 10000, asOf: '2026-01-01' });
  return f;
}
const transfer = { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'cash', fromAccountId: 'outside', toAccountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, transferId: 'transfer' } as const;

describe('aggregate transfer write validation', () => {
  it.each([-100, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s before excluding aggregate replay', async amountMinor => {
    const f = await fixture();
    const { revision } = await readWealthAccounts(f.db, scope);
    await expect(appendWealthEvent(f.db, scope, { ...transfer, money: { currency: 'CAD', amountMinor } })).rejects.toMatchObject({ code: 'invalid_money' });
    expect((await readWealthEvents(f.db, scope)).events).toEqual([]);
    expect((await readWealthAccounts(f.db, scope)).revision).toBe(revision);
    await expect(readWealthReport(f.db, scope, { asOf: '2026-01-03' })).resolves.toMatchObject({ totalByCurrency: { CAD: 20000 } });
  });

  it.each([null, { currency: 'CAD', amountMinor: Number.NaN }, { currency: 'invalid-currency', amountMinor: 100 }])('rejects malformed transfer money %j', async money => {
    const f = await fixture();
    await expect(appendWealthEvent(f.db, scope, { ...transfer, money })).rejects.toThrow();
    expect((await readWealthEvents(f.db, scope)).events).toEqual([]);
  });

  it('rejects an unsupported transfer kind even when neither endpoint is replayed', async () => {
    const f = await fixture();
    await expect(appendWealthEvent(f.db, scope, { ...transfer, transferKind: 'unsupported' })).rejects.toMatchObject({ code: 'invalid_transfer' });
  });

  it('rejects aggregate self-transfers independently of active holdings', async () => {
    const f = await fixture();
    await expect(appendWealthEvent(f.db, scope, { ...transfer, toAccountId: 'outside' })).rejects.toMatchObject({ code: 'invalid_transfer' });
  });

  it('rejects a correction that replaces a valid aggregate transfer with negative money', async () => {
    const f = await fixture();
    await appendWealthEvent(f.db, scope, transfer);
    await expect(appendWealthEvent(f.db, scope, { id: 'correction', sourceId: 'correction', date: '2026-01-03', kind: 'correction', targetSourceId: transfer.sourceId, replacement: { ...transfer, money: { currency: 'CAD', amountMinor: -100 } } })).rejects.toMatchObject({ code: 'invalid_money' });
    expect((await readWealthEvents(f.db, scope)).events).toHaveLength(1);
  });

  it('rejects negative aggregate transfers in CSV preview', async () => {
    const f = await fixture();
    const csv = 'record_type,id,source_id,date,kind,transfer_kind,from_account_id,to_account_id,currency,amount_minor,transfer_id\nevent,t,t,2026-01-02,transfer,cash,outside,brokerage,CAD,-100,t\n';
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'negative-transfer' });
    expect(preview.errors.length).toBeGreaterThan(0);
  });
});
