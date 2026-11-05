import {
  add,
  compare,
  decimal,
  divideExactInteger,
  multiplyInteger,
  powerOfTen,
  roundRatio,
  safeNumber,
  subtract,
  toString,
  type ScaledDecimal,
} from './wealth-math';
import {
  accountRegistry,
  assertFee,
  assertInstrumentMoney,
  assertMoney,
  assertPositiveQuantity,
  compareEventsWithOrder,
  instrumentKey,
  uniqueEvents,
  validateAccountIds,
  WealthDomainError,
} from './wealth-validation';
import type {
  CanonicalInstrument,
  WealthAccount,
  WealthAccountRegistry,
  WealthCashBalance,
  WealthEvent,
  WealthMoney,
  WealthPositionState,
  WealthReplayResult,
} from './wealth-types';

export interface ReplayOptions {
  readonly accounts?: WealthAccountRegistry | readonly WealthAccount[];
  /** Historical imports may explicitly opt into incomplete cash history. */
  readonly allowNegativeCash?: boolean;
}

export interface MutablePosition {
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  quantity: ScaledDecimal;
  costBasisMinor: bigint | null;
  realizedGainMinor: bigint | null;
}

interface PositionAddition {
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: ScaledDecimal;
  readonly basisMinor: bigint | null;
}

interface PositionSale {
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: ScaledDecimal;
  readonly proceedsMinor: bigint;
  readonly feeMinor: bigint;
}

interface PositionTransfer {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: ScaledDecimal;
}

interface CashApplication {
  readonly cash: Map<string, bigint>;
  readonly accountId: string;
  readonly currency: string;
  readonly delta: bigint;
  readonly options: ReplayOptions;
}

export function replayWealthEvents(events: readonly WealthEvent[], options: ReplayOptions = {}): WealthReplayResult {
  const prepared = prepareEvents(events);
  const { unique, controls, effective } = prepared;
  const positions = new Map<string, MutablePosition>();
  const cash = new Map<string, bigint>();
  for (const item of effective) applyEvent(item, positions, cash, options);

  return {
    positions: Object.freeze([...positions.values()].sort(comparePositions).map(positionView)),
    cash: Object.freeze([...cash.entries()].filter(([, amount]) => amount !== 0n).sort(([left], [right]) => left.localeCompare(right)).map(cashView)),
    appliedSourceIds: Object.freeze(effective.map((item) => item.sourceId)),
    duplicateSourceIds: unique.duplicates,
    reversedSourceIds: Object.freeze([...controls.reversed].sort()),
  };
}

/** Resolves corrections, reversals, normalization, and deterministic order for
 * callers that need the effective event stream for reporting/audit metadata. */
export function resolveWealthEvents(events: readonly WealthEvent[]): readonly WealthEvent[] {
  return Object.freeze([...prepareEvents(events).effective]);
}

function prepareEvents(events: readonly WealthEvent[]) {
  const unique = uniqueEvents(events);
  const bySource = new Map(unique.events.map((item) => [item.sourceId, item]));
  const controls = resolveControls(unique.events, bySource);
  const effective = [...controls.effective];
  validateSequenceGroups(effective);
  effective.sort((left, right) => compareEventsWithOrder(left, right, controls.inputOrder));
  return { unique, controls, effective };
}

interface ControlResolution {
  readonly reversed: ReadonlySet<string>;
  readonly effective: WealthEvent[];
  readonly inputOrder: ReadonlyMap<string, number>;
}

type ControlResult = { readonly kind: 'include'; readonly event: WealthEvent } | { readonly kind: 'omit' } | { readonly kind: 'replace'; readonly event: WealthEvent };

function resolveControls(events: readonly WealthEvent[], bySource: ReadonlyMap<string, WealthEvent>): ControlResolution {
  const collected = collectControls(events, bySource);
  const materialized = materializeControls(events, collected.controlsByTarget);
  return { reversed: collected.reversed, effective: materialized.effective, inputOrder: materialized.inputOrder };
}

