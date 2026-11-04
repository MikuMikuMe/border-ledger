import { createWealthAccountRegistry, resolveWealthEvents, replayWealthEvents } from '../src/domain/wealth';
import type { WealthAccount, WealthEvent } from '../src/domain/wealth-types';

export interface WealthSegmentTransition {
  readonly account_id: string;
  readonly effective_date: string;
  readonly from_mode: WealthAccount['mode'];
  readonly to_mode: WealthAccount['mode'];
}

export interface WealthSegmentProjectionContext {
  readonly accounts: readonly WealthAccount[];
  readonly transitions: readonly WealthSegmentTransition[];
  readonly lineageEvents?: readonly WealthEvent[];
}

export interface WealthReplayValidationQuery {
  readonly events: readonly WealthEvent[];
  readonly context: WealthSegmentProjectionContext;
  readonly asOf: string;
  readonly fromDate?: string | null;
}

interface SegmentRef {
  readonly accountId: string;
  readonly mode: WealthAccount['mode'];
  readonly startDate: string | null;
}

interface SegmentProjectionState {
  readonly effectiveEvents: readonly WealthEvent[];
  readonly timelines: ReadonlyMap<string, readonly SegmentRef[]>;
  readonly dependencyEvents: ReadonlyMap<string, readonly WealthEvent[]>;
  readonly transitions: readonly WealthSegmentTransition[];
  readonly replayAccountIds: ReadonlyMap<string, string>;
  readonly asOf: string;
  readonly selected: Map<string, WealthEvent>;
  readonly dependencies: PositionDependency[];
}

interface PositionDependency {
  readonly accountId: string;
  readonly throughDate: string;
  readonly segmentStartDate: string | null;
}

function accountTransitions(accountId: string, transitions: readonly WealthSegmentTransition[]): WealthSegmentTransition[] {
  return transitions.filter((transition) => transition.account_id === accountId).sort((left, right) => left.effective_date.localeCompare(right.effective_date));
}

function segmentTimeline(account: Pick<WealthAccount, 'id' | 'mode'>, transitions: readonly WealthSegmentTransition[]): SegmentRef[] {
  const history = accountTransitions(account.id, transitions);
  const initial = history[0]?.from_mode ?? account.mode;
  return [
    { accountId: account.id, mode: initial, startDate: null },
    ...history.map((transition) => ({ accountId: account.id, mode: transition.to_mode, startDate: transition.effective_date })),
  ];
}

function segmentTimelines(accounts: readonly WealthAccount[], transitions: readonly WealthSegmentTransition[]): ReadonlyMap<string, readonly SegmentRef[]> {
  const grouped = new Map<string, WealthSegmentTransition[]>();
  for (const transition of transitions) {
    const history = grouped.get(transition.account_id) ?? [];
    history.push(transition);
    grouped.set(transition.account_id, history);
  }
  return new Map(accounts.map((account) => [account.id, segmentTimeline(account, grouped.get(account.id) ?? [])]));
}

function segmentAtTimeline(timeline: readonly SegmentRef[], asOf: string): SegmentRef {
  let lower = 0;
  let upper = timeline.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const date = timeline[middle].startDate;
    if (date === null || date <= asOf) lower = middle + 1;
    else upper = middle;
  }
  return timeline[Math.max(0, lower - 1)];
}

function sameSegment(left: SegmentRef, right: SegmentRef): boolean {
  return left.accountId === right.accountId && left.mode === right.mode && left.startDate === right.startDate;
}

function segmentAliasId(segment: SegmentRef): string {
  return `__wealth_segment__${encodeURIComponent(segment.accountId)}__${segment.startDate ?? 'initial'}`;
}


function segmentKey(segment: SegmentRef): string {
  return `${segment.accountId}\u0000${segment.mode}\u0000${segment.startDate ?? ''}`;
}

function historicalHoldingsSegments(timeline: readonly SegmentRef[], asOf: string): SegmentRef[] {
  const current = segmentAtTimeline(timeline, asOf);
  return timeline.filter((segment) => {
    if (segment.mode !== 'holdings') return false;
    if (sameSegment(segment, current)) return false;
    return segment.startDate === null || segment.startDate <= asOf;
  });
}

function allocateReplayAlias(segment: SegmentRef, occupied: Set<string>): string {
  const base = segmentAliasId(segment);
  let id = base;
  let suffix = 1;
  while (occupied.has(id)) id = `${base}__${suffix++}`;
  occupied.add(id);
  return id;
}

