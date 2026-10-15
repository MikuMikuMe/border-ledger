import type {
  RecurringClassification,
  RecurringDetailPage,
  RecurringPage,
  RecurringStream,
  RecurringSummary,
} from '../src/domain/recurring';
import {
  readRecurringDetail,
  readRecurringPage,
  readRecurringSummary,
  updateRecurringClassification,
} from './recurring-store';
import {
  validateRecurringClassification,
  validateRecurringListQuery,
  validateRecurringSummaryQuery,
} from './validation';
import type { D1Database } from './db-types';

const DEFAULT_LIMIT = 50;

export class RecurringServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly currentRevision?: number;

  constructor(code: string, message: string, status = 400, retryable = false, currentRevision?: number) {
    super(message);
    this.name = 'RecurringServiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.currentRevision = currentRevision;
  }
}

function invalid(message: string): never {
  throw new RecurringServiceError('invalid_request', message, 400);
}

function todayInLedgerZone() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
}

function streamDto(stream: RecurringStream) {
  return {
    id: stream.id,
    accountId: stream.accountId,
    currency: stream.currency,
    merchantName: stream.merchantName,
    merchantEntityId: stream.merchantEntityId,
    frequency: stream.frequency,
    sourceFrequency: stream.sourceFrequency,
    classification: stream.classification ?? 'unclassified',
    sourceStatus: stream.sourceStatus,
    isOutflow: stream.isOutflow,
    firstDate: stream.firstDate,
    lastDate: stream.lastDate,
    averageAmountMinor: stream.averageAmountMinor,
    lastAmountMinor: stream.lastAmountMinor,
    predictedAmountMinor: stream.predictedAmountMinor,
    predictedNextDate: stream.predictedNextDate,
    sourceUpdatedAt: stream.sourceUpdatedAt,
    revision: stream.revision ?? 0,
  };
}

function membershipDto(membership: RecurringDetailPage['history'][number]) {
  return {
    providerTransactionId: membership.providerTransactionId,
    pendingProviderTransactionId: membership.pendingProviderTransactionId,
    date: membership.date,
    amountMinor: membership.amountMinor,
    currency: membership.currency,
    status: membership.status ?? 'posted',
    kind: membership.kind ?? 'expense',
  };
}

export async function readMobileRecurringPage(db: D1Database, params: URLSearchParams) {
  const query = validateRecurringListQuery(params);
  if ('error' in query) invalid(query.error);
  const page = await readRecurringPage(db, query);
  return {
    items: page.streams.map(streamDto),
    page: { nextCursor: page.nextCursor, limit: query.limit ?? DEFAULT_LIMIT },
    state: page.state,
    checkedAt: page.checkedAt,
    sourceUpdatedAt: page.sourceUpdatedAt,
    lastError: page.lastError,
    coverageWarnings: page.coverageWarnings,
  };
}

export async function readMobileRecurringSummary(db: D1Database, params: URLSearchParams) {
  const queryParams = new URLSearchParams(params);
  // The date used for upcoming analysis is server-owned; clients cannot move
  // the forecast window by submitting a different "today" value.
  if (queryParams.has('startDate')) queryParams.set('start', queryParams.get('startDate')!);
  if (queryParams.has('endDate')) queryParams.set('end', queryParams.get('endDate')!);
  queryParams.set('today', todayInLedgerZone());
  const query = validateRecurringSummaryQuery(queryParams);
  if ('error' in query) invalid(query.error);
  const summary = await readRecurringSummary(db, query);
  return {
    ...summary,
    upcoming: summary.upcoming.map((stream) => ({ ...streamDto(stream), nextExpectedAmountMinor: stream.nextExpectedAmountMinor })),
    latestPaymentChanges: summary.latestPaymentChanges.map(streamDto),
  };
}

export async function readMobileRecurringDetail(db: D1Database, id: string, params: URLSearchParams) {
  if (!id || id.length > 128) invalid('The recurring stream id is not valid.');
  const query = validateRecurringListQuery(params);
  if ('error' in query) invalid(query.error);
  const detail = await readRecurringDetail(db, id, query.cursor, query.limit);
  if (!detail) throw new RecurringServiceError('not_found', 'Recurring stream not found.', 404);
  return {
    stream: streamDto(detail.stream),
    history: detail.history.map(membershipDto),
    page: { nextCursor: detail.nextCursor, limit: query.limit ?? DEFAULT_LIMIT },
    classification: detail.classification,
  };
}

export async function classifyMobileRecurring(db: D1Database, id: string, body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('The recurring classification body is not valid.');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'expectedRevision' && key !== 'classification')) {
    invalid('The recurring classification body contains unsupported fields.');
  }
  if (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 0) invalid('The expected revision is not valid.');
  const classification = validateRecurringClassification(body);
  if ('error' in classification) invalid(classification.error);
  let result;
  try {
    result = await updateRecurringClassification(db, id, classification.classification as RecurringClassification, record.expectedRevision as number);
  } catch {
    throw new RecurringServiceError(
      'temporarily_unavailable',
      'The recurring classification could not be safely acknowledged.',
      503,
      true,
    );
  }
  if (result.kind === 'not_found') throw new RecurringServiceError('not_found', 'Recurring stream not found.', 404);
  if (result.kind === 'conflict') throw new RecurringServiceError('revision_conflict', 'The recurring stream changed; refresh before saving.', 409, false, result.revision);
  return { id, revision: result.revision, updatedAt: result.updatedAt ?? new Date().toISOString() };
}