function collectControls(events: readonly WealthEvent[], bySource: ReadonlyMap<string, WealthEvent>): { readonly reversed: ReadonlySet<string>; readonly controlsByTarget: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>> } {
  const reversed = new Set<string>();
  const controlsByTarget = new Map<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>();
  for (const event of events) {
    if (!isControl(event)) continue;
    const target = bySource.get(event.targetSourceId);
    if (!target) throw new WealthDomainError('invalid_reference', `Event ${event.sourceId} references an unknown source.`);
    if (event.date < target.date) throw new WealthDomainError('invalid_reference', 'A correction or reversal date must not precede its target event.');
    if (event.kind === 'correction' && event.replacement.date > event.date) throw new WealthDomainError('invalid_reference', 'A correction replacement must not be dated after its correction.');
    if (controlsByTarget.has(event.targetSourceId)) throw new WealthDomainError('invalid_reference', `Multiple corrections or reversals target source ${event.targetSourceId}.`);
    controlsByTarget.set(event.targetSourceId, event);
    reversed.add(event.targetSourceId);
  }
  validateControlLineage(controlsByTarget);
  return { reversed, controlsByTarget };
}

function validateControlLineage(controlsByTarget: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const sourceId of controlsByTarget.keys()) visitControlTarget(sourceId, controlsByTarget, visiting, visited);
}

function visitControlTarget(
  sourceId: string,
  controlsByTarget: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>,
  visiting: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(sourceId)) return;
  if (visiting.has(sourceId)) throw new WealthDomainError('invalid_reference', 'Correction lineage contains a cycle.');
  const control = controlsByTarget.get(sourceId);
  if (!control) return;
  visiting.add(sourceId);
  visitControlTarget(control.sourceId, controlsByTarget, visiting, visited);
  visiting.delete(sourceId);
  visited.add(sourceId);
}

function materializeControls(events: readonly WealthEvent[], controlsByTarget: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>): { readonly effective: WealthEvent[]; readonly inputOrder: ReadonlyMap<string, number> } {
  const inputOrder = new Map(events.map((event, index) => [event.sourceId, index]));
  const occupiedSourceIds = new Set(events.map((event) => event.sourceId));
  const effective: WealthEvent[] = [];
  for (const event of events) {
    const materialized = materializeEvent(event, controlsByTarget, occupiedSourceIds, inputOrder);
    if (materialized) effective.push(materialized);
  }
  return { effective, inputOrder };
}

function materializeEvent(
  event: WealthEvent,
  controlsByTarget: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>,
  occupiedSourceIds: Set<string>,
  inputOrder: Map<string, number>,
): WealthEvent | null {
  if (isControl(event)) return null;
  const result = resolveBaseEvent(event, controlsByTarget, new Set());
  if (result.kind === 'omit') return null;
  if (result.kind === 'replace') {
    reserveReplacementSource(result.event, occupiedSourceIds);
    inputOrder.set(result.event.sourceId, inputOrder.get(event.sourceId) ?? inputOrder.size);
  }
  return result.event;
}

function reserveReplacementSource(event: WealthEvent, occupiedSourceIds: Set<string>): void {
  if (occupiedSourceIds.has(event.sourceId)) throw new WealthDomainError('source_conflict', `Correction replacement source ${event.sourceId} collides with an existing event.`);
  occupiedSourceIds.add(event.sourceId);
}

function resolveBaseEvent(base: WealthEvent, controls: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>, seen: ReadonlySet<string>): ControlResult {
  const control = controls.get(base.sourceId);
  if (!control) return { kind: 'include', event: base };
  if (control.kind === 'reversal') return { kind: 'omit' };
  return resolveCorrection(base, control, controls, seen);
}

function resolveCorrection(base: WealthEvent, correction: Extract<WealthEvent, { kind: 'correction' }>, controls: ReadonlyMap<string, Extract<WealthEvent, { kind: 'reversal' | 'correction' }>>, seen: ReadonlySet<string>): ControlResult {
  if (seen.has(correction.sourceId)) throw new WealthDomainError('invalid_reference', 'Correction lineage contains a cycle.');
  const next = controls.get(correction.sourceId);
  if (!next) return { kind: 'replace', event: replacementEvent(correction, base.sequence) };
  if (next.kind === 'reversal') return { kind: 'include', event: base };
  return resolveCorrection(base, next, controls, new Set([...seen, correction.sourceId]));
}

function replacementEvent(correction: Extract<WealthEvent, { kind: 'correction' }>, targetSequence: number | undefined): WealthEvent {
  return {
    ...correction.replacement,
    id: `${correction.id}:replacement`,
    sourceId: `${correction.sourceId}:replacement`,
    sequence: targetSequence ?? correction.replacement.sequence,
  } as WealthEvent;
}

