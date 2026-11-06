import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { handleWealthApi } from '../worker/wealth-http';
import { BodyTooLargeError } from '../worker/security';
import { createWealthImportPreview, upsertWealthAccount } from '../worker/wealth-store';

const fixtures: Array<ReturnType<typeof createSqliteD1Fixture>> = [];
const context = { userId: 'owner', ledgerId: 'personal' };
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });

describe('Wealth CSV HTTP payload boundaries', () => {
  it.each([{ remap: false }, { remap: true }])('previews a full-size escaped CSV with remap=$remap', async ({ remap }) => {
    const f = createSqliteD1Fixture();
    fixtures.push(f);
    const prefix = 'record_type,id,name,account_kind,account_mode,currency,active,ignored\naccount,large,Large,manual_asset,aggregate,CAD,1,';
    const csv = prefix + '\u0001'.repeat(2 * 1024 * 1024 - prefix.length);
    const body = JSON.stringify({ csv, operationId: 'large-preview', ...(remap ? { mapping: { name: 'name' } } : {}) });
    const response = await handleWealthApi(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', body }), f.db, context);
    expect(response?.status).toBe(201);
    expect(await response?.json()).toMatchObject({ validationErrors: [], rows: [expect.objectContaining({ error: null, record: expect.objectContaining({ recordType: 'account' }) })] });
  });

  it('maps Unicode and punctuated source headers without changing their values', async () => {
    const f = createSqliteD1Fixture();
    fixtures.push(f);
    await upsertWealthAccount(f.db, context, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    const csv = 'record_type,id,source_id,date,kind,account_id,exchange,ticker,type,currency,quantité,amount (cad)\nevent,opening,opening,2026-11-01,opening_position,brokerage,TSX,SHOP,stock,CAD,0.5,10000';
    const response = await handleWealthApi(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', body: JSON.stringify({ csv, mapping: { quantity: 'quantité', basis_minor: 'amount (cad)' }, operationId: 'custom-headers' }) }), f.db, context);
    expect(response?.status).toBe(201);
    expect(await response?.json()).toMatchObject({ errors: [], validationErrors: [], sourceHeaders: expect.arrayContaining(['quantité', 'amount (cad)']), rows: [expect.objectContaining({ event: expect.objectContaining({ quantity: '0.5', basis: { currency: 'CAD', amountMinor: 10000 } }) })] });
  });

  it('persists an explicit unmapped field without restoring its canonical source', async () => {
    const f = createSqliteD1Fixture(); fixtures.push(f);
    await upsertWealthAccount(f.db, context, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    const csv = 'record_type,id,source_id,date,kind,account_id,currency,amount_minor,memo\nevent,cash,cash,2026-11-01,opening_cash,brokerage,CAD,100,ignored note';
    const first = await createWealthImportPreview(f.db, context, { csv, mapping: { memo: null }, operationId: 'clear-memo' });
    expect(first.errors).toEqual([]);
    expect(first.mapping.memo).toBeNull();
    expect(first.rows[0].event?.memo).toBeFalsy();
    const recovered = await createWealthImportPreview(f.db, context, { csv, mapping: { memo: null }, operationId: 'clear-memo' });
    expect(recovered.mapping.memo).toBeNull();
    const retry = await createWealthImportPreview(f.db, context, { csv, mapping: first.mapping, operationId: 'clear-memo-again' });
    expect(retry.mapping.memo).toBeNull();
    expect(retry.rows[0].event?.memo).toBeFalsy();
  });

  it.each([{ unknown: null }, { memo: null, Memo: null }])('still rejects invalid canonical null mappings %j', async mapping => {
    const f = createSqliteD1Fixture(); fixtures.push(f);
    await expect(createWealthImportPreview(f.db, context, { csv: 'record_type,id,name,account_kind,account_mode,currency\naccount,a,A,manual_asset,aggregate,CAD', mapping, operationId: 'invalid-mapping' })).rejects.toBeDefined();
  });

  it('rejects a decoded CSV above 2 MiB even when the JSON envelope fits', async () => {
    const f = createSqliteD1Fixture();
    fixtures.push(f);
    const response = await handleWealthApi(new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', body: JSON.stringify({ csv: 'x'.repeat(2 * 1024 * 1024 + 1), operationId: 'oversized-preview' }) }), f.db, context);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ code: 'invalid_csv' });
  });

  it('rejects an unbounded JSON envelope before parsing CSV', async () => {
    const request = new Request('https://pf.example.com/api/wealth/imports/preview', { method: 'POST', body: JSON.stringify({ csv: 'x'.repeat(13 * 1024 * 1024), operationId: 'oversized-envelope' }) });
    await expect(handleWealthApi(request, {} as ReturnType<typeof createSqliteD1Fixture>['db'], context)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it.each(['contribution', 'withdrawal'] as const)('keeps large escaped %s diagnostics within the native preview budget on retries', async kind => {
    const f = createSqliteD1Fixture();
    fixtures.push(f);
    await upsertWealthAccount(f.db, context, { id: 'brokerage', name: 'Synthetic', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    const memo = '\u0001'.repeat(1_048_000);
    const row = `event,same,same,2026-01-01,${kind},brokerage,CAD,1,${memo}`;
    const csv = 'record_type,id,source_id,date,kind,account_id,currency,amount_minor,memo\n' + row + '\n' + row;
    expect(Buffer.byteLength(csv)).toBeLessThanOrEqual(2 * 1024 * 1024);
    const input = { csv, operationId: 'escaped-diagnostics' };
    const preview = await createWealthImportPreview(f.db, context, input);
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(preview.duplicates).toEqual([expect.objectContaining({ rowId: 'row-2', duplicateOf: 'same' })]);
    expect(preview.rows[0].event).toMatchObject({ memo });
    const replay = await createWealthImportPreview(f.db, context, input);
    expect(replay).toEqual(preview);
  });

});
