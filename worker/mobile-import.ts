import type { D1Database } from './db-types';
import type { OwnerContext } from './mobile-auth';
import { MobileAuthError } from './mobile-auth';
import { getCurrencyMeta } from '../src/domain/currencies';
import {
  beginImportPublication,
  completeImportPublication,
  createImportPreview,
  ensureImportDuplicateDecisionStore,
  markImportError,
  readImportPreview,
  readStagedImportRows,
  stageImportChunk,
  ImportStoreError,
  MAX_IMPORT_CHUNK_BYTES,
  MAX_IMPORT_CHUNK_ROWS,
  MAX_IMPORT_ROWS,
} from './import-store';
import { commitStatementRows, ReconciliationConflictError, statementSourceIdentityKey, type StatementCommitRow } from './reconciliation-store';

export const IMPORT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export { MAX_IMPORT_CHUNK_BYTES, MAX_IMPORT_CHUNK_ROWS, MAX_IMPORT_ROWS };

const SHA256_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['expense', 'income', 'transfer', 'refund', 'fee']);
const STATUSES = new Set(['confirmed', 'provisional', 'needs_review']);

export interface ImportRowInput {
  rowId: string;
  rowIndex: number;
  accountId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  category: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
  status: 'confirmed' | 'provisional' | 'needs_review';
  source: 'statement';
  fingerprint: string;
  note?: string | null;
  bankReference?: string | null;
  sourceIdentity?: {
    bankSourceId?: string | null;
    bankRowId?: string | null;
  };
}

export interface ImportRowValidation {
  code: string;
  message: string;
}

export function validateImportRowShape(value: unknown, accountId: string): ImportRowValidation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { code: 'invalid_row', message: 'Each import row must be an object.' };
  const row = value as Partial<ImportRowInput>;
  if (row.accountId !== accountId) return { code: 'account_mismatch', message: 'Every row must use the selected account.' };
  if (typeof row.rowId !== 'string' || row.rowId.length === 0 || row.rowId.length > 160) return { code: 'invalid_row_id', message: 'The row ID is not bounded.' };
  if (!Number.isSafeInteger(row.rowIndex) || (row.rowIndex as number) < 0 || (row.rowIndex as number) > 1_000_000) return { code: 'invalid_row_index', message: 'The row index is not valid.' };
  if (typeof row.date !== 'string' || !DATE_RE.test(row.date) || Number.isNaN(new Date(`${row.date}T00:00:00.000Z`).valueOf())) return { code: 'invalid_date', message: 'The statement date is not valid.' };
  if (typeof row.merchant !== 'string' || row.merchant.trim().length === 0 || row.merchant.length > 200) return { code: 'invalid_merchant', message: 'The merchant is not bounded.' };
  if (!Number.isSafeInteger(row.amountMinor)) return { code: 'invalid_amount', message: 'Amounts must be safe integer minor units.' };
  if (typeof row.currency !== 'string' || getCurrencyMeta(row.currency) === null) return { code: 'invalid_currency', message: 'Currency must be a registered uppercase ISO code.' };
  if (typeof row.category !== 'string' || row.category.length === 0 || row.category.length > 120) return { code: 'invalid_category', message: 'The category is not bounded.' };
  if (typeof row.kind !== 'string' || !KINDS.has(row.kind)) return { code: 'invalid_kind', message: 'The row kind is not supported.' };
  if (typeof row.status !== 'string' || !STATUSES.has(row.status)) return { code: 'invalid_status', message: 'The row status is not supported.' };
  if (row.source !== 'statement') return { code: 'invalid_source', message: 'Only statement rows can be imported.' };
  if (typeof row.fingerprint !== 'string' || row.fingerprint.length === 0 || row.fingerprint.length > 256) return { code: 'invalid_fingerprint', message: 'The row fingerprint is not bounded.' };
  if (row.note !== undefined && row.note !== null && (typeof row.note !== 'string' || row.note.length > 4096)) return { code: 'invalid_note', message: 'The row note is not bounded.' };
  if (row.bankReference !== undefined && row.bankReference !== null && (typeof row.bankReference !== 'string' || row.bankReference.length > 256)) return { code: 'invalid_bank_reference', message: 'The bank reference is not bounded.' };
  const identity = row.sourceIdentity;
  if (identity !== undefined && (!identity || typeof identity !== 'object')) return { code: 'invalid_source_identity', message: 'The source identity is not valid.' };
  if ((identity?.bankSourceId && !identity.bankRowId) || (!identity?.bankSourceId && identity?.bankRowId)) return { code: 'invalid_source_identity', message: 'Bank source and row IDs must be supplied together.' };
  return null;
}

export interface CreateImportPreviewInput {
  accountId: string;
  fileName: string;
  fileSizeBytes: number;
  fileSha256: string;
  format: 'csv' | 'verified_boc';
  rowCount: number;
  idempotencyKey: string;
}

