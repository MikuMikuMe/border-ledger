import { getCurrencyMeta, type CurrencyCode } from './currencies';
import { resolveEventTime, type EventTimeBasis } from './alert-lifecycle';
import type { Transaction, TransactionKind } from './types';

export interface Money { readonly currency: CurrencyCode; readonly amountMinor: number }
export type MoneyRole = 'transaction' | 'authorization' | 'billing' | 'fee';
export interface MoneyComponent extends Money { readonly role: MoneyRole }
export type BankAlertEventType = 'purchase_notice' | 'authorization_reversal' | 'declined' | 'refund_notice' | 'hold_notice' | 'adjustment_notice' | 'repayment_notice' | 'transfer_notice' | 'fee_notice' | 'unknown';
export type MoneyDirection = 'outflow' | 'inflow' | 'none' | 'unknown';
export interface InstrumentHint { readonly kind: 'card_suffix' | 'account_hint' | 'source_reference'; readonly value: string }
export interface BankDisplayedTime { readonly localDateTime: string | null; readonly zone: string | null; readonly precision: 'minute' | 'second' | 'date' | 'unknown'; readonly yearProvenance: 'explicit' | 'inferred' | 'two_digit' | 'missing' }
export interface EventCompleteness { readonly individualTimestamp: boolean; readonly supportedSource: boolean; readonly labeledMoney: boolean }

export interface BankAlertEventInput {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly observationId: string;
  readonly sourceProfileId: string;
  readonly parserVersion: string;
  readonly notificationPostedAt: string | null;
  readonly capturedAt: string;
  readonly eventTimeBasis: EventTimeBasis;
  readonly eventType: BankAlertEventType;
  readonly direction: MoneyDirection;
  readonly instrumentHint?: InstrumentHint | null;
  readonly eventMoney: Money | null;
  readonly primaryMoneyRole: MoneyRole | null;
  readonly amounts: readonly MoneyComponent[];
  readonly feeTreatment: 'included' | 'separate' | 'unknown';
  readonly bankReference?: string | null;
  readonly bankDisplayedTime: BankDisplayedTime | null;
  readonly merchant?: string | null;
  readonly completeness: EventCompleteness;
}

export interface InstrumentMapping {
  readonly accountId: string;
  readonly sourceProfileId: string;
  readonly approved: boolean;
  readonly allowedCurrencies: readonly CurrencyCode[];
  readonly instrumentHint?: InstrumentHint | null;
  readonly ledgerId?: 'personal';
}

export type AlertLinkRelation = 'cancels' | 'partially_reverses' | 'replaces_authorization' | 'refund_of' | 'confirms' | 'possible_duplicate';
export interface AlertLink {
  readonly fromEventId: string;
  readonly toEventId?: string;
  readonly toTransactionId?: string;
  readonly relation: AlertLinkRelation;
  readonly allocatedMoney?: Money | null;
  readonly evidenceBasis: 'bank_reference' | 'user_review';
  readonly revision: number;
  readonly accountId: string;
  readonly ledgerId?: 'personal';
}

export type AlertLifecycleEvents = readonly BankAlertEventInput[];
export type CanonicalAlertTransaction = Transaction<CurrencyCode>;

export type AlertProjectionState = 'provisional' | 'non_spending' | 'needs_review' | 'voided' | 'superseded';
export type AlertReasonCode = 'unsupported_source' | 'unresolved_instrument' | 'unresolved_time' | 'unresolved_money' | 'invalid_money' | 'invalid_direction' | 'unknown_event_type' | 'orphan_reversal' | 'invalid_cancellation' | 'awaiting_bank_credit' | 'fee_treatment_unknown' | 'confirmed_elsewhere' | 'cancelled' | 'non_spending_event';
export interface AlertProjectionResult {
  readonly state: AlertProjectionState;
  readonly reasonCodes: AlertReasonCode[];
  readonly countedMoney: Money | null;
  readonly transaction: Transaction<CurrencyCode> | null;
}

function result(state: AlertProjectionState, reasonCodes: AlertReasonCode[] = [], countedMoney: Money | null = null, transaction: Transaction<CurrencyCode> | null = null): AlertProjectionResult {
  return { state, reasonCodes, countedMoney, transaction };
}

function validMoney(money: Money): boolean {
  return getCurrencyMeta(money.currency) !== null && Number.isSafeInteger(money.amountMinor) && money.amountMinor > 0;
}

