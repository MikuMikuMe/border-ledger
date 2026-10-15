import type { RecurringClassification, RecurringQuery, RecurringSummaryQuery } from '../src/domain/recurring';
import type { Currency } from '../src/domain/types';
import { getCurrencyMeta, type CurrencyCode } from '../src/domain/currencies';

export interface ValidatedPlaidExchangeInput {
  publicToken: string;
  accountIds: string[];
}

export type ValidatedRecurringListQuery = RecurringQuery;
export type ValidatedRecurringSummaryQuery = RecurringSummaryQuery;

export interface ValidatedImportTransaction {
  id: string;
  date: string;
  merchant: string;
  amountMinor: number;
  currency: CurrencyCode;
  category: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
  status: 'confirmed' | 'provisional' | 'needs_review';
  source: 'statement';
  fingerprint: string;
  note: string | null;
  bankReference?: string | null;
  sourceIdentity?: {
    bankSourceId?: string | null;
    bankRowId?: string | null;
    rowIndex?: number;
  };
}

export interface ValidatedImportPayload {
  accountId: string;
  filename: string;
  transactions: ValidatedImportTransaction[];
  fileSha256?: string;
  operationId?: string;
}

export interface ValidatedAlertReviewInput {
  id: string;
  alertEventId: string;
  targetAlertEventId?: string;
  statementTransactionId?: string;
  candidateTransactionId?: string;
  relation?: 'confirms' | 'refund_of' | 'cancels' | 'partially_reverses' | 'possible_duplicate';
  allocatedCurrency?: CurrencyCode;
  allocatedAmountMinor?: number;
  evidenceBasis: 'bank_reference' | 'user_review';
  revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const recurringClassifications: readonly RecurringClassification[] = ['unclassified', 'subscription', 'bill', 'other', 'excluded'];

function queryString(value: string | null, maxLength: number) {
  return value && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function queryDate(value: string | null, field: string, required = false): string | undefined | { error: string } {
  if (!value) return required ? { error: `The ${field} date is required.` } : undefined;
  if (!isIsoDate(value)) return { error: `The ${field} date is not valid.` };
  return value;
}

function recurringFilters(params: URLSearchParams): { accountId?: string; currency?: Currency; classification?: RecurringClassification } | { error: string } {
  const accountId = params.get('accountId');
  if (accountId && !boundedString(accountId, 160)) return { error: 'The recurring account filter is not valid.' };
  const currency = params.get('currency');
  if (currency && !getCurrencyMeta(currency)) return { error: 'The recurring currency filter is not valid.' };
  const classification = params.get('classification');
  if (classification && !recurringClassifications.includes(classification as RecurringClassification)) return { error: 'The recurring classification filter is not valid.' };
  return {
    ...(accountId ? { accountId: accountId.trim() } : {}),
    ...(currency ? { currency: currency as Currency } : {}),
    ...(classification ? { classification: classification as RecurringClassification } : {}),
  };
}

export function validateRecurringListQuery(params: URLSearchParams): ValidatedRecurringListQuery | { error: string } {
  const filters = recurringFilters(params);
  if ('error' in filters) return filters;
  const limitParam = params.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) return { error: 'The recurring page limit is not valid.' };
    limit = Number(limitParam);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return { error: 'The recurring page limit must be between 1 and 100.' };
  }
  const cursor = params.get('cursor');
  if (cursor !== null && (!queryString(cursor, 512) || !/^[A-Za-z0-9_-]+$/.test(cursor))) return { error: 'The recurring cursor is not valid.' };
  const today = queryDate(params.get('today'), 'today');
  if (typeof today !== 'string' && today !== undefined) return today;
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === null ? {} : { cursor }),
    ...(today ? { today } : {}),
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.classification ? { classification: filters.classification } : {}),
  };
}

