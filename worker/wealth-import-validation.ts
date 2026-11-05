import { createWealthAccountRegistry } from '../src/domain/wealth';
import type { WealthAccount, WealthEvent } from '../src/domain/wealth-types';
import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import {
  existingAccountRecord,
  importRecordAccount,
  importRecordEvent,
  importRecordTransition,
  importRecordValuation,
  orderImportRecords,
} from './wealth-import-records';
import { transitionModeAtDate, transitionOpeningEvents } from './wealth-import-transitions';
import { replayWealthEventsAcrossModeSegments, type WealthSegmentProjectionContext, type WealthSegmentTransition } from './wealth-segment-projection';
import type { ImportModeTransition, ImportValidationServices, WealthImportRecord } from './wealth-import-types';

interface BankAliasRow {
  readonly transaction_id: string;
  readonly id: string;
  readonly identity_key: string;
  readonly provider_transaction_id: string | null;
  readonly provider_pending_transaction_id: string | null;
  readonly bank_source_id: string | null;
  readonly bank_row_id: string | null;
  readonly event_id: string | null;
  readonly bank_reference: string | null;
}

type BankAliasGroups = ReadonlyMap<string, ReadonlySet<string>>;

interface ImportedBankLink {
  readonly sourceId: string;
  readonly claimSourceId: string;
  readonly linkedBankSourceId: string;
  readonly event: WealthEvent;
}

const BANK_ALIAS_FIELDS = ['transaction_id', 'id', 'identity_key', 'provider_transaction_id', 'provider_pending_transaction_id', 'bank_source_id', 'bank_row_id', 'event_id', 'bank_reference'] as const;

export function importedEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') return correctionAccountIds(event);
  return 'accountId' in event ? [event.accountId] : [];
}

function correctionAccountIds(event: Extract<WealthEvent, { kind: 'correction' }>): string[] {
  const replacement = event.replacement;
  if (replacement.kind === 'transfer') return [replacement.fromAccountId, replacement.toAccountId];
  return 'accountId' in replacement ? [replacement.accountId] : [];
}

function accountValidationErrors(accountRecords: readonly WealthImportRecord[]): { readonly accounts: readonly WealthAccount[]; readonly ids: ReadonlySet<string>; readonly errors: readonly string[] } {
  const accounts = accountRecords.map((record) => importRecordAccount(record)!).filter(Boolean);
  try {
    createWealthAccountRegistry(accounts);
    return { accounts, ids: new Set(accounts.map((account) => account.id)), errors: [] };
  } catch (error) {
    return { accounts, ids: new Set(accounts.map((account) => account.id)), errors: [error instanceof Error ? error.message : 'The imported accounts are invalid.'] };
  }
}

function importedReferenceErrors(records: readonly WealthImportRecord[], accountIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const eventContext: EventReferenceContext = { accountIds, errors };
  for (const record of records) {
    appendValuationReferenceError(record, accountIds, errors);
    appendEventReferenceErrors(record, eventContext);
  }
  return errors;
}

function appendValuationReferenceError(record: WealthImportRecord, accountIds: ReadonlySet<string>, errors: string[]): void {
  const valuation = importRecordValuation(record);
  if (valuation && !accountIds.has(valuation.accountId)) errors.push(`Valuation ${valuation.id} references an unknown account.`);
}

interface ModeTimelineAccount {
  readonly id: string;
  readonly mode: WealthAccount['mode'];
  readonly currency?: string | null;
}

function transitionRecords(records: readonly WealthImportRecord[]): ImportModeTransition[] {
  return records.flatMap((record) => {
    const transition = importRecordTransition(record);
    return transition ? [transition] : [];
  });
}

function transitionTimelineErrors(accounts: readonly WealthAccount[], transitions: readonly ImportModeTransition[], existingAccountIds: ReadonlySet<string>, importedTransitionIds: ReadonlySet<string>): string[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const errors: string[] = [];
  const grouped = groupTransitions(byId, transitions, errors);
  grouped.forEach((history, accountId) => errors.push(...validateTransitionHistory(byId.get(accountId)!, history, existingAccountIds.has(accountId), importedTransitionIds)));
  return errors;
}

