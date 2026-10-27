import type { LedgerContext } from './tenant-context';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import type { D1Database, LedgerId } from './db-types';

export const MAX_IMPORT_CHUNK_BYTES = 128 * 1024;
export const MAX_IMPORT_CHUNK_ROWS = 1000;
export const MAX_IMPORT_ROWS = 10_000;

export type ImportPreviewState = 'staged' | 'ready' | 'publishing' | 'published' | 'cancelled' | 'expired' | 'error';

export class ImportStoreError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 409, retryable = false) {
    super(message);
    this.name = 'ImportStoreError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function text(value: string, field: string, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

function timestamp(value: string, field: string) {
  text(value, field, 64);
  if (Number.isNaN(Date.parse(value))) throw new RangeError(`${field} must be an ISO timestamp.`);
  return value;
}

function nonNegativeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer.`);
  return value;
}

function digest(value: string, field: string) {
  const result = text(value, field, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new RangeError(`${field} must be a SHA-256 hex digest.`);
  return result;
}

async function hasColumn(db: D1Database, table: string, column: string) {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.some((row) => row.name === column);
}

/** Runtime requires the migrated tenant-owned decision schema; never creates a legacy table. */
export async function ensureImportDuplicateDecisionStore(db: D1Database) {
  await db.prepare('SELECT ledger_id FROM import_duplicate_decisions LIMIT 0').all();
}

export interface ImportPreviewInput {
  id: string;
  accountId: string;
  filename: string;
  fileSizeBytes?: number;
  fileSha256: string;
  previewDigest: string;
  ownerBindingDigest?: string;
  rowCount: number;
  expiresAt: string;
}

export async function createImportPreview(db: D1Database, context: LedgerContext, input: ImportPreviewInput) {
  const fileSizeBytes = input.fileSizeBytes ?? 1;
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > 10 * 1024 * 1024) throw new RangeError('Import files are limited to 10 MiB.');
  const rowCount = nonNegativeInteger(input.rowCount, 'import row count');
  if (rowCount > MAX_IMPORT_ROWS) throw new RangeError(`Imports are limited to ${MAX_IMPORT_ROWS} rows.`);
  if (!(await hasColumn(db, 'import_previews', 'owner_binding_digest'))) {
    await db.prepare(`INSERT INTO import_previews
      (id, ledger_id, account_id, filename, file_sha256, preview_digest, row_count, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      text(input.id, 'import preview id'),
      context.ledgerId,
      text(input.accountId, 'import account id'),
      text(input.filename, 'import filename', 512),
      text(input.fileSha256, 'import file hash', 256),
      text(input.previewDigest, 'import preview digest', 256),
      rowCount,
      timestamp(input.expiresAt, 'import preview expiry'),
    ).run();
    return;
  }
  await db.prepare(`INSERT INTO import_previews
    (id, ledger_id, account_id, filename, file_size_bytes, file_sha256, preview_digest, owner_binding_digest, row_count, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'import preview id'),
    context.ledgerId,
    text(input.accountId, 'import account id'),
    text(input.filename, 'import filename', 512),
    fileSizeBytes,
    digest(input.fileSha256, 'import file hash'),
    digest(input.previewDigest, 'import preview digest'),
    digest(input.ownerBindingDigest ?? input.previewDigest, 'import owner binding'),
    rowCount,
    timestamp(input.expiresAt, 'import preview expiry'),
  ).run();
}

export interface ImportChunkInput {
  previewId: string;
  ownerBindingDigest?: string;
  chunkIndex: number;
  operationId: string;
  chunkDigest: string;
  rowStart: number;
  rowCount: number;
  rowsJson: string;
}

export async function stageImportChunk(db: D1Database, context: LedgerContext, input: ImportChunkInput) {
  nonNegativeInteger(input.chunkIndex, 'import chunk index');
  nonNegativeInteger(input.rowStart, 'import row start');
  nonNegativeInteger(input.rowCount, 'import row count');
  if (input.rowCount > MAX_IMPORT_CHUNK_ROWS) throw new RangeError(`Import chunks are limited to ${MAX_IMPORT_CHUNK_ROWS} rows.`);
  text(input.rowsJson, 'import rows JSON', MAX_IMPORT_CHUNK_BYTES);
  if (new TextEncoder().encode(input.rowsJson).byteLength > MAX_IMPORT_CHUNK_BYTES) throw new RangeError('Import chunk exceeds 128 KiB.');
  let rows: unknown;
  try {
    rows = JSON.parse(input.rowsJson);
  } catch {
    throw new TypeError('Import rows JSON is invalid.');
  }
  if (!Array.isArray(rows) || rows.length !== input.rowCount) throw new RangeError('Import row count does not match the chunk.');
  const modernSchema = await hasColumn(db, 'import_previews', 'owner_binding_digest');
  const preview = await db.prepare(modernSchema
    ? `SELECT status, expires_at, row_count, owner_binding_digest FROM import_previews WHERE id = ? AND ledger_id = ?`
    : `SELECT status, expires_at, row_count FROM import_previews WHERE id = ? AND ledger_id = ?`).bind(text(input.previewId, 'import preview id'), context.ledgerId).all<{ status: string; expires_at: string; row_count: number; owner_binding_digest?: string }>();
  const current = preview.results[0];
  if (!current) throw new ImportStoreError('not_found', 'The import preview does not exist.', 404);
  if (modernSchema && input.ownerBindingDigest && current.owner_binding_digest !== digest(input.ownerBindingDigest, 'import owner binding')) throw new ImportStoreError('forbidden', 'The import preview belongs to another owner.', 403);
  if (!['staged', 'ready'].includes(current.status) || Date.parse(current.expires_at) <= Date.now()) throw new ImportStoreError('not_writable', 'Import preview is not writable.', 409);
  if (input.rowStart + input.rowCount > current.row_count) throw new RangeError('Import chunk rows exceed the preview row count.');
  if (modernSchema) {
    const existing = await db.prepare(`SELECT operation_id, chunk_digest, row_start, row_count, rows_json FROM import_chunks WHERE preview_id = ? AND ledger_id = ? AND chunk_index = ?`).bind(input.previewId, context.ledgerId, input.chunkIndex).first<{ operation_id: string; chunk_digest: string; row_start: number; row_count: number; rows_json: string }>();
    if (existing) {
      if (existing.operation_id === input.operationId && existing.chunk_digest === input.chunkDigest && existing.row_start === input.rowStart && existing.row_count === input.rowCount && existing.rows_json === input.rowsJson) return { replayed: true };
      throw new ImportStoreError('chunk_conflict', 'The chunk index was already staged with different content.', 409);
    }
  }
  await db.prepare(`INSERT INTO import_chunks
    (preview_id, ledger_id, chunk_index, operation_id, chunk_digest, row_start, row_count, rows_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.previewId, context.ledgerId, input.chunkIndex, text(input.operationId, 'import operation id'), text(input.chunkDigest, 'import chunk digest', 256), input.rowStart, input.rowCount, input.rowsJson)
    .run();
  if (modernSchema) {
    const chunks = await db.prepare(`SELECT row_start, row_count FROM import_chunks WHERE preview_id = ? AND ledger_id = ? ORDER BY row_start, chunk_index`).bind(input.previewId, context.ledgerId).all<{ row_start: number; row_count: number }>();
    let cursor = 0;
    const complete = chunks.results.every((chunk) => {
      const contiguous = chunk.row_start === cursor;
      cursor = chunk.row_start + chunk.row_count;
      return contiguous;
    }) && cursor === current.row_count;
    if (complete) await db.prepare(`UPDATE import_previews SET status = 'ready', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ledger_id = ? AND status = 'staged'`).bind(input.previewId, context.ledgerId).run();
    return { replayed: false, ready: complete };
  }
  return { replayed: false, ready: false };
}

