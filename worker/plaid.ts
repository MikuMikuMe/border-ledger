import { classifyTransaction } from '../src/domain/ledger';
import type { Currency, Transaction, TransactionKind, TransactionStatus } from '../src/domain/types';
import type { D1Database } from './db-types';

export type PlaidEnvironment = 'sandbox' | 'development' | 'production';

export interface PlaidTransaction {
  transaction_id: string;
  pending_transaction_id?: string | null;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  date: string;
  merchant_name?: string | null;
  name: string;
  pending: boolean;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
  category?: string[] | null;
  payment_channel?: string | null;
}

export interface PlaidSyncPage<T extends { transaction_id: string }> {
  added: T[];
  modified: T[];
  removed: Array<{ transaction_id: string }>;
  next_cursor: string;
  has_more: boolean;
}

export interface PlaidSyncResult<T extends { transaction_id: string }> {
  added: T[];
  modified: T[];
  removed: Array<{ transaction_id: string }>;
  nextCursor: string;
}

export interface SealedAccessToken {
  ciphertext: string;
  iv: string;
}

export interface MappedPlaidTransaction extends Transaction {
  plaidItemId: string | null;
  providerTransactionId: string | null;
  providerPendingTransactionId: string | null;
}

const plaidHosts: Record<PlaidEnvironment, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export const MAX_PLAID_SYNC_PAGES = 100;

const categoryLabels: Record<string, string> = {
  BANK_FEES: 'Fees',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Dining',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home',
  INCOME: 'Income',
  LOAN_PAYMENTS: 'Transfers',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Personal care',
  RENT_AND_UTILITIES: 'Housing',
  TRANSFER_IN: 'Transfers',
  TRANSFER_OUT: 'Transfers',
  TRAVEL: 'Travel',
  TRANSPORTATION: 'Transport',
};