function replayAliasIds(
  accounts: readonly WealthAccount[],
  transitions: readonly WealthSegmentTransition[],
  asOf: string,
): ReadonlyMap<string, string> {
  const timelines = segmentTimelines(accounts, transitions);
  const occupied = new Set(accounts.map((account) => account.id));
  const aliases = new Map<string, string>();
  for (const account of accounts) {
    for (const segment of historicalHoldingsSegments(timelines.get(account.id)!, asOf)) {
      aliases.set(segmentKey(segment), allocateReplayAlias(segment, occupied));
    }
  }
  return aliases;
}

function segmentAtDate(accountId: string, eventDate: string, state: SegmentProjectionState): SegmentRef | null {
  const timeline = state.timelines.get(accountId);
  return timeline ? segmentAtTimeline(timeline, eventDate) : null;
}

function currentSegment(accountId: string, state: SegmentProjectionState): SegmentRef | null {
  return segmentAtDate(accountId, state.asOf, state);
}

function accountInCurrentHoldingsSegment(accountId: string, eventDate: string, state: SegmentProjectionState): boolean {
  const current = currentSegment(accountId, state);
  const dated = segmentAtDate(accountId, eventDate, state);
  return Boolean(current && dated && current.mode === 'holdings' && sameSegment(current, dated));
}

function holdingsSegmentAtDate(accountId: string, eventDate: string, state: SegmentProjectionState): SegmentRef | null {
  const segment = segmentAtDate(accountId, eventDate, state);
  return segment?.mode === 'holdings' ? segment : null;
}

function segmentReplayAccountId(state: SegmentProjectionState, segment: SegmentRef): string {
  if (segment.mode !== 'holdings') return segment.accountId;
  const current = currentSegment(segment.accountId, state);
  return current && sameSegment(current, segment) ? segment.accountId : state.replayAccountIds.get(segmentKey(segment)) ?? segmentAliasId(segment);
}

function projectedCashTransfer(
  event: Extract<WealthEvent, { kind: 'transfer'; transferKind: 'cash' }>,
  accountId: string,
  replayAccountId = accountId,
): WealthEvent {
  const incoming = event.toAccountId === accountId;
  return {
    id: `${event.id}:segment:${replayAccountId}`,
    sourceId: `${event.sourceId}:segment:${replayAccountId}`,
    date: event.date,
    ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    ...(event.memo === undefined ? {} : { memo: event.memo }),
    ...(event.linkedBankSourceId === undefined ? {} : { linkedBankSourceId: event.linkedBankSourceId }),
    kind: incoming ? 'contribution' : 'withdrawal',
    accountId: replayAccountId,
    money: event.money,
  } as WealthEvent;
}

function wealthEventAccountIds(event: WealthEvent): string[] {
  if (event.kind === 'transfer') return [event.fromAccountId, event.toAccountId];
  if (event.kind === 'correction') {
    const replacement = event.replacement;
    return replacement.kind === 'transfer' ? [replacement.fromAccountId, replacement.toAccountId] : 'accountId' in replacement ? [replacement.accountId] : [];
  }
  return 'accountId' in event ? [event.accountId] : [];
}

function scopedAccountEvent(event: WealthEvent, accountId: string, replayAccountId: string): WealthEvent {
  if (accountId === replayAccountId) return event;
  return {
    ...event,
    id: `${event.id}:segment:${replayAccountId}`,
    sourceId: `${event.sourceId}:segment:${replayAccountId}`,
    accountId: replayAccountId,
  } as WealthEvent;
}

function scopedPositionTransfer(event: Extract<WealthEvent, { kind: 'transfer'; transferKind: 'position' }>, state: SegmentProjectionState): WealthEvent {
  const fromSegment = segmentAtDate(event.fromAccountId, event.date, state);
  const toSegment = segmentAtDate(event.toAccountId, event.date, state);
  if (!fromSegment || !toSegment) return event;
  const fromAccountId = segmentReplayAccountId(state, fromSegment);
  const toAccountId = segmentReplayAccountId(state, toSegment);
  if (fromAccountId === event.fromAccountId && toAccountId === event.toAccountId) return event;
  const scope = `${fromAccountId}->${toAccountId}`;
  return { ...event, id: `${event.id}:segment:${scope}`, sourceId: `${event.sourceId}:segment:${scope}`, fromAccountId, toAccountId };
}

function addSegmentEvent(target: Map<string, WealthEvent>, event: WealthEvent, original: WealthEvent): void {
  const key = JSON.stringify([original.sourceId, event.kind, ...wealthEventAccountIds(event)]);
  target.set(key, event);
}

