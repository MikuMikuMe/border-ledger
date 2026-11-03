import type { ClassifiedWealthCashFlow } from '../../domain/wealth-types';
import type { WealthCashFlowResponse } from '../../domain/wealth-api-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface WealthCashFlowView extends WealthCashFlowResponse {
  accountName?: string | null;
  merchant?: string;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function flowClassification(value: unknown): ClassifiedWealthCashFlow['classification'] {
  return ['external_contribution', 'external_withdrawal', 'trade', 'internal_transfer', 'ambiguous'].includes(String(value)) ? value as ClassifiedWealthCashFlow['classification'] : 'ambiguous';
}

function flowDirection(value: unknown): ClassifiedWealthCashFlow['direction'] {
  return value === 'inflow' || value === 'outflow' ? value : null;
}

function flowKind(value: unknown): ClassifiedWealthCashFlow['kind'] {
  return ['bank', 'trade', 'internal_transfer', 'contribution', 'withdrawal'].includes(String(value)) ? value as ClassifiedWealthCashFlow['kind'] : null;
}

function flowBankKind(value: unknown): WealthCashFlowResponse['bankKind'] {
  return ['expense', 'income', 'refund', 'fee'].includes(String(value)) ? value as WealthCashFlowResponse['bankKind'] : undefined;
}

function flowEventKind(value: unknown): WealthCashFlowResponse['eventKind'] {
  return ['dividend', 'withholding', 'fee', 'contribution', 'withdrawal'].includes(String(value)) ? value as WealthCashFlowResponse['eventKind'] : undefined;
}

function cashFlowBase(value: Record<string, unknown>): Pick<WealthCashFlowView, 'sourceId' | 'date' | 'accountId' | 'money'> | null {
  const sourceId = stringValue(value.sourceId ?? value.source_id);
  if (!sourceId) return null;
  const date = stringValue(value.date);
  if (!date) return null;
  const moneyRecord = isRecord(value.money) ? value.money : null;
  if (!moneyRecord) return null;
  const currency = stringValue(moneyRecord.currency).toUpperCase();
  if (!currency) return null;
  const amountMinor = nullableInteger(moneyRecord.amountMinor ?? moneyRecord.amount_minor);
  if (amountMinor === null) return null;
  return { sourceId, date, accountId: stringValue(value.accountId ?? value.account_id), money: { currency, amountMinor } };
}

function cashFlowMetadata(value: Record<string, unknown>): Omit<WealthCashFlowView, 'sourceId' | 'date' | 'accountId' | 'money'> {
  return {
    direction: flowDirection(value.direction),
    kind: flowKind(value.kind),
    linkedWealthSourceId: optionalString(value.linkedWealthSourceId) ?? null,
    classification: flowClassification(value.classification),
    includedInPerformance: value.includedInPerformance !== false,
    reason: stringValue(value.reason, 'Source classification is available.'),
    transactionId: optionalString(value.transactionId),
    category: nullableString(value.category),
    bankKind: flowBankKind(value.bankKind ?? value.bank_kind),
    eventKind: flowEventKind(value.eventKind ?? value.event_kind),
    source: nullableString(value.source),
    status: optionalString(value.status),
    linkConflict: value.linkConflict === true,
    accountName: nullableString(value.accountName ?? value.account_name),
    merchant: optionalString(value.merchant),
  };
}

function reportCashFlowEntry(value: unknown): WealthCashFlowView | null {
  if (!isRecord(value)) return null;
  const base = cashFlowBase(value);
  return base ? { ...base, ...cashFlowMetadata(value) } : null;
}

export function reportCashFlows(value: unknown): WealthCashFlowView[] {
  return Array.isArray(value) ? value.flatMap((entry) => { const parsed = reportCashFlowEntry(entry); return parsed ? [parsed] : []; }) : [];
}
