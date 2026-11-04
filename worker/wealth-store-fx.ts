import type { WealthFxStatus } from '../src/domain/wealth-api-types';
import type { D1Database } from './db-types';
import { readFxSnapshot } from './db-types';
import { convertMinorUnits, parseFrankfurterRates, type ValidatedFxRates } from './fx-rates';
import { warmFxSnapshot } from './ledger-reports';

export interface WealthFxConversionDependencies {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

export interface WealthFxConversionOptions {
  readonly db: D1Database;
  readonly totals: Readonly<Record<string, number>>;
  readonly requested: 'CAD' | null;
  readonly asOf: string;
  readonly dependencies?: WealthFxConversionDependencies;
  readonly statusByCurrency?: Readonly<Record<string, string>>;
}

type FxProvenance = Pick<WealthFxStatus, 'effectiveDate' | 'provider' | 'baseCurrency' | 'rates'>;

function emptyFxProvenance(): FxProvenance {
  return { effectiveDate: null, provider: null, baseCurrency: null, rates: {} };
}

function fxProvenance(rates: ValidatedFxRates | null, totals: Readonly<Record<string, number>>, requested: string): FxProvenance {
  const sourceCodes = Object.keys(totals).filter((code) => code !== requested);
  if (!rates || sourceCodes.length === 0) return emptyFxProvenance();
  const requiredQuotes = new Set<string>();
  for (const sourceCode of sourceCodes) {
    if (sourceCode !== 'EUR') requiredQuotes.add(sourceCode);
    if (requested !== 'EUR') requiredQuotes.add(requested);
  }
  const quotedRates = Object.fromEntries([...requiredQuotes].sort().flatMap((quote) => {
    const rate = rates.rates[quote];
    return rate === undefined ? [] : [[quote, rate] as const];
  }));
  return { effectiveDate: rates.effectiveDate, provider: 'frankfurter', baseCurrency: 'EUR', rates: quotedRates };
}

function incompleteCurrencyCodes(statusByCurrency: Readonly<Record<string, string>>): readonly string[] {
  return Object.entries(statusByCurrency).filter(([, status]) => status === 'incomplete').map(([currency]) => currency);
}

function parseStoredRates(row: { readonly effective_date: string; readonly rates_json: string }): ValidatedFxRates | null {
  try {
    return parseFrankfurterRates(Object.entries(JSON.parse(row.rates_json) as Record<string, unknown>).map(([quote, rate]) => ({ date: row.effective_date, base: 'EUR', quote, rate })));
  } catch {
    return null;
  }
}

async function loadRates(db: D1Database, asOf: string, dependencies: WealthFxConversionDependencies): Promise<ValidatedFxRates | null> {
  const row = await readFxSnapshot(db, asOf);
  const stored = row ? parseStoredRates(row) : null;
  if (stored) return stored;
  if (!dependencies.fetcher) return null;
  try {
    return await warmFxSnapshot(db, asOf, dependencies);
  } catch {
    return null;
  }
}

export async function convertWealthTotals(options: WealthFxConversionOptions): Promise<WealthFxStatus> {
  const target = options.requested;
  if (!target) return { convertedCadMinor: null, complete: false, unavailable: [], ...emptyFxProvenance() };
  const rates = await loadRates(options.db, options.asOf, options.dependencies ?? {});
  let total = 0;
  const unavailable: string[] = [];
  for (const [code, amount] of Object.entries(options.totals)) {
    if (code === target) {
      total += amount;
      continue;
    }
    const converted = rates ? convertMinorUnits({ amountMinorUnits: amount, sourceCode: code, targetCode: target, rates }) : null;
    if (converted === null) unavailable.push(code);
    else total += converted;
  }
  const incomplete = incompleteCurrencyCodes(options.statusByCurrency ?? {});
  const complete = unavailable.length === 0 && incomplete.length === 0;
  return { convertedCadMinor: complete ? total : null, complete, unavailable, ...fxProvenance(rates, options.totals, target) };
}
