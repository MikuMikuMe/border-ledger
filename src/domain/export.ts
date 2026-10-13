import type { Transaction } from './types';

const sourceLabels: Record<Transaction['source'], string> = {
  alert: 'BOC alert',
  manual: 'Manual',
  plaid: 'Plaid',
  statement: 'Statement',
};

const statusLabels: Record<Transaction['status'], string> = {
  confirmed: 'Confirmed',
  needs_review: 'Needs review',
  provisional: 'Provisional',
};

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeTransactionsCsv(transactions: Transaction[]) {
  const header = ['Date', 'Merchant', 'Category', 'Source', 'State', 'Amount', 'Currency', 'Note'];
  const rows = transactions.map((transaction) => [
    transaction.date,
    transaction.merchant,
    transaction.category,
    sourceLabels[transaction.source],
    statusLabels[transaction.status],
    (transaction.amountMinor / 100).toFixed(2),
    transaction.currency,
    transaction.note ?? '',
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}
