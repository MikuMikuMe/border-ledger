import type { LedgerContext } from './tenant-context';
import { decodeCursor, encodeCursor, type TransactionCursor } from './transaction-cursor';
import { getCurrencyMeta } from '../src/domain/currencies';
import type { D1Database } from './db-types';
import { notSupersededAlertTransactionPredicate } from './ledger-reports';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 120;

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

function dateFilter(params:URLSearchParams,name:'from'|'to') {
 const value=params.get(name);
 if(value===null)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid(`The ${name} date is not valid.`);
 const date=new Date(`${value}T00:00:00.000Z`);
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)invalid(`The ${name} date is not valid.`);
 return value;
}
function readTransactionFilters(params: URLSearchParams) {
  const query = boundedFilter(params, 'query', MAX_QUERY_LENGTH)?.trim() || null;
  const from=dateFilter(params,'from'),to=dateFilter(params,'to');
  const validRange=!from||!to||from<=to;
  if(!validRange)invalid('The transaction date range is not valid.');
  return {
    query,from,to,
    currency: validatedTransactionFilter(params, 'currency'),
    status: validatedTransactionFilter(params, 'status'),
    source: validatedTransactionFilter(params, 'source'),
    category: boundedFilter(params, 'category', MAX_CATEGORY_LENGTH),
  };
}

function addExactFilters(clauses:string[],bindings:unknown[],{currency,status,source,category}:Pick<ReturnType<typeof readTransactionFilters>,'currency'|'status'|'source'|'category'>) {
  const exactFilters: Array<[string,string|null]> = [
    ['t.currency',currency], ['t.status',status], ['t.source',source],
    ['COALESCE(annotation.category, t.category)',category],
  ];
  for (const [column,value] of exactFilters) {
    if (value === null) continue;
    clauses.push(`${column} = ?`);
    bindings.push(value);
  }
}

function buildTransactionWhere(context:LedgerContext,cursor:TransactionCursor|null,{query,currency,status,source,category,from,to}:ReturnType<typeof readTransactionFilters>){
  const clauses = ['t.ledger_id = ?', notSupersededAlertTransactionPredicate('t')];
  const bindings: unknown[] = [context.ledgerId];
  if (cursor) {
    clauses.push('(t.date < ? OR (t.date = ? AND t.id < ?))');
    bindings.push(cursor.date, cursor.date, cursor.id);
  }
  if(from){clauses.push('t.date >= ?');bindings.push(from);}
  if(to){clauses.push('t.date <= ?');bindings.push(to);}
  if (query) {
    const needle = `%${query}%`;
    clauses.push('(t.id LIKE ? OR t.merchant LIKE ? OR a.name LIKE ? OR COALESCE(annotation.category, t.category) LIKE ? OR COALESCE(CASE WHEN annotation.revision IS NULL THEN t.note ELSE annotation.note END, \'\') LIKE ?)');
    bindings.push(needle, needle, needle, needle, needle);
  }
  addExactFilters(clauses,bindings,{currency,status,source,category});
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
