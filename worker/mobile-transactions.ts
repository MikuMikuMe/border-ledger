import type { LedgerContext } from './tenant-context';
import { decodeCursor, encodeCursor, type TransactionCursor } from './transaction-cursor';
import { getCurrencyMeta } from '../src/domain/currencies';
import type { D1Database } from './db-types';
import { notSupersededAlertTransactionPredicate } from './ledger-reports';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;

const VALID_STATUSES = new Set(['confirmed', 'provisional', 'needs_review']);
const VALID_SOURCES = new Set(['statement', 'plaid', 'alert', 'manual', 'lunchflow']);

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

function validatedTransactionFilter(params: URLSearchParams, name: 'currency' | 'status' | 'source') {
  const value = params.get(name);
  if (value === null) return null;
  const valid = name === 'currency'
    ? getCurrencyMeta(value) !== null
    : (name === 'status' ? VALID_STATUSES : VALID_SOURCES).has(value);
  if (!valid) invalid(`The transaction ${name} is not valid.`);
  return value;
}

function readTransactionFilters(params: URLSearchParams) {
  const query = boundedFilter(params, 'query', MAX_QUERY_LENGTH)?.trim() || null;
  return {
    query,
    currency: validatedTransactionFilter(params, 'currency'),
    status: validatedTransactionFilter(params, 'status'),
    source: validatedTransactionFilter(params, 'source'),
    category: boundedFilter(params, 'category', MAX_CATEGORY_LENGTH),
  };
}

function buildTransactionWhere(context:LedgerContext,cursor:TransactionCursor|null,{query,currency,status,source,category}:ReturnType<typeof readTransactionFilters>){
  const clauses = ['t.ledger_id = ?', notSupersededAlertTransactionPredicate('t')];
  const bindings: unknown[] = [context.ledgerId];
  if (cursor) {
    clauses.push('(t.date < ? OR (t.date = ? AND t.id < ?))');
    bindings.push(cursor.date, cursor.date, cursor.id);
  }
  if (query) {
    const needle = `%${query}%`;
    clauses.push('(t.id LIKE ? OR t.merchant LIKE ? OR a.name LIKE ? OR COALESCE(annotation.category, t.category) LIKE ? OR COALESCE(CASE WHEN annotation.revision IS NULL THEN t.note ELSE annotation.note END, \'\') LIKE ?)');
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
    clauses.push('COALESCE(annotation.category, t.category) = ?');
    bindings.push(category);
  }
  return {clauses,bindings};
}

/** Owner-only canonical Activity page. The source currency and amount sign are
 * preserved exactly as stored; the Android client decides only how to display
 * them, never how to convert them. */
export async function readMobileTransactionPage(db: D1Database, context: LedgerContext, params: URLSearchParams) {
  const { limit, cursor } = pageQuery(params);
  const filters=readTransactionFilters(params);
  const {clauses,bindings}=buildTransactionWhere(context,cursor,filters);
  const result = await db.prepare(`SELECT t.id, t.account_id, t.date, t.merchant, t.amount_minor, t.currency,
      COALESCE(annotation.category, t.category) AS category, t.kind, t.status, t.source,
      CASE WHEN annotation.revision IS NULL THEN t.note ELSE annotation.note END AS note,
      annotation.revision AS annotation_revision
    FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.ledger_id = t.ledger_id
    LEFT JOIN annotation_revisions annotation ON annotation.id = (
      SELECT latest.id FROM annotation_revisions latest
      WHERE latest.ledger_id = t.ledger_id AND latest.transaction_id = t.id
      ORDER BY latest.revision DESC LIMIT 1
    )
    WHERE ${clauses.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC LIMIT ?`).bind(...bindings, limit + 1).all<TransactionRow>();
  return transactionPage(result.results, limit);
}

function transactionPage(results: TransactionRow[], limit: number) {
  const hasMore = results.length > limit;
  const rows = hasMore ? results.slice(0, limit) : results;
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
