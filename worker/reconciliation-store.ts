import { assertPublicationNotExpired, statementPublicationStatements, type ImportPublicationBinding } from './statement-publication';
import type { LedgerContext } from './tenant-context';
import { assertFinancialAuthority, type FinancialContext } from './financial-authority';
import { ledgerScopedIdentifier, statementTransactionIdentifier } from './ledger-identifiers';
import type { D1Database, D1Statement, CurrencyCode } from './db-types';

const LEDGER_ID = 'personal';
const MAX_ROWS = 500;
const MAX_CANDIDATES_PER_ROW = 5;
const MAX_MERCHANT_LENGTH = 200;

export interface StatementSourceIdentity {
  accountId: string;
  fileSha256: string;
  rowIndex: number;
  bankSourceId?: string | null;
  bankRowId?: string | null;
}

export interface StatementCommitRow {
  id: string;
  accountId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: CurrencyCode;
  category: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
  status: 'confirmed' | 'provisional' | 'needs_review';
  source: 'statement';
  fingerprint: string;
  note?: string | null;
  sourceIdentity: StatementSourceIdentity;
  contentDigest?: string;
  bankReference?: string | null;
}

export interface CommitStatementRowsInput {
  importId: string;
  operationId?: string;
  accountId: string;
  filename: string;
  fileSha256: string;
  rows: readonly StatementCommitRow[];
  publication?: ImportPublicationBinding;
}

export interface StatementCandidate {
  id: string;
  statementTransactionId: string;
  candidateTransactionId: string;
  score: number;
  reasonCodes: string[];
  status: 'open' | 'accepted' | 'dismissed';
}

export interface CommitStatementRowsResult {
  importId: string;
  accepted: number;
  duplicates: number;
  needsReview: number;
  candidateCount: number;
  transactionIds: string[];
  duplicateSourceIds: string[];
  candidates: StatementCandidate[];
}

interface ExistingSource {
  source_record_id: string;
  transaction_id: string;
  identity_key: string;
  content_digest: string;
}

interface ExistingTransaction {
  id: string;
  account_id: string;
  date: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  kind: string;
  status: string;
  source: string;
  bank_reference?: string | null;
}

interface ExistingCommitOperation {
  id: string;
  account_id: string;
  file_sha256: string;
  status: 'committed' | 'replayed' | 'partial_review';
  accepted_count: number;
  duplicate_count: number;
  review_count: number;
}

interface CandidateRow {
  id: string;
  source_record_id?: string;
  source_kind?: string;
  event_id?: string | null;
  account_id: string;
  date: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  kind: string;
  status: string;
  source: string;
  bank_reference?: string | null;
}

interface RankedCandidate {
  candidate: CandidateRow;
  score: number;
  reasonCodes: string[];
}

function bounded(value: string, field: string, max: number) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value.trim();
}

function safeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${field} must be a safe integer.`);
  return value;
}

function isoDate(value: string, field: string) {
  bounded(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${field} must be YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new RangeError(`${field} is not a real date.`);
  return value;
}

function hash(value: string) {
  // This is an identifier suffix, not a cryptographic proof. The file digest
  // itself is supplied by the client and is validated as a SHA-256 hex value.
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

export class ReconciliationConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReconciliationConflictError';
    this.code = code;
  }
}

export function isReconciliationUniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed|sqlite_constraint.*unique|constraint failed.*unique/i.test(message);
}

function sourceConflict(identityKey: string) {
  return new ReconciliationConflictError('source_identity_conflict', `The statement source identity has different content: ${identityKey}`);
}

export function statementSourceIdentityKey(identity: StatementSourceIdentity) {
  const accountId = bounded(identity.accountId, 'statement account id', 128);
  const fileSha256 = bounded(identity.fileSha256, 'statement file hash', 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fileSha256)) throw new RangeError('Statement file hash must be a SHA-256 hex digest.');
  if (!Number.isInteger(identity.rowIndex) || identity.rowIndex < 0 || identity.rowIndex > 1_000_000) throw new RangeError('Statement row index is not valid.');
  const bankSourceId = identity.bankSourceId?.trim() || null;
  const bankRowId = identity.bankRowId?.trim() || null;
  if ((bankSourceId && !bankRowId) || (!bankSourceId && bankRowId)) throw new RangeError('Bank source and row IDs must be supplied together.');
  if (bankSourceId && bankSourceId.length > 256) throw new RangeError('Bank source ID is too long.');
  if (bankRowId && bankRowId.length > 256) throw new RangeError('Bank row ID is too long.');
  return bankSourceId && bankRowId
    ? `statement:${accountId}:${bankSourceId}:${bankRowId}`
    : `statement:${accountId}:${fileSha256}:${identity.rowIndex}`;
}

function sourceRecordId(identity: StatementSourceIdentity) {
  return `statement-source:${encodeURIComponent(statementSourceIdentityKey(identity))}`;
}

function statementCandidateId(sourceId: string, candidateTransactionId: string) {
  return `statement-candidate:${encodeURIComponent(`${sourceId}:${candidateTransactionId}`)}`;
}

async function contentDigest(row: StatementCommitRow) {
  const canonical = JSON.stringify({
    accountId: row.accountId,
    date: row.date,
    merchant: row.merchant.trim(),
    amountMinor: row.amountMinor,
    currency: row.currency,
    category: row.category.trim(),
    kind: row.kind,
    fingerprint: row.fingerprint.trim(),
    note: row.note ?? null,
    bankReference: row.bankReference ?? null,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const computed = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (row.contentDigest?.trim() && row.contentDigest.trim().toLowerCase() !== computed) throw new ReconciliationConflictError('content_digest_conflict', 'The supplied statement content digest does not match the row content.');
  return computed;
}

function normalizedMerchant(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function candidateScore(row: StatementCommitRow, candidate: CandidateRow) {
  const sameCurrency = candidate.currency === row.currency;
  const sameAmount = candidate.amount_minor === row.amountMinor;
  const referenceMatch = Boolean(row.bankReference?.trim() && candidate.bank_reference?.trim() && row.bankReference.trim().toLowerCase() === candidate.bank_reference.trim().toLowerCase());
  if (candidate.account_id !== row.accountId || candidate.kind !== row.kind || Math.sign(candidate.amount_minor) !== Math.sign(row.amountMinor)) return null;
  // A bank reference can establish that two differently denominated records
  // are related, but it does not establish that their amounts are the same
  // money. Keep that case review-only unless an explicit FX/settlement review
  // supplies the missing semantics.
  if ((!sameCurrency || !sameAmount) && !referenceMatch) return null;
  if (sameCurrency && !sameAmount) return null;
  const rowDate = Date.parse(`${row.date}T00:00:00.000Z`);
  const candidateDate = Date.parse(`${candidate.date}T00:00:00.000Z`);
  const days = Math.abs(rowDate - candidateDate) / 86_400_000;
  if (!Number.isFinite(days) || days > 3) return null;
  const rowMerchant = normalizedMerchant(row.merchant);
  const candidateMerchant = normalizedMerchant(candidate.merchant);
  if (!referenceMatch && (!rowMerchant || !candidateMerchant)) return null;
  const merchantMatch = rowMerchant === candidateMerchant || rowMerchant.includes(candidateMerchant) || candidateMerchant.includes(rowMerchant);
  if (!merchantMatch && !referenceMatch && days > 0) return null;
  const score = referenceMatch && sameCurrency && sameAmount ? 100 : referenceMatch ? 75 : Math.max(40, 100 - Math.round(days * 15) - (merchantMatch ? 0 : 25));
  return {
    score,
    reasonCodes: ['same_account', ...(sameCurrency ? ['same_currency'] : ['cross_currency']), ...(sameAmount ? ['same_amount'] : []), ...(referenceMatch ? ['bank_reference'] : []), ...(merchantMatch ? ['merchant_match'] : []), ...(days === 0 ? ['same_date'] : ['nearby_date'])],
  };
}

function isStrongAlertCandidate(row: StatementCommitRow, candidate: RankedCandidate) {
  return candidate.candidate.source === 'alert' &&
    candidate.candidate.source_kind === 'alert' &&
    Boolean(candidate.candidate.event_id) &&
    candidate.candidate.currency === row.currency &&
    candidate.candidate.amount_minor === row.amountMinor &&
    candidate.reasonCodes.includes('bank_reference') &&
    candidate.reasonCodes.includes('same_currency') &&
    candidate.reasonCodes.includes('same_amount');
}

async function accountAllowsCurrency(db: D1Database, context: LedgerContext, accountId: string, currency: string) {
  const account = await db.prepare(`SELECT a.id
    FROM accounts a LEFT JOIN account_currencies c ON c.account_id = a.id AND c.ledger_id = a.ledger_id
    WHERE a.id = ? AND a.ledger_id = ? AND (c.currency = ? OR (c.currency IS NULL AND a.currency = ?)) LIMIT 1`).bind(accountId, context.ledgerId, currency, currency).all<{ id: string }>();
  return account.results.length > 0;
}

async function existingSource(db: D1Database, context: LedgerContext, identityKey: string) {
  return db.prepare(`SELECT id AS source_record_id, transaction_id, identity_key, content_digest
    FROM transaction_source_records WHERE ledger_id = ? AND source_kind = 'statement' AND identity_key = ? LIMIT 1`)
    .bind(context.ledgerId, identityKey).first<ExistingSource>();
}

async function candidateTransactions(db: D1Database, context: LedgerContext, row: StatementCommitRow) {
  const reference = row.bankReference?.trim() || null;
  const candidates = await db.prepare(`SELECT DISTINCT t.id, t.account_id, t.date, t.merchant, t.amount_minor, t.currency, t.kind, t.status, t.source,
      sr.id AS source_record_id, sr.source_kind, sr.event_id,
      COALESCE(
        sr.bank_reference,
        (SELECT ae.bank_reference FROM alert_projections ap JOIN alert_events ae ON ae.event_id = ap.event_id AND ae.ledger_id = ap.ledger_id
          WHERE ap.ledger_id = t.ledger_id AND ap.transaction_id = t.id AND ae.bank_reference IS NOT NULL ORDER BY ap.updated_at DESC LIMIT 1)
      ) AS bank_reference
    FROM transactions t
    JOIN transaction_source_records sr ON sr.transaction_id = t.id AND sr.account_id = t.account_id AND sr.ledger_id = ? AND sr.ledger_id = t.ledger_id AND sr.source_kind = 'alert'
    WHERE t.account_id = ? AND t.kind = ? AND t.status IN ('confirmed', 'provisional', 'needs_review')
      AND NOT EXISTS (SELECT 1 FROM alert_projections superseded_alert
        WHERE superseded_alert.ledger_id = t.ledger_id AND superseded_alert.state = 'superseded'
          AND (superseded_alert.transaction_id = t.id OR superseded_alert.event_id = sr.event_id))
      AND ( (t.currency = ? AND t.amount_minor = ?)
        OR (? IS NOT NULL AND lower(COALESCE(sr.bank_reference,
          (SELECT ae.bank_reference FROM alert_projections ap JOIN alert_events ae ON ae.event_id = ap.event_id AND ae.ledger_id = ap.ledger_id
            WHERE ap.ledger_id = t.ledger_id AND ap.transaction_id = t.id AND ae.bank_reference IS NOT NULL ORDER BY ap.updated_at DESC LIMIT 1))) = lower(?)) )
    ORDER BY t.date DESC, t.id LIMIT 50`).bind(context.ledgerId, row.accountId, row.kind, row.currency, row.amountMinor, reference, reference).all<CandidateRow>();
  return candidates.results
    .map((candidate) => {
      const rank = candidateScore(row, candidate);
      return rank ? { candidate, ...rank } : null;
    })
    .filter((item): item is RankedCandidate => item !== null)
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id))
    .slice(0, MAX_CANDIDATES_PER_ROW);
}

export interface AlertStatementMatchInput {
  accountId: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: CurrencyCode;
  kind: StatementCommitRow['kind'];
  bankReference?: string | null;
}

export interface AlertStatementMatch {
  statementTransactionId: string;
  sourceRecordId: string;
  score: number;
  reasonCodes: string[];
  basis: 'bank_reference' | 'candidate_rank';
}

/**
 * Finds statement-side candidates for an alert that arrived after the bank
 * export. The query is intentionally statement-only and scope-complete; an
 * alert can be auto-confirmed only when exactly one candidate has a bank
 * reference match.
 */
export async function findAlertStatementMatches(db: D1Database, input: AlertStatementMatchInput): Promise<AlertStatementMatch[]> {
  const feature = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'statement_reconciliation_candidates' LIMIT 1`).first<{ name: string }>();
  if (!feature) return [];
  const reference = input.bankReference?.trim() || null;
  const candidates = await db.prepare(`SELECT t.id, t.account_id, t.date, t.merchant, t.amount_minor, t.currency, t.kind, t.status, t.source,
      sr.id AS source_record_id, sr.source_kind, sr.event_id, sr.bank_reference
    FROM transaction_source_records sr
    JOIN transactions t ON t.id = sr.transaction_id AND t.account_id = sr.account_id
    WHERE sr.ledger_id = ? AND sr.ledger_id = t.ledger_id AND sr.source_kind = 'statement' AND sr.account_id = ? AND t.account_id = ?
      AND t.kind = ?
      AND ( (t.currency = ? AND t.amount_minor = ?)
        OR (? IS NOT NULL AND sr.bank_reference IS NOT NULL AND lower(sr.bank_reference) = lower(?)) )
      AND t.status IN ('confirmed', 'provisional', 'needs_review')
    ORDER BY t.date DESC, t.id LIMIT 50`).bind(LEDGER_ID, input.accountId, input.accountId, input.kind, input.currency, input.amountMinor, reference, reference).all<CandidateRow>();
  const row = {
    id: '__alert_statement_match__',
    accountId: input.accountId,
    date: input.date,
    merchant: input.merchant,
    amountMinor: input.amountMinor,
    currency: input.currency,
    category: 'Uncategorized',
    kind: input.kind,
    status: 'provisional' as const,
    source: 'statement' as const,
    fingerprint: '__alert_statement_match__',
    sourceIdentity: { accountId: input.accountId, fileSha256: '0'.repeat(64), rowIndex: 0 },
    bankReference: input.bankReference ?? null,
  } satisfies StatementCommitRow;
  return candidates.results
    .map((candidate) => {
      const rank = candidateScore(row, candidate);
      if (!rank || !candidate.source_record_id) return null;
      return {
        statementTransactionId: candidate.id,
        sourceRecordId: candidate.source_record_id,
        score: rank.score,
        reasonCodes: rank.reasonCodes,
        basis: rank.reasonCodes.includes('bank_reference') && rank.reasonCodes.includes('same_currency') && rank.reasonCodes.includes('same_amount')
          ? 'bank_reference' as const
          : 'candidate_rank' as const,
      };
    })
    .filter((item): item is AlertStatementMatch => item !== null)
    .sort((left, right) => right.score - left.score || left.statementTransactionId.localeCompare(right.statementTransactionId))
    .slice(0, MAX_CANDIDATES_PER_ROW);
}

