import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import {
  ALPHA_VANTAGE_ENDPOINT,
  WEALTH_QUOTE_PROVIDER,
  confirmAlphaVantageMatch,
  lookupAlphaVantageInstrument,
  openWealthCredential,
  parseAlphaVantageListing,
  parseAlphaVantageQuote,
  parseAlphaVantageSearch,
  readWealthQuotes,
  refreshWealthQuote,
  removeWealthQuoteCredential,
  reserveWealthQuoteQuota,
  saveWealthQuoteCredential,
  sealWealthCredential,
  searchWealthQuote,
  type WealthQuoteInstrument,
  wealthQuoteToHoldingValuation,
} from '../worker/wealth-quotes';

const owner = { userId: 'owner', ledgerId: 'personal' };
const secret = 'ab'.repeat(32);
const stock: WealthQuoteInstrument = { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' };
const usStock: WealthQuoteInstrument = { exchange: 'NASDAQ', ticker: 'AAPL', type: 'stock', currency: 'USD' };

describe('wealth quote credential protection', () => {
  it('encrypts keys with ledger/provider-bound AAD and never exposes plaintext', async () => {
    const sealed = await sealWealthCredential('private-alpha-key', secret, { ledgerId: 'ledger-a', provider: WEALTH_QUOTE_PROVIDER });
    expect(JSON.stringify(sealed)).not.toContain('private-alpha-key');
    await expect(openWealthCredential(sealed, secret, { ledgerId: 'ledger-a', provider: WEALTH_QUOTE_PROVIDER })).resolves.toBe('private-alpha-key');
    await expect(openWealthCredential(sealed, secret, { ledgerId: 'ledger-b', provider: WEALTH_QUOTE_PROVIDER })).rejects.toThrow();
    await expect(sealWealthCredential('private-alpha-key', 'not-a-key', { ledgerId: 'ledger-a', provider: WEALTH_QUOTE_PROVIDER })).rejects.toThrow();
  });

  it('stores credentials independently per ledger and supports removal without returning keys', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
      await fixture.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'personal-key' }, { secret });
      await saveWealthQuoteCredential(fixture.db, { userId: 'other', ledgerId: 'other-ledger' }, { credential: 'other-key' }, { secret });
      const rows = await fixture.db.prepare('SELECT ciphertext,iv FROM wealth_quote_credentials ORDER BY ledger_id').all<{ ciphertext: string; iv: string }>();
      expect(JSON.stringify(rows)).not.toContain('personal-key');
      expect(JSON.stringify(rows)).not.toContain('other-key');
      await removeWealthQuoteCredential(fixture.db, owner);
      expect((await fixture.db.prepare("SELECT ledger_id FROM wealth_quote_credentials WHERE ledger_id='personal'").all()).results).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});

