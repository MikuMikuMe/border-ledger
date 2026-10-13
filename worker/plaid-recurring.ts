import type {
  RecurringFrequency,
  RecurringMembership,
  RecurringStream,
} from '../src/domain/recurring';
import type { Currency } from '../src/domain/types';

export interface PlaidRecurringAmount {
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

export interface PlaidRecurringMembership {
  transaction_id: string;
  pending_transaction_id?: string | null;
  date: string;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

export interface PlaidRecurringStream {
  account_id: string;
  stream_id: string;
  merchant_name?: string | null;
  description?: string | null;
  merchant_entity_id?: string | null;
  frequency: string;
  status: string;
  is_outflow?: boolean;
  average_amount: PlaidRecurringAmount;
  last_amount?: PlaidRecurringAmount | null;
  predicted_amount?: PlaidRecurringAmount | null;
  first_date?: string | null;
  last_date?: string | null;
  predicted_next_date?: string | null;
  transactions?: readonly PlaidRecurringMembership[];
}

export interface PlaidRecurringResponse {
  updated_at?: string | null;
  request_id?: string;
  history_complete?: boolean;
  inflow_streams: readonly PlaidRecurringStream[];
  outflow_streams: readonly PlaidRecurringStream[];
}

export interface NormalizedRecurringSnapshot {
  itemId: string;
  sourceUpdatedAt: string | null;
  requestId: string | null;
  historyComplete: boolean | null;
  streams: RecurringStream[];
  coverageWarnings: string[];
}

const supportedFrequencies = new Set<RecurringFrequency>(['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'ANNUALLY', 'UNKNOWN']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Recurring ${field} is required.`);
  return value;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`Recurring ${field} must be a string or null.`);
  return value;
}

function validDate(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Recurring ${field} is not a valid provider date.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Recurring ${field} is not a valid provider date.`);
  return value;
}

function validTimestamp(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).valueOf())) throw new Error('Recurring updated_at is not a valid timestamp.');
  return value;
}

function amountCurrency(value: PlaidRecurringAmount, field: string): Currency | null {
  if (!isRecord(value)) throw new Error(`Recurring ${field} must be an amount object.`);
  const currency = String(value.iso_currency_code ?? value.unofficial_currency_code ?? '').toUpperCase();
  if (currency === 'CAD' || currency === 'CNY') return currency;
  return null;
}

function signedMinor(value: PlaidRecurringAmount, field: string, isOutflow: boolean, expectedCurrency?: Currency) {
  if (!isRecord(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount)) throw new Error(`Recurring ${field}.amount must be finite.`);
  const currency = amountCurrency(value, field);
  if (!currency) return { currency: null, amountMinor: null };
  if (expectedCurrency && currency !== expectedCurrency) throw new Error(`Recurring ${field} currency does not match the stream currency.`);
  const scaled = -value.amount * 100;
  if (!Number.isSafeInteger(Math.round(scaled))) throw new Error(`Recurring ${field}.amount is outside the safe integer range.`);
  if (isOutflow && value.amount < 0) throw new Error(`Recurring ${field}.amount has an incompatible outflow sign.`);
  if (!isOutflow && value.amount > 0) throw new Error(`Recurring ${field}.amount has an incompatible inflow sign.`);
  return { currency, amountMinor: Math.round(scaled) };
}

function normalizeFrequency(value: string) {
  const frequency = value.toUpperCase() as RecurringFrequency;
  return supportedFrequencies.has(frequency) ? frequency : 'UNKNOWN';
}

function normalizeMemberships(value: unknown, field: string, isOutflow: boolean, currency: Currency): RecurringMembership[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Recurring ${field} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Recurring ${field}[${index}] must be an object.`);
    const transactionId = requireString(entry.transaction_id, `${field}[${index}].transaction_id`);
    const date = validDate(entry.date, `${field}[${index}].date`);
    if (!date) throw new Error(`Recurring ${field}[${index}].date is required.`);
    const amount = signedMinor(entry as unknown as PlaidRecurringAmount, `${field}[${index}]`, isOutflow, currency);
    if (amount.amountMinor === null) throw new Error(`Recurring ${field}[${index}] uses an unsupported currency.`);
    return {
      providerTransactionId: transactionId,
      pendingProviderTransactionId: optionalString(entry.pending_transaction_id, `${field}[${index}].pending_transaction_id`),
      date,
      amountMinor: amount.amountMinor,
      currency,
    };
  });
}