export function buildPlaidRequest(environment: PlaidEnvironment, path: string, body: Record<string, unknown>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new Request(`${plaidHosts[environment]}${normalizedPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getPlaidEnvironment(value: string | undefined): PlaidEnvironment {
  if (value === 'development' || value === 'production') return value;
  return 'sandbox';
}

function normalizedCurrency(transaction: PlaidTransaction): Currency | null {
  const currency = (transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? '').toUpperCase();
  return currency === 'CAD' || currency === 'CNY' ? currency : null;
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function categoryFor(transaction: PlaidTransaction) {
  const primary = transaction.personal_finance_category?.primary?.toUpperCase() ?? '';
  return categoryLabels[primary] ?? 'Uncategorized';
}

function kindFor(transaction: PlaidTransaction, amountMinor: number): TransactionKind {
  const primary = transaction.personal_finance_category?.primary?.toUpperCase() ?? '';
  if (primary === 'BANK_FEES') return 'fee';
  if (primary === 'INCOME') return 'income';
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || primary === 'LOAN_PAYMENTS') return 'transfer';
  if (primary.includes('REFUND')) return 'refund';
  return classifyTransaction({
    amountMinor,
    description: `${transaction.merchant_name ?? ''} ${transaction.name} ${primary}`,
  });
}

export function mapPlaidTransaction(transaction: PlaidTransaction, accountId: string, itemId?: string): MappedPlaidTransaction | null {
  const currency = normalizedCurrency(transaction);
  if (!currency) return null;

  const canonicalId = transaction.pending_transaction_id || transaction.transaction_id;
  const merchant = transaction.merchant_name?.trim() || transaction.name.trim() || 'Unknown merchant';
  const amountMinor = Math.round(transaction.amount * -100);
  const kind = kindFor(transaction, amountMinor);
  const status: TransactionStatus = transaction.pending ? 'provisional' : 'confirmed';

  return {
    id: `plaid-${safePart(accountId)}-${safePart(canonicalId)}`,
    accountId,
    date: transaction.date,
    merchant,
    amountMinor,
    currency,
    category: categoryFor(transaction),
    kind,
    status,
    source: 'plaid',
    fingerprint: `plaid:${accountId}:${canonicalId}`,
    note: transaction.pending ? 'Pending in Plaid' : undefined,
    plaidItemId: itemId ?? null,
    providerTransactionId: transaction.pending ? null : transaction.transaction_id,
    providerPendingTransactionId: transaction.pending ? transaction.transaction_id : transaction.pending_transaction_id ?? null,
  };
}

async function existingPlaidTransactionId(db: D1Database, mapped: MappedPlaidTransaction) {
  if (mapped.plaidItemId && mapped.providerTransactionId) {
    const current = await db.prepare(`SELECT id FROM transactions
      WHERE plaid_item_id = ? AND provider_transaction_id = ? LIMIT 1`)
      .bind(mapped.plaidItemId, mapped.providerTransactionId).all<{ id: string }>();
    if (current.results[0]?.id) return current.results[0].id;
  }
  if (mapped.plaidItemId && mapped.providerPendingTransactionId) {
    const pending = await db.prepare(`SELECT id FROM transactions
      WHERE plaid_item_id = ? AND provider_pending_transaction_id = ? LIMIT 1`)
      .bind(mapped.plaidItemId, mapped.providerPendingTransactionId).all<{ id: string }>();
    if (pending.results[0]?.id) return pending.results[0].id;
  }
  const fingerprint = await db.prepare('SELECT id FROM transactions WHERE fingerprint = ? LIMIT 1').bind(mapped.fingerprint).all<{ id: string }>();
  return fingerprint.results[0]?.id ?? null;
}

export async function upsertPlaidTransaction(db: D1Database, mapped: MappedPlaidTransaction) {
  const existingId = await existingPlaidTransactionId(db, mapped);
  const localId = existingId ?? mapped.id;
  const values = [
    mapped.accountId,
    mapped.date,
    mapped.merchant,
    mapped.amountMinor,
    mapped.currency,
    mapped.category,
    mapped.kind,
    mapped.status,
    mapped.source,
    mapped.fingerprint,
    mapped.note ?? null,
    mapped.plaidItemId,
    mapped.providerTransactionId,
    mapped.providerPendingTransactionId,
  ];
  if (existingId) {
    await db.prepare(`UPDATE transactions SET
      account_id = ?, date = ?, merchant = ?, amount_minor = ?, currency = ?, category = ?, kind = ?, status = ?, source = ?, fingerprint = ?, note = ?,
      plaid_item_id = ?, provider_transaction_id = ?, provider_pending_transaction_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).bind(...values, existingId).run();
    return existingId;
  }
  await db.prepare(`INSERT INTO transactions
    (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note,
     plaid_item_id, provider_transaction_id, provider_pending_transaction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      id = excluded.id,
      account_id = excluded.account_id,
      date = excluded.date,
      merchant = excluded.merchant,
      amount_minor = excluded.amount_minor,
      currency = excluded.currency,
      category = excluded.category,
      kind = excluded.kind,
      status = excluded.status,
      source = excluded.source,
      note = excluded.note,
      plaid_item_id = excluded.plaid_item_id,
      provider_transaction_id = excluded.provider_transaction_id,
      provider_pending_transaction_id = excluded.provider_pending_transaction_id,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(localId, ...values).run();
  return localId;
}

export async function removePlaidTransaction(db: D1Database, itemId: string, providerTransactionId: string) {
  await db.prepare(`DELETE FROM transactions
    WHERE plaid_item_id = ? AND (
      provider_transaction_id = ?
      OR (provider_transaction_id IS NULL AND provider_pending_transaction_id = ?)
    )`).bind(itemId, providerTransactionId, providerTransactionId).run();
}

export async function fetchAllPlaidTransactions<T extends { transaction_id: string }>(
  fetchPage: (cursor: string) => Promise<PlaidSyncPage<T>>,
  initialCursor = '',
): Promise<PlaidSyncResult<T>> {
  let cursor = initialCursor;
  const added: T[] = [];
  const modified: T[] = [];
  const removed: Array<{ transaction_id: string }> = [];

  for (let pageCount = 0; pageCount < MAX_PLAID_SYNC_PAGES; pageCount += 1) {
    const page = await fetchPage(cursor);
    added.push(...page.added);
    modified.push(...page.modified);
    removed.push(...page.removed);
    if (!page.has_more) return { added, modified, removed, nextCursor: page.next_cursor };
    cursor = page.next_cursor;
  }
  throw new Error('Plaid sync exceeded the maximum page limit.');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeEncryptionKey(value: string) {
  const normalized = value.trim();
  const bytes = /^[0-9a-f]{64}$/i.test(normalized)
    ? Uint8Array.from(normalized.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)))
    : base64UrlToBytes(normalized);
  if (bytes.length !== 32) throw new Error('PLAID_ENCRYPTION_KEY must encode exactly 32 bytes.');
  return bytes;
}

async function importEncryptionKey(value: string, usage: KeyUsage) {
  return crypto.subtle.importKey('raw', decodeEncryptionKey(value), { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptAccessToken(plaintext: string, encryptionKey: string): Promise<SealedAccessToken> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(encryptionKey, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptAccessToken(sealed: SealedAccessToken, encryptionKey: string) {
  const key = await importEncryptionKey(encryptionKey, 'decrypt');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(sealed.iv) }, key, base64UrlToBytes(sealed.ciphertext));
  return new TextDecoder().decode(plaintext);
}
