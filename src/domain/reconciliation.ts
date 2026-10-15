import type { CurrencyCode } from './currencies';
import type {
  StatementSourceIdentity,
  Transaction,
  TransactionKind,
  TransactionSource,
  TransactionStatus,
} from './types';

export type { StatementSourceIdentity } from './types';

const MAX_IDENTITY_ROW_INDEX = 1_000_000;

function bounded(value: string, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value.trim();
}

function optionalBounded(value: string | null | undefined, field: string, max: number): string | null {
  if (value === null || value === undefined || value.trim().length === 0) return null;
  return bounded(value, field, max);
}

/**
 * Returns the stable source-record key used by statement persistence.
 *
 * The file hash and row index are always retained as provenance. If a bank
 * supplies both a source and row ID, that pair is the replay identity and is
 * intentionally independent of the row's amount, date, or merchant.
 */
export function statementSourceIdentityKey(identity: StatementSourceIdentity): string {
  const accountId = bounded(identity.accountId, 'statement account id', 128);
  const fileSha256 = bounded(identity.fileSha256, 'statement file hash', 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fileSha256)) throw new RangeError('Statement file hash must be a SHA-256 hex digest.');
  if (!Number.isInteger(identity.rowIndex) || identity.rowIndex < 0 || identity.rowIndex > MAX_IDENTITY_ROW_INDEX) {
    throw new RangeError('Statement row index is not valid.');
  }

  const bankSourceId = optionalBounded(identity.bankSourceId, 'bank source ID', 256);
  const bankRowId = optionalBounded(identity.bankRowId, 'bank row ID', 256);
  if ((bankSourceId && !bankRowId) || (!bankSourceId && bankRowId)) throw new RangeError('Bank source and row IDs must be supplied together.');

  return bankSourceId && bankRowId
    ? `statement:${accountId}:${bankSourceId}:${bankRowId}`
    : `statement:${accountId}:${fileSha256}:${identity.rowIndex}`;
}

export interface StatementCandidateRecord {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  readonly merchant: string;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly kind: TransactionKind;
  readonly status?: TransactionStatus;
  readonly source?: TransactionSource;
  readonly bankReference?: string | null;
  readonly sourceIdentity?: StatementSourceIdentity;
}

export type StatementCandidateReasonCode =
  | 'same_account'
  | 'same_currency'
  | 'same_amount'
  | 'same_kind'
  | 'same_date'
  | 'nearby_date'
  | 'merchant_match'
  | 'bank_reference';

export interface StatementCandidateResult<T extends StatementCandidateRecord = StatementCandidateRecord> {
  readonly candidate: T;
  readonly candidateTransactionId: string;
  readonly score: number;
  readonly reasonCodes: StatementCandidateReasonCode[];
}

export type StatementCandidate<T extends StatementCandidateRecord = StatementCandidateRecord> = StatementCandidateResult<T>;

export interface StatementCandidateRankingOptions {
  readonly maxCandidates?: number;
  readonly maxDateDistanceDays?: number;
}

