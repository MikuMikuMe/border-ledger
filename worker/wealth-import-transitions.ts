import type { CanonicalInstrument, WealthEvent, WealthAccount } from '../src/domain/wealth-types';
import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import type { ImportModeTransition } from './wealth-import-types';

interface StoredModeTransitionRow {
  readonly account_id: string;
  readonly effective_date: string;
  readonly from_mode: WealthAccount['mode'];
  readonly to_mode: WealthAccount['mode'];
  readonly payload_json: string;
}

interface TransitionAccount {
  readonly id: string;
  readonly mode: WealthAccount['mode'];
  readonly currency?: string | null;
}

export interface TransitionOpeningValuation {
  readonly id: string;
  readonly accountId: string;
  readonly instrument: CanonicalInstrument | null;
  readonly asOf: string;
  readonly priceMinor: number;
  readonly source: 'manual';
  readonly provider: null;
}

export function transitionRecordId(accountId: string, effectiveDate: string): string {
  return `mode-transition:${accountId}:${effectiveDate}`;
}

function transitionPayload(transition: ImportModeTransition): Record<string, unknown> {
  return {
    fromMode: transition.fromMode,
    toMode: transition.toMode,
    effectiveDate: transition.effectiveDate,
    openingCashMinor: transition.openingCashMinor ?? null,
    openingValueMinor: transition.openingValueMinor ?? null,
    openingPositions: transition.openingPositions,
  };
}

function normalizeStoredTransition(row: StoredModeTransitionRow, accountCurrency: string | null): ImportModeTransition {
  const payload = JSON.parse(row.payload_json) as Partial<ImportModeTransition>;
  return {
    id: transitionRecordId(row.account_id, row.effective_date),
    accountId: row.account_id,
    fromMode: row.from_mode,
    toMode: row.to_mode,
    effectiveDate: row.effective_date,
    openingCashMinor: typeof payload.openingCashMinor === 'number' ? payload.openingCashMinor : null,
    openingValueMinor: typeof payload.openingValueMinor === 'number' ? payload.openingValueMinor : null,
    openingPositions: Array.isArray(payload.openingPositions) ? payload.openingPositions : [],
    accountCurrency,
  };
}

export async function readImportModeTransitions(
  db: D1Database,
  context: FinancialContext,
  accounts: readonly TransitionAccount[] = [],
): Promise<ImportModeTransition[]> {
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency ?? null]));
  const rows = await db.prepare(`SELECT account_id,effective_date,from_mode,to_mode,payload_json
    FROM wealth_account_mode_transitions WHERE ledger_id=? ORDER BY account_id,effective_date`).bind(context.ledgerId).all<StoredModeTransitionRow>();
  return rows.results.map((row) => normalizeStoredTransition(row, currencyByAccount.get(row.account_id) ?? null));
}

export function storedTransitionPayload(transition: ImportModeTransition): string {
  return JSON.stringify(transitionPayload(transition));
}

function openingPositionId(transition: ImportModeTransition, index: number): string {
  return transition.openingPositions[index]?.id ?? `opening-position:${transition.accountId}:${transition.effectiveDate}:${index}`;
}

export function transitionOpeningEvents(transition: ImportModeTransition, startingSequence = 0): WealthEvent[] {
  const events: WealthEvent[] = [];
  let sequence = startingSequence;
  if (transition.openingCashMinor !== null && transition.openingCashMinor !== undefined) {
    const id = `opening-cash:${transition.accountId}:${transition.effectiveDate}`;
    events.push({
      id,
      sourceId: id,
      date: transition.effectiveDate,
      sequence: sequence++,
      kind: 'opening_cash',
      accountId: transition.accountId,
      money: { currency: transition.accountCurrency ?? 'CAD', amountMinor: transition.openingCashMinor },
    });
  }
  transition.openingPositions.forEach((position, index) => {
    const id = openingPositionId(transition, index);
    events.push({
      id,
      sourceId: position.sourceId ?? id,
      date: transition.effectiveDate,
      sequence: sequence++,
      kind: 'opening_position',
      accountId: transition.accountId,
      instrument: position.instrument,
      quantity: position.quantity,
      basis: position.basis ?? null,
    });
  });
  return events;
}

export function transitionOpeningValuations(transition: ImportModeTransition): TransitionOpeningValuation[] {
  if (hasAggregateOpeningValue(transition)) {
    const id = `account-value:${transition.accountId}:${transition.effectiveDate}`;
    return [{ id, accountId: transition.accountId, instrument: null, asOf: transition.effectiveDate, priceMinor: transition.openingValueMinor, source: 'manual', provider: null }];
  }
  return transition.openingPositions.flatMap((position, index) => position.priceMinor === null || position.priceMinor === undefined ? [] : [{
    id: `${openingPositionId(transition, index)}:valuation`,
    accountId: transition.accountId,
    instrument: position.instrument,
    asOf: transition.effectiveDate,
    priceMinor: position.priceMinor,
    source: 'manual' as const,
    provider: null,
  }]);
}

function hasAggregateOpeningValue(transition: ImportModeTransition): transition is ImportModeTransition & { readonly openingValueMinor: number } {
  return transition.toMode === 'aggregate' && transition.openingValueMinor !== null && transition.openingValueMinor !== undefined;
}

export function transitionOpeningEventCount(transition: ImportModeTransition): number {
  return transitionOpeningEvents(transition).length;
}

export function transitionSyntheticEventIds(transition: ImportModeTransition): ReadonlySet<string> {
  return new Set(transitionOpeningEvents(transition).flatMap((event) => [event.id, event.sourceId]));
}

export function transitionSyntheticValuationIds(transition: ImportModeTransition): ReadonlySet<string> {
  return new Set(transitionOpeningValuations(transition).map((valuation) => valuation.id));
}

export function initialAccountMode(account: TransitionAccount, transitions: readonly ImportModeTransition[]): WealthAccount['mode'] {
  const first = transitions.filter(transition => transition.accountId === account.id).sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))[0];
  return first?.fromMode ?? account.mode;
}

export function transitionModeAtDate(account: TransitionAccount, transitions: readonly ImportModeTransition[], asOf: string): WealthAccount['mode'] {
  const history = transitions.filter((transition) => transition.accountId === account.id).sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  const prior = history.filter((transition) => transition.effectiveDate <= asOf).at(-1);
  return prior?.toMode ?? history[0]?.fromMode ?? account.mode;
}

export function transitionAccountModeAtEnd(account: TransitionAccount, transitions: readonly ImportModeTransition[]): WealthAccount['mode'] {
  return transitionModeAtDate(account, transitions, '9999-12-31');
}
