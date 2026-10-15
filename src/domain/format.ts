import { getCurrencyMeta, type CurrencyCode, type CurrencyRegistry } from './currencies';

export function formatMoney(amountMinor: number, currency: CurrencyCode, options?: Intl.NumberFormatOptions, registry?: CurrencyRegistry) {
  const meta = getCurrencyMeta(currency, registry);
  if (!meta || !Number.isSafeInteger(amountMinor)) throw new RangeError('Invalid currency or amount.');
  return new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: meta.minorUnitDigits,
    maximumFractionDigits: meta.minorUnitDigits,
    ...options,
  }).format(amountMinor / 10 ** meta.minorUnitDigits);
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', ...options }).format(new Date(`${date}T12:00:00`));
}