function normalizeStream(raw: unknown, itemId: string, accountMappings: ReadonlyMap<string, string>, isOutflow: boolean, warnings: Set<string>, index: number): RecurringStream | null {
  if (!isRecord(raw)) throw new Error(`Recurring stream[${index}] must be an object.`);
  const accountId = requireString(raw.account_id, `stream[${index}].account_id`);
  if (!accountMappings.has(accountId)) {
    warnings.add('unapproved_account');
    return null;
  }
  const streamId = requireString(raw.stream_id, `stream[${index}].stream_id`);
  const frequencySource = requireString(raw.frequency, `stream[${index}].frequency`).toUpperCase();
  const sourceStatus = requireString(raw.status, `stream[${index}].status`).toUpperCase();
  if (raw.is_outflow !== undefined && typeof raw.is_outflow !== 'boolean') throw new Error(`Recurring stream[${index}].is_outflow must be boolean.`);
  const streamIsOutflow = raw.is_outflow ?? isOutflow;
  const average = signedMinor(raw.average_amount as PlaidRecurringAmount, `stream[${index}].average_amount`, streamIsOutflow);
  if (average.currency === null || average.amountMinor === null) {
    warnings.add('unsupported_currency');
    return null;
  }
  const last = raw.last_amount === null || raw.last_amount === undefined ? null : signedMinor(raw.last_amount as PlaidRecurringAmount, `stream[${index}].last_amount`, streamIsOutflow, average.currency);
  const predicted = raw.predicted_amount === null || raw.predicted_amount === undefined ? null : signedMinor(raw.predicted_amount as PlaidRecurringAmount, `stream[${index}].predicted_amount`, streamIsOutflow, average.currency);
  if (last?.amountMinor === null || predicted?.amountMinor === null) throw new Error(`Recurring stream[${index}] has an unsupported secondary amount currency.`);
  const memberships = normalizeMemberships(raw.transactions, `stream[${index}].transactions`, streamIsOutflow, average.currency);
  return {
    id: `${itemId}:${streamId}`,
    itemId,
    streamId,
    accountId: accountMappings.get(accountId)!,
    merchantName: raw.merchant_name === undefined || raw.merchant_name === null ? null : requireString(raw.merchant_name, `stream[${index}].merchant_name`).trim(),
    merchantEntityId: optionalString(raw.merchant_entity_id, `stream[${index}].merchant_entity_id`),
    currency: average.currency,
    sourceStatus,
    sourceFrequency: frequencySource,
    frequency: normalizeFrequency(frequencySource),
    isOutflow: streamIsOutflow,
    firstDate: validDate(raw.first_date, `stream[${index}].first_date`),
    lastDate: validDate(raw.last_date, `stream[${index}].last_date`),
    predictedNextDate: validDate(raw.predicted_next_date, `stream[${index}].predicted_next_date`),
    averageAmountMinor: average.amountMinor,
    lastAmountMinor: last?.amountMinor ?? null,
    predictedAmountMinor: predicted?.amountMinor ?? null,
    memberships,
    sourceUpdatedAt: null,
  };
}

export function normalizeRecurringSnapshot(response: PlaidRecurringResponse, itemId: string, accountMappings: ReadonlyMap<string, string>): NormalizedRecurringSnapshot {
  if (!isRecord(response)) throw new Error('Recurring response must be an object.');
  if (!Array.isArray(response.inflow_streams)) throw new Error('Recurring inflow_streams must be an array.');
  if (!Array.isArray(response.outflow_streams)) throw new Error('Recurring outflow_streams must be an array.');
  const sourceUpdatedAt = validTimestamp(response.updated_at);
  const warnings = new Set<string>();
  const streams = [
    ...response.outflow_streams.map((stream, index) => normalizeStream(stream, itemId, accountMappings, true, warnings, index)),
    ...response.inflow_streams.map((stream, index) => normalizeStream(stream, itemId, accountMappings, false, warnings, index)),
  ].filter((stream): stream is RecurringStream => stream !== null).map((stream) => ({ ...stream, sourceUpdatedAt }));
  return {
    itemId,
    sourceUpdatedAt,
    requestId: typeof response.request_id === 'string' ? response.request_id : null,
    historyComplete: typeof response.history_complete === 'boolean' ? response.history_complete : null,
    streams,
    coverageWarnings: [...warnings],
  };
}