export interface StoredImportPreview {
  id: string;
  ledger_id: LedgerId;
  account_id: string;
  filename: string;
  file_size_bytes: number;
  file_sha256: string;
  preview_digest: string;
  owner_binding_digest: string;
  row_count: number;
  selected_count: number;
  status: Exclude<ImportPreviewState, 'error'>;
  operation_id: string | null;
  expires_at: string;
  published_at: string | null;
  receipt_id: string | null;
  committed_count: number;
  duplicate_count: number;
  review_count: number;
  revision: number;
  selected_row_ids_json: string;
}

export interface StoredImportError {
  code: string;
  message: string;
  created_at: string;
}

async function readModernPreview(db: D1Database, context: LedgerContext, previewId: string) {
  return db.prepare(`SELECT id, ledger_id, account_id, filename, file_size_bytes, file_sha256, preview_digest,
      owner_binding_digest, row_count, selected_count, status, operation_id, expires_at, published_at, receipt_id,
      committed_count, duplicate_count, review_count, revision, selected_row_ids_json
    FROM import_previews WHERE id = ? AND ledger_id = ?`).bind(text(previewId, 'import preview id'), context.ledgerId).first<StoredImportPreview>();
}

async function readModernError(db: D1Database, context: LedgerContext, previewId: string) {
  return db.prepare(`SELECT code, message, created_at FROM import_preview_errors WHERE preview_id = ? AND ledger_id = ?`).bind(previewId, context.ledgerId).first<StoredImportError>();
}

