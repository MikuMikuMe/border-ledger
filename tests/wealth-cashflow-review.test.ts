import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthEvents, readWealthReport, readWealthSnapshot, upsertWealthAccount, upsertWealthValuation } from '../worker/wealth-store';
import type { CanonicalInstrument } from '../src/domain/wealth-types';
import { cashFlowRecords } from '../worker/wealth-store-cashflows';
import { decideManualMatch } from '../worker/manual-transactions';

const scope = { userId: 'owner', ledgerId: 'personal' };
const fixtures: Array<ReturnType<typeof createSqliteD1Fixture>> = [];
const money = (amountMinor: number) => ({ currency: 'CAD', amountMinor });
interface BankFixtureOptions { amountMinor?: number; bankKind?: 'income' | 'expense' | 'fee'; openingMinor?: number }

afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });

async function fixture(options: BankFixtureOptions = {}) {
  const f = createSqliteD1Fixture();
  fixtures.push(f);
  await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,currency_mode,kind,status,ledger_id) VALUES('bank','Bank','Synthetic','CAD','single','checking','active','personal')").run();
  await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx-1','bank','2026-01-02','Synthetic',?,'CAD','Investment',?,'confirmed','manual','fixture-bank','personal')").bind(options.amountMinor ?? 100, options.bankKind ?? 'income').run();
  await f.db.prepare(`INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,manual_id,bank_reference,content_digest)
    VALUES('source-row-1','personal','manual','identity-1','tx-1','bank','provider-1','pending-1','bank-source-1','bank-row-1','event-1','manual-1','reference-1','fixture-digest')`).run();
  await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
  await appendWealthEvent(f.db, scope, { id: 'opening', sourceId: 'opening', kind: 'opening_cash', date: '2026-01-01', accountId: 'brokerage', money: money(options.openingMinor ?? 10000) });
  return f;
}

async function report(f: Awaited<ReturnType<typeof fixture>>) {
  return readWealthReport(f.db, scope, { asOf: '2026-01-02', from: '2026-01-01', to: '2026-01-02' });
}

function eventCsv(events: readonly unknown[]): string {
  return 'record_type,event_json\n' + events.map((event) => 'event,"' + JSON.stringify(event).replaceAll('"', '""') + '"').join('\n') + '\n';
}

function capitalCorrection(linkedBankSourceId: string) {
  return { id: 'capital-correction', sourceId: 'capital-correction', kind: 'correction', date: '2026-01-03', targetSourceId: 'capital', replacement: { kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId } };
}

async function sharedBankFixture(reverse: boolean = false) {
  const f = await fixture();
  await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('tx-2','bank','2026-01-02','Synthetic second',100,'CAD','Investment','income','confirmed','manual','fixture-bank-2','personal')").run();
  await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,bank_source_id,manual_id,content_digest) VALUES('source-row-2','personal','manual','identity-2','tx-2','bank','bank-source-1','manual-2','fixture-digest-2')").run();
  if (reverse) {
    await f.db.prepare("DELETE FROM transaction_source_records WHERE id='source-row-1'").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,bank_source_id,manual_id,content_digest) VALUES('source-row-1','personal','manual','identity-1','tx-1','bank','bank-source-1','manual-1','fixture-digest')").run();
  }
  return f;
}

function capitalEvent(sourceId: string, linkedBankSourceId: string) {
  return { id: sourceId, sourceId, kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId };
}