function validComponents(event: BankAlertEventInput): boolean {
  if (!event.eventMoney || !event.primaryMoneyRole || !validMoney(event.eventMoney)) return false;
  if (!event.amounts.every((part) => validMoney(part) && ['transaction', 'authorization', 'billing', 'fee'].includes(part.role))) return false;
  return event.amounts.some((part) => part.role === event.primaryMoneyRole && part.currency === event.eventMoney?.currency && part.amountMinor === event.eventMoney.amountMinor);
}

function validLinkMetadata(link: AlertLink, mapping: InstrumentMapping): boolean {
  return link.accountId === mapping.accountId && (link.ledgerId === undefined || link.ledgerId === 'personal') &&
    (link.evidenceBasis === 'bank_reference' || link.evidenceBasis === 'user_review') && Number.isSafeInteger(link.revision) && link.revision > 0 &&
    !!link.fromEventId && link.fromEventId !== link.toEventId;
}

function validLink(link: AlertLink, event: BankAlertEventInput, mapping: InstrumentMapping): boolean {
  return validLinkMetadata(link, mapping) && (link.toEventId === event.eventId || link.fromEventId === event.eventId);
}

function expectedTransactionKind(event: BankAlertEventInput): TransactionKind {
  return event.eventType === 'refund_notice' ? 'refund' : event.eventType === 'fee_notice' ? 'fee' : 'expense';
}

function compatibleCanonicalTransaction(target: CanonicalAlertTransaction | undefined, event: BankAlertEventInput, mapping: InstrumentMapping): boolean {
  if (!target || !event.eventMoney || target.accountId !== mapping.accountId || target.status !== 'confirmed' || target.source === 'alert') return false;
  const expectedSign = event.direction === 'inflow' ? 1 : -1;
  return target.kind === expectedTransactionKind(event) && target.currency === event.eventMoney.currency && Number.isSafeInteger(target.amountMinor) && Math.sign(target.amountMinor) === expectedSign && Math.abs(target.amountMinor) === event.eventMoney.amountMinor;
}

function validConfirmationLink(link: AlertLink, event: BankAlertEventInput, mapping: InstrumentMapping, canonicalTransactions: readonly CanonicalAlertTransaction[]): boolean {
  if (!validLink(link, event, mapping) || link.fromEventId !== event.eventId || !link.toTransactionId || link.toEventId !== undefined || (link.allocatedMoney !== undefined && link.allocatedMoney !== null)) return false;
  const matches = canonicalTransactions.filter((transaction) => transaction.id === link.toTransactionId);
  return matches.length === 1 && compatibleCanonicalTransaction(matches[0], event, mapping);
}

function isUnresolvedSource(event: BankAlertEventInput, mapping: InstrumentMapping | null): boolean {
  if (!event.completeness.supportedSource || !mapping || !mapping.approved || mapping.sourceProfileId !== event.sourceProfileId || !mapping.accountId) return true;
  if (mapping.ledgerId !== undefined && mapping.ledgerId !== 'personal') return true;
  if (mapping.instrumentHint && (mapping.instrumentHint.kind !== event.instrumentHint?.kind || mapping.instrumentHint.value !== event.instrumentHint.value)) return true;
  return false;
}

function sameInstrument(left: BankAlertEventInput, right: BankAlertEventInput): boolean {
  return left.sourceProfileId === right.sourceProfileId &&
    left.instrumentHint?.kind === right.instrumentHint?.kind &&
    left.instrumentHint?.value === right.instrumentHint?.value;
}

function validLiveNotificationTimestamp(notificationPostedAt: string | null): boolean {
  if (!notificationPostedAt) return false;
  try {
    const time = resolveEventTime({ mode: 'live', notificationPostedAt, individualTimestamp: true });
    return time.basis === 'notification_posted' && time.occurredAt !== null && time.reportingDate !== null;
  } catch {
    return false;
  }
}

function validLifecycleEndpoint(event: BankAlertEventInput, mapping: InstrumentMapping, expectedType: BankAlertEventType, expectedDirection: MoneyDirection): boolean {
  return event.schemaVersion === 1 && !!event.eventId && !!event.observationId && !!event.parserVersion &&
    event.eventType === expectedType && event.direction === expectedDirection &&
    event.completeness.supportedSource && event.completeness.individualTimestamp && event.completeness.labeledMoney &&
    event.eventTimeBasis === 'notification_posted' && !!event.notificationPostedAt &&
    validLiveNotificationTimestamp(event.notificationPostedAt) &&
    !isUnresolvedSource(event, mapping) && validComponents(event) && !!event.eventMoney &&
    mapping.allowedCurrencies.includes(event.eventMoney.currency);
}