export function validateRecurringSummaryQuery(params: URLSearchParams): ValidatedRecurringSummaryQuery | { error: string } {
  const filters = recurringFilters(params);
  if ('error' in filters) return filters;
  const start = queryDate(params.get('start') ?? params.get('from'), 'start', true);
  if (typeof start !== 'string') return start ?? { error: 'The start date is required.' };
  const end = queryDate(params.get('end') ?? params.get('to'), 'end', true);
  if (typeof end !== 'string') return end ?? { error: 'The end date is required.' };
  if (start > end) return { error: 'The recurring summary date range is not valid.' };
  const today = queryDate(params.get('today'), 'today', true);
  if (typeof today !== 'string') return today ?? { error: 'The today date is required.' };
  return {
    startDate: start,
    endDate: end,
    today,
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.classification ? { classification: filters.classification } : {}),
  };
}

export function validateRecurringClassification(input: unknown): { classification: RecurringClassification } | { error: string } {
  if (!isRecord(input) || !recurringClassifications.includes(input.classification as RecurringClassification)) {
    return { error: 'The recurring classification is not valid.' };
  }
  return { classification: input.classification as RecurringClassification };
}

export function validatePlaidExchangeInput(input: unknown): ValidatedPlaidExchangeInput | { error: string } {
  if (!isRecord(input)) return { error: 'A Plaid public token is required.' };
  if (!boundedString(input.publicToken, 512) || input.publicToken.trim().length < 10) {
    return { error: 'A Plaid public token is required.' };
  }
  if (!Array.isArray(input.accountIds) || input.accountIds.length === 0) {
    return { error: 'Choose at least one Plaid account before connecting.' };
  }
  if (input.accountIds.length > 20 || input.accountIds.some((value) => !boundedString(value, 128))) {
    return { error: 'The selected Plaid accounts are not valid.' };
  }
  const accountIds = input.accountIds.map((value) => (value as string).trim());
  if (new Set(accountIds).size !== accountIds.length) {
    return { error: 'Choose at least one unique Plaid account.' };
  }
  return { publicToken: input.publicToken.trim(), accountIds };
}

export function selectPlaidAccounts<T extends { account_id: string }>(accounts: T[], selectedAccountIds: string[]) {
  const available = new Set(accounts.map((account) => account.account_id));
  if (selectedAccountIds.some((accountId) => !available.has(accountId))) return null;
  const selected = new Set(selectedAccountIds);
  return accounts.filter((account) => selected.has(account.account_id));
}