function ownerMatches(preview: StoredImportPreview, ownerBindingDigest: string) {
  return preview.owner_binding_digest === digest(ownerBindingDigest, 'import owner binding');
}

async function expireObservedPreview(db: D1Database, context: LedgerContext, preview: StoredImportPreview) {
  const bindings = [preview.id,context.ledgerId,preview.status,preview.revision];
  await db.batch([
    db.prepare(`DELETE FROM import_chunks WHERE preview_id=? AND ledger_id=? AND EXISTS (
      SELECT 1 FROM import_previews WHERE id=? AND ledger_id=? AND status=? AND revision=?
        AND status IN ('staged','ready','publishing') AND julianday(expires_at)<=julianday('now'))`)
      .bind(preview.id,context.ledgerId,...bindings),
    db.prepare(`UPDATE import_previews SET status='expired',revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ledger_id=? AND status=? AND revision=?
        AND status IN ('staged','ready','publishing') AND julianday(expires_at)<=julianday('now')`).bind(...bindings),
  ]);
  const current = await readModernPreview(db,context,preview.id);
  if (!current) throw new ImportStoreError('not_found','The import preview does not exist.',404);
  return current;
}

export async function readImportPreview(db: D1Database, context: LedgerContext, previewId: string, ownerBindingDigest: string) {
  let preview = await readModernPreview(db, context, previewId);
  if (!preview) throw new ImportStoreError('not_found', 'The import preview does not exist.', 404);
  if (!ownerMatches(preview, ownerBindingDigest)) throw new ImportStoreError('forbidden', 'The import preview belongs to another owner.', 403);
  const failure = await readModernError(db, context, previewId);
  if (Date.parse(preview.expires_at) <= Date.now() && ['staged','ready','publishing'].includes(preview.status)) {
    preview = await expireObservedPreview(db,context,preview);
  }
  return { preview, state: failure ? 'error' as const : preview.status as ImportPreviewState, error: failure };
}

export async function readStagedImportRows(db: D1Database, context: LedgerContext, previewId: string, ownerBindingDigest: string) {
  const { preview } = await readImportPreview(db, context, previewId, ownerBindingDigest);
  if (!['ready', 'publishing'].includes(preview.status)) throw new ImportStoreError('not_ready', 'The import preview is incomplete.', 409);
  const chunks = await db.prepare(`SELECT row_start, row_count, rows_json FROM import_chunks WHERE preview_id = ? AND ledger_id = ? ORDER BY row_start, chunk_index`).bind(previewId, context.ledgerId).all<{ row_start: number; row_count: number; rows_json: string }>();
  const rows: unknown[] = [];
  let cursor = 0;
  for (const chunk of chunks.results) {
    if (chunk.row_start !== cursor) throw new ImportStoreError('import_error', 'The staged import chunks are not contiguous.', 409);
    const parsed = JSON.parse(chunk.rows_json) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== chunk.row_count) throw new ImportStoreError('import_error', 'A staged import chunk is corrupt.', 409);
    rows.push(...parsed);
    cursor += chunk.row_count;
  }
  if (cursor !== preview.row_count) throw new ImportStoreError('not_ready', 'The import preview is incomplete.', 409);
  return { preview, rows };
}

