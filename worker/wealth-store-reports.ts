import {
  classifyWealthCashFlows,
  calculateModifiedDietz,
  createWealthReport,
  createWealthSnapshot,
  instrumentKey,
  resolveWealthEvents,
} from '../src/domain/wealth';
import type {
  ClassifiedWealthCashFlow,
  HoldingValuation,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashFlowRecord,
  WealthEvent,
  WealthReport,
  WealthSnapshot,
} from '../src/domain/wealth-types';
import type { WealthAllocationRow, WealthFxStatus, WealthHistoryPoint } from '../src/domain/wealth-api-types';
import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import { readLunchFlowBalances, type StoredBalance } from './lunchflow-balance-store';
import { readWealthQuotes, wealthQuoteToHoldingValuation, type WealthQuoteInstrument } from './wealth-quotes';
import { convertWealthTotals } from './wealth-store-fx';
import { cashFlowRecords, classifyInvestmentCashFlows, portfolioFlowRecords, summarizeCashFlows, summarizeInvestmentCashFlows, type CashFlowTotal, type InvestmentCashFlowRecord } from './wealth-store-cashflows';
import type { StoredModeTransition, WealthReportDependencies } from './wealth-store';
import type { WealthSegmentProjectionContext } from './wealth-segment-projection';

export interface WealthReportRange {
  readonly asOf: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface WealthReportReadServices {
  readonly accounts: (db: D1Database, context: FinancialContext) => Promise<readonly (WealthAccount & { amountMinor?: number | null })[]>;
  readonly transitions: (db: D1Database, context: FinancialContext) => Promise<readonly StoredModeTransition[]>;
  readonly events: (db: D1Database, context: FinancialContext) => Promise<WealthEvent[]>;
  readonly valuations: (db: D1Database, context: FinancialContext) => Promise<readonly (HoldingValuation & { valueMinor?: number; id: string })[]>;
  readonly balanceHistory: (db: D1Database, context: FinancialContext) => Promise<StoredBalance[]>;
  readonly currentRevision: (db: D1Database, context: FinancialContext) => Promise<number>;
  readonly accountsAtDate: (accounts: readonly (WealthAccount & { amountMinor?: number | null })[], transitions: readonly StoredModeTransition[], asOf: string) => (WealthAccount & { amountMinor?: number | null })[];
  readonly modeAtDate: (account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly StoredModeTransition[], asOf: string) => WealthAccount['mode'];
  readonly modeSegment: (account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly StoredModeTransition[], asOf: string) => { mode: WealthAccount['mode']; startDate: string | null };
  readonly segmentReplayAccounts: (accounts: readonly WealthAccount[], transitions: readonly StoredModeTransition[], asOf: string) => readonly WealthAccount[];
  readonly eventsForCurrentModeSegment: (events: readonly WealthEvent[], context: WealthSegmentProjectionContext, asOf: string) => readonly WealthEvent[];
}

interface WealthReportProjectionInput {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly range: WealthReportRange;
  readonly reportingCurrency: 'CAD' | null;
  readonly dependencies: WealthReportDependencies;
  readonly services: WealthReportReadServices;
}

function linkedStatus(account: WealthAccount, balances: readonly StoredBalance[], asOf: string) {
  if (account.kind !== 'linked_bank' || !account.linkedBankAccountId) return null;
  const balance = balances.filter((candidate) => candidate.accountId === account.linkedBankAccountId && candidate.observedAt.slice(0, 10) <= asOf).sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.stale - left.stale)[0];
  if (!balance) return { state: 'missing' as const, balance: null, observedAt: null };
  if (balance.stale || balance.observedAt.slice(0, 10) > asOf) return { state: 'stale' as const, balance: null, observedAt: balance.observedAt };
  return { state: 'fresh' as const, balance: balance.amountMinor, observedAt: balance.observedAt };
}
function aggregateValue(account: WealthAccount & { amountMinor?: number | null }, valuations: readonly (HoldingValuation & { valueMinor?: number })[], balances: readonly StoredBalance[], asOf: string, historical: boolean) {
  if (account.mode !== 'aggregate') return null;
  const dated = valuations.filter((item) => item.accountId === account.id && item.asOf <= asOf && item.valueMinor !== undefined).sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
  if (dated) return { amount: account.kind === 'debt' ? -Math.abs(dated.valueMinor!) : dated.valueMinor!, observedAt: dated.asOf, state: 'fresh' as const };
  const linked = linkedStatus(account, balances, asOf);
  if (linked) return { amount: linked.balance === null ? null : account.kind === 'debt' ? -Math.abs(linked.balance) : linked.balance, observedAt: linked.observedAt, state: linked.state };
  if (historical) return { amount: null, observedAt: null, state: 'missing' as const };
  return { amount: null, observedAt: null, state: 'missing' as const };
}
function addTotal(target: Record<string, number>, currencyCode: string | undefined, amount: number | null) {
  if (!currencyCode || amount === null) return;
  target[currencyCode] = (target[currencyCode] ?? 0) + amount;
}

function wealthEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') {
    const replacement = event.replacement;
    return replacement.kind === 'transfer' ? [replacement.fromAccountId, replacement.toAccountId] : 'accountId' in replacement ? [replacement.accountId] : [];
  }
  return 'accountId' in event ? [event.accountId] : [];
}

function isPortfolioBaseEvent(event: WealthEvent, investmentIds: ReadonlySet<string>): boolean {
  if (event.kind === 'reversal' || event.kind === 'correction') return false;
  const accountIds = wealthEventAccountIds(event);
  return accountIds.length > 0 && accountIds.every((id) => investmentIds.has(id));
}

function addPortfolioControls(events: readonly WealthEvent[], sources: Set<string>): void {
  for (const event of events) {
    if (!isPortfolioControl(event)) continue;
    if (!sources.has(event.targetSourceId)) continue;
    sources.add(event.sourceId);
  }
}

function isPortfolioControl(event: WealthEvent): event is Extract<WealthEvent, { kind: 'reversal' | 'correction' }> {
  return event.kind === 'reversal' || event.kind === 'correction';
}

function portfolioEventSources(events: readonly WealthEvent[], investmentIds: ReadonlySet<string>): Set<string> {
  const sources = new Set(events.filter((event) => isPortfolioBaseEvent(event, investmentIds)).map((event) => event.sourceId));
  let previousSize = -1;
  while (sources.size !== previousSize) { previousSize = sources.size; addPortfolioControls(events, sources); }
  return sources;
}

function addControlLineage(sourceId: string, controls: ReadonlyMap<string, Extract<WealthEvent, { kind: 'correction' | 'reversal' }>>, sources: Set<string>): void {
  const control = controls.get(sourceId);
  if (!control || sources.has(sourceId)) return;
  sources.add(sourceId);
  addControlLineage(control.targetSourceId, controls, sources);
}

function portfolioHistorySourceIds(events: readonly WealthEvent[], effectiveEvents: readonly WealthEvent[], investmentIds: ReadonlySet<string>): Set<string> {
  const sources = portfolioEventSources(events, investmentIds);
  const controls = new Map(events.filter((event): event is Extract<WealthEvent, { kind: 'correction' | 'reversal' }> => isPortfolioControl(event)).map((event) => [event.sourceId, event]));
  for (const sourceId of portfolioEventSources(effectiveEvents, investmentIds)) {
    if (sourceId.endsWith(':replacement')) addControlLineage(sourceId.slice(0, -':replacement'.length), controls, sources);
  }
  return sources;
}

function addAggregateStatus(target: Record<string, 'complete' | 'incomplete'>, currencyCode: string | undefined, state: 'fresh' | 'stale' | 'missing'): void {
  if (!currencyCode) return;
  if (state !== 'fresh') {
    target[currencyCode] = 'incomplete';
    return;
  }
  target[currencyCode] ??= 'complete';
}