export function validateAlertReviewPayload(input: unknown): ValidatedAlertReviewInput | { error: string } {
  if (!isRecord(input)) return { error: 'A review object is required.' };
  const allowed = new Set(['id', 'alertEventId', 'targetAlertEventId', 'statementTransactionId', 'candidateTransactionId', 'relation', 'allocatedCurrency', 'allocatedAmountMinor', 'evidenceBasis', 'revision']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return { error: 'The review contains an unknown field.' };
  if (!boundedString(input.id, 160) || !boundedString(input.alertEventId, 160)) return { error: 'A review ID and alert event ID are required.' };
  const targetAlertEventId = input.targetAlertEventId;
  const statementTransactionId = input.statementTransactionId;
  const candidateTransactionId = input.candidateTransactionId;
  if (targetAlertEventId !== undefined && !boundedString(targetAlertEventId, 160)) return { error: 'The target alert event ID is not valid.' };
  if (statementTransactionId !== undefined && !boundedString(statementTransactionId, 160)) return { error: 'The statement transaction ID is not valid.' };
  if (candidateTransactionId !== undefined && !boundedString(candidateTransactionId, 160)) return { error: 'The candidate transaction ID is not valid.' };
  if (!targetAlertEventId && !statementTransactionId) return { error: 'A review target is required.' };
  if (targetAlertEventId && (statementTransactionId || candidateTransactionId)) return { error: 'A review cannot target both an alert event and a transaction.' };
  if (candidateTransactionId && !statementTransactionId) return { error: 'A candidate review must include its statement transaction.' };
  const relation = input.relation;
  const relations = ['confirms', 'refund_of', 'cancels', 'partially_reverses', 'possible_duplicate'] as const;
  if (relation !== undefined && !relations.includes(relation as typeof relations[number])) return { error: 'The review relation is not supported.' };
  if ((relation === 'cancels' || relation === 'partially_reverses') && !targetAlertEventId) return { error: 'Lifecycle relations require an alert-event target.' };
  if (relation && relation !== 'cancels' && relation !== 'partially_reverses' && targetAlertEventId) return { error: 'Only cancellation relations may target another alert event.' };
  if (input.evidenceBasis !== 'bank_reference' && input.evidenceBasis !== 'user_review') return { error: 'Review evidence must be bank_reference or user_review.' };
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) return { error: 'The review revision must be a positive safe integer.' };
  const hasCurrency = input.allocatedCurrency !== undefined && input.allocatedCurrency !== null;
  const hasAmount = input.allocatedAmountMinor !== undefined && input.allocatedAmountMinor !== null;
  if (hasCurrency !== hasAmount) return { error: 'Allocation currency and amount must be supplied together.' };
  const allocationCurrency = typeof input.allocatedCurrency === 'string' ? input.allocatedCurrency.toUpperCase() : null;
  if (hasCurrency && (!allocationCurrency || !getCurrencyMeta(allocationCurrency))) return { error: 'The allocation currency is not registered.' };
  if (hasAmount && (!Number.isSafeInteger(input.allocatedAmountMinor) || (input.allocatedAmountMinor as number) <= 0)) return { error: 'The allocation amount must be a positive safe integer.' };
  return {
    id: input.id.trim(),
    alertEventId: input.alertEventId.trim(),
    ...(targetAlertEventId ? { targetAlertEventId: targetAlertEventId.trim() } : {}),
    ...(statementTransactionId ? { statementTransactionId: statementTransactionId.trim() } : {}),
    ...(candidateTransactionId ? { candidateTransactionId: candidateTransactionId.trim() } : {}),
    ...(relation ? { relation: relation as ValidatedAlertReviewInput['relation'] } : {}),
    ...(hasCurrency ? { allocatedCurrency: allocationCurrency as CurrencyCode } : {}),
    ...(hasAmount ? { allocatedAmountMinor: input.allocatedAmountMinor as number } : {}),
    evidenceBasis: input.evidenceBasis,
    revision: input.revision as number,
  };
}