function validateSequenceGroups(events: readonly WealthEvent[]): void {
  const grouped = new Map<string, readonly WealthEvent[]>();
  for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  validateUniqueSequences(events);
  for (const group of grouped.values()) validateSequenceGroup(group);
}

function validateUniqueSequences(events: readonly WealthEvent[]): void {
  const sequences = new Set<number>();
  for (const event of events) {
    if (event.sequence === undefined) continue;
    if (sequences.has(event.sequence)) throw new WealthDomainError('invalid_event', 'Replay event sequences must be unique within a ledger.');
    sequences.add(event.sequence);
  }
}

function validateSequenceGroup(group: readonly WealthEvent[]): void {
  if (hasMixedSequence(group)) throw new WealthDomainError('invalid_event', 'Same-day replay events must all have a sequence when any sequence is present.');
  if (hasDuplicateSequence(group)) throw new WealthDomainError('invalid_event', 'Same-day replay event sequences must be unique.');
}

function hasMixedSequence(group: readonly WealthEvent[]): boolean {
  const hasSequence = group.some((event) => event.sequence !== undefined);
  return hasSequence && group.some((event) => event.sequence === undefined);
}

function hasDuplicateSequence(group: readonly WealthEvent[]): boolean {
  const sequences = group.flatMap((event) => event.sequence === undefined ? [] : [event.sequence]);
  return sequences.length > 0 && new Set(sequences).size !== sequences.length;
}

function applyEvent(event: WealthEvent, positions: Map<string, MutablePosition>, cash: Map<string, bigint>, options: ReplayOptions): void {
  validateAccountIds(event, options.accounts);
  const handlers: Record<WealthEvent['kind'], () => void> = {
    opening_position: () => applyOpeningPosition(event as Extract<WealthEvent, { kind: 'opening_position' }>, positions),
    opening_cash: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'opening_cash' }>, cash, 1n, options),
    buy: () => applyBuy(event as Extract<WealthEvent, { kind: 'buy' }>, positions, cash, options),
    sell: () => applySell(event as Extract<WealthEvent, { kind: 'sell' }>, positions, cash, options),
    dividend: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'dividend' }>, cash, 1n, options),
    withholding: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'withholding' }>, cash, -1n, options),
    fee: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'fee' }>, cash, -1n, options),
    contribution: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'contribution' }>, cash, 1n, options),
    withdrawal: () => applyCashEvent(event as Extract<WealthEvent, { kind: 'withdrawal' }>, cash, -1n, options),
    split: () => applySplit(event as Extract<WealthEvent, { kind: 'split' }>, positions),
    transfer: () => applyTransfer(event as Extract<WealthEvent, { kind: 'transfer' }>, positions, cash, options),
    reversal: () => invalidControl(),
    correction: () => invalidControl(),
  };
  handlers[event.kind]();
}

function applyOpeningPosition(event: Extract<WealthEvent, { kind: 'opening_position' }>, positions: Map<string, MutablePosition>): void {
  assertPositiveQuantity(event.quantity);
  assertMoney(event.basis, 'opening basis', true);
  if (event.basis) assertInstrumentMoney(event.basis, event.instrument, 'opening basis');
  addPosition(positions, { accountId: event.accountId, instrument: event.instrument, quantity: decimal(event.quantity), basisMinor: event.basis ? BigInt(event.basis.amountMinor) : null });
}

function applyBuy(event: Extract<WealthEvent, { kind: 'buy' }>, positions: Map<string, MutablePosition>, cash: Map<string, bigint>, options: ReplayOptions): void {
  assertPositiveQuantity(event.quantity);
  assertMoney(event.consideration, 'buy consideration');
  assertInstrumentMoney(event.consideration, event.instrument, 'buy consideration');
  assertFee(event.fee, event.instrument);
  const outlay = BigInt(event.consideration.amountMinor) + BigInt(event.fee?.amountMinor ?? 0);
  addPosition(positions, { accountId: event.accountId, instrument: event.instrument, quantity: decimal(event.quantity), basisMinor: outlay });
  applyCash({ cash, accountId: event.accountId, currency: event.consideration.currency, delta: -outlay, options });
}