function groupTransitions(accounts: ReadonlyMap<string, WealthAccount>, transitions: readonly ImportModeTransition[], errors: string[]): Map<string, ImportModeTransition[]> {
  const grouped = new Map<string, ImportModeTransition[]>();
  for (const transition of transitions) {
    if (!accounts.has(transition.accountId)) {
      errors.push(`Mode transition ${transition.id} references an unknown account.`);
      continue;
    }
    const history = grouped.get(transition.accountId) ?? [];
    history.push(transition);
    grouped.set(transition.accountId, history);
  }
  return grouped;
}

function validateTransitionHistory(account: WealthAccount, history: readonly ImportModeTransition[], existingAccount: boolean, importedTransitionIds: ReadonlySet<string>): string[] {
  const ordered = [...history].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  const storedHistory = ordered.filter((transition) => !importedTransitionIds.has(transition.id));
  const expectedAccountMode = existingAccount ? storedHistory.at(-1)?.toMode ?? ordered[0]?.fromMode : ordered[0]?.fromMode;
  return ordered.flatMap((transition, index) => transitionErrors(account, transition, ordered[index - 1], ordered[0]?.fromMode ?? account.mode))
    .concat(expectedAccountMode && account.mode !== expectedAccountMode ? [`Account ${account.id} mode does not match its transition history.`] : []);
}

function transitionErrors(account: WealthAccount, transition: ImportModeTransition, prior: ImportModeTransition | undefined, initialMode: WealthAccount['mode']): string[] {
  const errors: string[] = [];
  const expectedFrom = prior?.toMode ?? initialMode;
  if (prior && prior.effectiveDate === transition.effectiveDate) errors.push(`Mode transition ${transition.id} duplicates an effective date.`);
  if (transition.fromMode !== expectedFrom) errors.push(`Mode transition ${transition.id} does not follow the account mode at its effective date.`);
  if (transition.fromMode === transition.toMode) errors.push(`Mode transition ${transition.id} must change the account representation.`);
  if (transition.toMode === 'holdings' && account.kind !== 'brokerage') errors.push(`Mode transition ${transition.id} requires a brokerage account for holdings mode.`);
  return errors;
}

function transitionHistoryErrors(
  importedTransitions: readonly ImportModeTransition[],
  existingTransitions: readonly ImportModeTransition[],
  existingEvents: readonly WealthEvent[],
  existingValuations: readonly { readonly accountId: string; readonly asOf: string }[],
): string[] {
  const errors: string[] = [];
  for (const transition of importedTransitions) {
    const dates = [
      ...existingEvents.flatMap((event) => importedEventAccountIds(event).includes(transition.accountId) ? [event.date] : []),
      ...existingValuations.flatMap((valuation) => valuation.accountId === transition.accountId ? [valuation.asOf] : []),
      ...existingTransitions.flatMap((prior) => prior.accountId === transition.accountId ? [prior.effectiveDate] : []),
    ];
    const latest = dates.sort().at(-1);
    if (latest && latest >= transition.effectiveDate) errors.push(`Mode transition ${transition.id} must be after existing account history.`);
  }
  return errors;
}

