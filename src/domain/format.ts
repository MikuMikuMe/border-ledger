import type { Currency } from './types';

export function formatMoney(amountMinor: number, currency: Currency, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(amountMinor / 100);
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', ...options }).format(new Date(`${date}T12:00:00`));
}

