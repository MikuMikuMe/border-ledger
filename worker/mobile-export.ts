import type { D1Database } from './db-types';
import type { MobileAuthConfig, OwnerContext } from './mobile-auth';
import { MobileAuthError, requireRecentOwnerApproval } from './mobile-auth';
import { apiSecurityHeaders } from './security';
import { notSupersededAlertTransactionPredicate } from './ledger-reports';
import { getCurrencyMeta } from '../src/domain/currencies';

export const CANONICAL_EXPORT_HEADER = 'Id,AccountId,Date,Merchant,Category,Kind,Status,Source,AmountMinor,Currency,Note,Fingerprint,BankReference\n';

export interface ExportFilters {
  currency?: string;
  startDate?: string;
  endDate?: string;
}

export type ExportSelection = 'all' | 'current_filter';

export class MobileExportError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 400, retryable = false) {
    super(message);
    this.name = 'MobileExportError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function csvCell(value: string | number | null | undefined, options: { numeric?: boolean } = {}) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (options.numeric) return raw;
  const safe = raw.replace(/(^|[,;\t\r\n])(\s*[=+\-@])/g, "$1'$2");
  const quoted = /[,"\r\n]/.test(safe) || /[^\x00-\x7F]/.test(safe);
  return quoted ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function isFullLedgerSelection(selection: ExportSelection, filters: ExportFilters) {
  return selection === 'all' || (!filters.currency && !filters.startDate && !filters.endDate);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateFilters(filters: ExportFilters) {
  if (filters.currency !== undefined && getCurrencyMeta(filters.currency) === null) throw new MobileExportError('invalid_request', 'The export currency is not valid.', 400);
  if (filters.startDate !== undefined && !isRealDate(filters.startDate)) throw new MobileExportError('invalid_request', 'The export start date is not valid.', 400);
  if (filters.endDate !== undefined && !isRealDate(filters.endDate)) throw new MobileExportError('invalid_request', 'The export end date is not valid.', 400);
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new MobileExportError('invalid_request', 'The export date range is not valid.', 400);
}

function assertOwner(owner: OwnerContext) {
  if (owner.credentialType !== 'owner' || owner.ledgerId !== 'personal' || !owner.scopes.includes('exports:read')) throw new MobileAuthError('forbidden', 'The owner exports scope is required.', 403);
}

async function requireFullLedgerApproval(db: D1Database, owner: OwnerContext, config: Pick<MobileAuthConfig, 'now'>) {
  const family = await db.prepare(`SELECT created_at FROM owner_session_families WHERE id = ? AND ledger_id = 'personal' AND revoked_at IS NULL`).bind(owner.familyId).first<{ created_at: string }>();
  if (!family) throw new MobileAuthError('unauthorized', 'The owner session is not active.', 401);
  // Owner sessions are issued only after the explicit owner approval flow. The
  // session creation timestamp is therefore the durable approval timestamp.
  requireRecentOwnerApproval(family.created_at, config);
}

interface ExportRow {
  id: string;
  account_id: string;
  date: string;
  merchant: string;
  category: string;
  kind: string;
  status: string;
  source: string;
  amount_minor: number;
  currency: string;
  note: string | null;
  fingerprint: string;
  bank_reference: string | null;
}

async function readPage(db: D1Database, filters: ExportFilters, cursor: { date: string; id: string } | null, pageSize: number) {
  const { conditions, args } = exportConditions(filters, cursor);
  const result = await db.prepare(`SELECT t.id, t.account_id, t.date, t.merchant, t.category, t.kind, t.status, t.source,
      t.amount_minor, t.currency, t.note, t.fingerprint, source.bank_reference
    FROM transactions t
    LEFT JOIN (
      SELECT transaction_id, MAX(bank_reference) AS bank_reference
      FROM transaction_source_records
      WHERE source_kind = 'statement'
      GROUP BY transaction_id
    ) source ON source.transaction_id = t.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.date ASC, t.id ASC LIMIT ?`).bind(...args, pageSize).all<ExportRow>();
  return result.results;
}

function exportConditions(filters: ExportFilters, cursor: { date: string; id: string } | null = null) {
  const conditions = [notSupersededAlertTransactionPredicate('t')];
  const args: unknown[] = [];
  if (filters.currency) { conditions.push('t.currency = ?'); args.push(filters.currency); }
  if (filters.startDate) { conditions.push('t.date >= ?'); args.push(filters.startDate); }
  if (filters.endDate) { conditions.push('t.date <= ?'); args.push(filters.endDate); }
  if (cursor) { conditions.push('(t.date > ? OR (t.date = ? AND t.id > ?))'); args.push(cursor.date, cursor.date, cursor.id); }
  return { conditions, args };
}

async function countExportRows(db: D1Database, filters: ExportFilters) {
  const { conditions, args } = exportConditions(filters);
  const result = await db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${conditions.join(' AND ')}`).bind(...args).first<{ count: number }>();
  return result?.count ?? 0;
}

function rowCsv(row: ExportRow) {
  return [
    csvCell(row.id),
    csvCell(row.account_id),
    csvCell(row.date),
    csvCell(row.merchant),
    csvCell(row.category),
    csvCell(row.kind),
    csvCell(row.status),
    csvCell(row.source),
    csvCell(row.amount_minor, { numeric: true }),
    csvCell(row.currency),
    csvCell(row.note),
    csvCell(row.fingerprint),
    csvCell(row.bank_reference),
  ].join(',') + '\n';
}

export interface CreateLedgerExportInput {
  selection: ExportSelection;
  filters: ExportFilters;
}

export async function createLedgerExportResponse(db: D1Database, owner: OwnerContext, config: Pick<MobileAuthConfig, 'now'>, input: CreateLedgerExportInput) {
  assertOwner(owner);
  validateFilters(input.filters);
  if (isFullLedgerSelection(input.selection, input.filters)) await requireFullLedgerApproval(db, owner, config);
  const exportedRows = await countExportRows(db, input.filters);
  const receiptId = `export-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(CANONICAL_EXPORT_HEADER));
        let cursor: { date: string; id: string } | null = null;
        while (true) {
          const rows = await readPage(db, input.filters, cursor, 250);
          if (rows.length === 0) break;
          for (const row of rows) controller.enqueue(encoder.encode(rowCsv(row)));
          const last = rows[rows.length - 1];
          cursor = { date: last.date, id: last.id };
          if (rows.length < 250) break;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...apiSecurityHeaders(),
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="border-ledger-export.csv"',
      'cache-control': 'no-store',
      'x-worker-receipt-id': receiptId,
      'x-worker-exported-rows': String(exportedRows),
    },
  });
}
