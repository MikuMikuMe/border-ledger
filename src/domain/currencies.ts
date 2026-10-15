import registeredCurrencies from '../../contracts/currencies.json';

export type CurrencyCode = string;
export interface CurrencyMeta { code: CurrencyCode; minorUnitDigits: number }
export type CurrencyRegistry = ReadonlyMap<CurrencyCode, CurrencyMeta>;

// Keep validation independent of the host ICU/CLDR version. The contract is
// the app's deterministic ISO-4217 allowlist; runtime locale data is only for
// display, never for deciding whether a code is accepted.
const ISO_CURRENCY_CODES = new Set(registeredCurrencies.map(({ code }) => code));

export function createCurrencyRegistry(entries: readonly CurrencyMeta[]): CurrencyRegistry {
  const registry = new Map<CurrencyCode, CurrencyMeta>();
  for (const entry of entries) {
    if (!/^[A-Z]{3}$/.test(entry.code) || !ISO_CURRENCY_CODES.has(entry.code) || !Number.isInteger(entry.minorUnitDigits) || entry.minorUnitDigits < 0 || entry.minorUnitDigits > 3 || registry.has(entry.code)) {
      throw new RangeError(`Invalid currency metadata: ${entry.code}`);
    }
    registry.set(entry.code, Object.freeze({ code: entry.code, minorUnitDigits: entry.minorUnitDigits }));
  }
  return registry;
}

export const currencyRegistry = createCurrencyRegistry(registeredCurrencies);

export const supportedCurrencyCodes: readonly CurrencyCode[] = Object.freeze([...currencyRegistry.keys()]);

export function getCurrencyMeta(code: string, registry: CurrencyRegistry = currencyRegistry): CurrencyMeta | null {
  return registry.get(code) ?? null;
}

export function listCurrencyMeta(registry: CurrencyRegistry = currencyRegistry): CurrencyMeta[] {
  return [...registry.values()];
}

export function resolveCurrencySymbol(symbol: string): CurrencyMeta | null {
  // Symbols such as $ and ¥ have several possible ISO codes and cannot identify money.
  return getCurrencyMeta(symbol);
}

export function parseMoneyMinor(value: string, currency: CurrencyCode, registry: CurrencyRegistry = currencyRegistry): number {
  const meta = getCurrencyMeta(currency, registry);
  if (!meta) throw new RangeError('Unknown currency.');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > meta.minorUnitDigits) throw new RangeError('Invalid money scale.');
  const digits = `${match[2]}${(match[3] ?? '').padEnd(meta.minorUnitDigits, '0')}`;
  const signed = BigInt(digits) * (match[1] ? -1n : 1n);
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Unsafe money amount.');
  return Number(signed);
}

export function emptyCurrencyTotals(registry: CurrencyRegistry = currencyRegistry): Record<CurrencyCode, number> {
  return Object.fromEntries([...registry.keys()].map((code) => [code, 0]));
}