interface EventIndex {
  readonly byId: Map<string, BankAlertEventInput>;
  readonly conflictingIds: Set<string>;
}

function indexLifecycleEvents(current: BankAlertEventInput, lifecycleEvents: AlertLifecycleEvents): EventIndex {
  const byId = new Map<string, BankAlertEventInput>();
  const conflictingIds = new Set<string>();
  for (const candidate of [current, ...lifecycleEvents]) {
    if (!candidate.eventId) continue;
    const existing = byId.get(candidate.eventId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
      conflictingIds.add(candidate.eventId);
      continue;
    }
    byId.set(candidate.eventId, candidate);
  }
  return { byId, conflictingIds };
}

function cancellationRelation(relation: AlertLinkRelation): boolean {
  return relation === 'cancels' || relation === 'partially_reverses';
}

function cancellationLinksTouching(event: BankAlertEventInput, links: readonly AlertLink[]): readonly AlertLink[] {
  return links.filter((link) => cancellationRelation(link.relation) && (link.fromEventId === event.eventId || link.toEventId === event.eventId));
}

function validatedCancellationLinks(event: BankAlertEventInput, mapping: InstrumentMapping, links: readonly AlertLink[], lifecycleEvents: AlertLifecycleEvents): Set<AlertLink> {
  const valid = new Set<AlertLink>();
  const index = indexLifecycleEvents(event, lifecycleEvents);
  const groupedBySource = new Map<string, Array<{ link: AlertLink; valid: boolean }>>();

  for (const link of links.filter((candidate) => cancellationRelation(candidate.relation))) {
    const source = index.byId.get(link.fromEventId);
    const target = link.toEventId ? index.byId.get(link.toEventId) : undefined;
    const allocation = link.allocatedMoney;
    const validEndpoints = !!source && !!target && !index.conflictingIds.has(link.fromEventId) && !index.conflictingIds.has(link.toEventId ?? '') &&
      validLifecycleEndpoint(source, mapping, 'authorization_reversal', 'none') &&
      validLifecycleEndpoint(target, mapping, 'purchase_notice', 'outflow') &&
      target.primaryMoneyRole === 'transaction' &&
      sameInstrument(source, target);
    const validAllocation = !!allocation && validMoney(allocation) && !!source?.eventMoney && !!target?.eventMoney &&
      allocation.currency === source.eventMoney.currency && allocation.currency === target.eventMoney.currency &&
      allocation.amountMinor <= source.eventMoney.amountMinor && allocation.amountMinor <= target.eventMoney.amountMinor;
    const validShape = validLinkMetadata(link, mapping) && !!link.toEventId && !link.toTransactionId &&
      (link.relation === 'partially_reverses' || (!!target?.eventMoney && !!allocation && allocation.amountMinor === target.eventMoney.amountMinor));
    const group = groupedBySource.get(link.fromEventId) ?? [];
    group.push({ link, valid: validEndpoints && validAllocation && validShape });
    groupedBySource.set(link.fromEventId, group);
  }

  for (const group of groupedBySource.values()) {
    const targets = new Set(group.map(({ link }) => link.toEventId));
    if (group.length !== 1 || targets.size !== 1 || !group[0].valid) continue;
    valid.add(group[0].link);
  }
  return valid;
}

