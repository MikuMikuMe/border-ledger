export type Currency = 'CAD' | 'CNY';
export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
export type TransactionStatus = 'confirmed' | 'provisional' | 'needs_review';
export type TransactionSource = 'statement' | 'plaid' | 'alert' | 'manual';

export interface Account {
  id: string;
  name: string;
  institution: string;
  currency: Currency;
  kind: 'chequing' | 'savings' | 'credit';
  status: 'connected' | 'import_only' | 'needs_attention';
  lastSyncedAt: string | null;
  plaidItemId?: string | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: Currency;
  category: string;
  kind: TransactionKind;
  status: TransactionStatus;
  source: TransactionSource;
  fingerprint: string;
  note?: string;
}

export interface ReportWindow {
  key: 'today' | 'week' | 'month';
  label: string;
  start: string;
  end: string;
}

export interface SpendingSummary {
  CAD: number;
  CNY: number;
}

