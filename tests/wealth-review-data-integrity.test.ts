import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { createWealthSnapshot, type WealthEvent } from '../src/domain/wealth';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthReport, readWealthSnapshot, upsertWealthAccount, wealthExportCsv } from '../worker/wealth-store';

const scope = { userId: 'owner', ledgerId: 'personal' };
const instrument = { exchange: 'TSX', ticker: 'RY', type: 'stock' as const, currency: 'CAD' };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
function fixture() { const f = createSqliteD1Fixture(); fixtures.push(f); return f; }

async function bankFixture() {
  const f = fixture();
  await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('usd-bank','USD bank','Synthetic','USD','chequing','import_only','personal')").run();
  return f;
}

const linkedAccount = { id: 'linked', name: 'Linked bank', kind: 'linked_bank', mode: 'aggregate', currency: 'CAD', linkedBankAccountId: 'usd-bank' } as const;

describe('Wealth review data integrity', () => {
  it('rejects a linked account that relabels a USD bank as CAD', async () => {
    const f = await bankFixture();
    await expect(upsertWealthAccount(f.db, scope, linkedAccount)).rejects.toMatchObject({ code: 'linked_bank_currency_mismatch' });
    expect((await f.db.prepare('SELECT COUNT(*) AS n FROM wealth_accounts').first<{ n: number }>())?.n).toBe(0);
    await expect(upsertWealthAccount(f.db, scope, { ...linkedAccount, currency: 'USD' })).resolves.toMatchObject({ revision: 1 });
  });

  it('does not relabel legacy linked observations in snapshots or reports', async () => {
    const f = await bankFixture();
    await f.db.prepare("INSERT INTO wealth_accounts(ledger_id,id,name,kind,mode,currency,linked_bank_account_id,active,revision) VALUES('personal','linked','Legacy','linked_bank','aggregate','CAD','usd-bank',1,1)").run();
    await f.db.prepare("INSERT INTO wealth_linked_balance_observations(ledger_id,account_id,currency,amount_minor,observed_at,source_revision) VALUES('personal','usd-bank','USD',10000,'2026-01-01T12:00:00Z',1)").run();
    for (const read of [readWealthSnapshot, readWealthReport]) {
      const report = await read(f.db, scope, { asOf: '2026-01-02' });
      expect(report.totalByCurrency).toEqual({});
      expect(report.totalStatusByCurrency).toEqual({ CAD: 'incomplete' });
      expect(report.accounts).toEqual([expect.objectContaining({ valueMinor: null, valueState: 'missing' })]);
    }
    await f.db.prepare("UPDATE wealth_accounts SET currency='USD' WHERE id='linked'").run();
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-02' })).totalByCurrency).toEqual({ USD: 10000 });
  });

  it('rejects a currency-mismatched linked account in CSV preview', async () => {
    const f = await bankFixture();
    const csv = 'record_type,id,name,account_kind,account_mode,currency,linked_bank_account_id,active\naccount,linked,Linked bank,linked_bank,aggregate,CAD,usd-bank,1\n';
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'mismatched-bank-preview' });
    expect(preview.errors).toEqual(expect.arrayContaining([expect.objectContaining({ error: expect.stringContaining('currency') })]));
  });

  it('recognizes exported event rows when optional fields were originally omitted', async () => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
    await appendWealthEvent(f.db, scope, { id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } });
    await appendWealthEvent(f.db, scope, { id: 'buy', sourceId: 'buy', date: '2026-01-02', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: { currency: 'CAD', amountMinor: 50 } });
    const csv = await wealthExportCsv(f.db, scope);
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: 'optional-export' });
    expect(preview.errors).toEqual([]);
    expect(preview.duplicates).toHaveLength(preview.rows.length);
    const changed = await createWealthImportPreview(f.db, scope, { csv: csv.replace(',50,', ',51,'), operationId: 'changed-event-export' });
    expect(changed.errors.length).toBeGreaterThan(0);
  });

  it.each(['aggregate', 'holdings'] as const)('recognizes its unchanged export after leaving %s mode', async mode => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode, currency: 'CAD' });
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: mode === 'aggregate' ? 'holdings' : 'aggregate', currency: 'CAD', effectiveDate: '2026-01-02', ...(mode === 'aggregate' ? { openingCashMinor: 10000 } : { openingValueMinor: 10000 }) });
    const csv = await wealthExportCsv(f.db, scope);
    const preview = await createWealthImportPreview(f.db, scope, { csv, operationId: `repeat-${mode}` });
    expect(preview.errors).toEqual([]);
    expect(preview.duplicates).toHaveLength(preview.rows.length);
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: 2, operationId: `repeat-commit-${mode}` })).resolves.toMatchObject({ committed: 0 });
    expect(await wealthExportCsv(f.db, scope)).toBe(csv);
    const changed = await createWealthImportPreview(f.db, scope, { csv: csv.replace('Brokerage', 'Changed name'), operationId: `changed-${mode}` });
    expect(changed.errors.length).toBeGreaterThan(0);
  });

  it.each([
    { kind: 'sell', incoming: 'buy' }, { kind: 'transfer', incoming: 'buy' },
    { kind: 'sell', incoming: 'opening_position' }, { kind: 'transfer', incoming: 'opening_position' },
    { kind: 'sell', incoming: 'transfer' }, { kind: 'transfer', incoming: 'transfer' },
  ] as const)('restores current basis after a full $kind followed by $incoming', ({ kind, incoming }) => {
    const events: WealthEvent[] = [
      { id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 } },
      { id: 'unknown', sourceId: 'unknown', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: null },
      kind === 'sell'
        ? { id: 'close', sourceId: 'close', date: '2026-01-02', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: { currency: 'CAD', amountMinor: 100 }, fee: null }
        : { id: 'close', sourceId: 'close', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'brokerage', toAccountId: 'destination', instrument, quantity: '1', transferId: 'move-unknown' },
      { id: 'known-source', sourceId: 'known-source', date: '2026-01-01', kind: 'opening_position', accountId: 'known', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 50 } },
      incoming === 'buy'
        ? { id: 'reopen', sourceId: 'reopen', date: '2026-01-03', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: { currency: 'CAD', amountMinor: 50 }, fee: null }
        : incoming === 'opening_position'
          ? { id: 'reopen', sourceId: 'reopen', date: '2026-01-03', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 50 } }
          : { id: 'reopen', sourceId: 'reopen', date: '2026-01-03', kind: 'transfer', transferKind: 'position', fromAccountId: 'known', toAccountId: 'brokerage', instrument, quantity: '1', transferId: 'known-incoming' },
    ];
    const snapshot = createWealthSnapshot(events, { asOf: '2026-01-04', accounts: [{ id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings' }, { id: 'destination', name: 'Destination', kind: 'brokerage', mode: 'holdings' }, { id: 'known', name: 'Known', kind: 'brokerage', mode: 'holdings' }], valuations: [{ accountId: 'brokerage', instrument, asOf: '2026-01-04', priceMinor: 70, source: 'manual' }] });
    expect(snapshot.positions.find(position => position.accountId === 'brokerage')).toMatchObject({ quantity: '1', costBasisMinor: 50, basisKnown: true, unrealizedGainMinor: 20, realizedGainMinor: kind === 'sell' ? null : 0 });
  });
});