function dependencyEventIndex(events: readonly WealthEvent[], timelines: ReadonlyMap<string, readonly SegmentRef[]>): ReadonlyMap<string, readonly WealthEvent[]> {
  const index = new Map<string, WealthEvent[]>();
  for (const event of events) {
    for (const accountId of wealthEventAccountIds(event)) {
      const timeline = timelines.get(accountId);
      if (!timeline) continue;
      const segment = segmentAtTimeline(timeline, event.date);
      if (segment.mode !== 'holdings') continue;
      const key = segmentKey(segment);
      const entries = index.get(key) ?? [];
      entries.push(event);
      index.set(key, entries);
    }
  }
  return index;
}

function queueIncomingPositionDependency(state: SegmentProjectionState, dependency: PositionDependency, event: WealthEvent): void {
  if (event.kind !== 'transfer') return;
  if (event.transferKind !== 'position') return;
  if (event.toAccountId !== dependency.accountId) return;
  if (accountInCurrentHoldingsSegment(event.fromAccountId, event.date, state)) return;
  const sourceSegment = holdingsSegmentAtDate(event.fromAccountId, event.date, state);
  if (sourceSegment) state.dependencies.push({ accountId: event.fromAccountId, throughDate: event.date, segmentStartDate: sourceSegment.startDate });
}

function addPositionDependencyEvent(state: SegmentProjectionState, dependency: PositionDependency, event: WealthEvent): void {
  if (event.kind === 'transfer' && event.transferKind === 'cash') {
    const segment: SegmentRef = { accountId: dependency.accountId, mode: 'holdings', startDate: dependency.segmentStartDate };
    addSegmentEvent(state.selected, projectedCashTransfer(event, dependency.accountId, segmentReplayAccountId(state, segment)), event);
    return;
  }
  addSegmentEvent(state.selected, event.kind === 'transfer' && event.transferKind === 'position' ? scopedPositionTransfer(event, state) : scopeEventForSegment(event, state), event);
  queueIncomingPositionDependency(state, dependency, event);
}

function addPositionSegmentDependencies(state: SegmentProjectionState, dependency: PositionDependency, offsets: Map<string, number>): void {
  const key = segmentKey({ accountId: dependency.accountId, mode: 'holdings', startDate: dependency.segmentStartDate });
  const events = state.dependencyEvents.get(key) ?? [];
  let cursor = offsets.get(key) ?? 0;
  while (cursor < events.length) {
    const event = events[cursor];
    if (event.date > dependency.throughDate) break;
    addPositionDependencyEvent(state, dependency, event);
    cursor++;
  }
  offsets.set(key, cursor);
}

function projectTransfer(state: SegmentProjectionState, event: Extract<WealthEvent, { kind: 'transfer' }>): void {
  const endpoints = [event.fromAccountId, event.toAccountId].map((accountId) => ({ accountId, active: accountInCurrentHoldingsSegment(accountId, event.date, state) }));
  const active = endpoints.filter((endpoint) => endpoint.active);
  if (active.length === 2) {
    addSegmentEvent(state.selected, event.transferKind === 'position' ? scopedPositionTransfer(event, state) : event, event);
    return;
  }
  if (active.length !== 1) return;
  const accountId = active[0].accountId;
  if (event.transferKind === 'cash') {
    addSegmentEvent(state.selected, projectedCashTransfer(event, accountId), event);
    return;
  }
  addSegmentEvent(state.selected, scopedPositionTransfer(event, state), event);
  if (accountId === event.toAccountId) {
    const sourceSegment = holdingsSegmentAtDate(event.fromAccountId, event.date, state);
    if (sourceSegment) state.dependencies.push({ accountId: event.fromAccountId, throughDate: event.date, segmentStartDate: sourceSegment.startDate });
  }
}

function scopeEventForSegment(event: WealthEvent, state: SegmentProjectionState): WealthEvent {
  const accountId = wealthEventAccountIds(event)[0];
  if (!accountId) return event;
  const segment = segmentAtDate(accountId, event.date, state);
  return segment ? scopedAccountEvent(event, accountId, segmentReplayAccountId(state, segment)) : event;
}

function projectSegmentEvent(state: SegmentProjectionState, event: WealthEvent): void {
  if (event.kind === 'transfer') {
    projectTransfer(state, event);
    return;
  }
  const accountId = wealthEventAccountIds(event)[0];
  if (accountId && accountInCurrentHoldingsSegment(accountId, event.date, state)) addSegmentEvent(state.selected, scopeEventForSegment(event, state), event);
}

function orderedSegmentEvents(selected: Iterable<WealthEvent>): WealthEvent[] {
  const ordered = [...selected].sort((left, right) => left.date.localeCompare(right.date) || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) || left.sourceId.localeCompare(right.sourceId));
  // Controls have already been resolved; these identities exist only during replay.
  return ordered.map((event, index) => ({ ...event, id: `wealth-replay-${index}`, sourceId: `wealth-replay-${index}`, sequence: index + 1 }));
}