function eventRequiresHoldings(event: WealthEvent): boolean {
  if (event.kind === 'correction') return event.replacement.kind === 'transfer' ? event.replacement.transferKind === 'position' : true;
  if (event.kind === 'transfer') return event.transferKind === 'position';
  return ['opening_position', 'opening_cash', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split'].includes(event.kind);
}

function eventModeDate(event: WealthEvent): string {
  return event.kind === 'correction' ? event.replacement.date : event.date;
}

function transferPairs(event: WealthEvent): Array<readonly [string, string]> {
  if (event.kind === 'transfer') return [[event.fromAccountId, event.toAccountId]];
  if (event.kind === 'correction' && event.replacement.kind === 'transfer') return [[event.replacement.fromAccountId, event.replacement.toAccountId]];
  return [];
}

function modeAtDate(account: ModeTimelineAccount, transitions: readonly ImportModeTransition[], asOf: string): WealthAccount['mode'] {
  return transitionModeAtDate(account, transitions, asOf);
}

function valuationModeError(valuation: NonNullable<ReturnType<typeof importRecordValuation>>, accounts: ReadonlyMap<string, WealthAccount>, transitions: readonly ImportModeTransition[]): string | null {
  const account = accounts.get(valuation.accountId);
  if (!account) return null;
  const expected = valuation.instrument ? 'holdings' : 'aggregate';
  return modeAtDate(account, transitions, valuation.asOf) === expected ? null : `Valuation ${valuation.id} requires a ${expected} account on ${valuation.asOf}.`;
}

function eventModeErrors(event: WealthEvent, accounts: ReadonlyMap<string, WealthAccount>, transitions: readonly ImportModeTransition[]): string[] {
  const errors: string[] = [];
  const date = eventModeDate(event);
  const requiresHoldings = eventRequiresHoldings(event);
  const mismatched = importedEventAccountIds(event).some((accountId) => {
    const account = accounts.get(accountId);
    return Boolean(account && modeAtDate(account, transitions, date) !== 'holdings');
  });
  if (requiresHoldings && mismatched) errors.push(`Event ${event.sourceId} requires holdings accounts on ${date}.`);
  const mixed = transferPairs(event).some(([fromId, toId]) => {
    const from = accounts.get(fromId);
    const to = accounts.get(toId);
    return Boolean(from && to && modeAtDate(from, transitions, date) !== modeAtDate(to, transitions, date));
  });
  if (mixed) errors.push(`Event ${event.sourceId} transfers between aggregate and holdings accounts.`);
  return errors;
}

function importedModeErrors(records: readonly WealthImportRecord[], accounts: readonly WealthAccount[], transitions: readonly ImportModeTransition[]): string[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return records.flatMap((record) => {
    const valuation = importRecordValuation(record);
    const valuationError = valuation ? valuationModeError(valuation, byId, transitions) : null;
    const event = importRecordEvent(record);
    return [...(valuationError ? [valuationError] : []), ...(event ? eventModeErrors(event, byId, transitions) : [])];
  });
}

interface EventReferenceContext {
  readonly accountIds: ReadonlySet<string>;
  readonly errors: string[];
}

function appendEventReferenceErrors(record: WealthImportRecord, context: EventReferenceContext): void {
  const event = importRecordEvent(record);
  if (!event) return;
  if (importedEventAccountIds(event).some((id) => !context.accountIds.has(id))) context.errors.push(`Event ${event.sourceId} references an unknown account.`);
}

function importedBankLinks(events: readonly WealthEvent[]): ImportedBankLink[] {
  const correctionsByTarget = new Map(events.filter((event): event is Extract<WealthEvent, { kind: 'correction' }> => event.kind === 'correction').map((event) => [event.targetSourceId, event]));
  const links: ImportedBankLink[] = [];
  for (const event of events) {
    if (event.linkedBankSourceId) {
      const correction = correctionsByTarget.get(event.sourceId);
      const retainsLink = correction?.replacement.linkedBankSourceId === event.linkedBankSourceId;
      links.push({ sourceId: event.sourceId, claimSourceId: retainsLink ? correction!.sourceId : event.sourceId, linkedBankSourceId: event.linkedBankSourceId, event });
    }
    if (event.kind === 'correction' && event.replacement.linkedBankSourceId) {
      links.push({
        sourceId: `${event.sourceId}:replacement`,
        claimSourceId: event.sourceId,
        linkedBankSourceId: event.replacement.linkedBankSourceId,
        event: { ...event, linkedBankSourceId: event.replacement.linkedBankSourceId } as WealthEvent,
      });
    }
  }
  return links;
}

function aliasValues(row: BankAliasRow): string[] {
  return BANK_ALIAS_FIELDS.map((field) => row[field]).filter((value): value is string => typeof value === 'string' && value.length > 0);
}

async function readBankAliasGroups(db: D1Database, context: FinancialContext, links: readonly ImportedBankLink[]): Promise<BankAliasGroups> {
  const requested = [...new Set(links.map((link) => link.linkedBankSourceId))];
  if (requested.length === 0) return new Map();
  const placeholders = requested.map(() => '?').join(',');
  const match = BANK_ALIAS_FIELDS.map((field) => `${field} IN (${placeholders})`).join(' OR ');
  const matched = await db.prepare(`SELECT DISTINCT transaction_id FROM transaction_source_records WHERE ledger_id=? AND (${match})`).bind(context.ledgerId, ...BANK_ALIAS_FIELDS.flatMap(() => requested)).all<{ transaction_id: string }>();
  const transactionIds = matched.results.map((row) => row.transaction_id);
  if (transactionIds.length === 0) return new Map();
  const transactionPlaceholders = transactionIds.map(() => '?').join(',');
  const aliases = await db.prepare(`SELECT transaction_id,id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference FROM transaction_source_records WHERE ledger_id=? AND transaction_id IN (${transactionPlaceholders})`).bind(context.ledgerId, ...transactionIds).all<BankAliasRow>();
  const groups = new Map<string, Set<string>>();
  for (const row of aliases.results) {
    for (const value of aliasValues(row)) {
      const transactions = groups.get(value) ?? new Set<string>();
      transactions.add(row.transaction_id);
      groups.set(value, transactions);
    }
  }
  return groups;
}

function bankAliasGroup(linked: string, aliases: BankAliasGroups): string | null {
  const transactions = aliases.get(linked);
  if (!transactions) return `unresolved:${linked}`;
  if (transactions.size !== 1) return null;
  return [...transactions][0];
}

function correctedBankClaim(link: ImportedBankLink, corrections: ReadonlyMap<string, Extract<WealthEvent, { kind: 'correction' }>>, aliases: BankAliasGroups): string {
  const group = bankAliasGroup(link.linkedBankSourceId, aliases);
  if (group === null) return link.claimSourceId;
  let claim = link.claimSourceId;
  const visited = new Set<string>();
  while (!visited.has(claim)) {
    visited.add(claim);
    const correction = corrections.get(claim);
    if (!correction) break;
    const replacementLink = correction.replacement.linkedBankSourceId;
    if (!replacementLink) break;
    if (bankAliasGroup(replacementLink, aliases) !== group) break;
    claim = correction.sourceId;
  }
  return claim;
}

interface ImportedBankClaimContext {
  readonly aliases: BankAliasGroups;
  readonly corrections: ReadonlyMap<string, Extract<WealthEvent, { kind: 'correction' }>>;
  readonly claimed: Map<string, string>;
}

function importedBankClaimError(link: ImportedBankLink, context: ImportedBankClaimContext): string | null {
  const group = bankAliasGroup(link.linkedBankSourceId, context.aliases);
  if (group === null) return `Event ${link.sourceId} references an ambiguous bank link; choose a transaction ID or unique source alias.`;
  const claim = correctedBankClaim(link, context.corrections, context.aliases);
  const prior = context.claimed.get(group);
  if (prior && prior !== claim) return `Event ${link.sourceId} conflicts with another imported bank link.`;
  context.claimed.set(group, claim);
  return null;
}

async function importedLinkErrors(db: D1Database, context: FinancialContext, records: readonly WealthImportRecord[], services: ImportValidationServices): Promise<string[]> {
  const errors: string[] = [];
  const events = records.flatMap((record) => {
    const event = importRecordEvent(record);
    return event ? [event] : [];
  });
  const links = importedBankLinks(events);
  const aliasGroups = await readBankAliasGroups(db, context, links);
  const corrections = new Map(events.filter((event): event is Extract<WealthEvent, { kind: 'correction' }> => event.kind === 'correction').map((event) => [event.targetSourceId, event]));
  const claims: ImportedBankClaimContext = { aliases: aliasGroups, corrections, claimed: new Map() };
  for (const link of links) {
    const claimError = importedBankClaimError(link, claims);
    if (claimError) { errors.push(claimError); continue; }
    try {
      await services.assertBankLinkAvailable(db, context, link.event);
    } catch (error) {
      if (services.isBankLinkConflict(error)) errors.push(`Event ${link.sourceId} conflicts with an existing bank link.`);
      else throw error;
    }
  }
  return errors;
}

function materializedImportEvents(records: readonly WealthImportRecord[], startingSequence: number): WealthEvent[] {
  let sequence = startingSequence;
  const events: WealthEvent[] = [];
  for (const record of records) {
    const transition = importRecordTransition(record);
    if (transition) {
      const opening = transitionOpeningEvents(transition, sequence);
      events.push(...opening);
      sequence += opening.length;
      continue;
    }
    const event = importRecordEvent(record);
    if (event) events.push({ ...event, sequence: sequence++ });
  }
  return events;
}

function segmentTransitions(transitions: readonly ImportModeTransition[]): WealthSegmentTransition[] {
  return transitions.map((transition) => ({ account_id: transition.accountId, effective_date: transition.effectiveDate, from_mode: transition.fromMode, to_mode: transition.toMode }));
}

function latestEventDate(events: readonly WealthEvent[]): string | null {
  return events.map((event) => event.date).sort().at(-1) ?? null;
}

interface ImportReplayQuery {
  readonly events: readonly WealthEvent[];
  readonly records: readonly WealthImportRecord[];
  readonly accounts: readonly WealthAccount[];
  readonly transitions: readonly ImportModeTransition[];
  readonly nextSequence: number;
}

function replayImportErrors(query: ImportReplayQuery): string[] {
  try {
    const importedEvents = materializedImportEvents(query.records, query.nextSequence);
    const proposedEvents = [...query.events, ...importedEvents];
    const asOf = latestEventDate(proposedEvents);
    if (asOf) {
      const context: WealthSegmentProjectionContext = { accounts: query.accounts, transitions: segmentTransitions(query.transitions) };
      replayWealthEventsAcrossModeSegments({ events: proposedEvents, context, asOf });
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'The imported portfolio could not be replayed.'];
  }
}

export async function validateImportPortfolio(db: D1Database, context: FinancialContext, records: readonly WealthImportRecord[], services: ImportValidationServices): Promise<string[]> {
  const existingAccounts = await services.readAccounts(db, context);
  const [existingEvents, existingValuations, existingTransitions] = await Promise.all([
    services.readStoredEvents(db, context),
    services.readStoredValuations(db, context),
    services.readModeTransitions(db, context, existingAccounts),
  ]);
  const nextSequence = Math.max(0, ...existingEvents.map((event) => event.sequence ?? 0)) + 1;
  const orderedRecords = orderImportRecords(records, nextSequence);
  const accountRecords = [...existingAccounts.map(existingAccountRecord), ...orderedRecords.filter((record) => record.recordType === 'account')];
  const accountState = accountValidationErrors(accountRecords);
  const errors = [...accountState.errors, ...importedReferenceErrors(orderedRecords, accountState.ids)];
  const importedTransitions = transitionRecords(orderedRecords);
  const allTransitions = [...existingTransitions, ...importedTransitions];
  errors.push(...transitionTimelineErrors(
    accountState.accounts,
    allTransitions,
    new Set(existingAccounts.map((account) => account.id)),
    new Set(importedTransitions.map((transition) => transition.id)),
  ));
  errors.push(...transitionHistoryErrors(importedTransitions, existingTransitions, existingEvents, existingValuations));
  errors.push(...importedModeErrors(orderedRecords, accountState.accounts, allTransitions));
  errors.push(...await importedLinkErrors(db, context, orderedRecords, services));
  errors.push(...replayImportErrors({ events: existingEvents, records: orderedRecords, accounts: accountState.accounts, transitions: allTransitions, nextSequence }));
  for (const valuation of existingValuations) if (valuation.priceMinor < 0) errors.push(`Valuation ${valuation.id} has an invalid price.`);
  return [...new Set(errors)];
}
