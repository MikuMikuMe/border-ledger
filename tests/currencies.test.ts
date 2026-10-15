import { describe, expect, it } from 'vitest';
import { createCurrencyRegistry, getCurrencyMeta, parseMoneyMinor, resolveCurrencySymbol, supportedCurrencyCodes } from '../src/domain/currencies';
import { formatMoney } from '../src/domain/format';
import { calculateSpending } from '../src/domain/ledger';
import type { Transaction } from '../src/domain/types';
import { analyzeRecurring, type RecurringStream } from '../src/domain/recurring';

describe('validated currency registry', () => {
  it('accepts representative ISO currencies without a new display branch', () => {
    for (const [code, minorUnitDigits] of [['CAD', 2], ['CNY', 2], ['USD', 2], ['HKD', 2], ['EUR', 2], ['JPY', 0], ['KWD', 3]] as const) {
      expect(getCurrencyMeta(code)).toEqual({ code, minorUnitDigits });
      expect(formatMoney(1234, code)).toBeTruthy();
    }
    const transaction = (id: string, currency: string): Transaction<string> => ({ id, accountId: 'card', date: '2026-10-13', merchant: 'Shop', amountMinor: -100, currency, category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: id });
    expect(calculateSpending(['CAD', 'CNY', 'USD', 'HKD', 'EUR'].map((code) => transaction(code, code)))).toMatchObject({ CAD: 100, CNY: 100, USD: 100, HKD: 100, EUR: 100 });
  });

  it('keeps the contract allowlist deterministic across host ICU versions', () => {
    expect(supportedCurrencyCodes.length).toBeGreaterThan(150);
    expect(new Set(supportedCurrencyCodes).size).toBe(supportedCurrencyCodes.length);
    expect(supportedCurrencyCodes).toContain('EUR');
    expect(supportedCurrencyCodes).toContain('JPY');
    expect(supportedCurrencyCodes).toContain('TND');
  });

  it('rejects unknown codes and ambiguous symbols', () => {
    expect(getCurrencyMeta('XYZ')).toBeNull();
    expect(getCurrencyMeta('$')).toBeNull();
    expect(resolveCurrencySymbol('$')).toBeNull();
    expect(resolveCurrencySymbol('¥')).toBeNull();
  });

  it('uses injected zero and three decimal metadata for exact parsing and formatting', () => {
    const registry = createCurrencyRegistry([{ code: 'JPY', minorUnitDigits: 0 }, { code: 'KWD', minorUnitDigits: 3 }]);
    expect(parseMoneyMinor('123', 'JPY', registry)).toBe(123);
    expect(parseMoneyMinor('1.234', 'KWD', registry)).toBe(1234);
    expect(() => parseMoneyMinor('1.2', 'JPY', registry)).toThrow();
    expect(() => parseMoneyMinor('1.2345', 'KWD', registry)).toThrow();
    expect(formatMoney(1234, 'KWD', undefined, registry)).toContain('1.234');
    const transaction: Transaction<string> = { id: 'kwd-1', accountId: 'card', date: '2026-10-13', merchant: 'Shop', amountMinor: -1234, currency: 'KWD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'kwd-1' };
    expect(calculateSpending([transaction], { registry })).toEqual({ JPY: 0, KWD: 1234 });
  });

  it('uses contract zero and three decimal metadata for global parsing', () => {
    expect(parseMoneyMinor('123', 'JPY')).toBe(123);
    expect(parseMoneyMinor('1.234', 'KWD')).toBe(1234);
    expect(() => parseMoneyMinor('1.2', 'JPY')).toThrow();
    expect(() => parseMoneyMinor('1.2345', 'KWD')).toThrow();
  });

  it('keeps legacy recurring totals while adding registered currency totals', () => {
    const item: RecurringStream<string> = { id: 'usd-stream', itemId: 'item', streamId: 'provider', accountId: 'card', merchantName: 'Service', merchantEntityId: null, currency: 'USD', sourceStatus: 'MATURE', sourceFrequency: 'MONTHLY', frequency: 'MONTHLY', isOutflow: true, firstDate: '2026-01-01', lastDate: '2026-10-01', predictedNextDate: null, averageAmountMinor: -500, lastAmountMinor: -500, predictedAmountMinor: -500, memberships: [{ providerTransactionId: 'posted', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -500, currency: 'USD', status: 'posted', kind: 'expense' }], sourceUpdatedAt: null };
    expect(analyzeRecurring([item], '2026-10-13').monthlyByCurrency).toMatchObject({ CAD: 0, CNY: 0, USD: -500 });
  });

  it('rejects unsafe minor integers and invalid registry metadata', () => {
    expect(parseMoneyMinor('90071992547409.91', 'CAD')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseMoneyMinor('90071992547409.92', 'CAD')).toThrow();
    expect(() => createCurrencyRegistry([{ code: 'ZZ', minorUnitDigits: 2 }])).toThrow();
    expect(() => createCurrencyRegistry([{ code: 'USD', minorUnitDigits: -1 }])).toThrow();
  });
});