function holdingsOnlySnapshot(base: WealthSnapshot, accounts: readonly WealthAccount[]): WealthSnapshot {
  const holdingsIds = new Set(accounts.filter((account) => account.mode === 'holdings').map((account) => account.id));
  const positions = base.positions.filter((position) => holdingsIds.has(position.accountId));
  const cash = base.cash.filter((balance) => holdingsIds.has(balance.accountId));
  const totals: Record<string, number> = {};
  const status: Record<string, 'complete' | 'incomplete'> = {};
  for (const balance of cash) {
    addTotal(totals, balance.currency, balance.amountMinor);
    status[balance.currency] ??= 'complete';
  }
  for (const position of positions) {
    if (position.quantity === '0') continue;
    if (position.marketValueMinor === null) {
      status[position.instrument.currency] = 'incomplete';
      continue;
    }
    addTotal(totals, position.instrument.currency, position.marketValueMinor);
    status[position.instrument.currency] ??= 'complete';
  }
  return {
    ...base,
    positions,
    cash,
    totalByCurrency: Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))),
    totalStatusByCurrency: Object.fromEntries(Object.entries(status).sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function domainSnapshot(
  accounts: readonly (WealthAccount & { amountMinor?: number | null })[], transitions: readonly StoredModeTransition[], events: readonly WealthEvent[], valuations: readonly (HoldingValuation & { valueMinor?: number })[], balances: readonly StoredBalance[], asOf: string, services: WealthReportReadServices, historical = false,
): Promise<WealthSnapshot & { accounts: readonly (WealthAccount & Record<string, unknown>)[]; balanceStatuses: readonly Record<string, unknown>[] }> {
  const datedAccounts = services.accountsAtDate(accounts, transitions, asOf);
  const normalValuations = valuations.filter((item) => {
    if (!item.instrument.exchange) return false;
    const account = accounts.find((candidate) => candidate.id === item.accountId);
    if (!account) return false;
    const segment = services.modeSegment(account, transitions, asOf);
    return segment.mode === 'holdings' && (segment.startDate === null || item.asOf >= segment.startDate);
  });
  const domainEvents = services.eventsForCurrentModeSegment(events, { accounts, transitions }, asOf);
  const replayAccounts = services.segmentReplayAccounts(accounts, transitions, asOf);
  const base = holdingsOnlySnapshot(createWealthSnapshot(domainEvents, { asOf, accounts: replayAccounts, valuations: normalValuations }), datedAccounts);
  const totals = { ...base.totalByCurrency } as Record<string, number>;
  const totalStatusByCurrency = { ...base.totalStatusByCurrency } as Record<string, 'complete' | 'incomplete'>;
  const statuses: Record<string, unknown>[] = [];
  const renderedAccounts = datedAccounts.map((account) => {
    const value = aggregateValue(account, valuations, balances, asOf, historical);
    if (value) { addTotal(totals, account.currency, value.amount); addAggregateStatus(totalStatusByCurrency, account.currency, value.state); statuses.push({ accountId: account.id, state: value.state, observedAt: value.observedAt }); }
    return { ...account, ...(value ? { valueMinor: value.amount, valueState: value.state, valueObservedAt: value.observedAt } : {}) };
  });
  return { ...base, accounts: renderedAccounts, totalByCurrency: Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))), totalStatusByCurrency: Object.fromEntries(Object.entries(totalStatusByCurrency).sort(([left], [right]) => left.localeCompare(right))), balanceStatuses: statuses };
}

function visibleEffectiveEvents(events: readonly WealthEvent[], asOf: string): readonly WealthEvent[] {
  return resolveWealthEvents(events.filter((event) => event.date <= asOf));
}

function isControlEvent(event: WealthEvent): boolean {
  return event.kind === 'correction' || event.kind === 'reversal';
}

function addDiscoveryVariants(variants: Map<string, WealthEvent>, events: readonly WealthEvent[]): void {
  for (const event of events) variants.set(event.sourceId, event);
}