export async function beginImportPublication(db: D1Database, context: LedgerContext, input: { previewId: string; ownerBindingDigest: string; operationId: string; selectedRowIds: readonly string[] }) {
  const { previewId, ownerBindingDigest, operationId, selectedRowIds } = input;
  const current = await readImportPreview(db, context, previewId, ownerBindingDigest);
  if (current.state === 'error') throw new ImportStoreError('import_error', current.error?.message ?? 'The import preview has an error.', 409);
  if (current.state === 'published') return current.preview;
  if (current.state !== 'ready' && current.preview.status !== 'publishing') throw new ImportStoreError('not_ready', 'The import preview is not ready to publish.', 409);
  const operation = text(operationId, 'import operation id', 256);
  const ids = selectedRowIds.map((id) => text(id, 'selected import row id', 256));
  if (ids.length === 0 || ids.length > 500) throw new RangeError('An import commit must select between 1 and 500 rows.');
  if (current.preview.status === 'publishing') {
    if (current.preview.operation_id !== operation) throw new ImportStoreError('operation_conflict', 'The import is already publishing under another operation.', 409);
    let storedIds: unknown;
    try {
      storedIds = JSON.parse(current.preview.selected_row_ids_json);
    } catch {
      throw new ImportStoreError('import_error', 'The stored import selection is corrupt.', 409);
    }
    if (!Array.isArray(storedIds) || storedIds.length !== ids.length || storedIds.some((id, index) => id !== ids[index])) {
      throw new ImportStoreError('operation_conflict', 'The import operation is already bound to a different row selection.', 409);
    }
    return current.preview;
  }
  const result = await db.prepare(`UPDATE import_previews SET status = 'publishing', operation_id = ?, selected_count = ?, selected_row_ids_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND ledger_id = ? AND status = 'ready' AND revision = ?`).bind(operation, ids.length, JSON.stringify(ids), previewId, context.ledgerId, current.preview.revision).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new ImportStoreError('publication_race', 'The import publication changed; retry with the current preview.', 409);
  return (await readModernPreview(db, context, previewId)) ?? current.preview;
}

export async function completeImportPublication(db: D1Database, context: FinancialContext, input: { previewId: string; ownerBindingDigest: string; operationId: string; receiptId: string; counts: { accepted: number; duplicates: number; needsReview: number }; publishedAt: string }) {
  const { previewId, ownerBindingDigest, operationId, receiptId, counts, publishedAt } = input;
  await assertFinancialAuthority(db, context, 'imports:write');
  const preview = await readModernPreview(db, context, previewId);
  if (!preview) throw new ImportStoreError('not_found', 'The import preview does not exist.', 404);
  if (!ownerMatches(preview, ownerBindingDigest)) throw new ImportStoreError('forbidden', 'The import preview belongs to another owner.', 403);
  if (preview.status === 'published') return preview;
  if (preview.status !== 'publishing' || preview.operation_id !== text(operationId, 'import operation id', 256)) throw new ImportStoreError('operation_conflict', 'The import publication operation does not match.', 409);
  const authority = financialAuthorityPredicate(context, 'imports:write');
  const result = await db.prepare(`UPDATE import_previews SET status = 'published', receipt_id = ?, committed_count = ?, duplicate_count = ?, review_count = ?, published_at = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND ledger_id = ? AND status = 'publishing' AND operation_id = ?
      AND ${authority.sql}`).bind(
    text(receiptId, 'import receipt id', 256), counts.accepted, counts.duplicates, counts.needsReview, timestamp(publishedAt, 'import publication time'), previewId, context.ledgerId, operationId, ...authority.bindings,
  ).run();
  if ((result.meta?.changes ?? 0) === 0) {
    await assertFinancialAuthority(db, context, 'imports:write');
    const current = await readModernPreview(db, context, previewId);
    if (current?.status === 'published') return current;
    throw new ImportStoreError('publication_race', 'The import publication changed; retry the same operation.', 409, true);
  }
  return (await readModernPreview(db, context, previewId)) ?? preview;
}

export async function markImportError(db: D1Database, context: LedgerContext, input: { previewId: string; ownerBindingDigest: string; code: string; message: string }) {
  const { previewId, ownerBindingDigest, code, message } = input;
  const preview = await readModernPreview(db, context, previewId);
  if (!preview) throw new ImportStoreError('not_found', 'The import preview does not exist.', 404);
  if (!ownerMatches(preview, ownerBindingDigest)) throw new ImportStoreError('forbidden', 'The import preview belongs to another owner.', 403);
  await db.prepare(`INSERT OR IGNORE INTO import_preview_errors (preview_id, ledger_id, code, message) VALUES (?, ?, ?, ?)`).bind(
    previewId, context.ledgerId, text(code, 'import error code', 64), text(message, 'import error message', 512),
  ).run();
}

