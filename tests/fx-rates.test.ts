import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  convertMinorUnits,
  fetchFrankfurterSnapshot,
  isSupportedFxDate,
  parseFrankfurterRates,
  type ValidatedFxRates,
} from '../worker/fx-rates';

const rates: ValidatedFxRates = {
  effectiveDate: '2026-10-13',
  rates: {
    USD: '0.83',
    CAD: '1.37',
    JPY: '159.5',
  },
};

describe('Frankfurter FX rates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates v2 rows and keeps rates as serializable decimal strings', () => {
    expect(parseFrankfurterRates([
      { date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 0.83 },
      { date: '2026-10-13', base: 'EUR', quote: 'CAD', rate: '1.37' },
    ])).toEqual({
      effectiveDate: '2026-10-13',
      rates: { USD: '0.83', CAD: '1.37' },
    });
  });

  it('preserves raw provider number lexemes instead of parsing rates through binary numbers', async () => {
    const raw = '[{"date":"2026-10-13","base":"EUR","quote":"USD","rate":1.0000000000000001}]';
    const snapshot = await fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response(raw, { status: 200 })));

    expect(snapshot.rates).toEqual({ USD: '1.0000000000000001' });
  });

  it('uses EUR as the identity quote and inverts source quotes exactly', () => {
    expect(convertMinorUnits({
      amountMinorUnits: 100,
      sourceCurrency: 'EUR',
      targetCurrency: 'CAD',
      rates,
    })).toBe(137);
    expect(convertMinorUnits({
      amountMinorUnits: 137,
      sourceCurrency: 'CAD',
      targetCurrency: 'EUR',
      rates,
    })).toBe(100);
    expect(convertMinorUnits({
      amountMinorUnits: 123,
      sourceCurrency: 'EUR',
      targetCurrency: 'EUR',
      rates,
    })).toBe(123);
  });

  it('computes a cross-rate and rounds once at target precision', () => {
    expect(convertMinorUnits({
      amountMinorUnits: 100,
      sourceCurrency: 'USD',
      targetCurrency: 'CAD',
      rates,
    })).toBe(165);
    expect(convertMinorUnits({
      amountMinorUnits: 100,
      sourceCurrency: 'USD',
      targetCurrency: 'JPY',
      rates,
    })).toBe(192);
  });

  it('keeps signed refunds negative after magnitude rounding', () => {
    expect(convertMinorUnits({
      amountMinorUnits: -100,
      sourceCurrency: 'USD',
      targetCurrency: 'CAD',
      rates,
    })).toBe(-165);
  });

  it('rounds exact half-way magnitudes away from zero at target precision', () => {
    const halfway: ValidatedFxRates = { effectiveDate: '2026-10-13', rates: { CAD: '1.5', JPY: '0.5' } };
    expect(convertMinorUnits({ amountMinorUnits: 1, sourceCurrency: 'EUR', targetCurrency: 'CAD', rates: halfway })).toBe(2);
    expect(convertMinorUnits({ amountMinorUnits: -1, sourceCurrency: 'EUR', targetCurrency: 'CAD', rates: halfway })).toBe(-2);
    expect(convertMinorUnits({ amountMinorUnits: 100, sourceCurrency: 'EUR', targetCurrency: 'JPY', rates: halfway })).toBe(1);
    expect(convertMinorUnits({ amountMinorUnits: -100, sourceCurrency: 'EUR', targetCurrency: 'JPY', rates: halfway })).toBe(-1);
  });

  it('returns null when a safe input produces an unsafe converted output', () => {
    const doubling: ValidatedFxRates = { effectiveDate: '2026-10-13', rates: { CAD: '2' } };
    expect(convertMinorUnits({ amountMinorUnits: Number.MAX_SAFE_INTEGER, sourceCurrency: 'EUR', targetCurrency: 'CAD', rates: doubling })).toBeNull();
  });

  it('returns null for unavailable or invalid conversion inputs', () => {
    expect(convertMinorUnits({ amountMinorUnits: 100, sourceCurrency: 'USD', targetCurrency: 'GBP', rates })).toBeNull();
    expect(convertMinorUnits({ amountMinorUnits: 100, sourceCurrency: 'XYZ', targetCurrency: 'CAD', rates })).toBeNull();
    expect(convertMinorUnits({ amountMinorUnits: Number.MAX_SAFE_INTEGER + 1, sourceCurrency: 'USD', targetCurrency: 'CAD', rates })).toBeNull();
    expect(convertMinorUnits({ amountMinorUnits: 100, sourceCurrency: 'USD', targetCurrency: 'CAD', rates: { ...rates, rates: { USD: 'not-a-rate', CAD: '1.37' } } })).toBeNull();
  });

  it('rejects unknown, non-finite, non-positive, and duplicate provider rows', () => {
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'XYZ', rate: 1 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'USD', rate: Number.POSITIVE_INFINITY }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'USD', rate: -1 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 0 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'USD', quote: 'CAD', rate: 1 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'US', rate: 1 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'usd', rate: 1 }])).toThrow();
    expect(() => parseFrankfurterRates([{ date: '2026-10-13', base: 'EUR', quote: 'EUR', rate: 2 }])).toThrow();
    expect(() => parseFrankfurterRates([
      { date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 0.83 },
      { date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 0.84 },
    ])).toThrow();
    expect(() => parseFrankfurterRates([
      { date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 0.83 },
      { date: '2026-10-14', base: 'EUR', quote: 'CAD', rate: 1.37 },
    ])).toThrow();
  });

  it('rejects empty, non-array, and over-count provider payloads', () => {
    expect(() => parseFrankfurterRates([])).toThrow();
    expect(() => parseFrankfurterRates({})).toThrow();
    const tooMany = Array.from({ length: 257 }, () => ({ date: '2026-10-13', base: 'EUR', quote: 'USD', rate: 1 }));
    expect(() => parseFrankfurterRates(tooMany)).toThrow();
  });

  it('never logs provider response bodies on rejection', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response('secret provider body', { status: 502 })))).rejects.toThrow();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('strictly validates calendar dates', () => {
    expect(isSupportedFxDate('2026-10-13')).toBe(true);
    expect(isSupportedFxDate('2026-02-29')).toBe(false);
    expect(isSupportedFxDate('2026-02-30')).toBe(false);
    expect(isSupportedFxDate('2026-1-13')).toBe(false);
    expect(isSupportedFxDate('2026-10-13T00:00:00Z')).toBe(false);
    expect(() => parseFrankfurterRates([{ date: '2026-02-30', base: 'EUR', quote: 'USD', rate: 1 }])).toThrow();
  });

  it('constructs the fixed provider endpoint and returns a serializable snapshot', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify([{ date: '2026-10-12', base: 'EUR', quote: 'CAD', rate: 1.37 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const snapshot = await fetchFrankfurterSnapshot('2026-10-13', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.frankfurter.dev/v2/rates?date=2026-10-13&base=EUR',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(snapshot).toEqual({
      provider: 'frankfurter',
      requestedDate: '2026-10-13',
      effectiveDate: '2026-10-12',
      rates: { CAD: '1.37' },
    });
    expect(JSON.stringify(snapshot)).toContain('"CAD":"1.37"');
  });

  it('rejects HTTP failures, malformed bodies, empty bodies, and timed out requests', async () => {
    await expect(fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response('provider failure', { status: 503 })))).rejects.toThrow();
    await expect(fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response('{', { status: 200 })))).rejects.toThrow();
    await expect(fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response('   ', { status: 200 })))).rejects.toThrow();

    vi.useFakeTimers();
    const hangingFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = fetchFrankfurterSnapshot('2026-10-13', hangingFetcher);
    const timedOut = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
  });

  it('rejects response bodies beyond the bounded provider limit', async () => {
    const oversized = 'x'.repeat(70 * 1024);
    await expect(fetchFrankfurterSnapshot('2026-10-13', vi.fn(async () => new Response(oversized, { status: 200 })))).rejects.toThrow();
  });

  it('always uses the shared currency registry even when a caller supplies an override-shaped object', () => {
    const overrideAttempt = {
      amountMinorUnits: 1,
      sourceCurrency: 'USD',
      targetCurrency: 'CAD',
      rates: { effectiveDate: '2026-10-13', rates: { USD: '1', CAD: '1' } },
      registry: new Map([
        ['USD', { code: 'USD', minorUnitDigits: 0 }],
        ['CAD', { code: 'CAD', minorUnitDigits: 2 }],
      ]),
    } as unknown as Parameters<typeof convertMinorUnits>[0];

    expect(convertMinorUnits(overrideAttempt)).toBe(1);
  });
});