describe('Alpha Vantage quote validation', () => {
  it('requires an explicit exchange/currency/type match rather than ticker-only matching', () => {
    const match = {
      providerSymbol: 'SHOP.TRT', name: 'Shopify Inc.', type: 'Equity', region: 'Canada', currency: 'CAD', exchange: 'TSX',
    };
    expect(confirmAlphaVantageMatch(stock, match)).toBe(true);
    expect(confirmAlphaVantageMatch({ ...stock, exchange: 'NYSE', currency: 'USD' }, match)).toBe(false);
    expect(confirmAlphaVantageMatch({ ...stock, ticker: 'RY' }, match)).toBe(false);
    expect(confirmAlphaVantageMatch({ ...stock, type: 'etf' }, match)).toBe(false);
  });

  it('parses meaningful search and current quote payloads while rejecting empty or future observations', () => {
    const matches = parseAlphaVantageSearch({ bestMatches: [{
      '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', '9. matchScore': '1.0000', exchange: 'TSX',
    }] });
    expect(matches[0]).toMatchObject({ providerSymbol: 'SHOP.TRT', currency: 'CAD' });
    expect(parseAlphaVantageQuote({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '123.456', '07. latest trading day': '2026-11-02' } }, '2026-11-02')).toMatchObject({ symbol: 'SHOP.TRT', priceMinor: 12346, quoteDate: '2026-11-02' });
    expect(() => parseAlphaVantageSearch({ bestMatches: [] })).toThrow(/empty|match/i);
    expect(() => parseAlphaVantageQuote({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '123.45', '07. latest trading day': '2026-11-03' } }, '2026-11-02')).toThrow(/future/i);
  });

  it('parses bounded active US listings for symbols whose search rows omit exchange', () => {
    const listings = parseAlphaVantageListing([
      'symbol,name,exchange,assetType,ipoDate,delistingDate,status',
      'AAPL,"Apple, Inc.",NASDAQ,Stock,1980-12-12,,Active',
      'SPY,SPDR S&P 500 ETF Trust,NYSE ARCA,ETF,1993-01-22,,Active',
      'OLD,Old Company,NYSE,Stock,1980-01-01,2020-01-01, delisted',
    ].join('\n'));
    expect(listings).toEqual([
      expect.objectContaining({ providerSymbol: 'AAPL', exchange: 'NASDAQ', type: 'Equity', currency: 'USD' }),
      expect.objectContaining({ providerSymbol: 'SPY', exchange: 'ARCA', type: 'ETF', currency: 'USD' }),
    ]);
  });

  it('looks up only the fixed Alpha Vantage search endpoint and rejects provider errors', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/^https:\/\/www\.alphavantage\.co\/query\?/);
      expect(init?.redirect).toBe('error');
      return Response.json({ bestMatches: [{
        '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX',
      }] });
    });
    await expect(lookupAlphaVantageInstrument(stock, 'private-key', { fetcher, now: () => new Date('2026-11-02T12:00:00Z') })).resolves.toMatchObject({ status: 'matched', providerSymbol: 'SHOP.TRT' });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`function=SYMBOL_SEARCH`), expect.objectContaining({ method: 'GET', redirect: 'error' }));
    await expect(lookupAlphaVantageInstrument(stock, 'private-key', { fetcher: vi.fn(async () => new Response('provider failure', { status: 429 })), now: () => new Date('2026-11-02T12:00:00Z') })).resolves.toMatchObject({ status: 'provider_error' });
    expect(ALPHA_VANTAGE_ENDPOINT).toBe('https://www.alphavantage.co/query');
  });
});

