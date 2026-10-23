import type { CurrencyCode } from './currencies';
export type Currency = CurrencyCode;
export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
export type TransactionStatus = 'confirmed' | 'provisional' | 'needs_review';
export type TransactionSource = 'statement' | 'plaid' | 'alert' | 'manual' | 'lunchflow';

/**
 * The replay identity of a row supplied by a statement source.
 *
 * Bank row IDs are preferred when the source provides them. The file/row
 * pair remains necessary for exports that do not expose a stable row ID and
 * deliberately preserves repeated equal rows within one file.
 */
export interface StatementSourceIdentity {
  accountId: string;
  fileSha256: string;
  rowIndex: number;
  bankSourceId?: string | null;
  bankRowId?: string | null;
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  currency: Currency;
  kind: 'chequing' | 'savings' | 'credit';
  status: 'connected' | 'import_only' | 'needs_attention';
  lastSyncedAt: string | null;
  plaidItemId?: string | null;
  provider?: 'plaid' | 'lunchflow' | null;
}

export interface Transaction<Code extends CurrencyCode = CurrencyCode> {
  id: string;
  accountId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: Code;
  category: string;
  kind: TransactionKind;
  status: TransactionStatus;
  source: TransactionSource;
  fingerprint: string;
  note?: string;
  bankReference?: string | null;
  sourceIdentity?: StatementSourceIdentity;
}

export interface ReportWindow {
  key: 'today' | 'week' | 'month';
  label: string;
  start: string;
  end: string;
}

export type SpendingSummary = Record<CurrencyCode, number>;