function normalizeMerchant(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizeReference(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized ? normalized : null;
}

function dateDistanceDays(left: string, right: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return null;
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function sameSourceIdentity(left: StatementCandidateRecord, right: StatementCandidateRecord): boolean {
  if (!left.sourceIdentity || !right.sourceIdentity) return false;
  try {
    return statementSourceIdentityKey(left.sourceIdentity) === statementSourceIdentityKey(right.sourceIdentity);
  } catch {
    return false;
  }
}

function rankCandidate<T extends StatementCandidateRecord>(statement: StatementCandidateRecord, candidate: T, maxDateDistanceDays: number): StatementCandidateResult<T> | null {
  // Transaction IDs are not source identities: an older parser or an import
  // preview may propose the same local ID for rows from different files.
  if (candidate === statement || sameSourceIdentity(statement, candidate)) return null;
  if (candidate.accountId !== statement.accountId || candidate.currency !== statement.currency || candidate.amountMinor !== statement.amountMinor || candidate.kind !== statement.kind) return null;

  const days = dateDistanceDays(statement.date, candidate.date);
  if (days === null || days > maxDateDistanceDays) return null;

  const statementMerchant = normalizeMerchant(statement.merchant);
  const candidateMerchant = normalizeMerchant(candidate.merchant);
  const merchantMatch = Boolean(statementMerchant && candidateMerchant && (
    statementMerchant === candidateMerchant || statementMerchant.includes(candidateMerchant) || candidateMerchant.includes(statementMerchant)
  ));
  const referenceMatch = Boolean(normalizeReference(statement.bankReference) && normalizeReference(statement.bankReference) === normalizeReference(candidate.bankReference));
  if (!merchantMatch && !referenceMatch && days > 0) return null;

  const reasonCodes: StatementCandidateReasonCode[] = ['same_account', 'same_currency', 'same_amount', 'same_kind'];
  if (days === 0) reasonCodes.push('same_date');
  else reasonCodes.push('nearby_date');
  if (merchantMatch) reasonCodes.push('merchant_match');
  if (referenceMatch) reasonCodes.push('bank_reference');

  const score = referenceMatch ? 100 : merchantMatch ? (days === 0 ? 95 : 80) : 70;
  return { candidate, candidateTransactionId: candidate.id, score, reasonCodes };
}

/**
 * Ranks possible matches without treating a candidate fingerprint as an
 * identity. Equal purchases consequently remain separate, and a caller must
 * explicitly accept any returned candidate before linking records.
 */
export function rankStatementCandidates<T extends StatementCandidateRecord>(
  statement: StatementCandidateRecord,
  candidates: readonly T[],
  options: StatementCandidateRankingOptions = {},
): StatementCandidateResult<T>[] {
  const maxDateDistanceDays = options.maxDateDistanceDays ?? 3;
  const maxCandidates = options.maxCandidates ?? 5;
  if (!Number.isInteger(maxDateDistanceDays) || maxDateDistanceDays < 0) throw new RangeError('Candidate date distance is not valid.');
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new RangeError('Candidate limit is not valid.');

  return candidates
    .map((candidate) => rankCandidate(statement, candidate, maxDateDistanceDays))
    .filter((candidate): candidate is StatementCandidateResult<T> => candidate !== null)
    .sort((left, right) => right.score - left.score || left.candidateTransactionId.localeCompare(right.candidateTransactionId))
    .slice(0, maxCandidates);
}

export function findBankReferenceMatches<T extends StatementCandidateRecord>(statement: StatementCandidateRecord, candidates: readonly T[]): T[] {
  const reference = normalizeReference(statement.bankReference);
  if (!reference) return [];
  return candidates.filter((candidate) => (
    candidate.accountId === statement.accountId &&
    candidate.currency === statement.currency &&
    normalizeReference(candidate.bankReference) === reference
  ));
}

export interface StatementAlertMatch<T extends StatementCandidateRecord = StatementCandidateRecord> {
  readonly alert: T;
  readonly alertId: string;
  readonly basis: 'bank_reference' | 'candidate_rank';
  readonly score: number;
  readonly reasonCodes: StatementCandidateReasonCode[];
}

/**
 * Returns an unambiguous alert match. Ambiguous equal candidates deliberately
 * return null so review, rather than amount-based selection, owns the link.
 */
export function matchStatementToAlert<T extends StatementCandidateRecord>(
  statement: StatementCandidateRecord,
  alerts: readonly T[],
): StatementAlertMatch<T> | null {
  const ranked = rankStatementCandidates(statement, alerts);
  const references = ranked.filter((candidate) => candidate.reasonCodes.includes('bank_reference'));
  if (references.length === 1) {
    return { alert: references[0].candidate, alertId: references[0].candidateTransactionId, basis: 'bank_reference', score: references[0].score, reasonCodes: references[0].reasonCodes };
  }
  if (references.length > 1) return null;
  if (ranked.length !== 1 || ranked[0].score < 95) return null;
  return { alert: ranked[0].candidate, alertId: ranked[0].candidateTransactionId, basis: 'candidate_rank', score: ranked[0].score, reasonCodes: ranked[0].reasonCodes };
}

export interface StatementImportReconciliationResult {
  readonly transactions: Transaction[];
  readonly duplicates: Transaction[];
  readonly duplicateSourceKeys: string[];
  readonly candidates: Array<StatementCandidateResult & { statementTransactionId: string }>;
}

/**
 * Applies source-identity replay handling and weak-overlap review state to a
 * statement batch. It never removes an existing transaction by fingerprint.
 */
export function reconcileStatementImport(
  existing: readonly Transaction[],
  imported: readonly Transaction[],
): StatementImportReconciliationResult {
  const existingKeys = new Set<string>();
  for (const transaction of existing) {
    if (!transaction.sourceIdentity) continue;
    try {
      existingKeys.add(statementSourceIdentityKey(transaction.sourceIdentity));
    } catch {
      // Invalid historical identity cannot safely act as a replay key.
    }
  }

  const seenKeys = new Set<string>();
  const transactions: Transaction[] = [];
  const duplicates: Transaction[] = [];
  const candidates: Array<StatementCandidateResult & { statementTransactionId: string }> = [];
  const candidatePool = [...existing];
  const duplicateSourceKeys: string[] = [];

  for (const transaction of imported) {
    let sourceKey: string | null = null;
    if (transaction.sourceIdentity) {
      sourceKey = statementSourceIdentityKey(transaction.sourceIdentity);
      if (seenKeys.has(sourceKey) || existingKeys.has(sourceKey)) {
        duplicates.push(transaction);
        if (!duplicateSourceKeys.includes(sourceKey)) duplicateSourceKeys.push(sourceKey);
        seenKeys.add(sourceKey);
        continue;
      }
      seenKeys.add(sourceKey);
    }

    const ranked = transaction.source === 'statement'
      ? rankStatementCandidates(transaction, candidatePool)
      : [];
    const next = ranked.length > 0 && transaction.status !== 'needs_review'
      ? { ...transaction, status: 'needs_review' as const }
      : transaction;
    transactions.push(next);
    for (const candidate of ranked) candidates.push({ ...candidate, statementTransactionId: transaction.id });
  }

  return { transactions, duplicates, duplicateSourceKeys, candidates };
}

export type LifecycleProjectionState = 'provisional' | 'confirmed' | 'voided' | 'needs_review';
export type LifecycleReasonCode =
  | 'orphan_reversal'
  | 'target_not_found'
  | 'cross_account'
  | 'cross_instrument'
  | 'cross_currency'
  | 'invalid_allocation'
  | 'over_allocation'
  | 'confirmed_without_bank_reference'
  | 'cancelled';

export interface LifecyclePurchase {
  readonly id: string;
  readonly accountId: string;
  readonly instrumentId?: string | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
  readonly status: 'provisional' | 'confirmed';
}

export interface LifecycleReversal {
  readonly id: string;
  readonly accountId: string;
  readonly instrumentId?: string | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
}

export interface LifecycleAllocation {
  readonly reversalId: string;
  readonly purchaseId: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
  readonly evidenceBasis: 'bank_reference' | 'user_review';
}

export interface LifecycleAllocationResult {
  readonly state: LifecycleProjectionState;
  readonly remainingMinor: number | null;
  readonly reasonCodes: LifecycleReasonCode[];
}

function review(reason: LifecycleReasonCode): LifecycleAllocationResult {
  return { state: 'needs_review', remainingMinor: null, reasonCodes: [reason] };
}

/**
 * Applies explicit reversal allocations independent of arrival order. Links
 * are scoped to the named purchase; amount equality alone never chooses a
 * target, and every invalid allocation remains reviewable without a negative
 * spending projection.
 */
export function applyLifecycleAllocations(
  purchase: LifecyclePurchase,
  reversals: readonly LifecycleReversal[],
  allocations: readonly LifecycleAllocation[],
): LifecycleAllocationResult {
  if (!Number.isSafeInteger(purchase.amountMinor) || purchase.amountMinor <= 0) return review('invalid_allocation');
  if (allocations.length === 0) return { state: purchase.status, remainingMinor: purchase.amountMinor, reasonCodes: [] };

  const reversalById = new Map(reversals.map((reversal) => [reversal.id, reversal]));
  const seenReversals = new Set<string>();
  let allocated = 0;

  for (const allocation of allocations) {
    if (allocation.purchaseId !== purchase.id) return review('target_not_found');
    const reversal = reversalById.get(allocation.reversalId);
    if (!reversal) return review('orphan_reversal');
    if (seenReversals.has(reversal.id)) return review('invalid_allocation');
    seenReversals.add(reversal.id);
    if (reversal.accountId !== purchase.accountId) return review('cross_account');
    if (purchase.instrumentId && purchase.instrumentId !== reversal.instrumentId) return review('cross_instrument');
    if (purchase.currency !== reversal.currency || allocation.currency !== purchase.currency) return review('cross_currency');
    if (!Number.isSafeInteger(reversal.amountMinor) || reversal.amountMinor <= 0 || !Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor <= 0) return review('invalid_allocation');
    if (allocation.amountMinor > reversal.amountMinor) return review('invalid_allocation');
    if (purchase.status === 'confirmed' && allocation.evidenceBasis !== 'bank_reference') return review('confirmed_without_bank_reference');
    allocated += allocation.amountMinor;
    if (!Number.isSafeInteger(allocated)) return review('over_allocation');
    if (allocated > purchase.amountMinor) return review('over_allocation');
  }

  const remainingMinor = purchase.amountMinor - allocated;
  if (remainingMinor === 0) return { state: 'voided', remainingMinor: 0, reasonCodes: ['cancelled'] };
  return { state: purchase.status, remainingMinor, reasonCodes: [] };
}
