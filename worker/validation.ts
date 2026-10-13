import type { RecurringClassification, RecurringQuery, RecurringSummaryQuery } from '../src/domain/recurring';
import type { Currency } from '../src/domain/types';

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
  currency: 'CAD' | 'CNY';
  category: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
  status: 'confirmed' | 'provisional' | 'needs_review';
  source: 'statement';
  fingerprint: string;
  note: string | null;
}

export interface ValidatedImportPayload {
  accountId: string;
  filename: string;
  transactions: ValidatedImportTransaction[];
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
  if (currency && currency !== 'CAD' && currency !== 'CNY') return { error: 'The recurring currency filter is not valid.' };
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

export function validateImportPayload(input: unknown): ValidatedImportPayload | { error: string } {
  if (!isRecord(input)) return { error: 'accountId and transactions are required' };
  if (!boundedString(input.accountId, 128) || !Array.isArray(input.transactions) || input.transactions.length === 0) {
    return { error: 'accountId and transactions are required' };
  }
  if (input.transactions.length > 500) return { error: 'No more than 500 transactions may be imported at once.' };
  const filename = input.filename === undefined ? 'statement.csv' : input.filename;
  if (!boundedString(filename, 200)) return { error: 'The import filename is not valid.' };

  const transactions: ValidatedImportTransaction[] = [];
  for (const candidate of input.transactions) {
    if (!isRecord(candidate)) return { error: 'Each imported transaction must be an object.' };
    if (!boundedString(candidate.id, 160)) return { error: 'Each imported transaction needs an id.' };
    if (!isIsoDate(candidate.date)) return { error: 'Each imported transaction needs a valid date.' };
    if (!boundedString(candidate.merchant, 200)) return { error: 'Each imported transaction needs a merchant.' };
    if (!Number.isFinite(candidate.amountMinor) || !Number.isInteger(candidate.amountMinor)) return { error: 'Each imported amount must be a finite integer.' };
    if (candidate.currency !== 'CAD' && candidate.currency !== 'CNY') return { error: 'Each imported currency must be CAD or CNY.' };
    if (!boundedString(candidate.category, 120)) return { error: 'Each imported transaction needs a category.' };
    if (!['expense', 'income', 'transfer', 'refund', 'fee'].includes(candidate.kind as string)) return { error: 'Each imported transaction has an invalid kind.' };
    if (!['confirmed', 'provisional', 'needs_review'].includes(candidate.status as string)) return { error: 'Each imported transaction has an invalid status.' };
    if (candidate.source !== 'statement') return { error: 'Imported transactions must use the statement source.' };
    if (!boundedString(candidate.fingerprint, 256)) return { error: 'Each imported transaction needs a fingerprint.' };
    if (candidate.note !== undefined && candidate.note !== null && (typeof candidate.note !== 'string' || candidate.note.length > 500)) return { error: 'Imported notes are too long.' };
    transactions.push({
      id: candidate.id,
      date: candidate.date,
      merchant: candidate.merchant,
      amountMinor: candidate.amountMinor as number,
      currency: candidate.currency,
      category: candidate.category,
      kind: candidate.kind as ValidatedImportTransaction['kind'],
      status: candidate.status as ValidatedImportTransaction['status'],
      source: 'statement',
      fingerprint: candidate.fingerprint,
      note: candidate.note === undefined ? null : candidate.note as string | null,
    });
  }
  return { accountId: input.accountId.trim(), filename: filename.trim(), transactions };
}
