import type { LedgerContext } from './tenant-context';
import { getCurrencyMeta } from '../src/domain/currencies';
import type { D1Database } from './db-types';
import { notSupersededAlertTransactionPredicate } from './ledger-reports';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;
const MAX_ID_LENGTH = 128;

const VALID_STATUSES = new Set(['confirmed', 'provisional', 'needs_review']);
const VALID_SOURCES = new Set(['statement', 'plaid', 'alert', 'manual', 'lunchflow']);

interface TransactionCursor {
  date: string;
  id: string;
}

interface TransactionRow {
  id: string;
  account_id: string;
  date: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  category: string;
  kind: string;
  status: string;
  source: string;
  note: string | null;
  annotation_revision: number | null;
}

function invalid(message: string): never {
  throw new RangeError(message);
}

function encodeCursor(value: TransactionCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string | null): TransactionCursor | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('The transaction cursor is not valid.');
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as Partial<TransactionCursor>;
    if (typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ||
        typeof parsed.id !== 'string' || parsed.id.length === 0 || parsed.id.length > MAX_ID_LENGTH) invalid('The transaction cursor is not valid.');
    return { date: parsed.date, id: parsed.id };
  } catch (error) {
    if (error instanceof RangeError) throw error;
    invalid('The transaction cursor is not valid.');
  }
}

function pageQuery(params: URLSearchParams) {
  const limitParam = params.get('limit');
  let limit = DEFAULT_PAGE_LIMIT;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) invalid('The transaction page limit is not valid.');
    limit = Number(limitParam);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) invalid('The transaction page limit must be between 1 and 100.');
  }
  return { limit, cursor: decodeCursor(params.get('cursor')) };
}

function boundedFilter(params: URLSearchParams, name: string, max: number) {
  const value = params.get(name);
  if (value === null) return null;
  if (value.length === 0 || value.length > max || [...value].some((character) => character.charCodeAt(0) < 0x20)) invalid(`The ${name} filter is not valid.`);
  return value;
}

/** Owner-only canonical Activity page. The source currency and amount sign are
 * preserved exactly as stored; the Android client decides only how to display
 * them, never how to convert them. */
export async function readMobileTransactionPage(db: D1Database, context: LedgerContext, params: URLSearchParams) {
  const { limit, cursor } = pageQuery(params);
  const query = boundedFilter(params, 'query', MAX_QUERY_LENGTH)?.trim() || null;
  const currency = params.get('currency');
  if (currency !== null && getCurrencyMeta(currency) === null) invalid('The transaction currency is not valid.');
  const status = params.get('status');
  if (status !== null && !VALID_STATUSES.has(status)) invalid('The transaction status is not valid.');
  const source = params.get('source');
  if (source !== null && !VALID_SOURCES.has(source)) invalid('The transaction source is not valid.');
  const category = boundedFilter(params, 'category', MAX_CATEGORY_LENGTH);

  const clauses = ['t.ledger_id = ?', notSupersededAlertTransactionPredicate('t')];
  const bindings: unknown[] = [context.ledgerId];
  if (cursor) {
    clauses.push('(t.date < ? OR (t.date = ? AND t.id < ?))');
    bindings.push(cursor.date, cursor.date, cursor.id);
  }
  if (query) {
    const needle = `%${query}%`;
    clauses.push('(t.id LIKE ? OR t.merchant LIKE ? OR a.name LIKE ? OR t.category LIKE ? OR COALESCE(t.note, \'\') LIKE ?)');
    bindings.push(needle, needle, needle, needle, needle);
  }
  if (currency !== null) {
    clauses.push('t.currency = ?');
    bindings.push(currency);
  }
  if (status !== null) {
    clauses.push('t.status = ?');
    bindings.push(status);
  }
  if (source !== null) {
    clauses.push('t.source = ?');
    bindings.push(source);
  }
  if (category !== null) {
    clauses.push('t.category = ?');
    bindings.push(category);
  }

  const result = await db.prepare(`SELECT t.id, t.account_id, t.date, t.merchant, t.amount_minor, t.currency,
      t.category, t.kind, t.status, t.source, t.note,
      (SELECT MAX(annotation.revision) FROM annotation_revisions annotation
        WHERE annotation.ledger_id = t.ledger_id AND annotation.transaction_id = t.id) AS annotation_revision
    FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.ledger_id = t.ledger_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC LIMIT ?`).bind(...bindings, limit + 1).all<TransactionRow>();
  const hasMore = result.results.length > limit;
  const rows = hasMore ? result.results.slice(0, limit) : result.results;
  const last = rows.at(-1);
  return {
    items: rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      date: row.date,
      merchant: row.merchant,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      category: row.category,
      kind: row.kind,
      status: row.status,
      source: row.source,
      note: row.note,
      revision: Number(row.annotation_revision ?? 0),
    })),
    page: {
      nextCursor: hasMore && last ? encodeCursor({ date: last.date, id: last.id }) : null,
      limit,
    },
  };
}
