import type { CanonicalInstrument, HoldingValuation, WealthAccount, WealthEvent } from '../src/domain/wealth-types';
import { csvEscape } from './wealth-import-csv';
import { CANONICAL_CSV_HEADERS, type ImportModeTransition } from './wealth-import-types';
import { storedTransitionPayload, transitionOpeningEvents, transitionOpeningValuations } from './wealth-import-transitions';

export { CANONICAL_CSV_HEADERS } from './wealth-import-types';

function eventIdentityFields(event: WealthEvent): Record<string, unknown> {
  const fields: Record<string, unknown> = { record_type: 'event', id: event.id, source_id: event.sourceId, date: event.date, kind: event.kind, sequence: event.sequence ?? '', memo: event.memo ?? '', linked_bank_source_id: event.linkedBankSourceId ?? '' };
  if (event.kind === 'transfer') return { ...fields, from_account_id: event.fromAccountId, to_account_id: event.toAccountId, transfer_kind: event.transferKind, transfer_id: event.transferId ?? '' };
  if ('accountId' in event) fields.account_id = event.accountId;
  return fields;
}

function eventInstrumentFields(event: WealthEvent): Record<string, unknown> {
  if (!('instrument' in event) || !event.instrument) return {};
  return { exchange: event.instrument.exchange, ticker: event.instrument.ticker, type: event.instrument.type, currency: event.instrument.currency };
}

function positionFields(event: Extract<WealthEvent, { kind: 'opening_position' }>): Record<string, unknown> {
  return { quantity: event.quantity, basis_minor: event.basis?.amountMinor ?? '', currency: event.instrument.currency };
}

function buyFields(event: Extract<WealthEvent, { kind: 'buy' }>): Record<string, unknown> {
  return { quantity: event.quantity, consideration_minor: event.consideration.amountMinor, fee_minor: event.fee?.amountMinor ?? '', currency: event.consideration.currency };
}

function sellFields(event: Extract<WealthEvent, { kind: 'sell' }>): Record<string, unknown> {
  return { quantity: event.quantity, proceeds_minor: event.proceeds.amountMinor, fee_minor: event.fee?.amountMinor ?? '', currency: event.proceeds.currency };
}

function moneyFields(event: Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' | 'opening_cash' | 'contribution' | 'withdrawal' }>): Record<string, unknown> {
  return { amount_minor: event.money.amountMinor, currency: event.money.currency };
}

function transferFields(event: Extract<WealthEvent, { kind: 'transfer' }>): Record<string, unknown> {
  return event.transferKind === 'cash'
    ? { amount_minor: event.money.amountMinor, currency: event.money.currency }
    : { quantity: event.quantity, currency: event.instrument.currency };
}

function splitFields(event: Extract<WealthEvent, { kind: 'split' }>): Record<string, unknown> {
  return { numerator: event.numerator, denominator: event.denominator, currency: event.instrument.currency };
}

function controlFields(event: Extract<WealthEvent, { kind: 'reversal' | 'correction' }>): Record<string, unknown> {
  return { target_source_id: event.targetSourceId, event_json: JSON.stringify(event) };
}

type KindFieldBuilder = (event: WealthEvent) => Record<string, unknown>;
const EVENT_KIND_FIELDS: Partial<Record<WealthEvent['kind'], KindFieldBuilder>> = {
  opening_position: (event) => positionFields(event as Extract<WealthEvent, { kind: 'opening_position' }>),
  buy: (event) => buyFields(event as Extract<WealthEvent, { kind: 'buy' }>),
  sell: (event) => sellFields(event as Extract<WealthEvent, { kind: 'sell' }>),
  dividend: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'dividend' }>),
  withholding: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'withholding' }>),
  fee: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'fee' }>),
  opening_cash: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'opening_cash' }>),
  contribution: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'contribution' }>),
  withdrawal: (event) => moneyFields(event as Extract<WealthEvent, { kind: 'withdrawal' }>),
  transfer: (event) => transferFields(event as Extract<WealthEvent, { kind: 'transfer' }>),
  split: (event) => splitFields(event as Extract<WealthEvent, { kind: 'split' }>),
  reversal: (event) => controlFields(event as Extract<WealthEvent, { kind: 'reversal' }>),
  correction: (event) => controlFields(event as Extract<WealthEvent, { kind: 'correction' }>),
};

function eventExportFields(event: WealthEvent): Record<string, unknown> {
  return { ...eventIdentityFields(event), ...eventInstrumentFields(event), ...(EVENT_KIND_FIELDS[event.kind]?.(event) ?? {}) };
}

