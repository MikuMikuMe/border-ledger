import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database } from '../worker/db-types';
import {
  appendWealthEvent,
  commitWealthImport,
  createWealthImportPreview,
  readWealthAccounts,
  readWealthEvents,
  readWealthReport,
  readWealthSnapshot,
  readWealthValuations,
  upsertWealthAccount,
  upsertWealthInstrument,
  upsertWealthValuation,
  wealthExportCsv,
} from '../worker/wealth-store';
import type { LedgerContext } from '../worker/tenant-context';
import type { CanonicalInstrument, WealthAccount } from '../src/domain/wealth-types';
import { wealthQuoteInstrumentKey, WEALTH_QUOTE_PROVIDER } from '../worker/wealth-quotes';

const owner: LedgerContext = { userId: 'owner', ledgerId: 'personal' };
const fixtures: Array<ReturnType<typeof createSqliteD1Fixture>> = [];
const instrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' };

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.close();
});

function fixture() {
  const value = createSqliteD1Fixture();
  fixtures.push(value);
  return value;
}

async function account(
  db: D1Database,
  id: string,
  kind: WealthAccount['kind'] = 'brokerage',
  mode: WealthAccount['mode'] = 'holdings',
  currency = 'CAD',
) {
  return upsertWealthAccount(db, owner, { id, name: id, kind, mode, currency });
}

async function event(db: D1Database, value: unknown) {
  return appendWealthEvent(db, owner, value);
}

function money(amountMinor: number, currency = 'CAD') {
  return { currency, amountMinor };
}

interface ProviderQuoteFixture {
  readonly quoteDate: string;
  readonly priceMinor: number;
  readonly revision: string;
  readonly quoteInstrument?: CanonicalInstrument;
}

