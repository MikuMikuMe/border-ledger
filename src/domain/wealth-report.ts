import { add, decimal, divideExactInteger, exactMoneyTimesQuantity, isZero, multiplyInteger, safeNumber, subtract, type ScaledDecimal } from './wealth-math';
import {
  accountRegistry,
  assertDate,
  assertMoney,
  instrumentKey,
  normalizeInstrument,
  parseDate,
  WealthDomainError,
} from './wealth-validation';
import { replayWealthEvents, resolveWealthEvents } from './wealth-replay';
import type {
  ClassifiedWealthCashFlow,
  HoldingValuation,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashBalance,
  WealthCashFlowRecord,
  WealthEvent,
  WealthMoney,
  WealthPositionState,
  WealthReport,
  WealthReportOptions,
  WealthSnapshot,
  WealthValuedPosition,
  WealthValueAvailability,
} from './wealth-types';

type ModifiedDietzArguments = readonly [number | null, number | null, readonly WealthCashFlowRecord[], string, string];
type ExternalWealthEvent = Extract<WealthEvent, { kind: 'contribution' | 'withdrawal' }>;
interface ExternalFlowContext {
  readonly flow: WealthCashFlowRecord;
  readonly date: number;
  readonly start: number;
  readonly end: number;
  readonly periodMs: number;
  readonly priorCurrency: string | null;
}
type ExternalFlowValue = { readonly skip: true; readonly currency: string | null } | { readonly skip: false; readonly currency: string; readonly signed: number; readonly weighted: number };
interface SplitObservationState {
  quantity: ScaledDecimal;
  readonly splitDates: Set<string>;
}
interface SplitObservationAddition {
  readonly accountId: string;
  readonly instrument: HoldingValuation['instrument'];
  readonly quantity: string;
  readonly inheritedDates?: readonly string[];
}

export function createWealthSnapshot(events: readonly WealthEvent[], options: WealthReportOptions): WealthSnapshot {
  assertDate(options.asOf, 'as-of date');
  const registry = accountRegistry(options.accounts);
  const visibleEvents = events.filter((event) => {
    assertDate(event.date, 'event date');
    return event.date <= options.asOf;
  });
  const replay = replayWealthEvents(visibleEvents, { accounts: registry, allowNegativeCash: options.allowNegativeCash });
  const splitDates = splitObservationBoundaries(resolveWealthEvents(visibleEvents));
  const positions = replay.positions.map((position) => valuePosition(position, options.valuations ?? [], options.asOf, splitDates));
  const totalByCurrency: Record<string, number> = Object.create(null) as Record<string, number>;
  const totalStatusByCurrency: Record<string, WealthValueAvailability> = Object.create(null) as Record<string, WealthValueAvailability>;
  addCashTotals(totalByCurrency, totalStatusByCurrency, replay.cash, registry.byId);
  addHoldingTotals(totalByCurrency, totalStatusByCurrency, positions, registry.byId);
  return {
    asOf: options.asOf,
    accounts: registry.accounts,
    positions: Object.freeze(positions),
    cash: replay.cash,
    totalByCurrency: Object.freeze(sortedRecord(totalByCurrency)),
    totalStatusByCurrency: Object.freeze(sortedRecord(totalStatusByCurrency)),
  };
}

export function classifyWealthCashFlows(records: readonly WealthCashFlowRecord[], events: readonly WealthEvent[] = []): ClassifiedWealthCashFlow[] {
  const eventsBySource = new Map(events.map((item) => [item.sourceId, item]));
  const linkedRecords = new Map<string, WealthCashFlowRecord>();
  const result: ClassifiedWealthCashFlow[] = [];
  for (const record of records) {
    assertMoney(record.money, 'cash flow');
    if (record.linkedWealthSourceId && isConflictingDuplicate(record, linkedRecords, result)) continue;
    if (record.linkedWealthSourceId) linkedRecords.set(record.linkedWealthSourceId, record);
    result.push(classifyRecord(record, eventsBySource.get(record.linkedWealthSourceId ?? '')));
  }
  return result;
}

/** Calculates return between EOD observations; start-date flows are already
 * reflected in the start value and end-date flows receive zero time weight. */
