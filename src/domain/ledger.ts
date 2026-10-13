import type { Currency, Transaction, TransactionKind } from './types';

export interface SpendingOptions {
  includeProvisional?: boolean;
  startDate?: string;
  endDate?: string;
}

const isCountedStatus = (transaction: Transaction, includeProvisional: boolean) =>
  transaction.status === 'confirmed' || (includeProvisional && transaction.status === 'provisional');

const isCountedKind = (kind: TransactionKind) => kind === 'expense' || kind === 'refund' || kind === 'fee';

export function calculateSpending(
  transactions: Transaction[],
  options: SpendingOptions = {},
): Record<Currency, number> {
  const result: Record<Currency, number> = { CAD: 0, CNY: 0 };
  const includeProvisional = options.includeProvisional ?? false;

  for (const transaction of transactions) {
    if (!isCountedStatus(transaction, includeProvisional) || !isCountedKind(transaction.kind)) continue;
    if (options.startDate && transaction.date < options.startDate) continue;
    if (options.endDate && transaction.date > options.endDate) continue;

    const absoluteAmount = Math.abs(transaction.amountMinor);
    result[transaction.currency] += transaction.kind === 'refund' ? -absoluteAmount : absoluteAmount;
  }

  return result;
}

export function classifyTransaction({ amountMinor, description }: { amountMinor: number; description: string }): TransactionKind {
  const normalized = description.toLowerCase();
  if (/refund|reversal|返还|退款/.test(normalized)) return 'refund';
  if (/transfer|payment to|credit card|还款|转账/.test(normalized)) return 'transfer';
  if (/\bfee\b|\bservice charge\b|手续费/.test(normalized)) return 'fee';
  if (amountMinor >= 0) return 'income';
  return 'expense';
}

export function mergeImportedTransactions(existing: Transaction[], imported: Transaction[]): Transaction[] {
  const fingerprints = new Set(existing.map((transaction) => transaction.fingerprint));
  const merged = [...existing];

  for (const transaction of imported) {
    if (fingerprints.has(transaction.fingerprint)) continue;
    fingerprints.add(transaction.fingerprint);
    merged.push(transaction);
  }

  return merged.sort((a, b) => b.date.localeCompare(a.date));
}

export function filterTransactions(
  transactions: Transaction[],
  filters: { query?: string; currency?: Currency | 'all'; category?: string | 'all'; status?: Transaction['status'] | 'all'; source?: Transaction['source'] | 'all' } = {},
) {
  const query = filters.query?.trim().toLowerCase();
  return transactions.filter((transaction) => {
    const matchesQuery = !query || `${transaction.merchant} ${transaction.category} ${transaction.note ?? ''}`.toLowerCase().includes(query);
    const matchesCurrency = !filters.currency || filters.currency === 'all' || transaction.currency === filters.currency;
    const matchesCategory = !filters.category || filters.category === 'all' || transaction.category === filters.category;
    const matchesStatus = !filters.status || filters.status === 'all' || transaction.status === filters.status;
    const matchesSource = !filters.source || filters.source === 'all' || transaction.source === filters.source;
    return matchesQuery && matchesCurrency && matchesCategory && matchesStatus && matchesSource;
  });
}