function effectiveEventsForSegment(events: readonly WealthEvent[], asOf: string, lineageEvents: readonly WealthEvent[] | undefined): readonly WealthEvent[] {
  const dated = events.filter((event) => event.date <= asOf);
  if (!lineageEvents || lineageEvents.length === 0) return resolveWealthEvents(dated);
  const seen = new Set(dated.map((event) => event.sourceId));
  return resolveWealthEvents([...dated, ...lineageEvents.filter((event) => !seen.has(event.sourceId))]).filter((event) => event.date <= asOf);
}

export function modeSegmentReplayAccounts(
  accounts: readonly WealthAccount[],
  transitions: readonly WealthSegmentTransition[],
  asOf: string,
): readonly WealthAccount[] {
  const timelines = segmentTimelines(accounts, transitions);
  const current = accounts.map((account) => ({ ...account, mode: segmentAtTimeline(timelines.get(account.id)!, asOf).mode }));
  const aliases = replayAliasIds(accounts, transitions, asOf);
  const historical: WealthAccount[] = [];
  for (const account of accounts) {
    for (const segment of historicalHoldingsSegments(timelines.get(account.id)!, asOf)) {
      const id = aliases.get(segmentKey(segment))!;
      historical.push({ ...account, id, name: `${account.name} (historical ${segment.startDate ?? 'opening'})`, kind: 'brokerage', mode: 'aggregate', linkedBankAccountId: null, active: true });
    }
  }
  return [...current, ...historical];
}

export function eventsForCurrentModeSegment(
  events: readonly WealthEvent[],
  context: WealthSegmentProjectionContext,
  asOf: string,
): readonly WealthEvent[] {
  const effectiveEvents = effectiveEventsForSegment(events, asOf, context.lineageEvents);
  const timelines = segmentTimelines(context.accounts, context.transitions);
  const state: SegmentProjectionState = {
    effectiveEvents,
    timelines,
    dependencyEvents: dependencyEventIndex(effectiveEvents, timelines),
    transitions: context.transitions,
    replayAccountIds: replayAliasIds(context.accounts, context.transitions, asOf),
    asOf,
    selected: new Map(),
    dependencies: [],
  };
  for (const event of state.effectiveEvents) projectSegmentEvent(state, event);
  const offsets = new Map<string, number>();
  while (state.dependencies.length > 0) {
    const dependency = state.dependencies.shift()!;
    addPositionSegmentDependencies(state, dependency, offsets);
  }
  return orderedSegmentEvents(state.selected.values());
}

function precedingEventDate(dates: readonly string[], boundary: string): string | null {
  let lower = 0;
  let upper = dates.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (dates[middle] < boundary) lower = middle + 1;
    else upper = middle;
  }
  return lower > 0 ? dates[lower - 1] : null;
}

function replayBoundaryDates(events: readonly WealthEvent[], transitions: readonly WealthSegmentTransition[]): Set<string> {
  const controls = events.filter((event) => event.kind === 'correction' || event.kind === 'reversal');
  return new Set([...transitions.map((transition) => transition.effective_date), ...controls.map((event) => event.date)]);
}

function replayCheckpointDates(query: WealthReplayValidationQuery): string[] {
  const dated = query.events.filter((event) => event.date <= query.asOf);
  const eventDates = [...new Set([...dated, ...resolveWealthEvents(dated)].map((event) => event.date))].sort();
  const boundaries = replayBoundaryDates(dated, query.context.transitions);
  const dates = new Set([query.asOf]);
  if (query.fromDate) dates.add(query.fromDate);
  for (const boundary of boundaries) {
    if (boundary > query.asOf) continue;
    dates.add(boundary);
    const prior = precedingEventDate(eventDates, boundary);
    if (prior) dates.add(prior);
  }
  return [...dates].filter((date) => !query.fromDate || date >= query.fromDate).sort();
}

export function replayWealthEventsAcrossModeSegments(query: WealthReplayValidationQuery): void {
  // A replay already checks every intermediate balance. Replay again only when
  // a control record or mode transition changes which historical tape is visible.
  for (const date of replayCheckpointDates(query)) {
    const projected = eventsForCurrentModeSegment(query.events, query.context, date);
    if (projected.length === 0) continue;
    const accounts = createWealthAccountRegistry(modeSegmentReplayAccounts(query.context.accounts, query.context.transitions, date));
    replayWealthEvents(projected, { accounts });
  }
}