export function calculateModifiedDietz(
  ...input: ModifiedDietzArguments
): ModifiedDietzResult {
  const [startValueMinor, endValueMinor, flows, periodStart, periodEnd] = input;
  const period = validPeriod(startValueMinor, endValueMinor, periodStart, periodEnd);
  if (!period.available) return period;
  const external = externalFlows(flows, period.start, period.end);
  if (!external) return unavailableDietz();
  const denominator = period.startValue + external.weighted;
  if (denominator === 0) return unavailableDietz();
  return { value: (period.endValue - period.startValue - external.total) / denominator, available: true, reason: null };
}

export function createWealthReport(events: readonly WealthEvent[], records: readonly WealthCashFlowRecord[], options: WealthReportOptions): WealthReport {
  return { ...createWealthSnapshot(events, options), ...createWealthReportAnalytics(events, records, options) };
}

/** Classify the complete ledger independently of account-segment snapshot replay. */
export function createWealthReportAnalytics(events: readonly WealthEvent[], records: readonly WealthCashFlowRecord[], options: WealthReportOptions): Pick<WealthReport, 'cashFlows' | 'modifiedDietz'> {
  assertDate(options.asOf, 'as-of date');
  const visibleRecords = records.filter((record) => record.date <= options.asOf);
  const visibleEvents = events.filter((event) => event.date <= options.asOf);
  const cashFlows = classifyWealthCashFlows(visibleRecords, visibleEvents);
  const currency = valuationCurrency(options.startValuation, options.endValuation);
  const completeFlows = !cashFlows.some((flow) => flow.classification === 'ambiguous');
  const modifiedDietz = reportDietz(options, currency, completeFlows, cashFlows);
  return { cashFlows: Object.freeze(cashFlows), modifiedDietz };
}

function addCashTotals(target: Record<string, number>, status: Record<string, WealthValueAvailability>, cash: readonly WealthCashBalance[], accounts: Readonly<Record<string, WealthAccount>>): void {
  for (const balance of cash) {
    if (!accounts[balance.accountId]) throw new WealthDomainError('unknown_account', `Account ${balance.accountId} is not registered.`);
    addTotal(target, balance.currency, balance.amountMinor);
    status[balance.currency] ??= 'complete';
  }
}

function addHoldingTotals(target: Record<string, number>, status: Record<string, WealthValueAvailability>, positions: readonly WealthValuedPosition[], accounts: Readonly<Record<string, WealthAccount>>): void {
  for (const position of positions) {
    const account = accounts[position.accountId];
    if (!account) throw new WealthDomainError('unknown_account', `Account ${position.accountId} is not registered.`);
    if (position.quantity === '0') continue;
    if (account.mode !== 'holdings') continue;
    if (position.marketValueMinor === null) {
      status[position.instrument.currency] = 'incomplete';
      continue;
    }
    addTotal(target, position.instrument.currency, position.marketValueMinor);
    status[position.instrument.currency] ??= 'complete';
  }
}

function valuePosition(position: WealthPositionState, valuations: readonly HoldingValuation[], asOf: string, splitDates: ReadonlyMap<string, readonly string[]>): WealthValuedPosition {
  const valuation = latestValuation(position, valuations, asOf);
  if (!valuation || valuationPrecedesSplit(position, valuation, splitDates)) return { ...position, valuation: null, marketValueMinor: null, unrealizedGainMinor: null };
  assertMoney({ currency: valuation.instrument.currency, amountMinor: valuation.priceMinor }, 'valuation price');
  const marketValueMinor = safeNumber(exactMoneyTimesQuantity(BigInt(valuation.priceMinor), parseQuantity(position.quantity)), 'market value');
  return { ...position, valuation, marketValueMinor, unrealizedGainMinor: position.costBasisMinor === null ? null : marketValueMinor - position.costBasisMinor };
}

function splitObservationBoundaries(events: readonly WealthEvent[]): ReadonlyMap<string, readonly string[]> {
  const states = new Map<string, SplitObservationState>();
  for (const event of events) applySplitObservationEvent(states, event);
  const boundaries = new Map<string, readonly string[]>();
  for (const [key, state] of states) {
    if (isZero(state.quantity) || state.splitDates.size === 0) continue;
    boundaries.set(key, Object.freeze([...state.splitDates].sort()));
  }
  return boundaries;
}