describe('wealth quote quota and cache publication', () => {
  it('reserves at most 25 requests in a rolling window under concurrent calls', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const results = await Promise.all(Array.from({ length: 30 }, () => reserveWealthQuoteQuota(fixture.db, owner, { instrumentKey: 'TSX\u0000SHOP\u0000stock\u0000CAD', now: new Date('2026-11-02T12:00:00Z') })));
      expect(results.filter(Boolean)).toHaveLength(25);
      expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM wealth_quote_quota_reservations').first<{ count: number }>())?.count).toBe(25);
    } finally {
      fixture.close();
    }
  });

  it('refreshes a current quote, reuses it without quota, and preserves it on provider failure', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe('error');
        return String(_input).includes('function=SYMBOL_SEARCH')
          ? Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] })
          : Response.json({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '123.45', '07. latest trading day': '2026-11-02' } });
      });
      const first = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, { secret, fetcher, now: () => new Date('2026-11-02T12:00:00Z') });
      expect(first).toMatchObject({ status: 'refreshed', quote: { priceMinor: 12345, quoteDate: '2026-11-02' } });
      const reservationCount = (await fixture.db.prepare('SELECT COUNT(*) AS count FROM wealth_quote_quota_reservations').first<{ count: number }>())?.count;
      const cached = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, { secret, fetcher: vi.fn(), now: () => new Date('2026-11-02T15:00:00Z') });
      expect(cached).toMatchObject({ status: 'cached', quote: { priceMinor: 12345 } });
      expect(cached.quote).toEqual(first.quote);
      expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM wealth_quote_quota_reservations').first<{ count: number }>())?.count).toBe(reservationCount);
      const failed = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, { secret, fetcher: vi.fn(async () => new Response('rate limited', { status: 429 })), now: () => new Date('2026-11-03T12:00:00Z') });
      expect(failed).toMatchObject({ status: 'provider_error', quote: { priceMinor: 12345 } });
      expect(JSON.stringify(failed)).not.toContain('private-key');
    } finally {
      fixture.close();
    }
  });

  it('confirms US symbols through LISTING_STATUS and reserves every provider request', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      const functions: string[] = [];
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe('error');
        const providerFunction = new URL(String(input)).searchParams.get('function') ?? '';
        functions.push(providerFunction);
        if (providerFunction === 'SYMBOL_SEARCH') return Response.json({ bestMatches: [{ '1. symbol': 'AAPL', '2. name': 'Apple Inc.', '3. type': 'Equity', '4. region': 'United States', '8. currency': 'USD' }] });
        if (providerFunction === 'LISTING_STATUS') return new Response('symbol,name,exchange,assetType,ipoDate,delistingDate,status\nAAPL,"Apple, Inc.",NASDAQ,Stock,1980-12-12,,Active\n', { headers: { 'content-type': 'text/csv' } });
        return Response.json({ 'Global Quote': { '01. symbol': 'AAPL', '05. price': '200.01', '07. latest trading day': '2026-11-02', '08. currency': 'USD' } });
      });
      const result = await refreshWealthQuote(fixture.db, owner, { instrument: usStock, providerSymbol: 'AAPL' }, { secret, fetcher, now: () => new Date('2026-11-02T12:00:00Z') });
      expect(result).toMatchObject({ status: 'refreshed', quote: { priceMinor: 20001, providerSymbol: 'AAPL' } });
      expect(functions).toEqual(['SYMBOL_SEARCH', 'LISTING_STATUS', 'GLOBAL_QUOTE']);
      expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM wealth_quote_quota_reservations').first<{ count: number }>())?.count).toBe(3);
    } finally {
      fixture.close();
    }
  });

  it('rejects a spoofed provider symbol before GLOBAL_QUOTE can price another instrument', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      const functions: string[] = [];
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const providerFunction = new URL(String(input)).searchParams.get('function') ?? '';
        functions.push(providerFunction);
        return Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] });
      });
      const result = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'OTHER.TRT' }, { secret, fetcher, now: () => new Date('2026-11-02T12:00:00Z') });
      expect(result).toMatchObject({ status: 'unsupported' });
      expect(functions).toEqual(['SYMBOL_SEARCH']);
    } finally {
      fixture.close();
    }
  });

  it('keeps a manual same-day valuation authoritative when appending a provider observation', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      await fixture.db.prepare(`INSERT INTO wealth_accounts(ledger_id,id,name,kind,mode,currency) VALUES(?,?,?,?,?,?)`).bind('personal', 'brokerage', 'Brokerage', 'brokerage', 'holdings', 'CAD').run();
      await fixture.db.prepare(`INSERT INTO wealth_events(ledger_id,id,source_id,date,sequence,kind,account_id,payload_json) VALUES(?,?,?,?,?,?,?,?)`).bind(
        'personal', 'opening-shop', 'opening-shop', '2026-11-01', 1, 'opening_position', 'brokerage', JSON.stringify({ accountId: 'brokerage', instrument: stock, quantity: '1', kind: 'opening_position' }),
      ).run();
      await fixture.db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind('personal', 'manual-shop', 'brokerage', 'TSX\u0000SHOP\u0000stock\u0000CAD', '2026-11-02', 11111, 'manual', null, JSON.stringify({ accountId: 'brokerage', instrument: stock, asOf: '2026-11-02', priceMinor: 11111, source: 'manual', provider: null })).run();
      const result = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, {
        secret,
        fetcher: vi.fn(async (input: RequestInfo | URL) => String(input).includes('SYMBOL_SEARCH')
          ? Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] })
          : Response.json({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '123.45', '07. latest trading day': '2026-11-02' } })),
        now: () => new Date('2026-11-02T12:00:00Z'),
      });
      expect(result.status).toBe('refreshed');
      expect(await fixture.db.prepare(`SELECT price_minor,source FROM wealth_valuations WHERE ledger_id=? AND account_id=? AND instrument_key=? AND as_of=?`).bind('personal', 'brokerage', 'TSX\u0000SHOP\u0000stock\u0000CAD', '2026-11-02').first()).toMatchObject({ price_minor: 11111, source: 'manual' });
    } finally {
      fixture.close();
    }
  });

  it('offers a quota-fenced search contract and maps cached observations into wealth valuations', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      const search = await searchWealthQuote(fixture.db, owner, stock, {
        secret,
        fetcher: vi.fn(async () => Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] })),
        now: () => new Date('2026-11-02T12:00:00Z'),
      });
      expect(search).toMatchObject({ status: 'matched', providerSymbol: 'SHOP.TRT' });
      await fixture.db.prepare(`INSERT INTO wealth_quote_observations
        (ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('personal', 'TSX\u0000SHOP\u0000stock\u0000CAD', 'TSX', 'SHOP', 'stock', 'CAD', 'alpha_vantage', 'SHOP.TRT', '2026-11-02', 12345, '2026-11-02T12:00:00.000Z', 'r1').run();
      const quotes = await readWealthQuotes(fixture.db, owner, [stock], new Date('2026-11-02T15:00:00Z'));
      expect(wealthQuoteToHoldingValuation('brokerage', quotes[0])).toMatchObject({ accountId: 'brokerage', asOf: '2026-11-02', priceMinor: 12345, source: 'provider' });
    } finally {
      fixture.close();
    }
  });

  it('does not overwrite a newer cached date with a stale provider observation', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      await fixture.db.prepare(`INSERT INTO wealth_quote_observations
        (ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('personal', 'TSX\u0000SHOP\u0000stock\u0000CAD', 'TSX', 'SHOP', 'stock', 'CAD', 'alpha_vantage', 'SHOP.TRT', '2026-11-02', 12345, '2026-11-02T12:00:00.000Z', 'old').run();
      const result = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, {
        secret,
        fetcher: vi.fn(async () => Response.json({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '99.00', '07. latest trading day': '2026-11-01' } })),
        now: () => new Date('2026-11-03T12:00:00Z'),
      });
      expect(result.status).toBe('stale');
      expect(result.quote?.priceMinor).toBe(12345);
    } finally {
      fixture.close();
    }
  });

  it('ignores zero, malformed-key, and mismatched-provider cached rows', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const zeroKey = 'TSX\u0000RY\u0000stock\u0000CAD';
      let zeroInserted = false;
      try {
        await fixture.db.prepare(`INSERT INTO wealth_quote_observations
          (ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('personal', zeroKey, 'TSX', 'RY', 'stock', 'CAD', 'alpha_vantage', 'RY.TRT', '2026-11-02', 0, '2026-11-02T12:00:00.000Z', 'zero').run();
        zeroInserted = true;
      } catch { /* The migration may enforce the positive-price CHECK. */ }
      await fixture.db.prepare(`INSERT INTO wealth_quote_observations
        (ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('personal', 'TSX\u0000SHOP\u0000stock\u0000CAD', 'TSX', 'SHOP', 'stock', 'CAD', 'alpha_vantage', 'RY.TRT', '2026-11-02', 12345, '2026-11-02T12:00:00.000Z', 'wrong-symbol').run();
      const quotes = await readWealthQuotes(fixture.db, owner, [stock, { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' }], new Date('2026-11-02T15:00:00Z'));
      expect(quotes).toEqual([]);
      if (zeroInserted) expect(quotes).toEqual([]);
      expect(() => wealthQuoteToHoldingValuation('brokerage', {
        ledgerId: 'personal', instrumentKey: zeroKey, instrument: { exchange: 'TSX', ticker: 'RY', type: 'stock', currency: 'CAD' }, provider: 'alpha_vantage', providerSymbol: 'RY.TRT', quoteDate: '2026-11-02', priceMinor: 0, observedAt: '2026-11-02T12:00:00.000Z', revision: 'zero',
      })).toThrow(/valid|price/i);
    } finally {
      fixture.close();
    }
  });

  it('does not return a future row when a guarded publication loses to it', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await saveWealthQuoteCredential(fixture.db, owner, { credential: 'private-key' }, { secret });
      await fixture.db.prepare(`INSERT INTO wealth_quote_observations
        (ledger_id,instrument_key,exchange,ticker,instrument_type,currency,provider,provider_symbol,quote_date,price_minor,observed_at,revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('personal', 'TSX\u0000SHOP\u0000stock\u0000CAD', 'TSX', 'SHOP', 'stock', 'CAD', 'alpha_vantage', 'SHOP.TRT', '2026-11-05', 99999, '2026-11-05T12:00:00.000Z', 'future').run();
      const result = await refreshWealthQuote(fixture.db, owner, { instrument: stock, providerSymbol: 'SHOP.TRT' }, {
        secret,
        fetcher: vi.fn(async (input: RequestInfo | URL) => String(input).includes('SYMBOL_SEARCH')
          ? Response.json({ bestMatches: [{ '1. symbol': 'SHOP.TRT', '2. name': 'Shopify Inc.', '3. type': 'Equity', '4. region': 'Canada', '8. currency': 'CAD', exchange: 'TSX' }] })
          : Response.json({ 'Global Quote': { '01. symbol': 'SHOP.TRT', '05. price': '123.45', '07. latest trading day': '2026-11-02' } })),
        now: () => new Date('2026-11-03T12:00:00Z'),
      });
      expect(result).toMatchObject({ status: 'stale', quote: null });
      expect(await readWealthQuotes(fixture.db, owner, [stock], new Date('2026-11-03T12:00:00Z'))).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
