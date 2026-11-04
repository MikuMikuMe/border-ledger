import { resolveWealthEvents } from '../src/domain/wealth';
import type { WealthAccount, WealthEvent } from '../src/domain/wealth-types';

export interface WealthSegmentTransition {
  readonly account_id: string;
  readonly effective_date: string;
  readonly from_mode: WealthAccount['mode'];
  readonly to_mode: WealthAccount['mode'];
}

interface SegmentProjectionState {
  readonly effectiveEvents: readonly WealthEvent[];
  readonly accounts: ReadonlyMap<string, WealthAccount>;
  readonly transitions: readonly WealthSegmentTransition[];
  readonly asOf: string;
  readonly selected: Map<string, WealthEvent>;
  readonly dependencies: PositionDependency[];
}

function accountTransitions(accountId: string, transitions: readonly WealthSegmentTransition[]): WealthSegmentTransition[] {
  return transitions.filter((transition) => transition.account_id === accountId).sort((left, right) => left.effective_date.localeCompare(right.effective_date));
}

function modeSegment(account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly WealthSegmentTransition[], asOf: string): { mode: WealthAccount['mode']; startDate: string | null } {
  const history = accountTransitions(account.id, transitions);
  const prior = history.filter((transition) => transition.effective_date <= asOf).at(-1);
  if (prior) return { mode: prior.to_mode, startDate: prior.effective_date };
  return { mode: history[0]?.from_mode ?? account.mode, startDate: null };
}

function accountInCurrentHoldingsSegment(accountId: string, eventDate: string, state: SegmentProjectionState): boolean {
  const account = state.accounts.get(accountId);
  if (!account) return false;
  const segment = modeSegment(account, state.transitions, state.asOf);
  return segment.mode === 'holdings' && (segment.startDate === null || eventDate >= segment.startDate);
}

function holdingsSegmentAtDate(accountId: string, eventDate: string, state: SegmentProjectionState): { mode: WealthAccount['mode']; startDate: string | null } | null {
  const account = state.accounts.get(accountId);
  if (!account) return null;
  const segment = modeSegment(account, state.transitions, eventDate);
  return segment.mode === 'holdings' ? segment : null;
}

function accountWasInHoldingsSegment(accountId: string, eventDate: string, segmentStartDate: string | null, state: SegmentProjectionState): boolean {
  const segment = holdingsSegmentAtDate(accountId, eventDate, state);
  return segment !== null && segment.startDate === segmentStartDate && (segment.startDate === null || eventDate >= segment.startDate);
}

function projectedCashTransfer(event: Extract<WealthEvent, { kind: 'transfer'; transferKind: 'cash' }>, accountId: string): WealthEvent {
  const incoming = event.toAccountId === accountId;
  return {
    id: `${event.id}:segment:${accountId}`,
    sourceId: `${event.sourceId}:segment:${accountId}`,
    date: event.date,
    ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    ...(event.memo === undefined ? {} : { memo: event.memo }),
    ...(event.linkedBankSourceId === undefined ? {} : { linkedBankSourceId: event.linkedBankSourceId }),
    kind: incoming ? 'contribution' : 'withdrawal',
    accountId,
    money: event.money,
  } as WealthEvent;
}

interface PositionDependency {
  readonly accountId: string;
  readonly throughDate: string;
  readonly segmentStartDate: string | null;
}

function wealthEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') {
    const replacement = event.replacement;
    return replacement.kind === 'transfer' ? [replacement.fromAccountId, replacement.toAccountId] : 'accountId' in replacement ? [replacement.accountId] : [];
  }
  return 'accountId' in event ? [event.accountId] : [];
}

function addSegmentEvent(target: Map<string, WealthEvent>, event: WealthEvent): void {
  target.set(event.sourceId, event);
}

function isPositionDependencyEvent(state: SegmentProjectionState, dependency: PositionDependency, event: WealthEvent): boolean {
  if (event.date > dependency.throughDate) return false;
  if (!wealthEventAccountIds(event).includes(dependency.accountId)) return false;
  return accountWasInHoldingsSegment(dependency.accountId, event.date, dependency.segmentStartDate, state);
}