function applySell(event: Extract<WealthEvent, { kind: 'sell' }>, positions: Map<string, MutablePosition>, cash: Map<string, bigint>, options: ReplayOptions): void {
  assertPositiveQuantity(event.quantity);
  assertMoney(event.proceeds, 'sale proceeds');
  assertInstrumentMoney(event.proceeds, event.instrument, 'sale proceeds');
  assertFee(event.fee, event.instrument);
  const proceeds = BigInt(event.proceeds.amountMinor);
  const fee = BigInt(event.fee?.amountMinor ?? 0);
  sellPosition(positions, { accountId: event.accountId, instrument: event.instrument, quantity: decimal(event.quantity), proceedsMinor: proceeds, feeMinor: fee });
  applyCash({ cash, accountId: event.accountId, currency: event.proceeds.currency, delta: proceeds - fee, options });
}

function applyCashEvent(event: Extract<WealthEvent, { kind: 'opening_cash' | 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal' }>, cash: Map<string, bigint>, sign: bigint, options: ReplayOptions): void {
  assertMoney(event.money, event.kind);
  if ('instrument' in event && event.instrument) assertInstrumentMoney(event.money, event.instrument, event.kind);
  applyCash({ cash, accountId: event.accountId, currency: event.money.currency, delta: sign * BigInt(event.money.amountMinor), options });
}

function applySplit(event: Extract<WealthEvent, { kind: 'split' }>, positions: Map<string, MutablePosition>): void {
  assertPositiveQuantity(event.numerator.toString());
  assertPositiveQuantity(event.denominator.toString());
  if (!Number.isSafeInteger(event.numerator) || !Number.isSafeInteger(event.denominator)) throw new WealthDomainError('invalid_split', 'Split ratio must use safe integers.');
  const position = requirePosition(positions, event.accountId, event.instrument);
  position.quantity = divideExactInteger(multiplyInteger(position.quantity, BigInt(event.numerator)), BigInt(event.denominator));
}

function applyTransfer(event: Extract<WealthEvent, { kind: 'transfer' }>, positions: Map<string, MutablePosition>, cash: Map<string, bigint>, options: ReplayOptions): void {
  if (event.fromAccountId === event.toAccountId) throw new WealthDomainError('invalid_transfer', 'A transfer must have distinct source and destination accounts.');
  if (event.transferKind === 'cash') {
    assertMoney(event.money, 'cash transfer');
    const amount = BigInt(event.money.amountMinor);
    applyCash({ cash, accountId: event.fromAccountId, currency: event.money.currency, delta: -amount, options });
    applyCash({ cash, accountId: event.toAccountId, currency: event.money.currency, delta: amount, options });
    return;
  }
  assertPositiveQuantity(event.quantity);
  transferPosition(positions, { fromAccountId: event.fromAccountId, toAccountId: event.toAccountId, instrument: event.instrument, quantity: decimal(event.quantity) });
}

function addPosition(positions: Map<string, MutablePosition>, input: PositionAddition): void {
  const key = positionKey(input.accountId, input.instrument);
  const position = positions.get(key);
  if (!position) {
    positions.set(key, { accountId: input.accountId, instrument: input.instrument, quantity: input.quantity, costBasisMinor: input.basisMinor, realizedGainMinor: 0n });
    return;
  }
  position.costBasisMinor = isZero(position.quantity) ? input.basisMinor : combinedBasis(position.costBasisMinor, input.basisMinor);
  position.quantity = add(position.quantity, input.quantity);
}

function combinedBasis(existing: bigint | null, incoming: bigint | null): bigint | null {
  return existing === null || incoming === null ? null : existing + incoming;
}

function sellPosition(positions: Map<string, MutablePosition>, sale: PositionSale): void {
  const position = requirePosition(positions, sale.accountId, sale.instrument);
  if (compare(sale.quantity, position.quantity) > 0) throw new WealthDomainError('short_sale', 'A short sale quantity cannot exceed the available long position.');
  const soldAll = compare(sale.quantity, position.quantity) === 0;
  const allocatedBasis = basisForSale(position, sale.quantity, soldAll);
  if (position.costBasisMinor !== null && allocatedBasis !== null) position.costBasisMinor -= allocatedBasis;
  position.quantity = subtract(position.quantity, sale.quantity);
  position.realizedGainMinor = realizedGain(position, allocatedBasis, sale.proceedsMinor, sale.feeMinor);
}

function transferPosition(positions: Map<string, MutablePosition>, transfer: PositionTransfer): void {
  const source = requirePosition(positions, transfer.fromAccountId, transfer.instrument);
  if (compare(transfer.quantity, source.quantity) > 0) throw new WealthDomainError('invalid_transfer', 'A position transfer cannot exceed the source position.');
  const movedAll = compare(transfer.quantity, source.quantity) === 0;
  const movedBasis = source.costBasisMinor === null ? null : movedAll ? source.costBasisMinor : proratedBasis(source.costBasisMinor, transfer.quantity, source.quantity);
  if (source.costBasisMinor !== null && movedBasis !== null) source.costBasisMinor -= movedBasis;
  source.quantity = subtract(source.quantity, transfer.quantity);
  addPosition(positions, { accountId: transfer.toAccountId, instrument: transfer.instrument, quantity: transfer.quantity, basisMinor: movedBasis });
}

function proratedBasis(totalBasis: bigint, part: ScaledDecimal, whole: ScaledDecimal): bigint {
  return roundRatio(totalBasis * part.coefficient * powerOfTen(whole.scale), whole.coefficient * powerOfTen(part.scale));
}

function basisForSale(position: MutablePosition, quantity: ScaledDecimal, soldAll: boolean): bigint | null {
  if (position.costBasisMinor === null) return null;
  return soldAll ? position.costBasisMinor : proratedBasis(position.costBasisMinor, quantity, position.quantity);
}

function realizedGain(position: MutablePosition, allocatedBasis: bigint | null, proceedsMinor: bigint, feeMinor: bigint): bigint | null {
  return allocatedBasis === null || position.realizedGainMinor === null ? null : position.realizedGainMinor + proceedsMinor - feeMinor - allocatedBasis;
}

function requirePosition(positions: Map<string, MutablePosition>, accountId: string, instrument: CanonicalInstrument): MutablePosition {
  const position = positions.get(positionKey(accountId, instrument));
  if (!position || isZero(position.quantity)) throw new WealthDomainError('missing_position', 'No long position is available for this instrument.');
  return position;
}

function applyCash(input: CashApplication): void {
  const key = `${input.accountId}\u0000${input.currency}`;
  const next = (input.cash.get(key) ?? 0n) + input.delta;
  if (next < 0n && !negativeCashAllowed(input.accountId, input.options)) throw new WealthDomainError('negative_cash', 'Cash balance cannot become negative without explicit incomplete-history allowance.');
  input.cash.set(key, next);
}

function negativeCashAllowed(accountId: string, options: ReplayOptions): boolean {
  if (options.allowNegativeCash) return true;
  if (!options.accounts) return false;
  const account = accountRegistry(options.accounts).byId[accountId];
  return account?.kind === 'debt';
}

function positionView(position: MutablePosition): WealthPositionState {
  return {
    accountId: position.accountId,
    instrument: position.instrument,
    quantity: toString(position.quantity),
    costBasisMinor: position.costBasisMinor === null ? null : safeNumber(position.costBasisMinor, 'cost basis'),
    basisKnown: position.costBasisMinor !== null,
    realizedGainMinor: position.realizedGainMinor === null ? null : safeNumber(position.realizedGainMinor, 'realized gain'),
  };
}

function cashView([key, amount]: [string, bigint]): WealthCashBalance {
  const separator = key.indexOf('\u0000');
  return { accountId: key.slice(0, separator), currency: key.slice(separator + 1), amountMinor: safeNumber(amount, 'cash balance') };
}

function comparePositions(left: MutablePosition, right: MutablePosition): number {
  return positionKey(left.accountId, left.instrument).localeCompare(positionKey(right.accountId, right.instrument));
}

function positionKey(accountId: string, instrument: CanonicalInstrument): string {
  return `${accountId}\u0000${instrumentKey(instrument)}`;
}

function isZero(value: ScaledDecimal): boolean {
  return value.coefficient === 0n;
}

function isControl(event: WealthEvent): event is Extract<WealthEvent, { kind: 'reversal' | 'correction' }> {
  return event.kind === 'reversal' || event.kind === 'correction';
}

function invalidControl(): never {
  throw new WealthDomainError('invalid_event', 'Control events are resolved before replay.');
}
