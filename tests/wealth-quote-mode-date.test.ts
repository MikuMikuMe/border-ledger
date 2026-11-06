import type { WealthAccountMode } from '../src/domain/wealth-types';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { appendWealthEvent, commitWealthImport, createWealthImportPreview, readWealthValuations, upsertWealthAccount, wealthExportCsv } from '../worker/wealth-store';
import { refreshWealthQuote, saveWealthQuoteCredential } from '../worker/wealth-quotes';
const scope = { ledgerId: 'personal', userId: 'owner' };
const instrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock' as const, currency: 'CAD' };
const secret = 'ab'.repeat(32);
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
function fixture() { const f = createSqliteD1Fixture(); fixtures.push(f); return f; }
interface QuoteModeCase {
  initial: WealthAccountMode;
  transitions: [string, WealthAccountMode][];
  quoteDate: string;
  expected: number;
}
const cases: QuoteModeCase[] = [
  { initial: 'aggregate', transitions: [['2026-11-03', 'holdings']], quoteDate: '2026-11-02', expected: 0 },
  { initial: 'aggregate', transitions: [['2026-11-02', 'holdings']], quoteDate: '2026-11-02', expected: 1 },
  { initial: 'holdings', transitions: [['2026-11-03', 'aggregate']], quoteDate: '2026-11-02', expected: 1 },
  ...['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map<QuoteModeCase>(quoteDate => ({ initial: 'aggregate', transitions: [['2026-11-01', 'holdings'], ['2026-11-03', 'aggregate'], ['2026-11-05', 'holdings']], quoteDate, expected: ['2026-11-02', '2026-11-05'].includes(quoteDate) ? 1 : 0 })),
];
async function opening(f: ReturnType<typeof fixture>, date: string) {
  await appendWealthEvent(f.db, scope, { id: `opening-${date}`, sourceId: `opening-${date}`, kind: 'opening_position', date, accountId: 'brokerage', instrument, quantity: '1', basis: { currency: 'CAD', amountMinor: 10000 } });
}

describe('provider quote effective representation', () => {
  it.each(cases)('publishes $quoteDate only into its holdings segment ($initial/$transitions)', async value => {
    const f = fixture();
    await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode: value.initial, currency: 'CAD' });
    if (value.initial === 'holdings') await opening(f, '2026-11-01');
    for (const [effectiveDate, mode] of value.transitions) {
      await upsertWealthAccount(f.db, scope, { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', mode, currency: 'CAD', effectiveDate, ...(mode === 'holdings' ? { openingCashMinor: 0 } : { openingValueMinor: 10000 }) });
      if (mode === 'holdings') await opening(f, effectiveDate);
    }
    await saveWealthQuoteCredential(f.db, scope, { credential: 'synthetic-key' }, { secret });
    const result = await refreshWealthQuote(f.db, scope, { instrument, providerSymbol: 'SHOP.TRT' }, { secret, now: () => new Date('2026-11-06T12:00:00Z'), fetcher: async input => String(input).includes('SYMBOL_SEARCH') ? Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Synthetic', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] }) : Response.json({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '100.00', '07. latest trading day': value.quoteDate } }) });
    expect(result.status).toBe('refreshed');
    expect((await f.db.prepare('SELECT quote_date FROM wealth_quote_observations').all()).results).toEqual([{ quote_date: value.quoteDate }]);
    const observations = await f.db.prepare("SELECT as_of FROM wealth_valuations WHERE source='provider'").all();
    expect(observations.results).toHaveLength(value.expected);
    const restored = fixture();
    const preview = await createWealthImportPreview(restored.db, scope, { csv: await wealthExportCsv(f.db, scope), operationId: 'restore' });
    expect(preview.errors).toEqual([]);
    await commitWealthImport(restored.db, scope, preview.previewId, { expectedRevision: preview.revision });
    expect((await readWealthValuations(restored.db, scope)).valuations).toEqual((await readWealthValuations(f.db, scope)).valuations);
  });
});