function queueIncomingPositionDependency(state: SegmentProjectionState, dependency: PositionDependency, event: WealthEvent): void {
  if (event.kind !== 'transfer') return;
  if (event.transferKind !== 'position') return;
  if (event.toAccountId !== dependency.accountId) return;
  const sourceSegment = holdingsSegmentAtDate(event.fromAccountId, event.date, state);
  if (sourceSegment) state.dependencies.push({ accountId: event.fromAccountId, throughDate: event.date, segmentStartDate: sourceSegment.startDate });
}

function addPositionDependencyEvent(state: SegmentProjectionState, dependency: PositionDependency, event: WealthEvent): void {
  if (event.kind === 'transfer' && event.transferKind === 'cash') {
    addSegmentEvent(state.selected, projectedCashTransfer(event, dependency.accountId));
    return;
  }
  addSegmentEvent(state.selected, event);
  queueIncomingPositionDependency(state, dependency, event);
}

function addPositionSegmentDependencies(state: SegmentProjectionState, dependency: PositionDependency): void {
  for (const event of state.effectiveEvents) {
    if (!isPositionDependencyEvent(state, dependency, event)) continue;
    addPositionDependencyEvent(state, dependency, event);
  }
}

function projectTransfer(state: SegmentProjectionState, event: Extract<WealthEvent, { kind: 'transfer' }>): void {
  const activeIds = wealthEventAccountIds(event).filter((accountId) => accountInCurrentHoldingsSegment(accountId, event.date, state));
  if (activeIds.length === 2) {
    addSegmentEvent(state.selected, event);
    return;
  }
  if (activeIds.length !== 1) return;
  if (event.transferKind === 'cash') {
    addSegmentEvent(state.selected, projectedCashTransfer(event, activeIds[0]));
    return;
  }
  addSegmentEvent(state.selected, event);
  if (activeIds[0] === event.toAccountId) {
    const sourceSegment = holdingsSegmentAtDate(event.fromAccountId, event.date, state);
    if (sourceSegment) state.dependencies.push({ accountId: event.fromAccountId, throughDate: event.date, segmentStartDate: sourceSegment.startDate });
  }
}

function projectSegmentEvent(state: SegmentProjectionState, event: WealthEvent): void {
  if (event.kind === 'transfer') {
    projectTransfer(state, event);
    return;
  }
  const accountId = wealthEventAccountIds(event)[0];
  if (accountId && accountInCurrentHoldingsSegment(accountId, event.date, state)) addSegmentEvent(state.selected, event);
}

function orderedSegmentEvents(selected: Iterable<WealthEvent>): WealthEvent[] {
  const ordered = [...selected].sort((left, right) => left.date.localeCompare(right.date) || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) || left.sourceId.localeCompare(right.sourceId));
  return ordered.map((event, index) => ({ ...event, sequence: index + 1 }));
}

interface SegmentProjectionOptions {
  readonly lineageEvents?: readonly WealthEvent[];
}

function effectiveEventsForSegment(events: readonly WealthEvent[], asOf: string, lineageEvents: readonly WealthEvent[] | undefined): readonly WealthEvent[] {
  const dated = events.filter((event) => event.date <= asOf);
  if (!lineageEvents || lineageEvents.length === 0) return resolveWealthEvents(dated);
  const seen = new Set(dated.map((event) => event.sourceId));
  return resolveWealthEvents([...dated, ...lineageEvents.filter((event) => !seen.has(event.sourceId))]).filter((event) => event.date <= asOf);
}

export function eventsForCurrentModeSegment(
  events: readonly WealthEvent[],
  accounts: readonly WealthAccount[],
  transitions: readonly WealthSegmentTransition[],
  asOf: string,
  options: SegmentProjectionOptions = {},
): readonly WealthEvent[] {
  const state: SegmentProjectionState = {
    effectiveEvents: effectiveEventsForSegment(events, asOf, options.lineageEvents),
    accounts: new Map(accounts.map((account) => [account.id, account])),
    transitions,
    asOf,
    selected: new Map(),
    dependencies: [],
  };
  for (const event of state.effectiveEvents) projectSegmentEvent(state, event);
  const queued = new Set<string>();
  while (state.dependencies.length > 0) {
    const dependency = state.dependencies.shift()!;
    const key = `${dependency.accountId}:${dependency.throughDate}:${dependency.segmentStartDate ?? ''}`;
    if (queued.has(key)) continue;
    queued.add(key);
    addPositionSegmentDependencies(state, dependency);
  }
  return orderedSegmentEvents(state.selected.values());
}