function historicalDiscoveryEvents(events: readonly WealthEvent[], asOf: string): readonly WealthEvent[] {
  const variants = new Map<string, WealthEvent>();
  addDiscoveryVariants(variants, events.filter((event) => event.date <= asOf && !isControlEvent(event)));
  const controlDates = new Set<string>([
    asOf,
    ...events.filter((event) => isControlEvent(event) && event.date <= asOf).map((event) => event.date),
  ]);
  for (const date of controlDates) addDiscoveryVariants(variants, visibleEffectiveEvents(events, date));
  return [...variants.values()];
}

function mergeBalances(history: readonly StoredBalance[], latest: readonly StoredBalance[]): StoredBalance[] {
  const seen = new Set<string>();
  const merged: StoredBalance[] = [];
  for (const balance of [...latest, ...history]) {
    const key = `${balance.accountId}|${balance.currency}|${balance.amountMinor}|${balance.observedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(balance);
  }
  return merged;
}

async function mergeProviderValuations(
  db: D1Database,
  context: FinancialContext,
  accounts: readonly WealthAccount[],
  transitions: readonly StoredModeTransition[],
  events: readonly WealthEvent[],
  valuations: readonly (HoldingValuation & { valueMinor?: number; id: string })[],
  asOf: string,
  services: WealthReportReadServices,
) {
  const accountInstruments = new Map<string, { instrument: WealthQuoteInstrument; accountIds: Set<string> }>();
  const discoveryEvents = historicalDiscoveryEvents(events, asOf);
  for (const event of discoveryEvents) {
    if (!('instrument' in event) || !event.instrument) continue;
    const instrument = event.instrument as WealthQuoteInstrument;
    const key = instrumentKey(instrument);
    const current = accountInstruments.get(key) ?? { instrument, accountIds: new Set<string>() };
    for (const accountId of wealthEventAccountIds(event)) {
      if (accounts.some((account) => account.id === accountId && services.modeAtDate(account, transitions, event.date) === 'holdings')) current.accountIds.add(accountId);
    }
    accountInstruments.set(key, current);
  }
  if (accountInstruments.size === 0) return valuations;
  const quotes = await readWealthQuotes(db, context, [...accountInstruments.values()].map((entry) => entry.instrument), new Date(`${asOf}T23:59:59.999Z`));
  const existing = new Set(valuations.map((valuation) => `${valuation.accountId}:${valuation.instrument.exchange ? instrumentKey(valuation.instrument) : '__account__'}:${valuation.asOf}`));
  const merged = [...valuations];
  for (const quote of quotes) {
    const entry = accountInstruments.get(instrumentKey(quote.instrument));
    if (!entry) continue;
    for (const accountId of entry.accountIds) {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account || services.modeAtDate(account, transitions, quote.quoteDate) !== 'holdings') continue;
      const valuation = wealthQuoteToHoldingValuation(accountId, quote);
      const key = `${accountId}:${instrumentKey(valuation.instrument)}:${valuation.asOf}`;
      if (!existing.has(key)) {
        existing.add(key);
        merged.push({ ...valuation, id: `quote:${quote.revision}:${accountId}` });
      }
    }
  }
  return merged;
}

type SnapshotAccount = WealthAccount & { amountMinor?: number | null; valueMinor?: number | null; valueState?: 'fresh' | 'stale' | 'missing'; valueObservedAt?: string | null };
type SnapshotWithStatus = Omit<WealthSnapshot, 'accounts'> & { accounts: readonly SnapshotAccount[]; balanceStatuses: readonly Record<string, unknown>[] };
interface WealthHistoryPointInternal extends WealthHistoryPoint {}

function addBalanceCoverage(snapshot: SnapshotWithStatus, missing: Set<string>): boolean {
  let stale = false;
  for (const status of snapshot.balanceStatuses) {
    const accountId = typeof status.accountId === 'string' ? status.accountId : null;
    if (status.state === 'stale') stale = true;
    if (accountId && status.state === 'missing') missing.add(`account:${accountId}`);
  }
  return stale;
}

function addValuationCoverage(snapshot: SnapshotWithStatus, missing: Set<string>): void {
  for (const [currencyCode, state] of Object.entries(snapshot.totalStatusByCurrency)) if (state === 'incomplete') missing.add(`valuation:${currencyCode}`);
  for (const position of snapshot.positions) if (position.quantity !== '0' && position.valuation === null) missing.add(`position:${position.accountId}:${instrumentKey(position.instrument)}`);
}

function snapshotCoverage(snapshot: SnapshotWithStatus) {
  const missing = new Set<string>();
  const stale = addBalanceCoverage(snapshot, missing);
  addValuationCoverage(snapshot, missing);
  return { stale, missingData: [...missing].sort() };
}

function missingAccountObservation(account: SnapshotAccount, point: string): string | null {
  if (account.mode !== 'aggregate') return null;
  if (!account.valueObservedAt) return null;
  if (account.valueObservedAt.slice(0, 10) === point) return null;
  return `account:${account.id}:observation`;
}

function missingPositionObservation(position: WealthSnapshot['positions'][number], point: string): string | null {
  if (position.quantity === '0') return null;
  if (position.valuation?.asOf === point) return null;
  return `position:${position.accountId}:${instrumentKey(position.instrument)}:observation`;
}

function historyPointCoverage(snapshot: SnapshotWithStatus, point: string): { readonly complete: boolean; readonly stale: boolean; readonly missingData: readonly string[] } {
  const quality = snapshotCoverage(snapshot);
  const observations = [
    ...snapshot.accounts.map((account) => missingAccountObservation(account, point)),
    ...snapshot.positions.map((position) => missingPositionObservation(position, point)),
  ].filter((value): value is string => value !== null);
  const missingData = [...new Set([...quality.missingData, ...observations])].sort();
  const valuesComplete = Object.values(snapshot.totalStatusByCurrency).every((state) => state === 'complete');
  return { complete: !quality.stale && missingData.length === 0 && valuesComplete, stale: quality.stale, missingData };
}

type AllocationDraft = Omit<WealthAllocationRow, 'share'>;

function investmentAccountIds(snapshot: SnapshotWithStatus): ReadonlySet<string> {
  return new Set(snapshot.accounts.filter((account) => account.kind === 'brokerage').map((account) => account.id));
}

function allocationDrafts(snapshot: SnapshotWithStatus): AllocationDraft[] {
  const ids = investmentAccountIds(snapshot);
  const holdingsIds = new Set(snapshot.accounts.filter((account) => ids.has(account.id) && account.mode === 'holdings').map((account) => account.id));
  const aggregate = snapshot.accounts.filter((account) => ids.has(account.id) && account.mode === 'aggregate' && account.currency).map((account) => ({ currency: account.currency!.toUpperCase(), accountId: account.id, kind: 'aggregate' as const, instrument: null, valueMinor: account.valueMinor ?? null, available: account.valueState === 'fresh' && account.valueMinor !== null }));
  const cash = snapshot.cash.filter((balance) => holdingsIds.has(balance.accountId)).map((balance) => ({ currency: balance.currency.toUpperCase(), accountId: balance.accountId, kind: 'cash' as const, instrument: null, valueMinor: balance.amountMinor, available: true }));
  const holdings = snapshot.positions.filter((position) => holdingsIds.has(position.accountId) && position.quantity !== '0').map((position) => ({ currency: position.instrument.currency.toUpperCase(), accountId: position.accountId, kind: 'holding' as const, instrument: position.instrument, valueMinor: position.marketValueMinor, available: position.marketValueMinor !== null }));
  return [...aggregate, ...cash, ...holdings];
}

function allocationTotals(rows: readonly AllocationDraft[]): { totals: ReadonlyMap<string, number>; incomplete: ReadonlySet<string> } {
  const totals = new Map<string, number>();
  const incomplete = new Set<string>();
  for (const row of rows) {
    if (row.valueMinor === null) { incomplete.add(row.currency); continue; }
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.valueMinor);
  }
  return { totals, incomplete };
}

function allocationRowShare(row: AllocationDraft, totals: ReadonlyMap<string, number>, incomplete: ReadonlySet<string>): number | null {
  const total = totals.get(row.currency) ?? 0;
  if (allocationUnavailable(row, total, incomplete)) return null;
  if (row.valueMinor === null) return null;
  return row.valueMinor / total;
}

function allocationUnavailable(row: AllocationDraft, total: number, incomplete: ReadonlySet<string>): boolean {
  if (!row.available || incomplete.has(row.currency)) return true;
  if (row.valueMinor === null) return true;
  return total === 0;
}

function compareAllocationRows(left: WealthAllocationRow, right: WealthAllocationRow): number {
  const leftKey = allocationSortKey(left);
  const rightKey = allocationSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const comparison = leftKey[index].localeCompare(rightKey[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function allocationSortKey(row: WealthAllocationRow): readonly string[] {
  return [row.currency, row.accountId, row.kind, row.instrument?.exchange ?? '', row.instrument?.ticker ?? ''];
}

function wealthAllocationRows(snapshot: SnapshotWithStatus): readonly WealthAllocationRow[] {
  const drafts = allocationDrafts(snapshot);
  const { totals, incomplete } = allocationTotals(drafts);
  return drafts.map((row) => ({ ...row, share: allocationRowShare(row, totals, incomplete) })).sort(compareAllocationRows);
}

async function buildWealthHistory(
  db: D1Database,
  accounts: readonly (WealthAccount & { amountMinor?: number | null })[],
  transitions: readonly StoredModeTransition[],
  events: readonly WealthEvent[],
  valuations: readonly (HoldingValuation & { valueMinor?: number })[],
  balances: readonly StoredBalance[],
  asOf: string,
  reportingCurrency: 'CAD' | null,
  dependencies: WealthReportDependencies = {},
  services: WealthReportReadServices,
): Promise<WealthHistoryPointInternal[]> {
  const dates = new Set<string>();
  for (const event of events) if (event.date <= asOf) dates.add(event.date);
  for (const valuation of valuations) if (valuation.asOf <= asOf) dates.add(valuation.asOf);
  for (const balance of balances) if (balance.observedAt.slice(0, 10) <= asOf) dates.add(balance.observedAt.slice(0, 10));
  const history: WealthHistoryPointInternal[] = [];
  for (const point of [...dates].sort()) {
    const pointSnapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, point, services, true);
    const conversion = await convertWealthTotals({ db, totals: pointSnapshot.totalByCurrency, requested: reportingCurrency, asOf: point, dependencies, statusByCurrency: pointSnapshot.totalStatusByCurrency });
    const coverage = historyPointCoverage(pointSnapshot, point);
    history.push({ date: point, totals: pointSnapshot.totalByCurrency, convertedCadMinor: conversion.convertedCadMinor, ...coverage });
  }
  return history;
}

function unavailableDietz(): ModifiedDietzResult {
  return { value: null, available: false, reason: 'incomplete_flows' };
}

interface DietzValues {
  readonly startValues: Readonly<Record<string, number>> | null | undefined;
  readonly endValues: Readonly<Record<string, number>> | null | undefined;
}
interface DietzPeriod {
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}
interface DietzByCurrencyInput extends DietzValues, DietzPeriod {
  readonly flows: readonly InvestmentCashFlowRecord[];
}

function unresolvedCapitalFlow(flow: InvestmentCashFlowRecord): boolean {
  if (flow.classification !== 'ambiguous') return false;
  return !['dividend', 'withholding', 'fee'].includes(flow.eventKind ?? '');
}

function currencyDietz(
  currencyCode: string,
  values: DietzValues,
  flows: readonly InvestmentCashFlowRecord[],
  period: DietzPeriod,
): ModifiedDietzResult {
  const currencyFlows = flows.filter((flow) => flow.money.currency.toUpperCase() === currencyCode);
  if (currencyFlows.some(unresolvedCapitalFlow)) return unavailableDietz();
  const performanceFlows = currencyFlows.filter((flow) => flow.includedInPerformance);
  if (!period.periodStart || !period.periodEnd) return unavailableDietz();
  return calculateModifiedDietz(values.startValues?.[currencyCode] ?? null, values.endValues?.[currencyCode] ?? null, performanceFlows, period.periodStart, period.periodEnd);
}

function modifiedDietzByCurrency(input: DietzByCurrencyInput): Readonly<Record<string, ModifiedDietzResult>> {
  const currencies = new Set<string>([...Object.keys(input.startValues ?? {}), ...Object.keys(input.endValues ?? {}), ...input.flows.map((flow) => flow.money.currency.toUpperCase())]);
  const period = { periodStart: input.periodStart, periodEnd: input.periodEnd };
  const values = { startValues: input.startValues, endValues: input.endValues };
  return Object.fromEntries([...currencies].sort().map((currencyCode) => [currencyCode, currencyDietz(currencyCode, values, input.flows, period)]));
}

export async function readWealthSnapshotProjection(input: WealthReportProjectionInput) {
  const { db, context, range, reportingCurrency, dependencies, services } = input;
  const asOf = range.asOf;
  const [accounts, transitions, events, storedValuations, latestBalances, balanceHistory] = await Promise.all([
    services.accounts(db, context),
    services.transitions(db, context),
    services.events(db, context),
    services.valuations(db, context),
    readLunchFlowBalances(db, context),
    services.balanceHistory(db, context),
  ]);
  const effectiveEvents = visibleEffectiveEvents(events, asOf);
  const balances = mergeBalances(balanceHistory, latestBalances);
  const valuations = await mergeProviderValuations(db, context, accounts, transitions, events, storedValuations, asOf, services);
  const snapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, asOf, services);
  const [history, records] = await Promise.all([
    buildWealthHistory(db, accounts, transitions, events, valuations, balances, asOf, reportingCurrency, dependencies, services),
    cashFlowRecords(db, context, effectiveEvents),
  ]);
  const quality = snapshotCoverage(snapshot);
  const cashFlows = classifyWealthCashFlows(records.filter((record) => record.date <= asOf), effectiveEvents);
  return {
    ...snapshot,
    allocations: wealthAllocationRows(snapshot),
    history,
    cashFlows,
    cashFlowTotals: summarizeCashFlows(cashFlows),
    modifiedDietz: { value: null, available: false, reason: 'missing_end_valuation' as const },
    stale: quality.stale,
    missingData: quality.missingData,
    revision: await services.currentRevision(db, context),
    fx: await convertWealthTotals({ db, totals: snapshot.totalByCurrency, requested: reportingCurrency, asOf, dependencies, statusByCurrency: snapshot.totalStatusByCurrency }),
  };
}

export async function readWealthReportProjection(input: WealthReportProjectionInput): Promise<WealthReport & { history: readonly WealthHistoryPoint[]; revision: number; balanceStatuses: readonly Record<string, unknown>[]; stale: boolean; missingData: readonly string[]; fx: WealthFxStatus; cashFlowTotals: Readonly<Record<string, CashFlowTotal>>; householdCashFlows: readonly WealthCashFlowRecord[]; investmentCashFlows: readonly InvestmentCashFlowRecord[]; investmentCashFlowTotals: Readonly<Record<string, CashFlowTotal>>; modifiedDietzByCurrency: Readonly<Record<string, ModifiedDietzResult>>; allocations: readonly WealthAllocationRow[] }> {
  const { db, context, range, reportingCurrency, dependencies, services } = input;
  const [accounts, transitions, events, storedValuations, latestBalances, balanceHistory] = await Promise.all([
    services.accounts(db, context),
    services.transitions(db, context),
    services.events(db, context),
    services.valuations(db, context),
    readLunchFlowBalances(db, context),
    services.balanceHistory(db, context),
  ]);
  const effectiveEvents = visibleEffectiveEvents(events, range.asOf);
  const balances = mergeBalances(balanceHistory, latestBalances);
  const valuations = await mergeProviderValuations(db, context, accounts, transitions, events, storedValuations, range.asOf, services);
  const history = await buildWealthHistory(db, accounts, transitions, events, valuations, balances, range.asOf, reportingCurrency, dependencies, services);
  const snapshot = await domainSnapshot(accounts, transitions, events, valuations, balances, range.asOf, services);
  const records = await cashFlowRecords(db, context, effectiveEvents);
  const filtered = records.filter((record) => (!range.from || record.date >= range.from) && (!range.to || record.date <= range.to));
  const investmentAccounts = accounts.filter((account) => account.kind === 'brokerage');
  const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
  const reportInvestmentAccounts = services.accountsAtDate(investmentAccounts, transitions, range.asOf);
  // Cash-flow classification and Dietz use the complete resolved portfolio
  // ledger. Snapshot replay remains segment-scoped, but a flow before a later
  // representation transition must still be included in the period return.
  const investmentEvents = effectiveEvents.filter((event) => isPortfolioBaseEvent(event, investmentAccountIds));
  const investmentValuations = valuations.filter((valuation) => investmentAccountIds.has(valuation.accountId));
  // Aggregate brokerage values are already represented by the portfolio
  // start/end totals. They use the account-value valuation key and have no
  // instrument; only holding prices belong in the domain report valuation
  // list, which normalizes instruments while replaying positions.
  const reportValuations = investmentValuations.filter((valuation) => Boolean(valuation.instrument.exchange));
  const portfolioEventIds = portfolioHistorySourceIds(events, effectiveEvents, investmentAccountIds);
  const portfolioHistoryEvents = events.filter((event) => portfolioEventIds.has(event.sourceId));
  const portfolioHistory = await buildWealthHistory(db, investmentAccounts, transitions, portfolioHistoryEvents, investmentValuations, [], range.asOf, reportingCurrency, dependencies, services);
  const startPoint = range.from ? portfolioHistory.find((point) => point.date === range.from && point.complete) : undefined;
  const endPoint = range.to ? portfolioHistory.find((point) => point.date === range.to && point.complete) : undefined;
  const investmentRecords = portfolioFlowRecords({ records: filtered, events: investmentEvents, investmentIds: investmentAccountIds, from: range.from, to: range.to, isPortfolioEvent: isPortfolioBaseEvent });
  // Valuations are end-of-day observations. The domain Dietz helper therefore
  // ignores start-date flows (already included in the opening observation) and
  // keeps end-date flows with zero time weight so they are removed from the
  // ending balance without being treated as return.
  const dietzRecords = investmentRecords.filter((record) => {
    if (range.from && record.date <= range.from) return false;
    const linked = record.linkedWealthSourceId ? investmentEvents.find((event) => event.sourceId === record.linkedWealthSourceId) : undefined;
    return linked?.kind === 'contribution' || linked?.kind === 'withdrawal';
  });
  const investmentCashFlows = classifyInvestmentCashFlows(investmentRecords, investmentEvents);
  const report = createWealthReport(investmentEvents, dietzRecords, { asOf: range.asOf, accounts: reportInvestmentAccounts, valuations: reportValuations, startValuation: startPoint?.totals ?? null, endValuation: endPoint?.totals ?? null, periodStart: range.from ?? undefined, periodEnd: range.to ?? undefined });
  const dietzByCurrency = modifiedDietzByCurrency({ startValues: startPoint?.totals ?? null, endValues: endPoint?.totals ?? null, flows: investmentCashFlows, periodStart: range.from, periodEnd: range.to });
  const quality = snapshotCoverage(snapshot);
  const householdCashFlows = classifyWealthCashFlows(filtered, effectiveEvents);
  return { ...report, ...snapshot, allocations: wealthAllocationRows(snapshot), cashFlows: householdCashFlows, cashFlowTotals: summarizeCashFlows(householdCashFlows), householdCashFlows, investmentCashFlows, investmentCashFlowTotals: summarizeInvestmentCashFlows(investmentCashFlows), modifiedDietzByCurrency: dietzByCurrency, history, revision: await services.currentRevision(db, context), balanceStatuses: snapshot.balanceStatuses, stale: quality.stale, missingData: quality.missingData, fx: await convertWealthTotals({ db, totals: snapshot.totalByCurrency, requested: reportingCurrency, asOf: range.asOf, dependencies, statusByCurrency: snapshot.totalStatusByCurrency }) };
}