export interface ImportPreviewResponse {
  id: string;
  revision: number;
  expiresAt: string;
  state: string;
  accountId: string;
  fileSizeBytes: number;
  fileSha256: string;
  rowCount: number;
  receivedRowCount: number;
  validRowCount: number;
  errors: Array<{ code: string; message: string }>;
  duplicateCandidates: ImportDuplicateCandidate[];
}

export interface ImportDuplicateCandidate {
  id: string;
  statementTransactionId: string;
  candidateTransactionId: string;
  score: number;
  reasonCodes: string[];
  status: 'open' | 'accepted' | 'dismissed';
}

export class MobileImportError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 400, retryable = false) {
    super(message);
    this.name = 'MobileImportError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function boundedString(value: unknown, name: string, max: number) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new MobileImportError('invalid_request', `${name} is not valid.`, 400);
  return value.trim();
}

function safeInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value)) throw new MobileImportError('invalid_request', `${name} is not a safe integer.`, 400);
  return value as number;
}

function assertOwner(owner: OwnerContext) {
  if (owner.credentialType !== 'owner' || owner.ledgerId !== 'personal' || !owner.scopes.includes('imports:write')) throw new MobileAuthError('forbidden', 'The owner imports scope is required.', 403);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireHash(value: string, name: string) {
  if (!SHA256_RE.test(value.toLowerCase())) throw new MobileImportError('invalid_request', `${name} must be a SHA-256 hex digest.`, 400);
  return value.toLowerCase();
}

function isoAfter(now: Date, milliseconds: number) {
  return new Date(now.getTime() + milliseconds).toISOString();
}

async function previewResponse(db: D1Database, value: Awaited<ReturnType<typeof readImportPreview>>): Promise<ImportPreviewResponse> {
  const { preview, state, error } = value;
  const duplicateCandidates = ['ready', 'publishing', 'published'].includes(preview.status)
    ? await readStagedDuplicateCandidates(db, preview)
    : [];
  return {
    id: preview.id,
    revision: preview.revision,
    expiresAt: preview.expires_at,
    state,
    accountId: preview.account_id,
    fileSizeBytes: preview.file_size_bytes,
    fileSha256: preview.file_sha256,
    rowCount: preview.row_count,
    receivedRowCount: preview.status === 'ready' || preview.status === 'publishing' || preview.status === 'published' ? preview.row_count : 0,
    validRowCount: preview.status === 'ready' || preview.status === 'publishing' || preview.status === 'published' ? preview.row_count : 0,
    errors: error ? [{ code: error.code, message: error.message }] : [],
    duplicateCandidates,
  };
}

export async function createImportPreviewForOwner(db: D1Database, owner: OwnerContext, input: CreateImportPreviewInput, now = new Date()) {
  assertOwner(owner);
  const fileName = boundedString(input.fileName, 'fileName', 512);
  const fileSizeBytes = safeInteger(input.fileSizeBytes, 'fileSizeBytes');
  if (fileSizeBytes <= 0 || fileSizeBytes > MAX_IMPORT_FILE_BYTES) throw new MobileImportError('file_too_large', 'CSV files are limited to 10 MiB.', 413);
  const fileSha256 = requireHash(boundedString(input.fileSha256, 'fileSha256', 128), 'fileSha256');
  if (input.format !== 'csv') throw new MobileImportError('unsupported_format', 'Only UTF-8 CSV statements are supported; image-only or unverified formats are not imported.', 415);
  const rowCount = safeInteger(input.rowCount, 'rowCount');
  if (rowCount < 1 || rowCount > MAX_IMPORT_ROWS) throw new MobileImportError('invalid_row_count', `Imports must contain 1-${MAX_IMPORT_ROWS} rows.`, 400);
  const idempotencyKey = boundedString(input.idempotencyKey, 'idempotency key', 256);
  const account = await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(input.accountId).first<{ id: string }>();
  if (!account) throw new MobileImportError('account_not_found', 'The selected owner account does not exist.', 404);
  const id = `mobile-import-${await sha256Hex(`${owner.subjectHash}|${idempotencyKey}`)}`;
  const previewDigest = await sha256Hex(`${id}|${fileSizeBytes}|${fileSha256}|${rowCount}`);
  const ownerBindingDigest = await sha256Hex(`${owner.subjectHash}|${id}|${fileSha256}`);
  try {
    await createImportPreview(db, { id, accountId: input.accountId, filename: fileName, fileSizeBytes, fileSha256, previewDigest, ownerBindingDigest, rowCount, expiresAt: isoAfter(now, IMPORT_PREVIEW_TTL_MS) });
  } catch (error) {
    if (!(error instanceof Error) || !/unique constraint/i.test(error.message)) throw error;
  }
  const existingMetadata = await db.prepare(`SELECT account_id, filename, file_size_bytes, file_sha256, row_count, owner_binding_digest
    FROM import_previews WHERE id = ?`).bind(id).first<{
    account_id: string;
    filename: string;
    file_size_bytes: number;
    file_sha256: string;
    row_count: number;
    owner_binding_digest: string;
  }>();
  if (existingMetadata && existingMetadata.owner_binding_digest !== ownerBindingDigest) {
    throw new MobileImportError('idempotency_conflict', 'The idempotency key is already bound to a different import.', 409);
  }
  const existing = await readImportPreview(db, id, ownerBindingDigest);
  if (existing.preview.account_id !== input.accountId || existingMetadata?.filename !== fileName || existing.preview.file_size_bytes !== fileSizeBytes || existing.preview.file_sha256 !== fileSha256 || existing.preview.row_count !== rowCount) {
    throw new MobileImportError('idempotency_conflict', 'The idempotency key is already bound to a different import.', 409);
  }
  return previewResponse(db, existing);
}

export interface StageImportChunkInput {
  previewId: string;
  chunkIndex: number;
  operationId: string;
  rowStart: number;
  rows: readonly ImportRowInput[];
}

export async function stageImportChunkForOwner(db: D1Database, owner: OwnerContext, input: StageImportChunkInput) {
  assertOwner(owner);
  const preview = await readImportPreviewByOwner(db, owner, input.previewId);
  if (input.rows.length < 1 || input.rows.length > MAX_IMPORT_CHUNK_ROWS) throw new MobileImportError('invalid_chunk', `Chunks must contain 1-${MAX_IMPORT_CHUNK_ROWS} rows.`, 400);
  const errors = input.rows.map((row) => validateImportRowShape(row, preview.preview.account_id)).filter((error): error is ImportRowValidation => error !== null);
  if (errors.length > 0) {
    await markImportError(db, input.previewId, preview.preview.owner_binding_digest, errors[0].code, errors[0].message);
    throw new MobileImportError(errors[0].code, errors[0].message, 422);
  }
  const rowsJson = JSON.stringify(input.rows);
  if (new TextEncoder().encode(rowsJson).byteLength > MAX_IMPORT_CHUNK_BYTES) throw new MobileImportError('chunk_too_large', 'The import chunk exceeds 128 KiB.', 413);
  const chunkDigest = await sha256Hex(rowsJson);
  await stageImportChunk(db, { previewId: input.previewId, ownerBindingDigest: preview.preview.owner_binding_digest, chunkIndex: safeInteger(input.chunkIndex, 'chunkIndex'), operationId: boundedString(input.operationId, 'operationId', 256), chunkDigest, rowStart: safeInteger(input.rowStart, 'rowStart'), rowCount: input.rows.length, rowsJson });
  return previewResponse(db, await readImportPreviewByOwner(db, owner, input.previewId));
}

async function readImportPreviewByOwner(db: D1Database, owner: OwnerContext, previewId: string) {
  const id = boundedString(previewId, 'previewId', 256);
  const digestHint = await db.prepare(`SELECT owner_binding_digest FROM import_previews WHERE id = ?`).bind(id).first<{ owner_binding_digest: string }>();
  if (!digestHint) throw new MobileImportError('not_found', 'The import preview does not exist.', 404);
  const preview = await db.prepare(`SELECT file_sha256 FROM import_previews WHERE id = ?`).bind(id).first<{ file_sha256: string }>();
  if (!preview) throw new MobileImportError('not_found', 'The import preview does not exist.', 404);
  const ownerBindingDigest = await sha256Hex(`${owner.subjectHash}|${id}|${preview.file_sha256}`);
  if (digestHint.owner_binding_digest !== ownerBindingDigest) throw new MobileImportError('forbidden', 'The import preview belongs to another owner.', 403);
  return readImportPreview(db, id, ownerBindingDigest);
}

const PREVIEW_CANDIDATE_LOOKUP_LIMIT = 50;
const PREVIEW_CANDIDATES_PER_ROW = 5;
const PREVIEW_CANDIDATE_DATE_WINDOW_DAYS = 3;

interface PreviewCandidateRow {
  id: string;
  source_record_id: string;
  source_kind: 'statement' | 'alert';
  identity_key: string;
  event_id: string | null;
  account_id: string;
  date: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  kind: string;
  status: string;
  source: string;
  bank_reference: string | null;
}

interface RankedPreviewCandidate {
  candidate: PreviewCandidateRow;
  score: number;
  reasonCodes: string[];
}

function normalizedPreviewMerchant(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizedPreviewReference(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || null;
}

function previewDateDistanceDays(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function previewSourceRecordId(identityKey: string) {
  return `statement-source:${encodeURIComponent(identityKey)}`;
}

function previewCandidateId(sourceId: string, candidateTransactionId: string) {
  return `statement-candidate:${encodeURIComponent(`${sourceId}:${candidateTransactionId}`)}`;
}

function previewHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

function previewStatementRow(preview: { account_id: string; file_sha256: string }, row: ImportRowInput): StatementCommitRow {
  return {
    id: row.rowId,
    accountId: row.accountId,
    date: row.date,
    merchant: row.merchant,
    amountMinor: row.amountMinor,
    currency: row.currency,
    category: row.category,
    kind: row.kind,
    status: row.status,
    source: 'statement',
    fingerprint: row.fingerprint,
    note: row.note,
    bankReference: row.bankReference,
    sourceIdentity: {
      accountId: preview.account_id,
      fileSha256: preview.file_sha256,
      rowIndex: row.rowIndex,
      bankSourceId: row.sourceIdentity?.bankSourceId ?? null,
      bankRowId: row.sourceIdentity?.bankRowId ?? null,
    },
  };
}

function rankStatementPreviewCandidate(row: StatementCommitRow, candidate: PreviewCandidateRow, identityKey: string): RankedPreviewCandidate | null {
  if (candidate.source_kind !== 'statement' || candidate.identity_key === identityKey) return null;
  if (candidate.account_id !== row.accountId || candidate.currency !== row.currency || candidate.amount_minor !== row.amountMinor || candidate.kind !== row.kind) return null;
  const days = previewDateDistanceDays(row.date, candidate.date);
  if (days === null || days > PREVIEW_CANDIDATE_DATE_WINDOW_DAYS) return null;
  const rowMerchant = normalizedPreviewMerchant(row.merchant);
  const candidateMerchant = normalizedPreviewMerchant(candidate.merchant);
  const merchantMatch = Boolean(rowMerchant && candidateMerchant && (
    rowMerchant === candidateMerchant || rowMerchant.includes(candidateMerchant) || candidateMerchant.includes(rowMerchant)
  ));
  const reference = normalizedPreviewReference(row.bankReference);
  const referenceMatch = Boolean(reference && reference === normalizedPreviewReference(candidate.bank_reference));
  if (!merchantMatch && !referenceMatch && days > 0) return null;
  const reasonCodes = [
    'same_account',
    'same_currency',
    'same_amount',
    'same_kind',
    ...(days === 0 ? ['same_date'] : ['nearby_date']),
    ...(merchantMatch ? ['merchant_match'] : []),
    ...(referenceMatch ? ['bank_reference'] : []),
  ];
  const score = referenceMatch ? 100 : merchantMatch ? (days === 0 ? 95 : 80) : 70;
  return { candidate, score, reasonCodes };
}

function rankAlertPreviewCandidate(row: StatementCommitRow, candidate: PreviewCandidateRow): RankedPreviewCandidate | null {
  const sameCurrency = candidate.currency === row.currency;
  const sameAmount = candidate.amount_minor === row.amountMinor;
  const reference = normalizedPreviewReference(row.bankReference);
  const referenceMatch = Boolean(reference && reference === normalizedPreviewReference(candidate.bank_reference));
  if (candidate.source_kind !== 'alert' || candidate.account_id !== row.accountId || candidate.kind !== row.kind || Math.sign(candidate.amount_minor) !== Math.sign(row.amountMinor)) return null;
  if ((!sameCurrency || !sameAmount) && !referenceMatch) return null;
  if (sameCurrency && !sameAmount) return null;
  const days = previewDateDistanceDays(row.date, candidate.date);
  if (days === null || days > PREVIEW_CANDIDATE_DATE_WINDOW_DAYS) return null;
  const rowMerchant = normalizedPreviewMerchant(row.merchant);
  const candidateMerchant = normalizedPreviewMerchant(candidate.merchant);
  const merchantMatch = rowMerchant === candidateMerchant || rowMerchant.includes(candidateMerchant) || candidateMerchant.includes(rowMerchant);
  if (!merchantMatch && !referenceMatch && days > 0) return null;
  const score = referenceMatch && sameCurrency && sameAmount ? 100 : referenceMatch ? 75 : Math.max(40, 100 - Math.round(days * 15) - (merchantMatch ? 0 : 25));
  return {
    candidate,
    score,
    reasonCodes: [
      'same_account',
      ...(sameCurrency ? ['same_currency'] : ['cross_currency']),
      ...(sameAmount ? ['same_amount'] : []),
      ...(referenceMatch ? ['bank_reference'] : []),
      ...(merchantMatch ? ['merchant_match'] : []),
      ...(days === 0 ? ['same_date'] : ['nearby_date']),
    ],
  };
}

async function readPreviewCandidateRows(db: D1Database, row: StatementCommitRow, excludedStatementFileSha256: string): Promise<PreviewCandidateRow[]> {
  const statementCandidates = await db.prepare(`SELECT DISTINCT t.id, sr.id AS source_record_id, sr.source_kind, sr.identity_key, sr.event_id,
      t.account_id, t.date, t.merchant, t.amount_minor, t.currency, t.kind, t.status, t.source, sr.bank_reference
    FROM transaction_source_records sr
    JOIN transactions t ON t.id = sr.transaction_id AND t.account_id = sr.account_id
    WHERE sr.ledger_id = 'personal' AND sr.source_kind = 'statement' AND sr.account_id = ? AND t.account_id = ?
      AND t.source = 'statement' AND t.kind = ? AND t.status IN ('confirmed', 'provisional', 'needs_review')
      AND t.currency = ? AND t.amount_minor = ?
      AND (sr.file_sha256 IS NULL OR sr.file_sha256 <> ?)
      AND date(t.date) BETWEEN date(?, '-3 day') AND date(?, '+3 day')
    ORDER BY t.date DESC, t.id LIMIT ${PREVIEW_CANDIDATE_LOOKUP_LIMIT}`).bind(
    row.accountId, row.accountId, row.kind, row.currency, row.amountMinor, excludedStatementFileSha256, row.date, row.date,
  ).all<PreviewCandidateRow>();
  const reference = row.bankReference?.trim() || null;
  const alertCandidates = await db.prepare(`SELECT DISTINCT t.id, sr.id AS source_record_id, sr.source_kind, sr.identity_key, sr.event_id,
      t.account_id, t.date, t.merchant, t.amount_minor, t.currency, t.kind, t.status, t.source,
      COALESCE(
        sr.bank_reference,
        (SELECT ae.bank_reference FROM alert_projections ap JOIN alert_events ae ON ae.event_id = ap.event_id
          WHERE ap.transaction_id = t.id AND ae.bank_reference IS NOT NULL ORDER BY ap.updated_at DESC LIMIT 1)
      ) AS bank_reference
    FROM transaction_source_records sr
    JOIN transactions t ON t.id = sr.transaction_id AND t.account_id = sr.account_id
    WHERE sr.ledger_id = 'personal' AND sr.source_kind = 'alert' AND sr.account_id = ? AND t.account_id = ?
      AND t.kind = ? AND t.status IN ('confirmed', 'provisional', 'needs_review')
      AND NOT EXISTS (SELECT 1 FROM alert_projections superseded_alert
        WHERE superseded_alert.state = 'superseded'
          AND (superseded_alert.transaction_id = t.id OR superseded_alert.event_id = sr.event_id))
      AND ((t.currency = ? AND t.amount_minor = ?)
        OR (? IS NOT NULL AND lower(COALESCE(sr.bank_reference,
          (SELECT ae.bank_reference FROM alert_projections ap JOIN alert_events ae ON ae.event_id = ap.event_id
            WHERE ap.transaction_id = t.id AND ae.bank_reference IS NOT NULL ORDER BY ap.updated_at DESC LIMIT 1))) = lower(?)))
      AND date(t.date) BETWEEN date(?, '-3 day') AND date(?, '+3 day')
    ORDER BY t.date DESC, t.id LIMIT ${PREVIEW_CANDIDATE_LOOKUP_LIMIT}`).bind(
    row.accountId, row.accountId, row.kind, row.currency, row.amountMinor, reference, reference, row.date, row.date,
  ).all<PreviewCandidateRow>();
  return [...statementCandidates.results, ...alertCandidates.results];
}

async function previewTransactionId(db: D1Database, row: ImportRowInput, identityKey: string, occupied: Set<string>) {
  const proposed = row.rowId;
  const proposedExists = occupied.has(proposed) || Boolean(await db.prepare('SELECT id FROM transactions WHERE id = ? LIMIT 1').bind(proposed).first<{ id: string }>());
  if (!proposedExists) return proposed;
  const fallback = `statement-${previewHash(identityKey)}-${row.rowIndex}`;
  const fallbackExists = occupied.has(fallback) || Boolean(await db.prepare('SELECT id FROM transactions WHERE id = ? LIMIT 1').bind(fallback).first<{ id: string }>());
  if (!fallbackExists) return fallback;
  return `${fallback}-${previewHash(`${identityKey}:${proposed}`)}`.slice(0, 160);
}

async function readPublishedImportRows(db: D1Database, preview: Awaited<ReturnType<typeof readImportPreview>>['preview']) {
  const chunks = await db.prepare(`SELECT row_start, row_count, rows_json FROM import_chunks WHERE preview_id = ? ORDER BY row_start, chunk_index`).bind(preview.id).all<{ row_start: number; row_count: number; rows_json: string }>();
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
  return rows;
}

function readPublishedSelectedRows(preview: Awaited<ReturnType<typeof readImportPreview>>['preview'], rows: readonly unknown[]) {
  let selectedValue: unknown;
  try {
    selectedValue = JSON.parse(preview.selected_row_ids_json);
  } catch {
    throw new ImportStoreError('import_error', 'The stored import selection is corrupt.', 409);
  }
  if (!Array.isArray(selectedValue) || selectedValue.length < 1 || selectedValue.length > 500 || selectedValue.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 160)) {
    throw new ImportStoreError('import_error', 'The stored import selection is corrupt.', 409);
  }
  const selectedIds = new Set(selectedValue);
  if (selectedIds.size !== selectedValue.length || selectedIds.size !== preview.selected_count) throw new ImportStoreError('import_error', 'The stored import selection is corrupt.', 409);
  const selectedRows = rows.filter((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rowId = (value as { rowId?: unknown }).rowId;
    return typeof rowId === 'string' && selectedIds.has(rowId);
  });
  if (selectedRows.length !== selectedIds.size) throw new ImportStoreError('import_error', 'The stored import selection is corrupt.', 409);
  return selectedRows;
}

async function readStagedDuplicateCandidates(
  db: D1Database,
  preview: Awaited<ReturnType<typeof readImportPreview>>['preview'],
  selectedValues?: readonly unknown[],
): Promise<ImportDuplicateCandidate[]> {
  await ensureImportDuplicateDecisionStore(db);
  const values = selectedValues ?? (preview.status === 'published'
    ? await readPublishedImportRows(db, preview)
    : (await readStagedImportRows(db, preview.id, preview.owner_binding_digest)).rows);
  const occupied = new Set<string>();
  const candidates: ImportDuplicateCandidate[] = [];
  for (const value of values) {
    const validation = validateImportRowShape(value, preview.account_id);
    if (validation) throw new ImportStoreError('import_error', `A staged import row is invalid: ${validation.message}`, 409);
    const row = value as ImportRowInput;
    const statement = previewStatementRow(preview, row);
    const identityKey = statementSourceIdentityKey(statement.sourceIdentity);
    const sourceId = previewSourceRecordId(identityKey);
    const statementTransactionId = await previewTransactionId(db, row, identityKey, occupied);
    occupied.add(statementTransactionId);
    const ranked = (await readPreviewCandidateRows(db, statement, preview.file_sha256))
      .map((candidate) => candidate.source_kind === 'statement'
        ? rankStatementPreviewCandidate(statement, candidate, identityKey)
        : rankAlertPreviewCandidate(statement, candidate))
      .filter((candidate): candidate is RankedPreviewCandidate => candidate !== null)
      .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))
      .slice(0, PREVIEW_CANDIDATES_PER_ROW);
    for (const candidate of ranked) {
      candidates.push({
        id: previewCandidateId(sourceId, candidate.candidate.id),
        statementTransactionId,
        candidateTransactionId: candidate.candidate.id,
        score: candidate.score,
        reasonCodes: candidate.reasonCodes,
        status: 'open',
      });
    }
  }
  const decisions = await db.prepare(`SELECT candidate_id, status
    FROM import_duplicate_decisions WHERE preview_id = ?`).bind(preview.id).all<{ candidate_id: string; status: 'accepted' | 'dismissed' }>();
  const decisionById = new Map(decisions.results.map((decision) => [decision.candidate_id, decision.status]));
  return candidates
    .map((candidate) => ({ ...candidate, status: decisionById.get(candidate.id) ?? candidate.status }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export interface DecideImportDuplicateInput {
  previewId: string;
  candidateId: string;
  expectedRevision: number;
  decision: 'resolve' | 'keep_separate';
}

/**
 * Records an explicit owner decision for one preview candidate. The candidate
 * is re-derived from staged rows, so callers cannot manufacture a decision for
 * another account or for a candidate outside this preview. The insert and
 * preview revision CAS are one D1 batch; a stale request cannot mutate state.
 */
export async function decideImportDuplicateForOwner(db: D1Database, owner: OwnerContext, input: DecideImportDuplicateInput) {
  assertOwner(owner);
  const current = await readImportPreviewByOwner(db, owner, input.previewId);
  if (!['staged', 'ready'].includes(current.preview.status)) throw new MobileImportError('not_writable', 'Duplicate decisions are only available before commit.', 409);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new MobileImportError('invalid_request', 'The expected import revision is not valid.', 400);
  if (input.decision !== 'resolve' && input.decision !== 'keep_separate') throw new MobileImportError('invalid_request', 'The duplicate decision is not supported.', 400);
  const candidateId = boundedString(input.candidateId, 'candidateId', 256);
  const candidate = (await readStagedDuplicateCandidates(db, current.preview)).find((item) => item.id === candidateId);
  if (!candidate) throw new MobileImportError('candidate_not_found', 'The duplicate candidate is not part of this import preview.', 404);
  const status: ImportDuplicateCandidate['status'] = input.decision === 'resolve' ? 'accepted' : 'dismissed';
  await ensureImportDuplicateDecisionStore(db);
  const existing = await db.prepare(`SELECT status FROM import_duplicate_decisions WHERE preview_id = ? AND candidate_id = ?`)
    .bind(current.preview.id, candidate.id).first<{ status: 'accepted' | 'dismissed' }>();
  if (existing?.status === status && (current.preview.revision === input.expectedRevision || current.preview.revision === input.expectedRevision + 1)) {
    return previewResponse(db, await readImportPreviewByOwner(db, owner, current.preview.id));
  }
  if (current.preview.revision !== input.expectedRevision) throw new MobileImportError('revision_conflict', 'The import preview changed; refresh before deciding this candidate.', 409);
  await db.batch([
    db.prepare(`INSERT INTO import_duplicate_decisions
      (preview_id, candidate_id, statement_transaction_id, candidate_transaction_id, status)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM import_previews
        WHERE id = ? AND owner_binding_digest = ? AND status IN ('staged', 'ready') AND revision = ?
      )
      ON CONFLICT(preview_id, candidate_id) DO UPDATE SET
        statement_transaction_id = excluded.statement_transaction_id,
        candidate_transaction_id = excluded.candidate_transaction_id,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP`).bind(
      current.preview.id, candidate.id, candidate.statementTransactionId, candidate.candidateTransactionId, status,
      current.preview.id, current.preview.owner_binding_digest, input.expectedRevision,
    ),
    db.prepare(`UPDATE import_previews SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_binding_digest = ? AND status IN ('staged', 'ready') AND revision = ?`).bind(
      current.preview.id, current.preview.owner_binding_digest, input.expectedRevision,
    ),
  ]);
  const after = await readImportPreviewByOwner(db, owner, current.preview.id);
  if (after.preview.revision !== input.expectedRevision + 1) {
    const afterCandidate = (await readStagedDuplicateCandidates(db, after.preview)).find((item) => item.id === candidate.id);
    if (afterCandidate?.status === status) return previewResponse(db, after);
    throw new MobileImportError('revision_conflict', 'The import preview changed; refresh before deciding this candidate.', 409);
  }
  return previewResponse(db, after);
}

export interface CancelImportInput {
  previewId: string;
  expectedRevision: number;
}

export async function cancelImportForOwner(db: D1Database, owner: OwnerContext, input: CancelImportInput) {
  assertOwner(owner);
  const current = await readImportPreviewByOwner(db, owner, input.previewId);
  await import('./import-store').then(({ cancelImport }) => cancelImport(db, current.preview.id, current.preview.owner_binding_digest, input.expectedRevision));
  return previewResponse(db, await readImportPreviewByOwner(db, owner, input.previewId));
}

async function readDuplicateCandidates(db: D1Database, accountId: string, fileSha256: string): Promise<ImportDuplicateCandidate[]> {
  const result = await db.prepare(`SELECT c.id, c.statement_transaction_id, c.candidate_transaction_id, c.score, c.reason_codes_json, c.status
    FROM statement_reconciliation_candidates c JOIN transaction_source_records r ON r.id = c.source_record_id
    WHERE r.ledger_id = 'personal' AND r.account_id = ? AND r.file_sha256 = ?
    ORDER BY c.id`).bind(accountId, fileSha256).all<{
    id: string;
    statement_transaction_id: string;
    candidate_transaction_id: string;
    score: number;
    reason_codes_json: string;
    status: ImportDuplicateCandidate['status'];
  }>();
  return result.results.map((item) => ({
    id: item.id,
    statementTransactionId: item.statement_transaction_id,
    candidateTransactionId: item.candidate_transaction_id,
    score: item.score,
    reasonCodes: JSON.parse(item.reason_codes_json) as string[],
    status: item.status,
  }));
}

function mergeDuplicateCandidates(...lists: readonly ImportDuplicateCandidate[][]) {
  const byId = new Map<string, ImportDuplicateCandidate>();
  for (const list of lists) {
    for (const candidate of list) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function applyImportCandidateDecisions(db: D1Database, previewId: string, candidates: readonly ImportDuplicateCandidate[]) {
  const decisions = await db.prepare(`SELECT candidate_id, status
    FROM import_duplicate_decisions WHERE preview_id = ? AND status IN ('accepted', 'dismissed')`).bind(previewId).all<{ candidate_id: string; status: 'accepted' | 'dismissed' }>();
  const decisionById = new Map(decisions.results.map((decision) => [decision.candidate_id, decision.status]));
  const statements = candidates.flatMap((candidate) => {
    const status = decisionById.get(candidate.id);
    return status ? [db.prepare(`UPDATE statement_reconciliation_candidates
      SET status = ?, evidence_basis = 'user_review', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'`).bind(status, candidate.id)] : [];
  });
  if (statements.length > 0) await db.batch(statements);
}

async function assertKeepSeparateCanPublish(db: D1Database, candidates: readonly ImportDuplicateCandidate[]) {
  for (const candidate of candidates) {
    if (candidate.status !== 'dismissed') continue;
    const alert = await db.prepare(`SELECT 1 AS present FROM transaction_source_records
      WHERE ledger_id = 'personal' AND transaction_id = ? AND source_kind = 'alert' LIMIT 1`)
      .bind(candidate.candidateTransactionId).first<{ present: number }>();
    if (alert) throw new MobileImportError('keep_separate_requires_review', 'This alert candidate cannot be kept separate through the import path yet; use Review to record the reconciliation decision.', 409);
  }
}

export interface CommitImportInput {
  previewId: string;
  expectedRevision: number;
  rowIds: readonly string[];
  operationId: string;
}

export async function commitImportForOwner(db: D1Database, owner: OwnerContext, input: CommitImportInput) {
  assertOwner(owner);
  const current = await readImportPreviewByOwner(db, owner, input.previewId);
  const operationId = boundedString(input.operationId, 'operationId', 160);
  if (current.preview.status === 'published') {
    if (current.preview.operation_id !== operationId) throw new MobileImportError('operation_conflict', 'The import preview is already published under another operation.', 409);
    const publishedRows = await readPublishedImportRows(db, current.preview);
    const selectedRows = readPublishedSelectedRows(current.preview, publishedRows);
    return {
      receiptId: current.preview.receipt_id,
      importId: current.preview.id,
      publishedRows: current.preview.committed_count,
      duplicateRows: current.preview.duplicate_count,
      needsReview: current.preview.review_count,
      revision: current.preview.revision,
      committedAt: current.preview.published_at,
      duplicateCandidates: mergeDuplicateCandidates(
        await readStagedDuplicateCandidates(db, current.preview, selectedRows),
        await readDuplicateCandidates(db, current.preview.account_id, current.preview.file_sha256),
      ),
    };
  }
  const resumesPublishing = current.preview.status === 'publishing' && current.preview.operation_id === operationId;
  if (!resumesPublishing && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.preview.revision)) throw new MobileImportError('revision_conflict', 'The import preview changed; refresh before committing.', 409);
  const selected = [...new Set(input.rowIds.map((id) => boundedString(id, 'rowId', 160)))].sort();
  if (selected.length < 1 || selected.length > 500) throw new MobileImportError('invalid_selection', 'Select between 1 and 500 rows to commit.', 400);
  const staged = await readStagedImportRows(db, current.preview.id, current.preview.owner_binding_digest);
  const byId = new Map(staged.rows.map((row) => [typeof row === 'object' && row !== null ? (row as { rowId?: string }).rowId : undefined, row]));
  const selectedRows = selected.map((id) => byId.get(id));
  if (selectedRows.some((row) => row === undefined)) throw new MobileImportError('invalid_selection', 'A selected row is not in the preview.', 400);
  const accountCurrencies = await db.prepare(`SELECT currency FROM account_currencies WHERE account_id = ?`).bind(current.preview.account_id).all<{ currency: string }>();
  const allowedCurrencies = new Set(accountCurrencies.results.map((row) => row.currency));
  const rows: StatementCommitRow[] = [];
  for (const value of selectedRows) {
    const validation = validateImportRowShape(value, current.preview.account_id);
    if (validation) {
      await markImportError(db, current.preview.id, current.preview.owner_binding_digest, validation.code, validation.message);
      throw new MobileImportError(validation.code, validation.message, 422);
    }
    const row = value as ImportRowInput;
    if (!allowedCurrencies.has(row.currency)) {
      await markImportError(db, current.preview.id, current.preview.owner_binding_digest, 'currency_not_allowed', `Currency ${row.currency} is not approved for this account.`);
      throw new MobileImportError('currency_not_allowed', `Currency ${row.currency} is not approved for this account.`, 422);
    }
    rows.push({ id: row.rowId, accountId: row.accountId, date: row.date, merchant: row.merchant, amountMinor: row.amountMinor, currency: row.currency, category: row.category, kind: row.kind, status: row.status, source: 'statement', fingerprint: row.fingerprint, note: row.note, bankReference: row.bankReference, sourceIdentity: { accountId: row.accountId, fileSha256: current.preview.file_sha256, rowIndex: row.rowIndex, bankSourceId: row.sourceIdentity?.bankSourceId, bankRowId: row.sourceIdentity?.bankRowId } });
  }
  const previewCandidates = await readStagedDuplicateCandidates(db, current.preview, selectedRows);
  if (previewCandidates.some((candidate) => candidate.status === 'open')) {
    throw new MobileImportError('open_duplicate_candidates', 'Resolve or keep separate every duplicate candidate before committing the import.', 409);
  }
  await assertKeepSeparateCanPublish(db, previewCandidates);
  const publication = await beginImportPublication(db, current.preview.id, current.preview.owner_binding_digest, operationId, selected);
  try {
    const result = await commitStatementRows(db, { importId: publication.id, operationId, accountId: publication.account_id, filename: publication.filename, fileSha256: publication.file_sha256, rows });
    await applyImportCandidateDecisions(db, publication.id, result.candidates);
    const receiptId = publication.receipt_id ?? `receipt-${crypto.randomUUID()}`;
    const completed = await completeImportPublication(db, publication.id, publication.owner_binding_digest, operationId, receiptId, { accepted: result.accepted, duplicates: result.duplicates, needsReview: result.needsReview }, new Date().toISOString());
    const committedCandidates = await readDuplicateCandidates(db, current.preview.account_id, current.preview.file_sha256);
    return { receiptId: completed.receipt_id, importId: completed.id, publishedRows: completed.committed_count, duplicateRows: completed.duplicate_count, needsReview: completed.review_count, revision: completed.revision, committedAt: completed.published_at, duplicateCandidates: mergeDuplicateCandidates(previewCandidates, committedCandidates) };
  } catch (error) {
    if (error instanceof RangeError || error instanceof ImportStoreError) {
      await markImportError(db, publication.id, publication.owner_binding_digest, 'commit_failed', error.message);
      throw error;
    }
    if (error instanceof ReconciliationConflictError) {
      await markImportError(db, publication.id, publication.owner_binding_digest, error.code, error.message);
      throw new MobileImportError(error.code, error.message, 409);
    }
    throw new MobileImportError('commit_failed', 'The import could not be committed.', 503, true);
  }
}