export async function publishImport(db: D1Database, context: FinancialContext, input: { previewId: string; operationId: string; publishedAt: string }) {
  const { previewId, operationId, publishedAt } = input;
  await assertFinancialAuthority(db, context, 'imports:write');
  const authority = financialAuthorityPredicate(context, 'imports:write');
  const id = text(previewId, 'import preview id');
  const operation = text(operationId, 'import operation id');
  const published = timestamp(publishedAt, 'import publication time');
  const preview = await db.prepare('SELECT status, operation_id FROM import_previews WHERE id = ? AND ledger_id = ?').bind(id, context.ledgerId).all<{ status: string; operation_id: string | null }>();
  const current = preview.results[0];
  if (!current || !['staged', 'ready', 'publishing'].includes(current.status)) throw new Error('Import preview is not publishable.');
  if (current.operation_id && current.operation_id !== operation) throw new Error('Import operation does not match the staged preview.');
  await db.batch([
    db.prepare(`UPDATE import_chunks SET published_at = ?
      WHERE preview_id = ? AND ledger_id = ? AND operation_id = ? AND published_at IS NULL`).bind(published, id, context.ledgerId, operation),
    db.prepare(`UPDATE import_previews SET ledger_id = CASE WHEN ${authority.sql} AND julianday(expires_at)>julianday('now') THEN ledger_id ELSE NULL END, status = 'published', operation_id = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ledger_id = ? AND status IN ('staged', 'ready', 'publishing')`).bind(...authority.bindings, operation, published, id, context.ledgerId),
  ]);
}

export async function cleanupExpiredImportStaging(db: D1Database, context: LedgerContext, now: string) {
  const cutoff = timestamp(now, 'import cleanup time');
  await db.batch([
    db.prepare(`DELETE FROM import_chunks WHERE ledger_id = ? AND preview_id IN
      (SELECT id FROM import_previews WHERE ledger_id = ? AND expires_at <= ? AND status IN ('staged', 'ready', 'publishing', 'expired'))`).bind(context.ledgerId, context.ledgerId, cutoff),
    db.prepare(`DELETE FROM import_previews WHERE ledger_id = ? AND expires_at <= ? AND status IN ('staged', 'ready', 'publishing', 'expired')`).bind(context.ledgerId, cutoff),
  ]);
}

export async function cancelImport(db: D1Database, context: LedgerContext, input: { previewId: string; ownerBindingDigest: string; expectedRevision: number }) {
  const { previewId, ownerBindingDigest, expectedRevision } = input;
  const id = text(previewId, 'import preview id');
  const modernSchema = await hasColumn(db, 'import_previews', 'owner_binding_digest');
  if (!modernSchema) throw new ImportStoreError('unsupported', 'Import cancellation requires the owner-bound import schema.', 409);
  nonNegativeInteger(expectedRevision, 'expected import revision');
  const current = await readModernPreview(db, context, id);
  if (!current) throw new ImportStoreError('not_found', 'The import preview does not exist.', 404);
  if (!ownerMatches(current, ownerBindingDigest)) throw new ImportStoreError('forbidden', 'The import preview belongs to another owner.', 403);
  const failure = await readModernError(db, context, id);
  if (failure) throw new ImportStoreError('import_error', failure.message, 409);
  if (Date.parse(current.expires_at) <= Date.now()) throw new ImportStoreError('expired', 'The import preview has expired.', 410);
  const result = await db.prepare(`UPDATE import_previews
    SET status = 'cancelled', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND ledger_id = ? AND owner_binding_digest = ? AND status IN ('staged', 'ready') AND revision = ?`)
    .bind(id, context.ledgerId, digest(ownerBindingDigest, 'import owner binding'), expectedRevision).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new ImportStoreError('revision_conflict', 'The import preview changed; refresh before cancelling.', 409);
  }
  await db.prepare('DELETE FROM import_chunks WHERE preview_id = ? AND ledger_id = ?').bind(id, context.ledgerId).run();
}