async function providerQuote(db: D1Database, fixtureValue: ProviderQuoteFixture) {
  const quoteInstrument = fixtureValue.quoteInstrument ?? instrument;
  await db.prepare(`INSERT INTO wealth_quote_observations(ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(owner.ledgerId, wealthQuoteInstrumentKey(quoteInstrument), quoteInstrument.exchange, quoteInstrument.ticker, quoteInstrument.type, quoteInstrument.currency, WEALTH_QUOTE_PROVIDER, `${quoteInstrument.ticker}.TRT`, fixtureValue.quoteDate, fixtureValue.priceMinor, `${fixtureValue.quoteDate}T12:00:00.000Z`, fixtureValue.revision).run();
}

async function positionTransferFixture(quantity: string = '1') {
  const f = fixture();
  await account(f.db, 'from');
  await account(f.db, 'to');
  await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity, basis: money(10000) });
  await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });
  return f;
}

async function cashTransferFixture() {
  const f = fixture();
  await account(f.db, 'from');
  await account(f.db, 'to');
  await event(f.db, { id: 'from-opening', sourceId: 'from-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'from', money: money(10000) });
  await event(f.db, { id: 'to-opening', sourceId: 'to-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'to', money: money(0) });
  await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'cash', fromAccountId: 'from', toAccountId: 'to', money: money(4000), transferId: 'transfer-1' });
  return f;
}

function csvEscape(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRows(headers: readonly string[], rows: readonly Record<string, string>[]) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')).join('\n')}\n`;
}

async function insertBankSource(db: D1Database) {
  await db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
  await db.prepare("INSERT OR IGNORE INTO account_currencies(account_id,currency,ledger_id) VALUES('bank-1','CAD','personal')").run();
  await db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx-1','bank-1','2026-01-01','Deposit',100,'CAD','Income','income','confirmed','manual','tx-fingerprint','personal')").run();
  await db.prepare(`INSERT INTO transaction_source_records(
    id,ledger_id,source_kind,identity_key,transaction_id,account_id,provider_transaction_id,
    provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,manual_id,bank_reference,content_digest
  ) VALUES('source-row-1','personal','manual','identity-1','tx-1','bank-1','provider-1',
    'pending-1','bank-source-1','bank-row-1','event-1','manual-1','reference-1','digest')`).run();
}

describe('wealth store integration', () => {
  it('rechecks disabled authority before existing event and valuation retries', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    const storedEvent = {
      id: 'event-1',
      sourceId: 'source-1',
      date: '2026-01-01',
      kind: 'contribution',
      accountId: 'brokerage',
      money: money(10000),
    };
    await event(f.db, storedEvent);
    const storedValuation = { id: 'valuation-1', accountId: 'brokerage', instrument, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' as const };
    await upsertWealthValuation(f.db, owner, storedValuation);
    await f.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();

    await expect(event(f.db, { ...storedEvent, id: 'retry-id', sequence: 99 })).rejects.toMatchObject({ code: 'access_not_enabled' });
    await expect(upsertWealthValuation(f.db, owner, { ...storedValuation, id: 'retry-valuation' })).rejects.toMatchObject({ code: 'access_not_enabled' });
  });

  it('treats a canonical source retry with new ids and casing as idempotent', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    const first = await event(f.db, {
      id: 'first-id', sourceId: 'retry-source', date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(5000, 'cad'),
    });
    const retry = await event(f.db, {
      id: 'different-id', sourceId: 'retry-source', sequence: 999, date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(5000, 'CAD'),
    });
    expect(retry.replayed).toBe(true);
    expect(retry.revision).toBe(first.revision);
    expect(retry.event.id).toBe('first-id');
    expect((await readWealthEvents(f.db, owner)).events).toHaveLength(1);
  });

  it('rejects every known alias when a bank transaction is already linked', async () => {
    const aliases = ['source-row-1', 'identity-1', 'tx-1', 'provider-1', 'pending-1', 'bank-source-1', 'bank-row-1', 'event-1', 'reference-1'];
    for (const [index, alias] of aliases.entries()) {
      const f = fixture();
      await insertBankSource(f.db);
      await account(f.db, 'brokerage');
      await event(f.db, { id: `linked-${index}`, sourceId: `linked-${index}`, date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'tx-1' });
      await expect(event(f.db, { id: `duplicate-${index}`, sourceId: `duplicate-${index}`, date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(100), linkedBankSourceId: alias })).rejects.toMatchObject({ code: 'bank_link_conflict' });
    }
  });

  it('rejects two preview events that use different aliases for one bank transaction', async () => {
    const f = fixture();
    await insertBankSource(f.db);
    await account(f.db, 'brokerage');
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'currency', 'amount_minor', 'linked_bank_source_id'];
    const csv = csvRows(headers, [
      { record_type: 'event', id: 'import-one', source_id: 'import-one', date: '2026-01-01', kind: 'contribution', account_id: 'brokerage', currency: 'CAD', amount_minor: '100', linked_bank_source_id: 'tx-1' },
      { record_type: 'event', id: 'import-two', source_id: 'import-two', date: '2026-01-01', kind: 'contribution', account_id: 'brokerage', currency: 'CAD', amount_minor: '100', linked_bank_source_id: 'bank-source-1' },
    ]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'alias-group-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('another imported bank link')]));
  });

  it('validates bank links nested inside correction replacements', async () => {
    const f = fixture();
    await insertBankSource(f.db);
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'linked-event', sourceId: 'linked-event', date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'tx-1' });
    await event(f.db, { id: 'unlinked-event', sourceId: 'unlinked-event', date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(100) });
    const correction = {
      id: 'import-correction',
      sourceId: 'import-correction',
      date: '2026-01-02',
      kind: 'correction',
      targetSourceId: 'unlinked-event',
      replacement: { kind: 'contribution', date: '2026-01-01', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'bank-source-1' },
    };
    const csv = csvRows(['record_type', 'event_json'], [{ record_type: 'event', event_json: JSON.stringify(correction) }]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'replacement-link-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('existing bank link')]));
  });

  it('uses server sequence for same-day deposit-buy-sell and keeps a closed gain', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'deposit', sourceId: 'z-deposit', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(10000) });
    await event(f.db, { id: 'buy', sourceId: 'a-buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(10000), fee: null });
    await event(f.db, { id: 'sell', sourceId: 'm-sell', date: '2026-01-01', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(12000), fee: null });

    const events = (await readWealthEvents(f.db, owner)).events;
    expect(events.map((item) => [item.sourceId, item.sequence])).toEqual([['z-deposit', 1], ['a-buy', 2], ['m-sell', 3]]);
    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-01' });
    expect(snapshot.positions).toEqual([expect.objectContaining({ quantity: '0', costBasisMinor: 0, realizedGainMinor: 2000 })]);
    expect(snapshot.missingData).not.toContain('position:brokerage:TSX:SHOP:stock:CAD');
  });

  it('rejects mixed-mode transfers and cash that would become negative', async () => {
    const f = fixture();
    await account(f.db, 'aggregate', 'manual_asset', 'aggregate');
    await account(f.db, 'holdings', 'brokerage', 'holdings');
    await expect(event(f.db, {
      id: 'mixed-transfer', sourceId: 'mixed-transfer', date: '2026-01-01', kind: 'transfer', transferKind: 'cash',
      fromAccountId: 'aggregate', toAccountId: 'holdings', money: money(100),
    })).rejects.toMatchObject({ code: 'mixed_account_mode' });

    const second = fixture();
    await account(second.db, 'brokerage');
    await expect(event(second.db, { id: 'unfunded-buy', sourceId: 'unfunded-buy', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(100), fee: null })).rejects.toMatchObject({ code: 'negative_cash' });
    await expect(event(second.db, { id: 'overspend', sourceId: 'overspend', date: '2026-01-01', kind: 'withdrawal', accountId: 'brokerage', money: money(100) })).rejects.toMatchObject({ code: 'negative_cash' });
  });

  it('keeps correction and reversal lineage consistent between report and snapshot', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'cash', sourceId: 'cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(20000) });
    await event(f.db, { id: 'buy', sourceId: 'buy-original', date: '2026-01-01', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(10000), fee: null });
    await event(f.db, {
      id: 'correct-buy', sourceId: 'correct-buy', date: '2026-01-02', kind: 'correction', targetSourceId: 'buy-original',
      replacement: { kind: 'buy', date: '2026-01-01', accountId: 'brokerage', instrument, quantity: '1', consideration: money(8000), fee: null },
    });
    await event(f.db, { id: 'reverse-correction', sourceId: 'reverse-correction', date: '2026-01-03', kind: 'reversal', targetSourceId: 'correct-buy' });
    await upsertWealthValuation(f.db, owner, { id: 'price', accountId: 'brokerage', instrument, asOf: '2026-01-01', priceMinor: 12000, source: 'manual' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    const report = await readWealthReport(f.db, owner, { asOf: '2026-01-03' });
    expect(report.totalByCurrency).toEqual(snapshot.totalByCurrency);
    expect(report.cash).toEqual(snapshot.cash);
    expect(report.positions).toEqual(snapshot.positions);
    expect(snapshot.cash).toEqual([{ accountId: 'brokerage', currency: 'CAD', amountMinor: 10000 }]);
    expect(snapshot.positions).toEqual([expect.objectContaining({ quantity: '1', costBasisMinor: 10000, marketValueMinor: 12000 })]);
  });

  it('does not report a missing price for a fully liquidated zero-quantity position', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: money(10000) });
    await event(f.db, { id: 'sale', sourceId: 'sale', date: '2026-01-02', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(11000), fee: null });
    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-02' });
    expect(snapshot.positions).toEqual([expect.objectContaining({ quantity: '0', realizedGainMinor: 1000, valuation: null })]);
    expect(snapshot.missingData).toEqual([]);
  });

  it('applies dated manual asset and debt values with debt sign and no pre-opening history', async () => {
    const f = fixture();
    await account(f.db, 'home', 'manual_asset', 'aggregate');
    await account(f.db, 'loan', 'debt', 'aggregate');
    await upsertWealthValuation(f.db, owner, { id: 'home-value', accountId: 'home', asOf: '2026-02-10', priceMinor: 100000, source: 'manual' });
    await upsertWealthValuation(f.db, owner, { id: 'loan-value', accountId: 'loan', asOf: '2026-02-10', priceMinor: 30000, source: 'manual' });
    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-02-15' });
    expect(snapshot.totalByCurrency).toEqual({ CAD: 70000 });
    expect(snapshot.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'home', valueMinor: 100000, valueState: 'fresh' }),
      expect.objectContaining({ id: 'loan', valueMinor: -30000, valueState: 'fresh' }),
    ]));
    expect(snapshot.history.map((point) => point.date)).toEqual(['2026-02-10']);
  });

  it('keeps portfolio return independent from household salary and aggregate asset/debt accounts', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await account(f.db, 'home', 'manual_asset', 'aggregate');
    await account(f.db, 'loan', 'debt', 'aggregate');
    await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: money(10000) });
    await upsertWealthValuation(f.db, owner, { id: 'start-price', accountId: 'brokerage', instrument, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' });
    await upsertWealthValuation(f.db, owner, { id: 'end-price', accountId: 'brokerage', instrument, asOf: '2026-01-31', priceMinor: 12000, source: 'manual' });
    await upsertWealthValuation(f.db, owner, { id: 'home-value', accountId: 'home', asOf: '2026-01-01', priceMinor: 5000, source: 'manual' });
    await upsertWealthValuation(f.db, owner, { id: 'loan-value', accountId: 'loan', asOf: '2026-01-01', priceMinor: 2000, source: 'manual' });
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank-1','Bank','Fixture','CAD','single','checking','active','personal')").run();
    await f.db.prepare("INSERT OR IGNORE INTO account_currencies(account_id,currency,ledger_id) VALUES('bank-1','CAD','personal')").run();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('salary','bank-1','2026-01-15','Employer',5000,'CAD','Salary','income','confirmed','manual','salary-fingerprint','personal')").run();

    const report = await readWealthReport(f.db, owner, { asOf: '2026-01-31', from: '2026-01-01', to: '2026-01-31' });
    expect(report.modifiedDietz).toMatchObject({ available: true, value: 0.2 });
    expect(report.investmentCashFlows).toEqual([]);
    expect(report.householdCashFlows).toEqual([expect.objectContaining({ transactionId: 'salary', classification: 'ambiguous' })]);
    expect(report.totalByCurrency).toEqual({ CAD: 15000 });
  });

  it('roundtrips canonical CSV records through preview and commit', async () => {
    const source = fixture();
    await account(source.db, 'brokerage');
    await upsertWealthInstrument(source.db, owner, { id: 'shop', ...instrument });
    await event(source.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: money(10000) });
    await event(source.db, { id: 'split', sourceId: 'split', date: '2026-01-02', kind: 'split', accountId: 'brokerage', instrument, numerator: 2, denominator: 1 });
    await upsertWealthValuation(source.db, owner, { id: 'price', accountId: 'brokerage', instrument, asOf: '2026-01-01', priceMinor: 12000, source: 'manual' });
    const csv = await wealthExportCsv(source.db, owner);
    expect(csv).toContain('record_type');
    expect(csv).toContain('numerator');
    expect(csv).toContain('2,1');

    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, owner, { csv: `\uFEFF${csv}`, operationId: 'roundtrip-preview' });
    expect(preview.errors).toEqual([]);
    const commit = await commitWealthImport(destination.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'roundtrip-commit' }) as { committed: number };
    expect(commit.committed).toBe(5);
    expect((await readWealthAccounts(destination.db, owner)).accounts.map((item) => item.id)).toEqual(['brokerage']);
    expect((await readWealthEvents(destination.db, owner)).events.map((item) => item.sourceId)).toEqual(['opening', 'split']);
    expect((await readWealthValuations(destination.db, owner)).valuations).toEqual([expect.objectContaining({ id: 'price', accountId: 'brokerage', priceMinor: 12000 })]);
  });

  it('roundtrips position transfers through canonical CSV', async () => {
    const source = fixture();
    await account(source.db, 'from');
    await account(source.db, 'to');
    await event(source.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity: '2', basis: money(10000) });
    await event(source.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });

    const csv = await wealthExportCsv(source.db, owner);
    expect(csv).toContain('position');
    expect(csv).toContain('transfer-1');
    expect(csv).toContain(',1,,,,');

    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, owner, { csv, operationId: 'position-transfer-roundtrip-preview' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(destination.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'position-transfer-roundtrip-commit' })).resolves.toMatchObject({ committed: 4 });
    expect((await readWealthSnapshot(destination.db, owner, { asOf: '2026-01-02' })).positions).toEqual([
      expect.objectContaining({ accountId: 'from', quantity: '1' }),
      expect.objectContaining({ accountId: 'to', quantity: '1' }),
    ]);
  });

  it('projects a cached provider quote onto a position-transfer destination', async () => {
    const f = await positionTransferFixture();
    await providerQuote(f.db, { quoteDate: '2026-01-02', priceMinor: 12000, revision: 'quote-1' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-02' });
    expect(snapshot.positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'to', quantity: '1', marketValueMinor: 12000 })]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 12000 });
    expect(snapshot.missingData).toEqual([]);
  });

  it('discovers provider quotes from correction replacement instruments', async () => {
    const f = fixture();
    await account(f.db, 'from');
    await account(f.db, 'to');
    await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity: '1', basis: money(10000) });
    await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });
    await event(f.db, { id: 'correction', sourceId: 'correction', date: '2026-01-03', kind: 'correction', targetSourceId: 'transfer', replacement: { kind: 'transfer', transferKind: 'position', date: '2026-01-02', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' } });
    await providerQuote(f.db, { quoteDate: '2026-01-03', priceMinor: 12000, revision: 'quote-correction' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    expect(snapshot.positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'to', quantity: '1', marketValueMinor: 12000 })]));
    expect(snapshot.missingData).toEqual([]);
  });

  it('keeps a cached quote on a historical position after a later correction', async () => {
    const f = fixture();
    const correctedInstrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'CSU', type: 'stock', currency: 'CAD' };
    await account(f.db, 'from');
    await account(f.db, 'to');
    await account(f.db, 'corrected-to');
    await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity: '1', basis: money(10000) });
    await event(f.db, { id: 'corrected-opening', sourceId: 'corrected-opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument: correctedInstrument, quantity: '1', basis: money(5000) });
    await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });
    await event(f.db, { id: 'correction', sourceId: 'correction', date: '2026-01-10', kind: 'correction', targetSourceId: 'transfer', replacement: { kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'corrected-to', instrument: correctedInstrument, quantity: '1', date: '2026-01-02', transferId: 'transfer-1' } });
    await providerQuote(f.db, { quoteDate: '2026-01-03', priceMinor: 12000, revision: 'quote-history' });
    await providerQuote(f.db, { quoteDate: '2026-01-03', priceMinor: 5000, revision: 'quote-corrected', quoteInstrument: correctedInstrument });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-10' });
    expect(snapshot.history.find((point) => point.date === '2026-01-03')).toEqual(expect.objectContaining({ totals: { CAD: 17000 }, missingData: [] }));
  });

  it('keeps the unaffected cash leg when a transfer destination leaves holdings mode', async () => {
    const f = await cashTransferFixture();
    await upsertWealthAccount(f.db, owner, { id: 'to', name: 'to', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 4000 });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    expect(snapshot.cash).toEqual([{ accountId: 'from', currency: 'CAD', amountMinor: 6000 }]);
    expect(snapshot.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'to', mode: 'aggregate', valueMinor: 4000 })]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 10000 });
  });

  it('keeps the unaffected position leg when a transfer destination leaves holdings mode', async () => {
    const f = await positionTransferFixture('2');
    await upsertWealthValuation(f.db, owner, { id: 'from-price', accountId: 'from', instrument, asOf: '2026-01-03', priceMinor: 6000, source: 'manual' });
    await upsertWealthAccount(f.db, owner, { id: 'to', name: 'to', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 6000 });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    expect(snapshot.positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'from', quantity: '1', marketValueMinor: 6000 })]));
    expect(snapshot.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'to', mode: 'aggregate', valueMinor: 6000 })]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 12000 });
  });

  it('projects a position transfer into a destination that remains in holdings mode', async () => {
    const f = await positionTransferFixture();
    await upsertWealthAccount(f.db, owner, { id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 0 });
    await upsertWealthValuation(f.db, owner, { id: 'to-price', accountId: 'to', instrument, asOf: '2026-01-03', priceMinor: 12000, source: 'manual' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    expect(snapshot.positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'to', quantity: '1', marketValueMinor: 12000 })]));
    expect(snapshot.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'from', mode: 'aggregate', valueMinor: 0 })]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 12000 });
  });

  it('replays only the source holdings segment for a position transfer after a mode reset', async () => {
    const f = fixture();
    await account(f.db, 'from');
    await account(f.db, 'to');
    await event(f.db, { id: 'old-opening', sourceId: 'old-opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity: '1', basis: money(5000) });
    await upsertWealthAccount(f.db, owner, { id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-02', openingValueMinor: 5000 });
    await upsertWealthAccount(f.db, owner, {
      id: 'from', name: 'from', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-01-03',
      openingPositions: [{ id: 'new-opening', sourceId: 'new-opening', instrument, quantity: '1', basis: money(10000) }],
    });
    await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-04', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });
    await upsertWealthAccount(f.db, owner, { id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-05', openingValueMinor: 0 });
    await upsertWealthValuation(f.db, owner, { id: 'to-price', accountId: 'to', instrument, asOf: '2026-01-05', priceMinor: 12000, source: 'manual' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-05' });
    expect(snapshot.positions).toEqual([expect.objectContaining({ accountId: 'to', quantity: '1', costBasisMinor: 10000, marketValueMinor: 12000 })]);
    expect(snapshot.totalByCurrency).toEqual({ CAD: 12000 });
  });

  it('keeps incoming positions and fresh source openings in separate mode segments', async () => {
    const f = fixture();
    await account(f.db, 'from');
    await account(f.db, 'to');
    await event(f.db, { id: 'old-opening', sourceId: 'old-opening', date: '2026-01-01', kind: 'opening_position', accountId: 'from', instrument, quantity: '1', basis: money(5000) });
    await event(f.db, { id: 'transfer', sourceId: 'transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'position', fromAccountId: 'from', toAccountId: 'to', instrument, quantity: '1', transferId: 'transfer-1' });
    await upsertWealthAccount(f.db, owner, { id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 0 });
    await upsertWealthAccount(f.db, owner, {
      id: 'from', name: 'from', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-01-04',
      openingPositions: [{ id: 'new-opening', sourceId: 'new-opening', instrument, quantity: '1', basis: money(10000) }],
    });
    await upsertWealthValuation(f.db, owner, { id: 'from-price', accountId: 'from', instrument, asOf: '2026-01-04', priceMinor: 12000, source: 'manual' });
    await upsertWealthValuation(f.db, owner, { id: 'to-price', accountId: 'to', instrument, asOf: '2026-01-04', priceMinor: 6000, source: 'manual' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-04' });
    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'from', quantity: '1', costBasisMinor: 10000, marketValueMinor: 12000 }),
      expect.objectContaining({ accountId: 'to', quantity: '1', costBasisMinor: 5000, marketValueMinor: 6000 }),
    ]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 18000 });
  });

  it('does not double-count a cash transfer while replaying a position source dependency', async () => {
    const f = fixture();
    await account(f.db, 'cash-source');
    await account(f.db, 'position-source');
    await account(f.db, 'destination');
    await event(f.db, { id: 'cash-opening', sourceId: 'cash-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'cash-source', money: money(1000) });
    await event(f.db, { id: 'position-opening', sourceId: 'position-opening', date: '2026-01-01', kind: 'opening_position', accountId: 'position-source', instrument, quantity: '1', basis: money(10000) });
    await event(f.db, { id: 'cash-transfer', sourceId: 'cash-transfer', date: '2026-01-02', kind: 'transfer', transferKind: 'cash', fromAccountId: 'cash-source', toAccountId: 'position-source', money: money(600), transferId: 'cash-transfer-1' });
    await event(f.db, { id: 'position-transfer', sourceId: 'position-transfer', date: '2026-01-03', kind: 'transfer', transferKind: 'position', fromAccountId: 'position-source', toAccountId: 'destination', instrument, quantity: '1', transferId: 'position-transfer-1' });
    await upsertWealthAccount(f.db, owner, { id: 'position-source', name: 'position-source', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-04', openingValueMinor: 0 });
    await upsertWealthValuation(f.db, owner, { id: 'destination-price', accountId: 'destination', instrument, asOf: '2026-01-04', priceMinor: 12000, source: 'manual' });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-04' });
    expect(snapshot.cash).toEqual([{ accountId: 'cash-source', currency: 'CAD', amountMinor: 400 }]);
    expect(snapshot.positions).toEqual([expect.objectContaining({ accountId: 'destination', quantity: '1', marketValueMinor: 12000 })]);
    expect(snapshot.totalByCurrency).toEqual({ CAD: 12400 });
  });

  it('projects a cash transfer into a destination that remains in holdings mode', async () => {
    const f = await cashTransferFixture();
    await upsertWealthAccount(f.db, owner, { id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 6000 });

    const snapshot = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-03' });
    expect(snapshot.cash).toEqual([{ accountId: 'to', currency: 'CAD', amountMinor: 4000 }]);
    expect(snapshot.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'from', mode: 'aggregate', valueMinor: 6000 })]));
    expect(snapshot.totalByCurrency).toEqual({ CAD: 10000 });
  });

  it('keeps corrected and reversed transfers segment-scoped after a destination transition', async () => {
    const f = await cashTransferFixture();
    await upsertWealthAccount(f.db, owner, { id: 'to', name: 'to', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-03', openingValueMinor: 4000 });
    await event(f.db, { id: 'correction', sourceId: 'correction', date: '2026-01-04', kind: 'correction', targetSourceId: 'transfer', replacement: { kind: 'transfer', transferKind: 'cash', date: '2026-01-02', fromAccountId: 'from', toAccountId: 'to', money: money(3000), transferId: 'transfer-1' } });

    const corrected = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-04' });
    expect(corrected.cash).toEqual([{ accountId: 'from', currency: 'CAD', amountMinor: 7000 }]);
    expect(corrected.totalByCurrency).toEqual({ CAD: 11000 });

    await event(f.db, { id: 'reverse-correction', sourceId: 'reverse-correction', date: '2026-01-05', kind: 'reversal', targetSourceId: 'correction' });
    const reversed = await readWealthSnapshot(f.db, owner, { asOf: '2026-01-05' });
    expect(reversed.cash).toEqual([{ accountId: 'from', currency: 'CAD', amountMinor: 6000 }]);
    expect(reversed.totalByCurrency).toEqual({ CAD: 10000 });
  });

  it('replays a late correction replacement during write validation', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'opening', sourceId: 'opening', date: '2026-01-01', kind: 'opening_position', accountId: 'brokerage', instrument, quantity: '1', basis: money(10000) });
    await event(f.db, { id: 'sale', sourceId: 'sale', date: '2026-01-02', kind: 'sell', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(10000), fee: null });

    await expect(event(f.db, {
      id: 'late-correction', sourceId: 'late-correction', date: '2026-01-03', kind: 'correction', targetSourceId: 'sale',
      replacement: { kind: 'sell', date: '2026-01-02', accountId: 'brokerage', instrument, quantity: '2', proceeds: money(20000), fee: null },
    })).rejects.toMatchObject({ code: 'short_sale' });

    await expect(event(f.db, {
      id: 'unknown-correction', sourceId: 'unknown-correction', date: '2026-01-03', kind: 'correction', targetSourceId: 'missing-sale',
      replacement: { kind: 'sell', date: '2026-01-02', accountId: 'brokerage', instrument, quantity: '1', proceeds: money(10000), fee: null },
    })).rejects.toMatchObject({ code: 'invalid_reference' });
  });

  it('accepts a correction replacement dated before its target event', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'opening-cash', sourceId: 'opening-cash', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(1000) });
    await event(f.db, { id: 'buy', sourceId: 'buy', date: '2026-01-05', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(100), fee: null });

    await expect(event(f.db, {
      id: 'backdated-correction', sourceId: 'backdated-correction', date: '2026-01-10', kind: 'correction', targetSourceId: 'buy',
      replacement: { kind: 'buy', date: '2026-01-01', accountId: 'brokerage', instrument, quantity: '1', consideration: money(100), fee: null },
    })).resolves.toMatchObject({ event: { sourceId: 'backdated-correction' } });
  });

  it('does not reuse pre-transition cash when validating a new holdings event', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'old-opening', sourceId: 'old-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(10000) });
    await upsertWealthAccount(f.db, owner, { id: 'brokerage', name: 'brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-02', openingValueMinor: 10000 });
    await upsertWealthAccount(f.db, owner, { id: 'brokerage', name: 'brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD', effectiveDate: '2026-01-03', openingCashMinor: 1000 });

    await expect(event(f.db, { id: 'oversized-buy', sourceId: 'oversized-buy', date: '2026-01-04', kind: 'buy', accountId: 'brokerage', instrument, quantity: '1', consideration: money(5000), fee: null })).rejects.toMatchObject({ code: 'negative_cash' });
  });

  it('treats LF and CRLF record endings equivalently and preserves quoted embedded CRLF', async () => {
    const lfFixture = fixture();
    const crlfFixture = fixture();
    await account(lfFixture.db, 'brokerage');
    await account(crlfFixture.db, 'brokerage');
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'currency', 'amount_minor', 'memo'];
    const memo = 'line one\r\nline two';
    const row = ['event', 'line-ending-event', 'line-ending-event', '2026-01-01', 'contribution', 'brokerage', 'CAD', '100', csvEscape(memo)].join(',');
    const lfCsv = `${headers.join(',')}\n${row}\n`;
    const crlfCsv = `${headers.join(',')}\r\n${row}\r\n`;
    const [lfPreview, crlfPreview] = await Promise.all([
      createWealthImportPreview(lfFixture.db, owner, { csv: lfCsv, operationId: 'lf-preview' }),
      createWealthImportPreview(crlfFixture.db, owner, { csv: crlfCsv, operationId: 'crlf-preview' }),
    ]);
    expect(lfPreview.errors).toEqual([]);
    expect(crlfPreview.errors).toEqual([]);
    expect(crlfPreview.rows.map(({ event, error, duplicateOf }) => ({ event, error, duplicateOf }))).toEqual(lfPreview.rows.map(({ event, error, duplicateOf }) => ({ event, error, duplicateOf })));
    expect(crlfPreview.rows[0]?.event).toMatchObject({ memo });
  });

  it('commits an aggregate valuation through a cold HTTP import initialization', async () => {
    vi.resetModules();
    const { handleWealthApi } = await import('../worker/wealth-http');
    const f = fixture();
    const headers = ['record_type', 'id', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'active', 'as_of', 'price_minor', 'source'];
    const csv = csvRows(headers, [
      { record_type: 'account', id: 'home', account_id: '', name: 'Home', account_kind: 'manual_asset', account_mode: 'aggregate', currency: 'CAD', active: '1', as_of: '', price_minor: '', source: '' },
      { record_type: 'valuation', id: 'home-value', account_id: 'home', name: '', account_kind: '', account_mode: '', currency: '', active: '', as_of: '2026-01-01', price_minor: '12345', source: 'manual' },
    ]);
    const request = (path: string, body: unknown) => new Request(`https://pf.example.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const previewResponse = await handleWealthApi(request('/api/wealth/imports/preview', { csv, operationId: 'cold-aggregate-preview' }), f.db, owner);
    expect(previewResponse?.status).toBe(201);
    const preview = await previewResponse!.json() as { previewId: string; errors: unknown[] };
    expect(preview.errors).toEqual([]);
    const commitResponse = await handleWealthApi(request(`/api/wealth/imports/${preview.previewId}/commit`, { expectedRevision: 0, operationId: 'cold-aggregate-commit' }), f.db, owner);
    expect(commitResponse?.status).toBe(200);
    expect(await commitResponse!.json()).toMatchObject({ committed: 2, revision: 1 });
  });

  it('commits CSV records in dependency order even when the file is event-first', async () => {
    const f = fixture();
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'amount_minor', 'active'];
    const csv = csvRows(headers, [
      { record_type: 'event', id: 'ordered-event', source_id: 'ordered-event', date: '2026-01-01', kind: 'contribution', account_id: 'brokerage', name: '', account_kind: '', account_mode: '', currency: 'CAD', amount_minor: '100', active: '' },
      { record_type: 'account', id: 'brokerage', source_id: '', date: '', kind: '', account_id: '', name: 'Brokerage', account_kind: 'brokerage', account_mode: 'holdings', currency: 'CAD', amount_minor: '', active: '1' },
    ]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'dependency-order-preview' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'dependency-order-commit' })).resolves.toMatchObject({ committed: 2, revision: 1 });
    expect((await readWealthAccounts(f.db, owner)).accounts.map((item) => item.id)).toEqual(['brokerage']);
    expect((await readWealthEvents(f.db, owner)).events.map((item) => item.sourceId)).toEqual(['ordered-event']);
  });

  it('applies validated custom CSV mappings and returns mapping metadata', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    const headers = ['Record Type', 'Identifier', 'Source', 'Date', 'Kind', 'Account', 'Currency', 'Amount', 'Type Label'];
    const csv = csvRows(headers, [{ 'Record Type': 'event', Identifier: 'mapped-event', Source: 'mapped-event', Date: '2026-01-01', Kind: 'contribution', Account: 'brokerage', Currency: 'CAD', Amount: '100', 'Type Label': 'event' }]);
    const mapping = { record_type: 'Record Type', id: 'Identifier', source_id: 'Source', date: 'Date', kind: 'Kind', account_id: 'Account', currency: 'Currency', amount_minor: 'Amount' };
    const preview = await createWealthImportPreview(f.db, owner, { csv, mapping, operationId: 'custom-mapping-preview' });
    expect(preview.errors).toEqual([]);
    expect(preview.sourceHeaders).toEqual(headers.map((header) => header.toLowerCase()));
    expect(preview.mapping).toMatchObject({ record_type: 'record type', amount_minor: 'amount' });
    expect(preview.canonicalHeaders).toContain('event_json');
  });

  it('rejects unknown or duplicate CSV mapping assignments', async () => {
    const f = fixture();
    const headers = ['Record Type', 'Date', 'Kind'];
    const csv = csvRows(headers, [{ 'Record Type': 'event', Date: '2026-01-01', Kind: 'opening_cash' }]);
    await expect(createWealthImportPreview(f.db, owner, { csv, mapping: { unsupported_field: 'Record Type' }, operationId: 'invalid-mapping-field' })).rejects.toMatchObject({ code: 'invalid_csv' });
    await expect(createWealthImportPreview(f.db, owner, { csv, mapping: { record_type: 'Record Type', kind: 'Record Type' }, operationId: 'duplicate-mapping-source' })).rejects.toMatchObject({ code: 'invalid_csv' });
  });

  it('binds custom mapping to preview idempotency', async () => {
    const f = fixture();
    const headers = ['Record Type', 'Type Label', 'Identifier', 'Source', 'Date', 'Kind', 'Account', 'Currency', 'Amount'];
    const csv = csvRows(headers, [{ 'Record Type': 'event', 'Type Label': 'event', Identifier: 'mapped-event', Source: 'mapped-event', Date: '2026-01-01', Kind: 'opening_cash', Account: 'brokerage', Currency: 'CAD', Amount: '0' }]);
    const firstMapping = { record_type: 'Record Type', id: 'Identifier', source_id: 'Source', date: 'Date', kind: 'Kind', account_id: 'Account', currency: 'Currency', amount_minor: 'Amount' };
    const secondMapping = { ...firstMapping, record_type: 'Type Label' };
    await createWealthImportPreview(f.db, owner, { csv, mapping: firstMapping, operationId: 'mapping-idempotency' });
    await expect(createWealthImportPreview(f.db, owner, { csv, mapping: secondMapping, operationId: 'mapping-idempotency' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('fences an empty import commit with a receipt and revision increment', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    const csv = csvRows(['record_type', 'id', 'name', 'account_kind', 'account_mode', 'currency', 'active'], [{ record_type: 'account', id: 'brokerage', name: 'brokerage', account_kind: 'brokerage', account_mode: 'holdings', currency: 'CAD', active: '1' }]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'empty-commit-preview' });
    expect(preview.duplicates).toHaveLength(1);
    const first = await commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 1, operationId: 'empty-commit-operation' });
    expect(first).toMatchObject({ committed: 0, revision: 2 });
    const second = await commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 1, operationId: 'empty-commit-operation' });
    expect(second).toMatchObject({ committed: 0, revision: 2, replayed: true });
    expect(await f.db.prepare('SELECT operation_id,result_revision FROM wealth_operations WHERE ledger_id=? AND operation_id=?').bind(owner.ledgerId, 'empty-commit-operation').first()).toMatchObject({ operation_id: 'empty-commit-operation', result_revision: 2 });
  });

  it('recovers an identical concurrent preview after the operation uniqueness race', async () => {
    const f = fixture();
    const csv = csvRows(['record_type', 'id', 'name', 'account_kind', 'account_mode', 'currency', 'active'], [{ record_type: 'account', id: 'brokerage', name: 'brokerage', account_kind: 'brokerage', account_mode: 'holdings', currency: 'CAD', active: '1' }]);
    const [first, second] = await Promise.all([
      createWealthImportPreview(f.db, owner, { csv, operationId: 'concurrent-preview' }),
      createWealthImportPreview(f.db, owner, { csv, operationId: 'concurrent-preview' }),
    ]);
    expect(first.previewId).toBe(second.previewId);
    expect(first.errors).toEqual(second.errors);
    expect((await f.db.prepare('SELECT COUNT(*) AS count FROM wealth_import_previews WHERE ledger_id=? AND operation_id=?').bind(owner.ledgerId, 'concurrent-preview').first<{ count: number }>())?.count).toBe(1);
  });

  it('rejects missing required CSV event money instead of treating it as zero', async () => {
    const f = fixture();
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'currency', 'amount_minor'];
    const csv = csvRows(headers, [{ record_type: 'event', id: 'missing-amount', source_id: 'missing-amount', date: '2026-01-01', kind: 'contribution', account_id: 'brokerage', currency: 'CAD', amount_minor: '   ' }]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'missing-money-preview' });
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].error).toContain('amount_minor is required');
  });

  it('fails invalid imports atomically and rejects stale preview commits', async () => {
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'currency', 'amount_minor'];
    const invalid = fixture();
    const invalidCsv = csvRows(headers, [{ record_type: 'event', id: 'orphan', source_id: 'orphan', date: '2026-01-01', kind: 'contribution', account_id: 'missing', currency: 'CAD', amount_minor: '100' }]);
    const invalidPreview = await createWealthImportPreview(invalid.db, owner, { csv: invalidCsv, operationId: 'invalid-preview' });
    expect(invalidPreview.errors.length).toBeGreaterThan(0);
    await expect(commitWealthImport(invalid.db, owner, invalidPreview.previewId, { expectedRevision: 0 })).rejects.toMatchObject({ code: 'invalid_csv' });
    expect((await readWealthAccounts(invalid.db, owner)).accounts).toEqual([]);
    expect((await readWealthEvents(invalid.db, owner)).events).toEqual([]);

    const stale = fixture();
    const accountCsv = csvRows(['record_type', 'id', 'name', 'account_kind', 'account_mode', 'currency', 'active'], [{ record_type: 'account', id: 'imported', name: 'Imported', account_kind: 'manual_asset', account_mode: 'aggregate', currency: 'CAD', active: '1' }]);
    const preview = await createWealthImportPreview(stale.db, owner, { csv: accountCsv, operationId: 'stale-preview' });
    await account(stale.db, 'already-written', 'manual_asset', 'aggregate');
    await expect(commitWealthImport(stale.db, owner, preview.previewId, { expectedRevision: 0 })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await readWealthAccounts(stale.db, owner)).accounts.map((item) => item.id)).toEqual(['already-written']);
  });

  it('returns mapping metadata for an initially unmapped custom-header CSV', async () => {
    const f = fixture();
    const csv = csvRows(['Trade Date', 'Ticker', 'Shares'], [{ 'Trade Date': '2026-01-01', Ticker: 'SHOP', Shares: '1' }]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'unmapped-header-preview' });
    expect(preview.sourceHeaders).toEqual(['trade date', 'ticker', 'shares']);
    expect(preview.canonicalHeaders).toContain('record_type');
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.error).toBeTruthy();
    expect(preview.errors).toEqual(expect.arrayContaining([expect.objectContaining({ rowId: 'row-1' })]));
  });

  it('rejects aggregate opening-cash imports consistently with the API', async () => {
    const f = fixture();
    const csv = csvRows(
      ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'active', 'amount_minor'],
      [
        { record_type: 'account', id: 'home', source_id: '', date: '', kind: '', account_id: '', name: 'Home', account_kind: 'manual_asset', account_mode: 'aggregate', currency: 'CAD', active: '1', amount_minor: '' },
        { record_type: 'event', id: 'opening-cash', source_id: 'opening-cash', date: '2026-01-01', kind: 'opening_cash', account_id: 'home', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', amount_minor: '25000' },
      ],
    );
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'aggregate-opening-cash-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('requires holdings accounts')]));
    expect(preview.rows.find((row) => row.recordType === 'event')?.error).toContain('requires holdings accounts');
  });

  it('roundtrips account mode transitions without exporting generated opening rows twice', async () => {
    const source = fixture();
    await account(source.db, 'brokerage', 'brokerage', 'aggregate');
    await upsertWealthInstrument(source.db, owner, { id: 'shop', ...instrument });
    await upsertWealthAccount(source.db, owner, {
      id: 'brokerage', name: 'brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD',
      effectiveDate: '2026-02-01', openingCashMinor: 10000,
      openingPositions: [{ id: 'opening-position', sourceId: 'opening-source', instrument, quantity: '1', basis: money(8000), priceMinor: 9000 }],
    });
    const csv = await wealthExportCsv(source.db, owner);
    expect(csv).toContain('mode_transition');
    expect(csv).not.toContain(',opening_cash,');
    expect(csv).not.toContain(',opening_position,');

    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, owner, { csv, operationId: 'transition-roundtrip-preview' });
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((row) => row.recordType)).toEqual(expect.arrayContaining(['account', 'instrument', 'mode_transition']));
    const commit = await commitWealthImport(destination.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'transition-roundtrip-commit' }) as { committed: number };
    expect(commit.committed).toBe(3);
    expect((await readWealthAccounts(destination.db, owner)).accounts).toEqual([expect.objectContaining({ id: 'brokerage', mode: 'holdings' })]);
    expect((await readWealthEvents(destination.db, owner)).events).toHaveLength(2);
    expect((await readWealthValuations(destination.db, owner)).valuations).toHaveLength(1);
    expect((await destination.db.prepare('SELECT COUNT(*) AS count FROM wealth_account_mode_transitions WHERE ledger_id=?').bind(owner.ledgerId).first<{ count: number }>())?.count).toBe(1);
  });

  it('imports a new transition onto an existing account at its current mode', async () => {
    const f = fixture();
    await account(f.db, 'brokerage', 'brokerage', 'aggregate');
    const csv = csvRows(['record_type', 'id', 'account_id', 'currency', 'effective_date', 'from_mode', 'to_mode', 'opening_cash_minor'], [{
      record_type: 'mode_transition', id: 'mode-transition:brokerage:2026-02-01', account_id: 'brokerage', currency: 'CAD', effective_date: '2026-02-01', from_mode: 'aggregate', to_mode: 'holdings', opening_cash_minor: '1000',
    }]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'existing-transition-preview' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 1, operationId: 'existing-transition-commit' })).resolves.toMatchObject({ committed: 1, revision: 2 });
    expect((await readWealthAccounts(f.db, owner)).accounts).toEqual([expect.objectContaining({ id: 'brokerage', mode: 'holdings' })]);
    expect((await readWealthEvents(f.db, owner)).events).toHaveLength(1);
  });

  it('validates event mode at each effective date across an imported transition', async () => {
    const f = fixture();
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'active', 'exchange', 'ticker', 'type', 'quantity', 'consideration_minor', 'fee_minor', 'from_mode', 'to_mode', 'effective_date', 'transition_json'];
    const transition = JSON.stringify({ fromMode: 'aggregate', toMode: 'holdings', effectiveDate: '2026-02-01', openingCashMinor: 1000, openingValueMinor: null, openingPositions: [] });
    const before = csvRows(headers, [
      { record_type: 'account', id: 'brokerage', source_id: '', date: '', kind: '', account_id: '', name: 'Brokerage', account_kind: 'brokerage', account_mode: 'aggregate', currency: 'CAD', active: '1', exchange: '', ticker: '', type: '', quantity: '', consideration_minor: '', fee_minor: '', from_mode: '', to_mode: '', effective_date: '', transition_json: '' },
      { record_type: 'mode_transition', id: 'mode-transition:brokerage:2026-02-01', source_id: '', date: '2026-02-01', kind: '', account_id: 'brokerage', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', exchange: '', ticker: '', type: '', quantity: '', consideration_minor: '', fee_minor: '', from_mode: 'aggregate', to_mode: 'holdings', effective_date: '2026-02-01', transition_json: transition },
      { record_type: 'instrument', id: 'shop', source_id: '', date: '', kind: '', account_id: '', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', exchange: 'TSX', ticker: 'SHOP', type: 'stock', quantity: '', consideration_minor: '', fee_minor: '', from_mode: '', to_mode: '', effective_date: '', transition_json: '' },
      { record_type: 'event', id: 'too-early', source_id: 'too-early', date: '2026-01-31', kind: 'buy', account_id: 'brokerage', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', exchange: 'TSX', ticker: 'SHOP', type: 'stock', quantity: '1', consideration_minor: '100', fee_minor: '', from_mode: '', to_mode: '', effective_date: '', transition_json: '' },
    ]);
    const rejected = await createWealthImportPreview(f.db, owner, { csv: before, operationId: 'transition-before-preview' });
    expect(rejected.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('holdings')]))

    const after = before.replace('2026-01-31', '2026-02-02').replace('too-early', 'after-transition');
    const accepted = await createWealthImportPreview(f.db, owner, { csv: after, operationId: 'transition-after-preview' });
    expect(accepted.errors).toEqual([]);
  });

  it('validates imported replay against only the current holdings segment', async () => {
    const f = fixture();
    await account(f.db, 'brokerage');
    await event(f.db, { id: 'old-opening', sourceId: 'old-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'brokerage', money: money(10000) });
    await upsertWealthAccount(f.db, owner, { id: 'brokerage', name: 'brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-02', openingValueMinor: 10000 });
    const headers = ['record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'active', 'exchange', 'ticker', 'type', 'quantity', 'consideration_minor', 'fee_minor', 'from_mode', 'to_mode', 'effective_date', 'opening_cash_minor', 'transition_json'];
    const transition = JSON.stringify({ fromMode: 'aggregate', toMode: 'holdings', effectiveDate: '2026-01-03', openingCashMinor: 1000, openingValueMinor: null, openingPositions: [] });
    const csv = csvRows(headers, [
      { record_type: 'mode_transition', id: 'mode-transition:brokerage:2026-01-03', source_id: '', date: '2026-01-03', kind: '', account_id: 'brokerage', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', exchange: '', ticker: '', type: '', quantity: '', consideration_minor: '', fee_minor: '', from_mode: 'aggregate', to_mode: 'holdings', effective_date: '2026-01-03', opening_cash_minor: '1000', transition_json: transition },
      { record_type: 'event', id: 'buy', source_id: 'buy', date: '2026-01-04', kind: 'buy', account_id: 'brokerage', name: '', account_kind: '', account_mode: '', currency: 'CAD', active: '', exchange: 'TSX', ticker: 'SHOP', type: 'stock', quantity: '1', consideration_minor: '5000', fee_minor: '', from_mode: '', to_mode: '', effective_date: '', opening_cash_minor: '', transition_json: '' },
    ]);

    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'segment-replay-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('Cash balance cannot become negative')]));
  });

  it('commits selected preview rows incrementally without stranding the remainder', async () => {
    const f = fixture();
    const headers = ['record_type', 'id', 'name', 'account_kind', 'account_mode', 'currency', 'active'];
    const csv = csvRows(headers, [
      { record_type: 'account', id: 'home', name: 'Home', account_kind: 'manual_asset', account_mode: 'aggregate', currency: 'CAD', active: '1' },
      { record_type: 'account', id: 'loan', name: 'Loan', account_kind: 'debt', account_mode: 'aggregate', currency: 'CAD', active: '1' },
    ]);
    const preview = await createWealthImportPreview(f.db, owner, { csv, operationId: 'partial-preview' });
    const first = await commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 0, rowIds: ['row-1'], operationId: 'partial-first-commit' });
    expect(first).toMatchObject({ committed: 1, revision: 1 });
    expect(await f.db.prepare('SELECT state FROM wealth_import_previews WHERE ledger_id=? AND id=?').bind(owner.ledgerId, preview.previewId).first<{ state: string }>()).toMatchObject({ state: 'preview' });
    expect(await f.db.prepare('SELECT row_id,state FROM wealth_import_rows WHERE ledger_id=? AND preview_id=? ORDER BY row_index').bind(owner.ledgerId, preview.previewId).all()).toMatchObject({ results: [{ row_id: 'row-1', state: 'committed' }, { row_id: 'row-2', state: 'valid' }] });
    const second = await commitWealthImport(f.db, owner, preview.previewId, { expectedRevision: 1, rowIds: ['row-2'], operationId: 'partial-second-commit' });
    expect(second).toMatchObject({ committed: 1, revision: 2 });
    expect(await f.db.prepare('SELECT state FROM wealth_import_previews WHERE ledger_id=? AND id=?').bind(owner.ledgerId, preview.previewId).first<{ state: string }>()).toMatchObject({ state: 'committed' });
    expect((await readWealthAccounts(f.db, owner)).accounts.map((item) => item.id)).toEqual(['home', 'loan']);
  });

  it('roundtrips an original event and correction that retain one bank link', async () => {
    const source = fixture();
    await insertBankSource(source.db);
    await account(source.db, 'brokerage');
    await event(source.db, { id: 'original', sourceId: 'original', date: '2026-01-01', kind: 'contribution', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'bank-source-1' });
    await event(source.db, { id: 'correction', sourceId: 'correction', date: '2026-01-02', kind: 'correction', targetSourceId: 'original', replacement: { kind: 'contribution', date: '2026-01-01', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'bank-source-1' } });
    const destination = fixture();
    await insertBankSource(destination.db);
    const preview = await createWealthImportPreview(destination.db, owner, { csv: await wealthExportCsv(source.db, owner), operationId: 'correction-link-roundtrip' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(destination.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'correction-link-commit' })).resolves.toMatchObject({ committed: 3 });
  });

  it('uses a correction replacement date for mixed-mode transfer validation', async () => {
    const source = fixture();
    await account(source.db, 'from', 'brokerage', 'holdings');
    await account(source.db, 'to', 'brokerage', 'holdings');
    await event(source.db, { id: 'from-opening', sourceId: 'from-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'from', money: money(1000) });
    await event(source.db, { id: 'to-opening', sourceId: 'to-opening', date: '2026-01-01', kind: 'opening_cash', accountId: 'to', money: money(1000) });
    await event(source.db, {
      id: 'original-transfer', sourceId: 'original-transfer', date: '2026-02-01', kind: 'transfer', transferKind: 'cash',
      fromAccountId: 'from', toAccountId: 'to', money: money(100), transferId: 'transfer-1',
    });
    await upsertWealthAccount(source.db, owner, {
      id: 'from', name: 'from', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-02-02', openingValueMinor: 900,
    });
    await event(source.db, {
      id: 'correction-transfer', sourceId: 'correction-transfer', date: '2026-02-03', kind: 'correction', targetSourceId: 'original-transfer',
      replacement: {
        kind: 'transfer', date: '2026-02-01', transferKind: 'cash', fromAccountId: 'from', toAccountId: 'to', money: money(100), transferId: 'transfer-1',
      },
    });

    const destination = fixture();
    const preview = await createWealthImportPreview(destination.db, owner, { csv: await wealthExportCsv(source.db, owner), operationId: 'correction-transfer-date-preview' });
    expect(preview.errors).toEqual([]);
    await expect(commitWealthImport(destination.db, owner, preview.previewId, { expectedRevision: 0, operationId: 'correction-transfer-date-commit' })).resolves.toMatchObject({ committed: preview.rows.length });
  });
});