async function publishStatementBatch(db: D1Database, context: FinancialContext, statements: D1Statement[], publication?: ImportPublicationBinding) {
  try { await db.batch(statements); }
  catch (error) {
    await assertFinancialAuthority(db, context, 'imports:write');
    await assertPublicationNotExpired(db,context,publication);
    throw error;
  }
}

/**
 * Commits statement rows, source identities, candidates, and import metadata
 * in one D1 batch. Queries happen before the batch; no response reports a row
 * as accepted until all corresponding durable writes succeed.
 */
export async function commitStatementRows(db: D1Database, context: FinancialContext, input: CommitStatementRowsInput, retryOnUnique = true): Promise<CommitStatementRowsResult> {
  await assertFinancialAuthority(db, context, 'imports:write');
  if (input.rows.length < 1 || input.rows.length > MAX_ROWS) throw new RangeError(`Statement imports are limited to ${MAX_ROWS} rows.`);
  const accountId = bounded(input.accountId, 'statement account id', 128);
  const fileSha256 = bounded(input.fileSha256, 'statement file hash', 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fileSha256)) throw new RangeError('Statement file hash must be a SHA-256 hex digest.');
  const filename = bounded(input.filename, 'statement filename', 200);
  const requestedOperationId = input.operationId?.trim();
  if (requestedOperationId) bounded(requestedOperationId, 'statement operation ID', 160);
  // A retry without a client operation ID must address the same durable
  // operation. The account is part of the derived key so the same file can be
  // imported independently into two accounts without colliding.
  const operationId = await ledgerScopedIdentifier(context, 'statement-operation', requestedOperationId || `statement-operation:${hash(`${accountId}:${fileSha256}`)}`);
  const importId = operationId;
  const previousOperation = await db.prepare(`SELECT id, account_id, file_sha256, status, accepted_count, duplicate_count, review_count
    FROM import_commit_operations WHERE id = ? AND ledger_id = ? LIMIT 1`).bind(operationId, context.ledgerId).first<ExistingCommitOperation>();
  if (previousOperation && (previousOperation.account_id !== accountId || previousOperation.file_sha256 !== fileSha256)) throw new RangeError('The import operation was reused for a different statement.');
  const replayOperation = previousOperation ?? await db.prepare(`SELECT id, account_id, file_sha256, status, accepted_count, duplicate_count, review_count
    FROM import_commit_operations WHERE ledger_id = ? AND account_id = ? AND file_sha256 = ? LIMIT 1`)
    .bind(context.ledgerId, accountId, fileSha256).first<ExistingCommitOperation>();
  if (replayOperation) {
    if (replayOperation.accepted_count + replayOperation.duplicate_count !== input.rows.length) throw sourceConflict(`operation:${replayOperation.id}`);
    const replayIdentities: string[] = [];
    const seenReplayIdentities = new Set<string>();
    for (const row of input.rows) {
      if (row.accountId !== accountId || row.source !== 'statement') throw new RangeError('Every statement row must use the selected account and statement source.');
      bounded(row.id, 'statement transaction id', 160);
      isoDate(row.date, 'statement date');
      bounded(row.merchant, 'statement merchant', MAX_MERCHANT_LENGTH);
      safeInteger(row.amountMinor, 'statement amount');
      bounded(row.currency, 'statement currency', 12);
      bounded(row.category, 'statement category', 120);
      bounded(row.fingerprint, 'statement candidate fingerprint', 256);
      if (!['expense', 'income', 'transfer', 'refund', 'fee'].includes(row.kind)) throw new RangeError('Statement row kind is not supported.');
      const identity = { ...row.sourceIdentity, accountId, fileSha256 };
      const identityKey = statementSourceIdentityKey(identity);
      if (seenReplayIdentities.has(identityKey)) throw new RangeError('Statement rows repeat a source identity.');
      seenReplayIdentities.add(identityKey);
      replayIdentities.push(identityKey);
      if (!await accountAllowsCurrency(db, context, accountId, row.currency)) throw new RangeError(`Currency ${row.currency} is not approved for this account.`);
      const existing = await existingSource(db, context, identityKey);
      const digest = await contentDigest(row);
      if (!existing || existing.content_digest !== digest) throw sourceConflict(identityKey);
    }
    const existingRows = await db.prepare(`SELECT t.id AS transaction_id
      FROM transaction_source_records r JOIN transactions t ON t.id = r.transaction_id AND t.ledger_id = r.ledger_id
      WHERE r.ledger_id = ? AND r.source_kind = 'statement' AND r.account_id = ? AND r.file_sha256 = ?
      ORDER BY r.row_index, t.id`).bind(context.ledgerId, accountId, fileSha256).all<{ transaction_id: string }>();
    const candidateRows = await db.prepare(`SELECT c.id, c.statement_transaction_id, c.candidate_transaction_id, c.score, c.reason_codes_json, c.status
      FROM statement_reconciliation_candidates c JOIN transaction_source_records r ON r.id = c.source_record_id AND r.ledger_id = c.ledger_id
      WHERE r.ledger_id = ? AND r.account_id = ? AND r.file_sha256 = ?`).bind(context.ledgerId, accountId, fileSha256).all<{ id: string; statement_transaction_id: string; candidate_transaction_id: string; score: number; reason_codes_json: string; status: 'open' | 'accepted' | 'dismissed' }>();
    return {
      importId: replayOperation.id,
      accepted: 0,
      duplicates: input.rows.length,
      needsReview: replayOperation.review_count,
      candidateCount: candidateRows.results.length,
      transactionIds: existingRows.results.map((item) => item.transaction_id),
      duplicateSourceIds: replayIdentities,
      candidates: candidateRows.results.map((item) => ({ id: item.id, statementTransactionId: item.statement_transaction_id, candidateTransactionId: item.candidate_transaction_id, score: item.score, reasonCodes: JSON.parse(item.reason_codes_json) as string[], status: item.status })),
    };
  }

  const seenIdentity = new Set<string>();
  const occupiedIds = new Set<string>();
  const reservedAlertEvents = new Set<string>();
  const reservedStatementTargets = new Set<string>();
  const prepared: Array<{
    row: StatementCommitRow;
    identityKey: string;
    sourceId: string;
    transactionId: string;
    existing: ExistingSource | null;
    contentDigest: string;
    candidates: RankedCandidate[];
    autoMatch: RankedCandidate | null;
    autoLinkId: string | null;
  }> = [];
  let duplicateCount = 0;

  for (const row of input.rows) {
    if (row.accountId !== accountId || row.source !== 'statement') throw new RangeError('Every statement row must use the selected account and statement source.');
    bounded(row.id, 'statement transaction id', 160);
    isoDate(row.date, 'statement date');
    bounded(row.merchant, 'statement merchant', MAX_MERCHANT_LENGTH);
    safeInteger(row.amountMinor, 'statement amount');
    bounded(row.currency, 'statement currency', 12);
    bounded(row.category, 'statement category', 120);
    bounded(row.fingerprint, 'statement candidate fingerprint', 256);
    if (!['expense', 'income', 'transfer', 'refund', 'fee'].includes(row.kind)) throw new RangeError('Statement row kind is not supported.');
    const identity = { ...row.sourceIdentity, accountId, fileSha256 };
    const identityKey = statementSourceIdentityKey(identity);
    if (seenIdentity.has(identityKey)) throw new RangeError('Statement rows repeat a source identity.');
    seenIdentity.add(identityKey);
    if (!await accountAllowsCurrency(db, context, accountId, row.currency)) throw new RangeError(`Currency ${row.currency} is not approved for this account.`);
    const existing = await existingSource(db, context, identityKey);
    const digest = await contentDigest(row);
    if (existing) {
      if (existing.content_digest !== digest) throw sourceConflict(identityKey);
      duplicateCount += 1;
      prepared.push({ row, identityKey, sourceId: existing.source_record_id, transactionId: existing.transaction_id, existing, contentDigest: digest, candidates: [], autoMatch: null, autoLinkId: null });
      continue;
    }
    const id = await statementTransactionIdentifier(db, context, { rawId: row.id, identityKey, rowIndex: row.sourceIdentity.rowIndex, occupied: occupiedIds });
    occupiedIds.add(id);
    const rankedCandidates = await candidateTransactions(db, context, row);
    const strongCandidates = rankedCandidates.filter((candidate) => isStrongAlertCandidate(row, candidate));
    let autoMatch: RankedCandidate | null = null;
    let autoLinkId: string | null = null;
    if (strongCandidates.length === 1) {
      const candidate = strongCandidates[0];
      const eventId = candidate.candidate.event_id;
      if (eventId && !reservedAlertEvents.has(eventId) && !reservedStatementTargets.has(id)) {
        const occupied = await db.prepare(`SELECT id FROM alert_event_links
          WHERE ledger_id = ? AND relation = 'confirms' AND (from_event_id = ? OR to_transaction_id = ?) LIMIT 1`)
          .bind(context.ledgerId, eventId, id).first<{ id: string }>();
        if (!occupied) {
          autoMatch = candidate;
          autoLinkId = `alert-review:${encodeURIComponent(`${eventId}:${id}`)}`;
          reservedAlertEvents.add(eventId);
          reservedStatementTargets.add(id);
        }
      }
    }
    prepared.push({ row, identityKey, sourceId: sourceRecordId(identity), transactionId: id, existing: null, contentDigest: digest, candidates: rankedCandidates, autoMatch, autoLinkId });
  }

  const newRows = prepared.filter((item) => item.existing === null);
  const candidates: StatementCandidate[] = [];
  const statements: D1Statement[] = [];
  for (const item of newRows) {
    const requiresReview = item.row.status === 'needs_review' || item.candidates.length > 0;
    statements.push(db.prepare(`INSERT INTO transactions
      (id, ledger_id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note, fx_lock_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'statement', ?, ?, ?)`)
      .bind(item.transactionId, context.ledgerId, accountId, item.row.date, item.row.merchant, item.row.amountMinor, item.row.currency, item.row.category, item.row.kind, requiresReview ? 'needs_review' : 'confirmed', item.row.fingerprint, item.row.note ?? null, item.row.date));
    const identity = item.row.sourceIdentity;
    statements.push(db.prepare(`INSERT INTO transaction_source_records
      (id, ledger_id, source_kind, identity_key, transaction_id, account_id, bank_source_id, bank_row_id, file_sha256, row_index, bank_reference, content_digest)
      VALUES (?, ?, 'statement', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(item.sourceId, context.ledgerId, item.identityKey, item.transactionId, accountId, identity.bankSourceId ?? null, identity.bankRowId ?? null, fileSha256, identity.rowIndex, item.row.bankReference ?? null, item.contentDigest));
    for (const candidate of item.candidates) {
      const candidateId = statementCandidateId(item.sourceId, candidate.candidate.id);
      const reasons = candidate.reasonCodes;
      candidates.push({ id: candidateId, statementTransactionId: item.transactionId, candidateTransactionId: candidate.candidate.id, score: candidate.score, reasonCodes: reasons, status: 'open' });
      statements.push(db.prepare(`INSERT INTO statement_reconciliation_candidates
        (id, ledger_id, source_record_id, statement_transaction_id, candidate_transaction_id, score, reason_codes_json, evidence_basis, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`)
        .bind(candidateId, context.ledgerId, item.sourceId, item.transactionId, candidate.candidate.id, candidate.score, JSON.stringify(reasons), isStrongAlertCandidate(item.row, candidate) ? 'bank_reference' : 'candidate_rank'));
    }
    if (item.autoMatch && item.autoLinkId && item.autoMatch.candidate.event_id) {
      const eventId = item.autoMatch.candidate.event_id;
      const linkId = item.autoLinkId;
      const linkExists = `(SELECT 1 FROM alert_event_links WHERE id = ? AND ledger_id = ? AND relation = 'confirms')`;
      statements.push(db.prepare(`INSERT INTO alert_event_links
        (id, ledger_id, from_event_id, to_transaction_id, relation, evidence_basis, revision)
        SELECT ?, ?, ?, ?, 'confirms', 'bank_reference', 2
        WHERE NOT EXISTS (SELECT 1 FROM alert_event_links existing
          WHERE existing.ledger_id = ? AND existing.relation = 'confirms'
            AND (existing.from_event_id = ? OR existing.to_transaction_id = ?))`)
        .bind(linkId, context.ledgerId, eventId, item.transactionId, context.ledgerId, eventId, item.transactionId));
      statements.push(db.prepare(`UPDATE alert_projections SET transaction_id = ?, state = 'superseded', reason_codes_json = ?, counted_currency = NULL, counted_amount_minor = NULL, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE event_id = ? AND ledger_id = ? AND state <> 'superseded' AND EXISTS ${linkExists}`)
        .bind(item.transactionId, JSON.stringify(['confirmed_elsewhere']), eventId, context.ledgerId, linkId, context.ledgerId));
      statements.push(db.prepare(`INSERT INTO alert_projection_provenance
        (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
        SELECT ?, ?, p.id, 'statement', ?, 'statement', p.revision
        FROM alert_projections p
        WHERE p.event_id = ? AND p.ledger_id = ? AND EXISTS ${linkExists}`)
        .bind(`${eventId}:statement:${item.sourceId}:2`, context.ledgerId, item.sourceId, eventId, context.ledgerId, linkId, context.ledgerId));
      statements.push(db.prepare(`UPDATE transactions SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ledger_id = ? AND source = 'statement' AND EXISTS ${linkExists}`)
        .bind(item.transactionId, context.ledgerId, linkId, context.ledgerId));
      statements.push(db.prepare(`UPDATE transactions SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ledger_id = ? AND source = 'alert'
          AND EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ? AND annotation.ledger_id = transactions.ledger_id)
          AND EXISTS ${linkExists}`)
        .bind(item.autoMatch.candidate.id, context.ledgerId, item.autoMatch.candidate.id, linkId, context.ledgerId));
      statements.push(db.prepare(`DELETE FROM transactions
        WHERE id = ? AND ledger_id = ? AND source = 'alert'
          AND NOT EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ? AND annotation.ledger_id = transactions.ledger_id)
          AND EXISTS ${linkExists}`)
        .bind(item.autoMatch.candidate.id, context.ledgerId, item.autoMatch.candidate.id, linkId, context.ledgerId));
    }
  }
  statements.push(...statementPublicationStatements(db, context, {
    operationId, accountId, fileSha256, filename, requestedCount:input.rows.length,
    acceptedCount:newRows.length, duplicateCount, publication:input.publication,
  }));
  try {
    await publishStatementBatch(db, context, statements, input.publication);
  } catch (error) {
    if (retryOnUnique && isReconciliationUniqueConflict(error)) return commitStatementRows(db, context, input, false);
    throw error;
  }
  const operation = await db.prepare(`SELECT review_count FROM import_commit_operations WHERE id = ? AND ledger_id = ? LIMIT 1`).bind(operationId, context.ledgerId).first<{ review_count: number }>();
  const committedCandidates = await db.prepare(`SELECT c.id, c.statement_transaction_id, c.candidate_transaction_id, c.score, c.reason_codes_json, c.status
    FROM statement_reconciliation_candidates c JOIN transaction_source_records r ON r.id = c.source_record_id AND r.ledger_id = c.ledger_id
    WHERE r.ledger_id = ? AND r.account_id = ? AND r.file_sha256 = ?`)
    .bind(context.ledgerId, accountId, fileSha256).all<{ id: string; statement_transaction_id: string; candidate_transaction_id: string; score: number; reason_codes_json: string; status: 'open' | 'accepted' | 'dismissed' }>();
  const committedCandidateList = committedCandidates.results.map((item) => ({ id: item.id, statementTransactionId: item.statement_transaction_id, candidateTransactionId: item.candidate_transaction_id, score: item.score, reasonCodes: JSON.parse(item.reason_codes_json) as string[], status: item.status }));
  return {
    importId,
    accepted: newRows.length,
    duplicates: duplicateCount,
    needsReview: operation?.review_count ?? 0,
    candidateCount: committedCandidateList.length,
    transactionIds: newRows.map((item) => item.transactionId),
    duplicateSourceIds: prepared.filter((item) => item.existing !== null).map((item) => item.identityKey),
    candidates: committedCandidateList,
  };
}

export class ReconciliationReviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReconciliationReviewError';
    this.code = code;
  }
}

export interface AlertReviewInput {
  id: string;
  alertEventId: string;
  targetAlertEventId?: string;
  statementTransactionId?: string;
  candidateTransactionId?: string;
  relation?: 'confirms' | 'refund_of' | 'cancels' | 'partially_reverses' | 'possible_duplicate';
  allocatedCurrency?: CurrencyCode | null;
  allocatedAmountMinor?: number | null;
  evidenceBasis: 'bank_reference' | 'user_review';
  revision: number;
}

interface ReviewAlertRow {
  event_id: string;
  ledger_id: string;
  account_id: string | null;
  source_profile_id: string;
  instrument_hint_kind: string | null;
  instrument_hint_value: string | null;
  event_type: string;
  direction: string;
  event_money_currency: string | null;
  event_money_amount_minor: number | null;
  bank_reference: string | null;
}

interface ReviewProjectionRow {
  id: string;
  event_id: string;
  transaction_id: string | null;
  state: string;
  revision: number;
  counted_currency: string | null;
  counted_amount_minor: number | null;
}

interface ReviewSourceRow {
  id: string;
  ledger_id: string;
  source_kind: string;
  account_id: string;
  bank_reference: string | null;
}

interface ReviewLinkRow {
  id: string;
  from_event_id: string;
  to_event_id: string | null;
  to_transaction_id: string | null;
  relation: string;
  allocated_currency: string | null;
  allocated_amount_minor: number | null;
  evidence_basis: string;
  revision: number;
}

function reviewReject(code: string, message: string): never {
  throw new ReconciliationReviewError(code, message);
}

function expectedAlertShape(alert: ReviewAlertRow) {
  const amountMinor = alert.event_money_amount_minor;
  if (!alert.event_money_currency || typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)) return null;
  if (amountMinor <= 0) return null;
  const kind = alert.event_type === 'refund_notice' ? 'refund' : alert.event_type === 'fee_notice' ? 'fee' : 'expense';
  const sign = alert.direction === 'inflow' ? 1 : alert.direction === 'outflow' ? -1 : 0;
  return { kind, sign, currency: alert.event_money_currency, amountMinor };
}

function sameNullable(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

function provenanceBasis(evidenceBasis: AlertReviewInput['evidenceBasis']): 'alert_event' | 'user_review' {
  return evidenceBasis === 'bank_reference' ? 'alert_event' : 'user_review';
}

function equalReviewLink(existing: ReviewLinkRow, input: AlertReviewInput, relation: string) {
  return existing.from_event_id === input.alertEventId &&
    existing.to_event_id === (input.targetAlertEventId ?? null) &&
    existing.to_transaction_id === (input.statementTransactionId ?? null) &&
    existing.relation === relation &&
    existing.allocated_currency === (input.allocatedCurrency ?? null) &&
    existing.allocated_amount_minor === (input.allocatedAmountMinor ?? null) &&
    existing.evidence_basis === input.evidenceBasis &&
    existing.revision === input.revision;
}

async function reviewTargetSource(db: D1Database, transactionId: string) {
  return db.prepare(`SELECT id, ledger_id, source_kind, account_id, bank_reference
    FROM transaction_source_records
    WHERE ledger_id = ? AND transaction_id = ?
    ORDER BY CASE WHEN source_kind = 'statement' THEN 0 ELSE 1 END, id LIMIT 1`)
    .bind(LEDGER_ID, transactionId).first<ReviewSourceRow>();
}

function checkBankReference(evidenceBasis: AlertReviewInput['evidenceBasis'], alert: ReviewAlertRow, source: ReviewSourceRow | null) {
  if (evidenceBasis !== 'bank_reference') return;
  if (!alert.bank_reference?.trim() || !source?.bank_reference?.trim() || alert.bank_reference.trim().toLowerCase() !== source.bank_reference.trim().toLowerCase()) {
    reviewReject('evidence_mismatch', 'Bank-reference evidence requires the same non-empty reference on the alert and statement.');
  }
}

function checkStatementShape(alert: ReviewAlertRow, target: ExistingTransaction, source: ReviewSourceRow | null) {
  const shape = expectedAlertShape(alert);
  if (!shape || !source || source.ledger_id !== LEDGER_ID || source.source_kind !== 'statement') reviewReject('target_scope_mismatch', 'The review target is not a statement in the personal ledger.');
  if (source.account_id !== alert.account_id || target.account_id !== alert.account_id) reviewReject('account_mismatch', 'Alert and statement must belong to the same account.');
  if (target.currency !== shape.currency || target.kind !== shape.kind || Math.sign(target.amount_minor) !== shape.sign || Math.abs(target.amount_minor) !== shape.amountMinor) {
    reviewReject('transaction_mismatch', 'Alert and statement currency, amount, kind, and sign must match exactly.');
  }
}

function checkSameLifecycleScope(left: ReviewAlertRow, right: ReviewAlertRow) {
  if (left.ledger_id !== LEDGER_ID || right.ledger_id !== LEDGER_ID || !left.account_id || left.account_id !== right.account_id) reviewReject('account_mismatch', 'Lifecycle events must share one personal-ledger account.');
  if (left.source_profile_id !== right.source_profile_id || !sameNullable(left.instrument_hint_kind, right.instrument_hint_kind) || !sameNullable(left.instrument_hint_value, right.instrument_hint_value)) reviewReject('instrument_mismatch', 'Lifecycle events must share the same source instrument.');
  if (!left.event_money_currency || left.event_money_currency !== right.event_money_currency) reviewReject('currency_mismatch', 'Lifecycle events must share one currency.');
}

function validateAllocation(input: AlertReviewInput, required: boolean) {
  const hasCurrency = input.allocatedCurrency !== undefined && input.allocatedCurrency !== null;
  const hasAmount = input.allocatedAmountMinor !== undefined && input.allocatedAmountMinor !== null;
  if (hasCurrency !== hasAmount) reviewReject('invalid_allocation', 'Allocation currency and amount must be supplied together.');
  if (required && (!hasCurrency || !hasAmount)) reviewReject('invalid_allocation', 'This lifecycle relation requires an allocation.');
  if (hasAmount && (!Number.isSafeInteger(input.allocatedAmountMinor) || (input.allocatedAmountMinor as number) <= 0)) reviewReject('invalid_allocation', 'Allocated review money must be a positive safe integer.');
  return hasAmount ? input.allocatedAmountMinor as number : null;
}

/**
 * Applies an explicit review decision without mutating immutable evidence.
 * All link, projection, arithmetic, provenance, and candidate changes share
 * one D1 batch so a review never exposes half a match.
 */
export async function applyAlertReview(db: D1Database, input: AlertReviewInput) {
  const relation = input.relation ?? 'confirms';
  if (!input.id || !input.alertEventId || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new RangeError('A review link needs an event and positive revision.');
  if (!['confirms', 'refund_of', 'cancels', 'partially_reverses', 'possible_duplicate'].includes(relation)) throw new RangeError('Unsupported review relation.');
  if (input.targetAlertEventId && (input.statementTransactionId || input.candidateTransactionId)) throw new RangeError('A review cannot target both an alert event and a transaction.');
  if (!input.targetAlertEventId && !input.statementTransactionId) throw new RangeError('A review needs a target alert event or statement transaction.');
  if (input.candidateTransactionId && !input.statementTransactionId) throw new RangeError('A candidate review must include its statement transaction.');
  if (relation === 'cancels' || relation === 'partially_reverses') {
    if (!input.targetAlertEventId) throw new RangeError('Lifecycle relations require an alert-event target.');
  } else if (input.targetAlertEventId) {
    throw new RangeError('Only cancellation relations may target another alert event.');
  }
  if (input.evidenceBasis !== 'bank_reference' && input.evidenceBasis !== 'user_review') throw new RangeError('Review evidence is invalid.');
  const allocation = validateAllocation(input, relation === 'cancels' || relation === 'partially_reverses' || relation === 'refund_of');
  if (relation === 'confirms' || relation === 'possible_duplicate') {
    if (allocation !== null) reviewReject('invalid_allocation', 'Confirmation and duplicate links cannot allocate money.');
  }

  const existingLink = await db.prepare(`SELECT id, from_event_id, to_event_id, to_transaction_id, relation, allocated_currency,
      allocated_amount_minor, evidence_basis, revision
    FROM alert_event_links WHERE id = ? LIMIT 1`).bind(input.id).first<ReviewLinkRow>();
  if (existingLink) {
    if (!equalReviewLink(existingLink, input, relation)) throw new ReconciliationConflictError('review_conflict', 'The review ID is already bound to different content.');
    return { alertEventId: input.alertEventId, targetAlertEventId: input.targetAlertEventId ?? null, transactionId: input.statementTransactionId ?? null, relation, replayed: true, projectionSuperseded: relation === 'confirms' };
  }

  const alert = await db.prepare(`SELECT event_id, ledger_id, account_id, source_profile_id, instrument_hint_kind, instrument_hint_value,
      event_type, direction, event_money_currency, event_money_amount_minor, bank_reference
    FROM alert_events WHERE event_id = ? LIMIT 1`).bind(input.alertEventId).first<ReviewAlertRow>();
  if (!alert || alert.ledger_id !== LEDGER_ID || !alert.account_id) reviewReject('alert_scope_mismatch', 'The source alert is not in the personal ledger account scope.');
  const projection = await db.prepare(`SELECT id, event_id, transaction_id, state, revision, counted_currency, counted_amount_minor
    FROM alert_projections WHERE event_id = ? LIMIT 1`).bind(input.alertEventId).first<ReviewProjectionRow>();
  if (!projection) reviewReject('projection_missing', 'The source alert has no durable projection.');
  if (input.revision <= projection.revision) reviewReject('stale_revision', 'The review revision must advance the alert projection.');

  const statements: D1Statement[] = [];
  let targetTransaction: ExistingTransaction | null = null;
  let targetSource: ReviewSourceRow | null = null;
  let targetProjection: ReviewProjectionRow | null = null;
  let targetAlert: ReviewAlertRow | null = null;

  if (input.targetAlertEventId) {
    if (input.targetAlertEventId === input.alertEventId) reviewReject('invalid_target', 'An alert cannot be linked to itself.');
    targetAlert = await db.prepare(`SELECT event_id, ledger_id, account_id, source_profile_id, instrument_hint_kind, instrument_hint_value,
        event_type, direction, event_money_currency, event_money_amount_minor, bank_reference
      FROM alert_events WHERE event_id = ? LIMIT 1`).bind(input.targetAlertEventId).first<ReviewAlertRow>();
    targetProjection = await db.prepare(`SELECT id, event_id, transaction_id, state, revision, counted_currency, counted_amount_minor
      FROM alert_projections WHERE event_id = ? LIMIT 1`).bind(input.targetAlertEventId).first<ReviewProjectionRow>();
    if (!targetAlert || !targetProjection) reviewReject('target_missing', 'The lifecycle target alert or projection does not exist.');
    checkSameLifecycleScope(alert, targetAlert);
    if (alert.event_type !== 'authorization_reversal' || alert.direction !== 'none' || targetAlert.event_type !== 'purchase_notice' || targetAlert.direction !== 'outflow') {
      reviewReject('invalid_cancellation', 'Only an authorization reversal may cancel a purchase notice.');
    }
    const sourceShape = expectedAlertShape(alert);
    const targetShape = expectedAlertShape(targetAlert);
    if (!sourceShape || !targetShape || sourceShape.currency !== targetShape.currency || sourceShape.sign !== 0 || targetShape.sign !== -1) {
      reviewReject('invalid_cancellation', 'Lifecycle event money is not a supported cancellation shape.');
    }
    if (input.evidenceBasis === 'bank_reference' && (!alert.bank_reference?.trim() || !targetAlert.bank_reference?.trim() || alert.bank_reference.trim().toLowerCase() !== targetAlert.bank_reference.trim().toLowerCase())) {
      reviewReject('evidence_mismatch', 'Bank-reference lifecycle evidence requires the same non-empty reference on both events.');
    }
    if (allocation === null || input.allocatedCurrency !== alert.event_money_currency || input.allocatedCurrency !== targetAlert.event_money_currency) reviewReject('currency_mismatch', 'Cancellation allocation must match both lifecycle events.');
    if (allocation > (alert.event_money_amount_minor ?? 0) || allocation > (targetAlert.event_money_amount_minor ?? 0)) reviewReject('allocation_exceeds_event', 'Cancellation allocation exceeds an event amount.');
    if (relation === 'cancels' && allocation !== targetAlert.event_money_amount_minor) reviewReject('invalid_cancellation', 'A full cancellation must allocate the entire purchase amount.');
    if (targetProjection.revision >= input.revision) reviewReject('stale_revision', 'The target projection revision is not behind this review.');
    const targetTransactionId = targetProjection.transaction_id;
    if (!targetTransactionId) reviewReject('target_missing', 'The lifecycle target has no alert transaction to adjust.');
    targetTransaction = await db.prepare(`SELECT id, account_id, currency, amount_minor, kind, status, source
      FROM transactions WHERE id = ? LIMIT 1`).bind(targetTransactionId).first<ExistingTransaction>();
    if (!targetTransaction || targetTransaction.source !== 'alert' || targetTransaction.account_id !== alert.account_id || targetTransaction.currency !== alert.event_money_currency || targetTransaction.kind !== 'expense' || Math.sign(targetTransaction.amount_minor) !== -1) reviewReject('transaction_mismatch', 'The lifecycle target transaction is outside the alert shape.');
    const priorFrom = await db.prepare(`SELECT COALESCE(SUM(allocated_amount_minor), 0) AS amount, COUNT(*) AS count
      FROM alert_event_links WHERE ledger_id = ? AND from_event_id = ? AND relation IN ('cancels', 'partially_reverses')`).bind(LEDGER_ID, input.alertEventId).first<{ amount: number; count: number }>();
    if ((priorFrom?.count ?? 0) > 0) reviewReject('duplicate_allocation', 'An authorization reversal may have only one durable allocation.');
    const priorTarget = await db.prepare(`SELECT COALESCE(SUM(allocated_amount_minor), 0) AS amount
      FROM alert_event_links WHERE ledger_id = ? AND to_event_id = ? AND relation IN ('cancels', 'partially_reverses')`).bind(LEDGER_ID, input.targetAlertEventId).first<{ amount: number }>();
    const previousAllocation = priorTarget?.amount ?? 0;
    const targetAmount = targetAlert.event_money_amount_minor ?? 0;
    if (previousAllocation + allocation > targetAmount) reviewReject('allocation_exceeds_event', 'Lifecycle allocations cannot exceed the purchase amount.');
    const remaining = targetAmount - previousAllocation - allocation;
    if (Math.abs(targetTransaction.amount_minor) !== targetAmount - previousAllocation) reviewReject('arithmetic_conflict', 'The stored alert transaction does not match prior lifecycle allocations.');
    statements.push(db.prepare(`INSERT INTO alert_event_links
      (id, ledger_id, from_event_id, to_event_id, relation, allocated_currency, allocated_amount_minor, evidence_basis, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.id, LEDGER_ID, input.alertEventId, input.targetAlertEventId, relation, input.allocatedCurrency, allocation, input.evidenceBasis, input.revision));
    statements.push(db.prepare(`UPDATE transactions SET amount_minor = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND source = 'alert' AND account_id = ?`).bind(remaining === 0 ? 0 : -remaining, targetTransaction.id, alert.account_id));
    if (remaining === 0) {
      statements.push(db.prepare(`UPDATE transactions SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND source = 'alert' AND account_id = ?`).bind(targetTransaction.id, alert.account_id));
      statements.push(db.prepare(`UPDATE alert_projections SET state = 'voided', transaction_id = CASE WHEN EXISTS (SELECT 1 FROM annotation_revisions WHERE transaction_id = ?) THEN transaction_id ELSE NULL END,
          reason_codes_json = ?, counted_currency = NULL, counted_amount_minor = NULL, revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision < ?`).bind(targetTransaction.id, JSON.stringify(['cancelled']), input.revision, targetProjection.id, input.revision));
      statements.push(db.prepare(`DELETE FROM transactions
        WHERE id = ? AND source = 'alert'
          AND NOT EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ?)
          AND NOT EXISTS (SELECT 1 FROM alert_projections other WHERE other.transaction_id = ?)
          AND NOT EXISTS (SELECT 1 FROM alert_event_links existing WHERE existing.to_transaction_id = ?)`)
        .bind(targetTransaction.id, targetTransaction.id, targetTransaction.id, targetTransaction.id));
    } else {
      statements.push(db.prepare(`UPDATE alert_projections SET state = 'provisional', reason_codes_json = ?, counted_currency = ?, counted_amount_minor = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision < ?`).bind(JSON.stringify([]), targetAlert.event_money_currency, remaining, input.revision, targetProjection.id, input.revision));
    }
    statements.push(db.prepare(`INSERT INTO alert_projection_provenance
      (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      VALUES (?, ?, ?, 'alert', ?, ?, ?)`)
      .bind(`${targetProjection.id}:lifecycle:${input.alertEventId}:${input.revision}`, LEDGER_ID, targetProjection.id, input.alertEventId, provenanceBasis(input.evidenceBasis), input.revision));
    statements.push(db.prepare(`UPDATE alert_projections SET state = 'non_spending', reason_codes_json = ?, counted_currency = NULL, counted_amount_minor = NULL, revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revision < ?`).bind(JSON.stringify(['non_spending_event']), input.revision, projection.id, input.revision));
    statements.push(db.prepare(`INSERT INTO alert_projection_provenance
      (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      VALUES (?, ?, ?, 'review', ?, ?, ?)`)
      .bind(`${projection.id}:lifecycle:${input.id}:${input.revision}`, LEDGER_ID, projection.id, input.id, provenanceBasis(input.evidenceBasis), input.revision));
    await db.batch(statements);
    return { alertEventId: input.alertEventId, targetAlertEventId: input.targetAlertEventId, transactionId: targetTransaction.id, relation, replayed: false, projectionSuperseded: false, remainingAmountMinor: remaining };
  }

  targetTransaction = await db.prepare(`SELECT id, account_id, currency, amount_minor, kind, status, source
    FROM transactions WHERE id = ? LIMIT 1`).bind(input.statementTransactionId).first<ExistingTransaction>();
  targetSource = targetTransaction ? await reviewTargetSource(db, targetTransaction.id) : null;
  if (!targetTransaction) reviewReject('target_missing', 'The statement target transaction does not exist.');
  if (targetTransaction.account_id !== alert.account_id || targetSource?.ledger_id !== LEDGER_ID) reviewReject('account_mismatch', 'Alert and statement must share the personal-ledger account.');
  if (relation === 'confirms' || relation === 'possible_duplicate' || relation === 'refund_of') {
    if (relation === 'refund_of') {
      if (alert.event_type !== 'refund_notice' || alert.direction !== 'inflow' || targetTransaction.source !== 'statement' || !targetSource || !alert.event_money_currency || targetTransaction.currency !== alert.event_money_currency || targetTransaction.kind === 'refund' || targetTransaction.amount_minor >= 0 || allocation === null || allocation > Math.abs(targetTransaction.amount_minor) || allocation !== alert.event_money_amount_minor) reviewReject('transaction_mismatch', 'A refund review requires a positive refund allocated to a matching statement outflow.');
      if (input.allocatedCurrency !== alert.event_money_currency) reviewReject('currency_mismatch', 'Refund allocation currency must match the alert.');
    } else {
      if (targetTransaction.source !== 'statement') reviewReject('target_scope_mismatch', 'This relation must target a statement transaction.');
      checkStatementShape(alert, targetTransaction, targetSource);
      if (relation === 'confirms' && targetTransaction.status !== 'confirmed' && targetTransaction.status !== 'needs_review') reviewReject('target_state_mismatch', 'A confirmation must target a durable statement transaction.');
    }
    checkBankReference(input.evidenceBasis, alert, targetSource);
  } else {
    reviewReject('unsupported_relation', 'This relation is not supported for statement targets.');
  }
  if (input.statementTransactionId && input.candidateTransactionId) {
    const candidate = await db.prepare(`SELECT id FROM statement_reconciliation_candidates
      WHERE ledger_id = ? AND statement_transaction_id = ? AND candidate_transaction_id = ? AND status = 'open' LIMIT 1`)
      .bind(LEDGER_ID, input.statementTransactionId, input.candidateTransactionId).first<{ id: string }>();
    const candidateTransaction = await db.prepare(`SELECT id, account_id, currency, amount_minor, kind, status, source
      FROM transactions WHERE id = ? LIMIT 1`).bind(input.candidateTransactionId).first<ExistingTransaction>();
    const shape = expectedAlertShape(alert);
    if (!candidateTransaction || candidateTransaction.account_id !== alert.account_id || candidateTransaction.source !== 'alert' || !shape || candidateTransaction.currency !== shape.currency || candidateTransaction.kind !== shape.kind || Math.sign(candidateTransaction.amount_minor) !== shape.sign || Math.abs(candidateTransaction.amount_minor) !== shape.amountMinor) {
      reviewReject('candidate_mismatch', 'The selected alert candidate does not match the source alert.');
    }
    if (candidate) statements.push(db.prepare(`UPDATE statement_reconciliation_candidates SET status = 'accepted', evidence_basis = 'user_review', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'`).bind(candidate.id));
  }
  statements.push(db.prepare(`INSERT INTO alert_event_links
    (id, ledger_id, from_event_id, to_transaction_id, relation, allocated_currency, allocated_amount_minor, evidence_basis, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, LEDGER_ID, input.alertEventId, targetTransaction.id, relation, input.allocatedCurrency ?? null, allocation, input.evidenceBasis, input.revision));
  statements.push(db.prepare(`INSERT INTO alert_projection_provenance
    (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
    VALUES (?, ?, ?, 'review', ?, ?, ?)`)
    .bind(`${projection.id}:review:${input.id}:${input.revision}`, LEDGER_ID, projection.id, input.id, provenanceBasis(input.evidenceBasis), input.revision));
  if (relation === 'confirms') {
    statements.push(db.prepare(`UPDATE alert_projections SET state = 'superseded', transaction_id = ?, reason_codes_json = ?, counted_currency = NULL, counted_amount_minor = NULL, revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revision < ?`).bind(targetTransaction.id, JSON.stringify(['confirmed_elsewhere']), input.revision, projection.id, input.revision));
    statements.push(db.prepare(`UPDATE transactions SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND source = 'statement' AND status IN ('needs_review', 'provisional')`).bind(targetTransaction.id));
    if (targetSource) statements.push(db.prepare(`INSERT INTO alert_projection_provenance
      (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      VALUES (?, ?, ?, 'statement', ?, 'statement', ?)`)
      .bind(`${projection.id}:statement:${targetSource.id}:${input.revision}`, LEDGER_ID, projection.id, targetSource.id, input.revision));
    const priorAlertTransactionId = projection.transaction_id;
    if (priorAlertTransactionId && priorAlertTransactionId !== targetTransaction.id) {
      statements.push(db.prepare(`UPDATE transactions SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND source = 'alert'
          AND EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ?)`)
        .bind(priorAlertTransactionId, priorAlertTransactionId));
      statements.push(db.prepare(`DELETE FROM transactions
        WHERE id = ? AND source = 'alert'
          AND NOT EXISTS (SELECT 1 FROM annotation_revisions annotation WHERE annotation.transaction_id = ?)
          AND NOT EXISTS (SELECT 1 FROM alert_projections other WHERE other.transaction_id = ? AND other.id <> ?)
          AND NOT EXISTS (SELECT 1 FROM alert_event_links existing WHERE existing.to_transaction_id = ?)
          AND EXISTS (SELECT 1 FROM alert_event_links confirmed WHERE confirmed.id = ? AND confirmed.relation = 'confirms')`)
        .bind(priorAlertTransactionId, priorAlertTransactionId, priorAlertTransactionId, projection.id, priorAlertTransactionId, input.id));
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (isReconciliationUniqueConflict(error)) {
      if (relation === 'confirms') reviewReject('target_already_confirmed', 'The alert or statement already has a durable confirmation. Review the existing link before retrying.');
      throw new ReconciliationConflictError('review_conflict', 'The review link conflicts with another durable review.');
    }
    throw error;
  }
  return { alertEventId: input.alertEventId, transactionId: targetTransaction.id, relation, replayed: false, projectionSuperseded: relation === 'confirms' };
}