export function validateImportPayload(input: unknown): ValidatedImportPayload | { error: string } {
  if (!isRecord(input)) return { error: 'accountId and transactions are required' };
  if (!boundedString(input.accountId, 128) || !Array.isArray(input.transactions) || input.transactions.length === 0) {
    return { error: 'accountId and transactions are required' };
  }
  if (input.transactions.length > 500) return { error: 'No more than 500 transactions may be imported at once.' };
  const filename = input.filename === undefined ? 'statement.csv' : input.filename;
  if (!boundedString(filename, 200)) return { error: 'The import filename is not valid.' };
  const fileSha256 = input.fileSha256 === undefined ? undefined : input.fileSha256;
  if (fileSha256 !== undefined && (!boundedString(fileSha256, 128) || !/^[a-f0-9]{64}$/i.test(fileSha256))) return { error: 'The statement file hash is not a SHA-256 hex digest.' };
  const operationId = input.operationId === undefined ? undefined : input.operationId;
  if (operationId !== undefined && !boundedString(operationId, 160)) return { error: 'The import operation ID is not valid.' };

  const transactions: ValidatedImportTransaction[] = [];
  for (const candidate of input.transactions) {
    if (!isRecord(candidate)) return { error: 'Each imported transaction must be an object.' };
    if (!boundedString(candidate.id, 160)) return { error: 'Each imported transaction needs an id.' };
    if (!isIsoDate(candidate.date)) return { error: 'Each imported transaction needs a valid date.' };
    if (!boundedString(candidate.merchant, 200)) return { error: 'Each imported transaction needs a merchant.' };
    if (!Number.isFinite(candidate.amountMinor) || !Number.isInteger(candidate.amountMinor)) return { error: 'Each imported amount must be a finite integer.' };
    if (typeof candidate.currency !== 'string' || !getCurrencyMeta(candidate.currency.toUpperCase())) return { error: 'Each imported currency must be registered.' };
    if (!boundedString(candidate.category, 120)) return { error: 'Each imported transaction needs a category.' };
    if (!['expense', 'income', 'transfer', 'refund', 'fee'].includes(candidate.kind as string)) return { error: 'Each imported transaction has an invalid kind.' };
    if (!['confirmed', 'provisional', 'needs_review'].includes(candidate.status as string)) return { error: 'Each imported transaction has an invalid status.' };
    if (candidate.source !== 'statement') return { error: 'Imported transactions must use the statement source.' };
    if (!boundedString(candidate.fingerprint, 256)) return { error: 'Each imported transaction needs a fingerprint.' };
    if (candidate.note !== undefined && candidate.note !== null && (typeof candidate.note !== 'string' || candidate.note.length > 500)) return { error: 'Imported notes are too long.' };
    if (candidate.bankReference !== undefined && candidate.bankReference !== null && !boundedString(candidate.bankReference, 128)) return { error: 'The statement bank reference is not valid.' };
    let sourceIdentity: ValidatedImportTransaction['sourceIdentity'];
    if (candidate.sourceIdentity !== undefined) {
      if (!isRecord(candidate.sourceIdentity)) return { error: 'The statement source identity is not valid.' };
      const bankSourceId = candidate.sourceIdentity.bankSourceId;
      const bankRowId = candidate.sourceIdentity.bankRowId;
      const rowIndex = candidate.sourceIdentity.rowIndex;
      if (bankSourceId !== undefined && bankSourceId !== null && !boundedString(bankSourceId, 256)) return { error: 'The bank source ID is not valid.' };
      if (bankRowId !== undefined && bankRowId !== null && !boundedString(bankRowId, 256)) return { error: 'The bank row ID is not valid.' };
      if ((bankSourceId === null) !== (bankRowId === null) || (bankSourceId === undefined) !== (bankRowId === undefined)) return { error: 'Bank source and row IDs must be supplied together.' };
      if (rowIndex !== undefined && (!Number.isInteger(rowIndex) || (rowIndex as number) < 0 || (rowIndex as number) > 1_000_000)) return { error: 'The statement row index is not valid.' };
      sourceIdentity = {
        bankSourceId: bankSourceId === undefined ? undefined : bankSourceId as string | null,
        bankRowId: bankRowId === undefined ? undefined : bankRowId as string | null,
        rowIndex: rowIndex === undefined ? undefined : rowIndex as number,
      };
    }
    transactions.push({
      id: candidate.id,
      date: candidate.date,
      merchant: candidate.merchant,
      amountMinor: candidate.amountMinor as number,
      currency: (candidate.currency as string).toUpperCase(),
      category: candidate.category,
      kind: candidate.kind as ValidatedImportTransaction['kind'],
      status: candidate.status as ValidatedImportTransaction['status'],
      source: 'statement',
      fingerprint: candidate.fingerprint,
      note: candidate.note === undefined ? null : candidate.note as string | null,
      ...(candidate.bankReference === undefined ? {} : { bankReference: candidate.bankReference === null ? null : (candidate.bankReference as string).trim() }),
      ...(sourceIdentity ? { sourceIdentity } : {}),
    });
  }
  return {
    accountId: input.accountId.trim(),
    filename: filename.trim(),
    transactions,
    ...(fileSha256 ? { fileSha256: fileSha256.toLowerCase() } : {}),
    ...(operationId ? { operationId: operationId.trim() } : {}),
  };
}
