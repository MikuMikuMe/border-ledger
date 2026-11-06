import type { WealthEvent } from '../src/domain/wealth-types';

/** Includes the original and intervening controls, preserving audit ownership. */
export function wealthEventLineage(event: WealthEvent, bySource: ReadonlyMap<string, WealthEvent>): readonly WealthEvent[] {
  const lineage: WealthEvent[] = [];
  const visited = new Set<string>();
  let current: WealthEvent | undefined = event;
  while (current && !visited.has(current.sourceId)) {
    visited.add(current.sourceId);
    lineage.push(current);
    current = current.kind === 'correction' || current.kind === 'reversal' ? bySource.get(current.targetSourceId) : undefined;
  }
  return lineage;
}