function applySplitObservationEvent(states: Map<string, SplitObservationState>, event: WealthEvent): void {
  if (event.kind === 'opening_position' || event.kind === 'buy') {
    addSplitObservationPosition(states, event);
    return;
  }
  if (event.kind === 'sell') {
    reduceSplitObservationPosition(states, event.accountId, event.instrument, event.quantity);
    return;
  }
  if (event.kind === 'split') {
    applySplitObservationSplit(states, event);
    return;
  }
  if (event.kind === 'transfer' && event.transferKind === 'position') {
    transferSplitObservationPosition(states, event);
  }
}

function addSplitObservationPosition(states: Map<string, SplitObservationState>, addition: SplitObservationAddition): void {
  const { accountId, instrument, quantity, inheritedDates = [] } = addition;
  const key = positionValuationKey(accountId, instrument);
  const current = states.get(key);
  if (!current) {
    states.set(key, { quantity: decimal(quantity), splitDates: new Set(inheritedDates) });
    return;
  }
  current.quantity = add(current.quantity, decimal(quantity));
  for (const date of inheritedDates) current.splitDates.add(date);
}

function reduceSplitObservationPosition(
  states: Map<string, SplitObservationState>,
  accountId: string,
  instrument: HoldingValuation['instrument'],
  quantity: string,
): void {
  const key = positionValuationKey(accountId, instrument);
  const current = states.get(key);
  if (!current) return;
  current.quantity = subtract(current.quantity, decimal(quantity));
  // Closing a lot does not undo the known split adjustment to quote units.
}

function applySplitObservationSplit(
  states: Map<string, SplitObservationState>,
  event: Extract<WealthEvent, { kind: 'split' }>,
): void {
  const key = positionValuationKey(event.accountId, event.instrument);
  const current = states.get(key);
  if (!current) return;
  current.quantity = divideExactInteger(multiplyInteger(current.quantity, BigInt(event.numerator)), BigInt(event.denominator));
  current.splitDates.add(event.date);
}

function transferSplitObservationPosition(
  states: Map<string, SplitObservationState>,
  event: Extract<WealthEvent, { kind: 'transfer'; transferKind: 'position' }>,
): void {
  const sourceKey = positionValuationKey(event.fromAccountId, event.instrument);
  const source = states.get(sourceKey);
  if (!source) return;
  const inheritedDates = [...source.splitDates];
  source.quantity = subtract(source.quantity, decimal(event.quantity));
  // Retain the source boundary if that account later holds this security again.
  addSplitObservationPosition(states, { accountId: event.toAccountId, instrument: event.instrument, quantity: event.quantity, inheritedDates });
}

function valuationPrecedesSplit(position: WealthPositionState, valuation: HoldingValuation, splitDates: ReadonlyMap<string, readonly string[]>): boolean {
  const dates = splitDates.get(positionValuationKey(position.accountId, position.instrument)) ?? [];
  return dates.some((splitDate) => valuation.asOf < splitDate);
}

function positionValuationKey(accountId: string, instrument: HoldingValuation['instrument']): string {
  return `${accountId}\u0000${instrumentKey(instrument)}`;
}

function latestValuation(position: WealthPositionState, valuations: readonly HoldingValuation[], asOf: string): HoldingValuation | null {
  return valuations.map((candidate) => {
    assertDate(candidate.asOf, 'valuation date');
    return { ...candidate, instrument: normalizeInstrument(candidate.instrument) };
  }).filter((candidate) => candidate.accountId === position.accountId && instrumentKey(candidate.instrument) === instrumentKey(position.instrument) && candidate.asOf <= asOf).sort((left, right) => right.asOf.localeCompare(left.asOf))[0] ?? null;
}

function classifyRecord(record: WealthCashFlowRecord, linked: WealthEvent | undefined): ClassifiedWealthCashFlow {
  const excluded = classifyExcluded(record, linked);
  if (excluded) return excluded;
  return classifyExternal(record, linked);
}

function isConflictingDuplicate(record: WealthCashFlowRecord, seen: Map<string, WealthCashFlowRecord>, result: ClassifiedWealthCashFlow[]): boolean {
  const link = record.linkedWealthSourceId;
  if (!link) return false;
  const prior = seen.get(link);
  if (!prior) return false;
  if (sameCashFlow(prior, record)) return true;
  result.push(classified(record, 'ambiguous', false, 'Conflicting bank records share one explicit wealth link.'));
  return true;
}