export function deriveAlertProjection(event: BankAlertEventInput, mapping: InstrumentMapping | null, links: readonly AlertLink[], lifecycleEvents: AlertLifecycleEvents = [], canonicalTransactions: readonly CanonicalAlertTransaction[] = []): AlertProjectionResult {
  if (!mapping) return result('needs_review', ['unresolved_instrument']);
  if (event.schemaVersion !== 1 || !event.eventId || !event.observationId || !event.parserVersion || isUnresolvedSource(event, mapping)) return result('needs_review', ['unsupported_source']);
  const validCancellations = validatedCancellationLinks(event, mapping, links, lifecycleEvents);
  if (cancellationLinksTouching(event, links).some((link) => !validCancellations.has(link))) return result('needs_review', ['invalid_cancellation']);

  if (event.eventType === 'declined' || event.eventType === 'hold_notice' || event.eventType === 'repayment_notice' || event.eventType === 'transfer_notice') {
    return result('non_spending', ['non_spending_event']);
  }
  if (event.eventType === 'authorization_reversal') {
    const outgoing = links.filter((link) => link.fromEventId === event.eventId && cancellationRelation(link.relation));
    if (outgoing.length === 0) {
      const incoming = links.some((link) => link.toEventId === event.eventId && cancellationRelation(link.relation));
      return incoming ? result('needs_review', ['invalid_cancellation']) : result('needs_review', ['orphan_reversal']);
    }
    return outgoing.length === 1 && cancellationLinksTouching(event, links).length === 1 && validCancellations.has(outgoing[0]) ? result('non_spending', ['non_spending_event']) : result('needs_review', ['invalid_cancellation']);
  }
  if (event.eventType === 'unknown' || event.eventType === 'adjustment_notice') return result('needs_review', ['unknown_event_type']);

  if (!event.completeness.individualTimestamp || event.eventTimeBasis !== 'notification_posted' || !event.notificationPostedAt) return result('needs_review', ['unresolved_time']);
  let reportingDate: string;
  try {
    const time = resolveEventTime({ mode: 'live', notificationPostedAt: event.notificationPostedAt, individualTimestamp: true });
    if (!time.reportingDate) return result('needs_review', ['unresolved_time']);
    reportingDate = time.reportingDate;
  } catch {
    return result('needs_review', ['unresolved_time']);
  }

  if (!event.completeness.labeledMoney || !event.eventMoney || !event.primaryMoneyRole) return result('needs_review', ['unresolved_money']);
  if (!validComponents(event) || !mapping.allowedCurrencies.includes(event.eventMoney.currency)) return result('needs_review', ['invalid_money']);

  const kind = expectedTransactionKind(event);
  if ((kind === 'refund' && event.direction !== 'inflow') || (kind !== 'refund' && event.direction !== 'outflow')) return result('needs_review', ['invalid_direction']);
  if (kind === 'fee' && (event.primaryMoneyRole !== 'fee' || event.feeTreatment !== 'separate')) return result('needs_review', ['fee_treatment_unknown']);
  if (kind === 'expense' && event.primaryMoneyRole !== 'transaction') return result('needs_review', ['invalid_money']);
  if (kind === 'refund' && event.primaryMoneyRole !== 'transaction') return result('needs_review', ['invalid_money']);

  const confirmationLinks = links.filter((link) => link.relation === 'confirms' && (link.fromEventId === event.eventId || link.toEventId === event.eventId));
  if (confirmationLinks.length > 0) {
    const validConfirmationLinks = confirmationLinks.filter((link) => validConfirmationLink(link, event, mapping, canonicalTransactions));
    const canonicalTargetIds = new Set(validConfirmationLinks.map((link) => link.toTransactionId));
    if (validConfirmationLinks.length !== confirmationLinks.length || validConfirmationLinks.length !== 1 || canonicalTargetIds.size !== 1) return result('needs_review', ['awaiting_bank_credit']);
    return result('superseded', ['confirmed_elsewhere']);
  }

  let amountMinor = event.eventMoney.amountMinor;
  if (kind === 'expense') {
    const cancellations = links.filter((link) => link.toEventId === event.eventId && (link.relation === 'cancels' || link.relation === 'partially_reverses'));
    const sources = new Set<string>();
    for (const cancellation of cancellations) {
      const money = cancellation.allocatedMoney;
      if (!validCancellations.has(cancellation) || !money || !validLink(cancellation, event, mapping) || money.currency !== event.eventMoney.currency || sources.has(cancellation.fromEventId)) return result('needs_review', ['invalid_cancellation']);
      sources.add(cancellation.fromEventId);
      amountMinor -= money.amountMinor;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return result('needs_review', ['invalid_cancellation']);
    }
    if (amountMinor === 0) return result('voided', ['cancelled']);
  }

  const countedMoney = { currency: event.eventMoney.currency, amountMinor };
  const transaction: Transaction<CurrencyCode> = {
    id: event.eventId,
    accountId: mapping.accountId,
    date: reportingDate,
    merchant: event.merchant || 'Merchant unavailable',
    amountMinor: kind === 'refund' ? amountMinor : -amountMinor,
    currency: countedMoney.currency,
    category: kind === 'refund' ? 'Refunds' : kind === 'fee' ? 'Fees' : 'Uncategorized',
    kind,
    status: 'provisional',
    source: 'alert',
    fingerprint: `alert:${event.eventId}`,
  };
  return result('provisional', [], countedMoney, transaction);
}
