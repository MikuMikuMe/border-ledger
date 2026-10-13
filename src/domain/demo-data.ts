import type { Account, Transaction } from './types';

export const demoAccounts: Account[] = [
  { id: 'rbc-chequing', name: 'Everyday chequing', institution: 'RBC Royal Bank', currency: 'CAD', kind: 'chequing', status: 'connected', lastSyncedAt: '2026-10-12T08:04:00-04:00' },
  { id: 'boc-cny', name: 'Mainland account', institution: 'Bank of China', currency: 'CNY', kind: 'savings', status: 'import_only', lastSyncedAt: '2026-10-09T17:20:00+08:00' },
];

export const demoTransactions: Transaction[] = [
  { id: 'tx-1', accountId: 'rbc-chequing', date: '2026-10-12', merchant: 'Union Station Market', amountMinor: -2840, currency: 'CAD', category: 'Groceries', kind: 'expense', status: 'confirmed', source: 'plaid', fingerprint: 'union-market-2026-10-12-2840' },
  { id: 'tx-2', accountId: 'boc-cny', date: '2026-10-11', merchant: '上海地铁', amountMinor: -700, currency: 'CNY', category: 'Transport', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'metro-shanghai-2026-10-11-700' },
  { id: 'tx-3', accountId: 'rbc-chequing', date: '2026-10-10', merchant: 'Northern Lights Coffee', amountMinor: -650, currency: 'CAD', category: 'Dining', kind: 'expense', status: 'confirmed', source: 'plaid', fingerprint: 'northern-lights-2026-10-10-650' },
  { id: 'tx-4', accountId: 'boc-cny', date: '2026-10-10', merchant: '盒马鲜生', amountMinor: -12890, currency: 'CNY', category: 'Groceries', kind: 'expense', status: 'provisional', source: 'alert', fingerprint: 'hema-2026-10-10-12890' },
  { id: 'tx-5', accountId: 'rbc-chequing', date: '2026-10-09', merchant: 'Harbour Books', amountMinor: -1899, currency: 'CAD', category: 'Shopping', kind: 'expense', status: 'confirmed', source: 'plaid', fingerprint: 'harbour-books-2026-10-09-1899' },
  { id: 'tx-6', accountId: 'boc-cny', date: '2026-10-08', merchant: '滴滴出行', amountMinor: -3560, currency: 'CNY', category: 'Transport', kind: 'expense', status: 'needs_review', source: 'alert', fingerprint: 'didi-2026-10-08-3560', note: 'Alert needs matching against a statement row.' },
  { id: 'tx-7', accountId: 'rbc-chequing', date: '2026-10-07', merchant: 'RBC Visa payment', amountMinor: -42000, currency: 'CAD', category: 'Transfers', kind: 'transfer', status: 'confirmed', source: 'plaid', fingerprint: 'visa-payment-2026-10-07-42000' },
  { id: 'tx-8', accountId: 'rbc-chequing', date: '2026-10-06', merchant: 'Cloud Nine Books refund', amountMinor: 1200, currency: 'CAD', category: 'Refunds', kind: 'refund', status: 'confirmed', source: 'plaid', fingerprint: 'cloud-nine-refund-2026-10-06-1200' },
  { id: 'tx-9', accountId: 'boc-cny', date: '2026-10-05', merchant: '便利蜂', amountMinor: -2260, currency: 'CNY', category: 'Groceries', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'bianlifeng-2026-10-05-2260' },
  { id: 'tx-10', accountId: 'rbc-chequing', date: '2026-10-03', merchant: 'Toronto Hydro', amountMinor: -5440, currency: 'CAD', category: 'Home', kind: 'expense', status: 'confirmed', source: 'plaid', fingerprint: 'hydro-2026-10-03-5440' },
  { id: 'tx-11', accountId: 'boc-cny', date: '2026-10-02', merchant: '喜茶', amountMinor: -3200, currency: 'CNY', category: 'Dining', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'heytea-2026-10-02-3200' },
  { id: 'tx-12', accountId: 'rbc-chequing', date: '2026-10-01', merchant: 'RBC payroll', amountMinor: 420000, currency: 'CAD', category: 'Income', kind: 'income', status: 'confirmed', source: 'plaid', fingerprint: 'payroll-2026-10-01-420000' },
];

export const demoDaily = [
  { day: '01', CAD: 38, CNY: 21 }, { day: '02', CAD: 0, CNY: 32 }, { day: '03', CAD: 54, CNY: 0 }, { day: '04', CAD: 18, CNY: 26 },
  { day: '05', CAD: 0, CNY: 23 }, { day: '06', CAD: 0, CNY: 36 }, { day: '07', CAD: 42, CNY: 0 }, { day: '08', CAD: 12, CNY: 36 },
  { day: '09', CAD: 19, CNY: 0 }, { day: '10', CAD: 7, CNY: 17 }, { day: '11', CAD: 0, CNY: 7 }, { day: '12', CAD: 28, CNY: 0 },
];