function externalFlows(flows: readonly WealthCashFlowRecord[], start: number, end: number): { readonly total: number; readonly weighted: number } | null {
  const periodMs = end - start;
  const values: ExternalFlowValue[] = [];
  let currency: string | null = null;
  for (const flow of flows) {
    const date = validFlowDate(flow, start, end);
    if (date === null) return null;
    const value = externalFlowValue({ flow, date, start, end, periodMs, priorCurrency: currency });
    if (value === null) return null;
    if (value.currency !== null) currency = value.currency;
    values.push(value);
  }
  return summarizeExternalFlows(values);
}

function summarizeExternalFlows(values: readonly ExternalFlowValue[]): { readonly total: number; readonly weighted: number } {
  let total = 0;
  let weighted = 0;
  for (const value of values) {
    if (value.skip) continue;
    total += value.signed;
    weighted += value.weighted;
  }
  return { total, weighted };
}

function externalFlowValue(context: ExternalFlowContext): ExternalFlowValue | null {
  const { flow, date, start, end, periodMs, priorCurrency } = context;
  if (isExcludedFlow(flow)) return { skip: true, currency: null };
  const direction = externalDirection(flow);
  if (!direction) return null;
  const currency = flow.money.currency.toUpperCase();
  if (priorCurrency !== null && priorCurrency !== currency) return null;
  if (date === start) return { skip: true, currency };
  const signed = direction === 'inflow' ? flow.money.amountMinor : -flow.money.amountMinor;
  return { skip: false, currency, signed, weighted: signed * ((end - date) / periodMs) };
}

function validPeriod(startValueMinor: number | null, endValueMinor: number | null, periodStart: string, periodEnd: string): { readonly available: true; readonly start: number; readonly end: number; readonly startValue: number; readonly endValue: number } | { readonly available: false; readonly value: null; readonly reason: 'missing_start_valuation' | 'missing_end_valuation' | 'invalid_period' } {
  if (startValueMinor === null) return { value: null, available: false, reason: 'missing_start_valuation' };
  if (endValueMinor === null) return { value: null, available: false, reason: 'missing_end_valuation' };
  const period = dateRange(periodStart, periodEnd);
  if (!period || !finiteValues(startValueMinor, endValueMinor)) return { value: null, available: false, reason: 'invalid_period' };
  return { available: true, ...period, startValue: startValueMinor, endValue: endValueMinor };
}

