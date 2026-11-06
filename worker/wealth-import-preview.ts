import type { D1Database, D1Statement } from './db-types';
import type { FinancialContext } from './financial-authority';
import { previewRow } from './wealth-import-records';
import type { CsvMappingMetadata, CsvPreviewRow, ImportReadRow, WealthImportRecord } from './wealth-import-types';

export interface PreviewReadServices {
  readonly currentRevision: (db: D1Database, context: FinancialContext) => Promise<number>;
  readonly parseJson: <T>(value: string, label: string) => T;
}

export async function readWealthPreview(db: D1Database, context: FinancialContext, previewId: string, services: PreviewReadServices) {
  const preview = await db.prepare('SELECT mapping_json FROM wealth_import_previews WHERE ledger_id=? AND id=?').bind(context.ledgerId, previewId).first<{ mapping_json: string }>();
  const rows = await db.prepare('SELECT row_id,row_index,payload_json,error_json,duplicate_of,state FROM wealth_import_rows WHERE ledger_id=? AND preview_id=? ORDER BY row_index').bind(context.ledgerId, previewId).all<ImportReadRow>();
  const result = rows.results.map((row) => materializePreviewRow(row, services.parseJson));
  const storedMetadata = previewMetadata(preview?.mapping_json ?? null, services.parseJson);
  return {
    previewId,
    revision: await services.currentRevision(db, context),
    rows: result,
    sourceHeaders: storedMetadata.metadata.sourceHeaders,
    canonicalHeaders: storedMetadata.metadata.canonicalHeaders,
    mapping: storedMetadata.metadata.mapping,
    ...previewDiagnostics(result, storedMetadata.validationErrors),
    validationErrors: storedMetadata.validationErrors,
  };
}

export function previewDiagnostics(rows: readonly CsvPreviewRow[], validationErrors: readonly string[]) {
  return {
    errors: [...rows.filter((row) => row.error).map(({ rowId, rowIndex, error }) => ({ rowId, rowIndex, error })), ...validationErrors.map((error) => ({ rowId: '__portfolio__', rowIndex: -1, error }))],
    duplicates: rows.filter((row) => row.duplicateOf).map(({ rowId, rowIndex, duplicateOf }) => ({ rowId, rowIndex, duplicateOf })),
  };
}
function materializePreviewRow(row: ImportReadRow, parseJson: PreviewReadServices['parseJson']) {
  const record = row.payload_json === 'null' ? null : parseJson<WealthImportRecord>(row.payload_json, 'import row');
  const error = row.error_json ? parseJson<{ message: string }>(row.error_json, 'import error').message : null;
  return previewRow({ rowId: row.row_id, rowIndex: row.row_index, recordType: record?.recordType ?? null, record, event: record?.recordType === 'event' ? record.event : null, error, duplicateOf: row.duplicate_of });
}

function previewMetadata(mappingJson: string | null, parseJson: PreviewReadServices['parseJson']): { readonly metadata: CsvMappingMetadata; readonly validationErrors: string[] } {
  const empty: CsvMappingMetadata = { sourceHeaders: [], canonicalHeaders: [], mapping: {} };
  if (!mappingJson) return { metadata: empty, validationErrors: [] };
  try {
    const stored = parseJson<{ sourceHeaders?: unknown; canonicalHeaders?: unknown; mapping?: unknown; validationErrors?: unknown }>(mappingJson, 'import mapping');
    const sourceHeaders = Array.isArray(stored.sourceHeaders) ? stored.sourceHeaders.filter((item): item is string => typeof item === 'string') : [];
    const canonicalHeaders = Array.isArray(stored.canonicalHeaders) ? stored.canonicalHeaders.filter((item): item is string => typeof item === 'string') : [];
    const mapping = stored.mapping && typeof stored.mapping === 'object' && !Array.isArray(stored.mapping) ? Object.fromEntries(Object.entries(stored.mapping as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
    const validationErrors = Array.isArray(stored.validationErrors) ? stored.validationErrors.filter((item): item is string => typeof item === 'string') : [];
    return { metadata: { sourceHeaders, canonicalHeaders, mapping }, validationErrors };
  } catch {
    return { metadata: empty, validationErrors: [] };
  }
}

export interface PreviewStatementContext {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly previewId: string;
  readonly operationId: string;
  readonly csvHash: string;
  readonly mappingJson: string;
  readonly rows: readonly CsvPreviewRow[];
  readonly revision: number;
  readonly guard: { readonly sql: string; readonly bindings: readonly unknown[] };
}

export function previewStatements(context: PreviewStatementContext): D1Statement[] {
  const statements: D1Statement[] = [context.db.prepare(`INSERT INTO wealth_import_previews(ledger_id,id,operation_id,csv_sha256,mapping_json,row_count,error_count,duplicate_count,state,revision) SELECT ?,?,?,?,?,?,?,?,'preview',? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, context.previewId, context.operationId, context.csvHash, context.mappingJson, context.rows.length, errorCount(context.rows), duplicateCount(context.rows), context.revision, ...context.guard.bindings)];
  for (const row of context.rows) statements.push(previewRowStatement(context, row));
  return statements;
}

function errorCount(rows: readonly CsvPreviewRow[]): number {
  return rows.filter((row) => row.error).length;
}

function duplicateCount(rows: readonly CsvPreviewRow[]): number {
  return rows.filter((row) => row.duplicateOf).length;
}

function previewRowStatement(context: PreviewStatementContext, row: CsvPreviewRow): D1Statement {
  const state = row.error ? 'error' : row.duplicateOf ? 'duplicate' : 'valid';
  const errorJson = row.error ? JSON.stringify({ message: row.error }) : null;
  return context.db.prepare(`INSERT INTO wealth_import_rows(ledger_id,preview_id,row_id,row_index,payload_json,error_json,duplicate_of,state) SELECT ?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, context.previewId, row.rowId, row.rowIndex, JSON.stringify(row.record), errorJson, row.duplicateOf, state, ...context.guard.bindings);
}