function row(fields: Record<string, unknown>): string {
  return CANONICAL_CSV_HEADERS.map((header) => csvEscape(fields[header] ?? '')).join(',');
}

function accountFields(account: WealthAccount & Record<string, unknown>, transitions: readonly ImportModeTransition[]): Record<string, unknown> {
  const initialMode = transitions.filter((transition) => transition.accountId === account.id).sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))[0]?.fromMode ?? account.mode;
  return { record_type: 'account', id: account.id, name: account.name, account_kind: account.kind, account_mode: initialMode, currency: account.currency ?? '', amount_minor: account.amountMinor ?? '', active: account.active ? '1' : '0', linked_bank_account_id: account.linkedBankAccountId ?? '' };
}

function instrumentFields(instrument: CanonicalInstrument & Record<string, unknown>): Record<string, unknown> {
  return { record_type: 'instrument', id: instrument.id, exchange: instrument.exchange, ticker: instrument.ticker, type: instrument.type, currency: instrument.currency };
}

function valuationFields(valuation: HoldingValuation & { id: string }): Record<string, unknown> {
  const instrument = valuation.instrument.exchange ? valuation.instrument : null;
  return { record_type: 'valuation', id: valuation.id, account_id: valuation.accountId, as_of: valuation.asOf, date: valuation.asOf, price_minor: valuation.priceMinor, source: valuation.source, provider: valuation.provider ?? '', ...(instrument ? { exchange: instrument.exchange, ticker: instrument.ticker, type: instrument.type, currency: instrument.currency } : {}) };
}

function transitionFields(transition: ImportModeTransition): Record<string, unknown> {
  return {
    record_type: 'mode_transition',
    id: transition.id,
    account_id: transition.accountId,
    currency: transition.accountCurrency ?? '',
    date: transition.effectiveDate,
    effective_date: transition.effectiveDate,
    from_mode: transition.fromMode,
    to_mode: transition.toMode,
    opening_cash_minor: transition.openingCashMinor ?? '',
    opening_value_minor: transition.openingValueMinor ?? '',
    opening_positions_json: transition.openingPositions.length ? JSON.stringify(transition.openingPositions) : '',
    transition_json: storedTransitionPayload(transition),
  };
}

function withoutTransitionSyntheticRows(
  transitions: readonly ImportModeTransition[],
  valuations: readonly (HoldingValuation & { id: string })[],
  events: readonly WealthEvent[],
): { readonly valuations: readonly (HoldingValuation & { id: string })[]; readonly events: readonly WealthEvent[] } {
  const eventIds = new Set<string>();
  const valuationIds = new Set<string>();
  transitions.forEach((transition) => {
    transitionOpeningEvents(transition).forEach((event) => { eventIds.add(event.id); eventIds.add(event.sourceId); });
    transitionOpeningValuations(transition).forEach((valuation) => valuationIds.add(valuation.id));
  });
  return { valuations: valuations.filter((valuation) => !valuationIds.has(valuation.id)), events: events.filter((event) => !eventIds.has(event.id) && !eventIds.has(event.sourceId)) };
}

export function wealthCsvRows(
  accounts: readonly (WealthAccount & Record<string, unknown>)[],
  instruments: readonly (CanonicalInstrument & Record<string, unknown>)[],
  valuations: readonly (HoldingValuation & { id: string })[],
  events: readonly WealthEvent[],
  transitions: readonly ImportModeTransition[] = [],
): string[] {
  const filtered = withoutTransitionSyntheticRows(transitions, valuations, events);
  return [
    ...accounts.map((account) => row(accountFields(account, transitions))),
    ...instruments.map((instrument) => row(instrumentFields(instrument))),
    ...transitions.map((transition) => row(transitionFields(transition))),
    ...filtered.valuations.map((valuation) => row(valuationFields(valuation))),
    ...filtered.events.map((event) => row(eventExportFields(event))),
  ];
}

export function wealthCsvDocument(
  accounts: readonly (WealthAccount & Record<string, unknown>)[],
  instruments: readonly (CanonicalInstrument & Record<string, unknown>)[],
  valuations: readonly (HoldingValuation & { id: string })[],
  events: readonly WealthEvent[],
  transitions: readonly ImportModeTransition[] = [],
): string {
  return `${[CANONICAL_CSV_HEADERS.join(','), ...wealthCsvRows(accounts, instruments, valuations, events, transitions)].join('\n')}\n`;
}

export const WEALTH_CSV_TEMPLATE = `${CANONICAL_CSV_HEADERS.join(',')}\n`;