function dateRange(periodStart: string, periodEnd: string): { readonly start: number; readonly end: number } | null {
  const start = parseDate(periodStart);
  const end = parseDate(periodEnd);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function finiteValues(startValueMinor: number, endValueMinor: number): boolean {
  return Number.isFinite(startValueMinor) && Number.isFinite(endValueMinor);
}

function classifyExcluded(record: WealthCashFlowRecord, linked: WealthEvent | undefined): ClassifiedWealthCashFlow | null {
  if (isTrade(record, linked)) return classified(record, 'trade', false, 'Trade cash is excluded from external performance flows.');
  if (isTransfer(record, linked)) return classified(record, 'internal_transfer', false, 'Internal transfers do not change invested capital.');
  return null;
}

function classifyExternal(record: WealthCashFlowRecord, linked: WealthEvent | undefined): ClassifiedWealthCashFlow {
  if (!isExternalEvent(linked)) return classified(record, 'ambiguous', false, 'External flow requires an explicit contribution or withdrawal link.');
  if (!matchesExternalEvent(record, linked)) return classified(record, 'ambiguous', false, 'Bank flow does not agree with the explicitly linked wealth event.');
  return classified(record, externalClassification(linked), true, 'Explicitly linked external capital flow.');
}

function validFlowDate(flow: WealthCashFlowRecord, start: number, end: number): number | null {
  const date = parseDate(flow.date);
  return date !== null && date >= start && date <= end && Number.isSafeInteger(flow.money.amountMinor) && flow.money.amountMinor >= 0 ? date : null;
}

function isExcludedFlow(flow: WealthCashFlowRecord): boolean {
  return flow.kind === 'trade' || flow.kind === 'internal_transfer';
}

function externalDirection(flow: WealthCashFlowRecord): 'inflow' | 'outflow' | null {
  if (flow.direction) return flow.direction;
  if (flow.kind === 'contribution') return 'inflow';
  if (flow.kind === 'withdrawal') return 'outflow';
  return null;
}

function isTrade(record: WealthCashFlowRecord, linked: WealthEvent | undefined): boolean {
  return record.kind === 'trade' || linked?.kind === 'buy' || linked?.kind === 'sell';
}

function isTransfer(record: WealthCashFlowRecord, linked: WealthEvent | undefined): boolean {
  return record.kind === 'internal_transfer' || linked?.kind === 'transfer';
}

function reportDietz(options: WealthReportOptions, currency: string | null, complete: boolean, cashFlows: readonly ClassifiedWealthCashFlow[]): ModifiedDietzResult {
  if (!complete) return unavailableDietz();
  if (currency === null) return unavailableDietz();
  const period = reportPeriod(options);
  if (period === null) return unavailableDietz();
  const flows = cashFlows.filter((flow) => flow.includedInPerformance);
  if (flows.some((flow) => flow.money.currency.toUpperCase() !== currency)) return unavailableDietz();
  return calculateModifiedDietz(valuationForCurrency(options.startValuation, currency), valuationForCurrency(options.endValuation, currency), flows, period.start, period.end);
}

function reportPeriod(options: WealthReportOptions): { readonly start: string; readonly end: string } | null {
  if (!options.periodStart || !options.periodEnd) return null;
  return { start: options.periodStart, end: options.periodEnd };
}

function valuationCurrency(start: Readonly<Record<string, number>> | null | undefined, end: Readonly<Record<string, number>> | null | undefined): string | null {
  const startKeys = Object.keys(start ?? {});
  const endKeys = Object.keys(end ?? {});
  if (startKeys.length !== 1 || endKeys.length !== 1) return null;
  const startCurrency = canonicalCurrency(startKeys[0]);
  const endCurrency = canonicalCurrency(endKeys[0]);
  return startCurrency !== null && startCurrency === endCurrency ? startCurrency : null;
}

function canonicalCurrency(value: string): string | null {
  const currency = value.toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function valuationForCurrency(values: Readonly<Record<string, number>> | null | undefined, currency: string): number | null {
  const key = Object.keys(values ?? {}).find((candidate) => candidate.toUpperCase() === currency);
  return key === undefined ? null : values?.[key] ?? null;
}

function unavailableDietz(): ModifiedDietzResult {
  return { value: null, available: false, reason: 'incomplete_flows' };
}

function isExternalEvent(event: WealthEvent | undefined): event is ExternalWealthEvent {
  return event?.kind === 'contribution' || event?.kind === 'withdrawal';
}

function matchesExternalEvent(record: WealthCashFlowRecord, event: ExternalWealthEvent): boolean {
  const expectedDirection = event.kind === 'contribution' ? 'inflow' : 'outflow';
  return record.direction === expectedDirection && sameMoney(record.money, event.money);
}

function externalClassification(event: ExternalWealthEvent): ClassifiedWealthCashFlow['classification'] {
  return event.kind === 'contribution' ? 'external_contribution' : 'external_withdrawal';
}

function parseQuantity(value: string): { readonly coefficient: bigint; readonly scale: number } {
  const [integer, fraction = ''] = value.split('.');
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function sameMoney(left: WealthMoney, right: WealthMoney): boolean {
  return left.currency.toUpperCase() === right.currency.toUpperCase() && left.amountMinor === right.amountMinor;
}

function sameCashFlow(left: WealthCashFlowRecord, right: WealthCashFlowRecord): boolean {
  return left.date === right.date && left.accountId === right.accountId && sameMoney(left.money, right.money) && left.direction === right.direction;
}

function classified(record: WealthCashFlowRecord, classification: ClassifiedWealthCashFlow['classification'], includedInPerformance: boolean, reason: string): ClassifiedWealthCashFlow {
  return { ...record, classification, includedInPerformance, reason };
}

function addTotal(target: Record<string, number>, currency: string, amount: number): void {
  target[currency] = (target[currency] ?? 0) + amount;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