async function transferredSplitFixture() {
  const f = await fixture();
  const instrument: CanonicalInstrument = { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' };
  for (const id of ['source', 'destination']) await upsertWealthAccount(f.db, scope, { id, name: id, kind: 'brokerage', mode: 'holdings', currency: 'CAD' });
  await appendWealthEvent(f.db, scope, { id: 'position', sourceId: 'position', kind: 'opening_position', date: '2026-01-01', accountId: 'source', instrument, quantity: '1', basis: money(10000) });
  await appendWealthEvent(f.db, scope, { id: 'split', sourceId: 'split', kind: 'split', date: '2026-01-02', accountId: 'source', instrument, numerator: 2, denominator: 1 });
  await appendWealthEvent(f.db, scope, { id: 'transfer', sourceId: 'transfer', kind: 'transfer', transferKind: 'position', date: '2026-01-03', fromAccountId: 'source', toAccountId: 'destination', instrument, quantity: '2', transferId: 'split-transfer' });
  await upsertWealthValuation(f.db, scope, { id: 'old-price', accountId: 'destination', instrument, asOf: '2026-01-01', priceMinor: 10000, source: 'manual' });
  return { ...f, instrument };
}

const bankAliases = ['tx-1', 'source-row-1', 'identity-1', 'provider-1', 'pending-1', 'bank-source-1', 'bank-row-1', 'event-1', 'reference-1'];

describe('PR 85 bank links and performance review', () => {
  it.each([
    { asOf: '2026-01-01', to: undefined },
    { asOf: '2026-01-01', to: '2026-01-05' },
    { asOf: '2026-01-02', to: '2026-01-01' },
  ])('excludes bank cash flows after the effective report cutoff ($asOf, $to)', async ({ asOf, to }) => {
    const f = await fixture();
    const result = await readWealthReport(f.db, scope, { asOf, to, from: '2026-01-01' });
    expect(result.householdCashFlows).toEqual([]);
    expect(result.cashFlows).toEqual([]);
    expect(result.cashFlowTotals).toEqual({});
    expect(result.investmentCashFlows).toEqual([]);
  });

  it('includes bank cash flows on the as-of date within the requested period', async () => {
    const f = await fixture();
    const result = await readWealthReport(f.db, scope, { asOf: '2026-01-02', from: '2026-01-02', to: '2026-01-05' });
    expect(result.householdCashFlows).toEqual([expect.objectContaining({ transactionId: 'tx-1', date: '2026-01-02' })]);
    expect(result.cashFlowTotals.CAD).toMatchObject({ incomeMinor: 100 });
  });

  it.each(bankAliases.map(alias => ({ alias })))('recognizes $alias as the same bank transaction and counts the contribution once', async ({ alias }) => {
    const f = await fixture();
    await appendWealthEvent(f.db, scope, { id: 'capital', sourceId: 'capital', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: alias });
    const records = await cashFlowRecords(f.db, scope, (await readWealthEvents(f.db, scope)).events);
    expect(records).toEqual([expect.objectContaining({ transactionId: 'tx-1', linkedWealthSourceId: 'capital' })]);
    const result = await report(f);
    expect(result.investmentCashFlows).toEqual([expect.objectContaining({ linkedWealthSourceId: 'capital', classification: 'external_contribution' })]);
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: true, value: 0 });
  });

  it.each([
    { original: 'source-row-1', replacement: 'tx-1' },
    { original: 'tx-1', replacement: 'bank-source-1' },
    { original: 'provider-1', replacement: 'source-row-2' },
  ])('allows a correction from $original to $replacement for the same transaction', async ({ original, replacement }) => {
    const f = await fixture();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest) VALUES('source-row-2','personal','manual','identity-2','tx-1','bank','manual-2','fixture-digest-2')").run();
    await appendWealthEvent(f.db, scope, { id: 'capital', sourceId: 'capital', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: original });
    await expect(appendWealthEvent(f.db, scope, capitalCorrection(replacement))).resolves.toMatchObject({ event: { sourceId: 'capital-correction' } });
    const result = await readWealthReport(f.db, scope, { asOf: '2026-01-03', from: '2026-01-01', to: '2026-01-03' });
    expect(result.investmentCashFlows).toHaveLength(1);
    expect(result.investmentCashFlows[0]).toMatchObject({ linkedWealthSourceId: 'capital-correction:replacement', classification: 'external_contribution' });
    expect(result.totalByCurrency.CAD).toBe(10100);
  });

  it.each(['tx-1','source-row-1','bank-source-1'])('preserves wealth link %s across duplicate confirmation and reversal', async linked => {
    const f = await fixture();
    await appendWealthEvent(f.db, scope, capitalEvent('capital', linked));
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-tx','bank','2026-01-02','Bank record',100,'CAD','Investment','income','confirmed','plaid','bank-fingerprint','personal')").run();
    const events=(await readWealthEvents(f.db,scope)).events;
    expect(await cashFlowRecords(f.db,scope,events)).toEqual(expect.arrayContaining([expect.objectContaining({transactionId:'tx-1',linkedWealthSourceId:'capital'})]));
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'confirmed',expectedRevision:0});
    expect(await cashFlowRecords(f.db,scope,events)).toEqual([expect.objectContaining({transactionId:'bank-tx',linkedWealthSourceId:'capital'})]);
    expect((await report(f)).investmentCashFlows).toEqual([expect.objectContaining({linkedWealthSourceId:'capital',classification:'external_contribution'})]);
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'dismissed',expectedRevision:1});
    expect(await cashFlowRecords(f.db,scope,events)).toEqual(expect.arrayContaining([expect.objectContaining({transactionId:'tx-1',linkedWealthSourceId:'capital'}),expect.objectContaining({transactionId:'bank-tx',linkedWealthSourceId:null})]));
  });
  it('rejects a second wealth event linked through the confirmed bank duplicate', async () => {
    const f=await fixture();
    await appendWealthEvent(f.db,scope,capitalEvent('capital','source-row-1'));
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-tx','bank','2026-01-02','Bank record',100,'CAD','Investment','income','confirmed','plaid','bank-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,content_digest) VALUES('bank-source','personal','legacy','bank-identity','bank-tx','bank','digest')").run();
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'confirmed',expectedRevision:0});
    await expect(appendWealthEvent(f.db,scope,capitalEvent('second-capital','bank-source'))).rejects.toMatchObject({code:'bank_link_conflict'});
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'dismissed',expectedRevision:1});
    await expect(appendWealthEvent(f.db,scope,capitalEvent('second-capital','bank-source'))).resolves.toBeDefined();
  });

  it('rejects importing two wealth links for one confirmed manual-bank pair', async () => {
    const f=await fixture();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-tx','bank','2026-01-02','Bank record',100,'CAD','Investment','income','confirmed','plaid','bank-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,content_digest) VALUES('bank-source','personal','legacy','bank-identity','bank-tx','bank','digest')").run();
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'confirmed',expectedRevision:0});
    const preview=await createWealthImportPreview(f.db,scope,{csv:eventCsv([capitalEvent('first','source-row-1'),capitalEvent('second','bank-source')]),operationId:'duplicate-pair-preview'});
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('conflicts with another imported bank link')]));
  });

  it('flags conflicting wealth links when independently linked transactions become duplicates', async () => {
    const f=await fixture();
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-tx','bank','2026-01-02','Bank record',100,'CAD','Investment','income','confirmed','plaid','bank-fingerprint','personal')").run();
    await f.db.prepare("INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,content_digest) VALUES('bank-source','personal','legacy','bank-identity','bank-tx','bank','digest')").run();
    await appendWealthEvent(f.db,scope,capitalEvent('first','source-row-1'));
    await appendWealthEvent(f.db,scope,capitalEvent('second','bank-source'));
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'confirmed',expectedRevision:0});
    const events=(await readWealthEvents(f.db,scope)).events;
    expect(await cashFlowRecords(f.db,scope,events)).toEqual([expect.objectContaining({transactionId:'bank-tx',linkedWealthSourceId:null,linkConflict:true})]);
  });

  it('stops transferring the manual wealth link when a confirmed match becomes stale', async () => {
    const f=await fixture();
    await appendWealthEvent(f.db,scope,capitalEvent('capital','source-row-1'));
    await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank-tx','bank','2026-01-02','Bank record',100,'CAD','Investment','income','confirmed','plaid','bank-fingerprint','personal')").run();
    await decideManualMatch(f.db,scope,{manualId:'tx-1',bankId:'bank-tx',decision:'confirmed',expectedRevision:0});
    await f.db.prepare("UPDATE transactions SET amount_minor=200 WHERE id='bank-tx'").run();
    const events=(await readWealthEvents(f.db,scope)).events;
    expect(await cashFlowRecords(f.db,scope,events)).toEqual(expect.arrayContaining([expect.objectContaining({transactionId:'tx-1',linkedWealthSourceId:'capital'}),expect.objectContaining({transactionId:'bank-tx',linkedWealthSourceId:null})]));
  });

  it('imports an alias-equivalent correction of an existing bank link', async () => {
    const f = await fixture();
    await appendWealthEvent(f.db, scope, { id: 'capital', sourceId: 'capital', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'source-row-1' });
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv([capitalCorrection('tx-1')]), operationId: 'same-link-correction-preview' });
    expect(preview.validationErrors).toEqual([]);
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: preview.revision, operationId: 'same-link-correction-commit' })).resolves.toMatchObject({ committed: 1 });
  });

  it('imports original and corrected aliases as one bank-link claim', async () => {
    const f = await fixture();
    const original = { id: 'capital', sourceId: 'capital', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(100), linkedBankSourceId: 'source-row-1' };
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv([original, capitalCorrection('tx-1')]), operationId: 'same-import-link-preview' });
    expect(preview.validationErrors).toEqual([]);
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: preview.revision, operationId: 'same-import-link-commit' })).resolves.toMatchObject({ committed: 2 });
  });

  it.each([{ reverse: false, specific: 'source-row-1' }, { reverse: true, specific: 'source-row-2' }])('rejects shared bank-source aliases regardless of row order ($reverse)', async ({ reverse, specific }) => {
    const f = await sharedBankFixture(reverse);
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv([capitalEvent('ambiguous', 'bank-source-1'), capitalEvent('specific', specific)]), operationId: 'ambiguous-shared-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('ambiguous bank link')]));
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: preview.revision, operationId: 'ambiguous-shared-commit' })).rejects.toBeDefined();
  });

  it('does not equate an ambiguous correction alias with its target during a fresh import', async () => {
    const f = await sharedBankFixture(true);
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv([capitalEvent('capital', 'source-row-1'), capitalCorrection('bank-source-1')]), operationId: 'ambiguous-correction-preview' });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('ambiguous bank link')]));
  });

  it('still accepts two distinct transaction-specific aliases from the same statement source', async () => {
    const f = await sharedBankFixture();
    const preview = await createWealthImportPreview(f.db, scope, { csv: eventCsv([capitalEvent('first', 'source-row-1'), capitalEvent('second', 'source-row-2')]), operationId: 'distinct-statement-preview' });
    expect(preview.validationErrors).toEqual([]);
    await expect(commitWealthImport(f.db, scope, preview.previewId, { expectedRevision: preview.revision, operationId: 'distinct-statement-commit' })).resolves.toMatchObject({ committed: 2 });
  });

  it('rejects an ambiguous first bank link on direct writes without changing the ledger', async () => {
    const f = await sharedBankFixture();
    const before = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-02' });
    await expect(appendWealthEvent(f.db, scope, capitalEvent('ambiguous-direct', 'bank-source-1'))).rejects.toMatchObject({ code: 'ambiguous_bank_link' });
    const after = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-02' });
    expect(after.revision).toBe(before.revision);
    expect(after.cash).toEqual(before.cash);
  });

  it('allows distinct direct transaction IDs even when their statement source is shared', async () => {
    const f = await sharedBankFixture();
    await appendWealthEvent(f.db, scope, capitalEvent('direct-first', 'tx-1'));
    await appendWealthEvent(f.db, scope, capitalEvent('direct-second', 'tx-2'));
    const result = await report(f);
    expect(result.investmentCashFlows).toHaveLength(2);
    expect(result.investmentCashFlows.every(flow => flow.classification === 'external_contribution')).toBe(true);
    expect(result.totalByCurrency.CAD).toBe(10200);
  });

  it.each(['contribution', 'withdrawal'] as const)('marks the CAD return unavailable when a linked %s amount disagrees', async kind => {
    const f = await fixture({ amountMinor: 5000, bankKind: kind === 'contribution' ? 'income' : 'expense', openingMinor: 20000 });
    await appendWealthEvent(f.db, scope, { id: 'capital', sourceId: 'capital', kind, date: '2026-01-02', accountId: 'brokerage', money: money(10000), linkedBankSourceId: 'source-row-1' });
    const result = await report(f);
    expect(result.investmentCashFlows).toEqual([expect.objectContaining({ classification: 'ambiguous', includedInPerformance: false })]);
    expect(result.modifiedDietz).toMatchObject({ available: false, reason: 'incomplete_flows' });
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: false, value: null, reason: 'incomplete_flows' });
  });

  it.each(['dividend', 'withholding', 'fee'] as const)('keeps %s outside external capital flows even when its bank match needs review', async kind => {
    const f = await fixture({ amountMinor: 500, bankKind: kind === 'dividend' ? 'income' : 'fee' });
    await appendWealthEvent(f.db, scope, { id: 'income-or-fee', sourceId: 'income-or-fee', kind, date: '2026-01-02', accountId: 'brokerage', money: money(1000), linkedBankSourceId: 'source-row-1' });
    const result = await report(f);
    expect(result.investmentCashFlows).toEqual([expect.objectContaining({ eventKind: kind, includedInPerformance: false, confirmed: false })]);
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: true, value: kind === 'dividend' ? 0.1 : -0.1 });
  });

  it('marks transferred split shares unavailable in the authoritative store until a post-split price exists', async () => {
    const f = await transferredSplitFixture();
    const stale = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' });
    expect(stale.positions).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'destination', quantity: '2', marketValueMinor: null })]));
    expect(stale.totalStatusByCurrency.CAD).toBe('incomplete');
    await upsertWealthValuation(f.db, scope, { id: 'new-price', accountId: 'destination', instrument: f.instrument, asOf: '2026-01-04', priceMinor: 5000, source: 'manual' });
    const current = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' });
    expect(current.totalByCurrency.CAD).toBe(20000);
    expect(current.totalStatusByCurrency.CAD).toBe('complete');
  });

  it('carries split price coverage through a historical source segment without leaking its replay account', async () => {
    const f = await transferredSplitFixture();
    await upsertWealthAccount(f.db, scope, { id: 'source', name: 'source', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', effectiveDate: '2026-01-04', openingValueMinor: 0 });
    const stale = await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' });
    expect(stale.positions).toEqual([expect.objectContaining({ accountId: 'destination', quantity: '2', marketValueMinor: null })]);
    expect(stale.totalStatusByCurrency.CAD).toBe('incomplete');
    expect(JSON.stringify(stale)).not.toContain('__wealth_segment__');
    await upsertWealthValuation(f.db, scope, { id: 'new-price', accountId: 'destination', instrument: f.instrument, asOf: '2026-01-04', priceMinor: 5000, source: 'manual' });
    expect((await readWealthSnapshot(f.db, scope, { asOf: '2026-01-04' })).totalByCurrency.CAD).toBe(20000);
  });

  it('keeps another currency available when only CAD capital flows are ambiguous', async () => {
    const f = await fixture({ amountMinor: 5000 });
    await upsertWealthAccount(f.db, scope, { id: 'usd', name: 'USD', kind: 'brokerage', mode: 'holdings', currency: 'USD' });
    await appendWealthEvent(f.db, scope, { id: 'usd-opening', sourceId: 'usd-opening', kind: 'opening_cash', date: '2026-01-01', accountId: 'usd', money: { currency: 'USD', amountMinor: 10000 } });
    await appendWealthEvent(f.db, scope, { id: 'capital', sourceId: 'capital', kind: 'contribution', date: '2026-01-02', accountId: 'brokerage', money: money(10000), linkedBankSourceId: 'source-row-1' });
    const result = await report(f);
    expect(result.modifiedDietzByCurrency.CAD).toMatchObject({ available: false, reason: 'incomplete_flows' });
    expect(result.modifiedDietzByCurrency.USD).toMatchObject({ available: true, value: 0 });
  });
});
