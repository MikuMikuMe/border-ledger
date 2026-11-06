import { useEffect, useState } from 'react';
import type { LedgerApi } from '../../domain/api';
import type { WealthAccount } from '../../domain/wealth-types';
import { reversibleEventsFromResponse, type ReversibleEventOption } from './wealth-event-utils';

interface WealthCorrectionFieldsProps {
  api: LedgerApi;
  accounts: readonly WealthAccount[];
  targetSourceId: string;
  controlKind: 'reversal' | 'correction';
  onTargetSourceChange: (value: string, selected?: ReversibleEventOption) => void;
}

function useCorrectionEvents(api: LedgerApi, accounts: readonly WealthAccount[]): { events: ReversibleEventOption[]; loading: boolean } {
  const [events, setEvents] = useState<ReversibleEventOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api('/api/wealth/events?limit=500')
      .then((value) => { if (!cancelled) setEvents(reversibleEventsFromResponse(value, accounts)); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, accounts]);
  return { events, loading };
}

function controlLabel(controlKind: WealthCorrectionFieldsProps['controlKind']): string {
  return controlKind === 'correction' ? 'Original event to replace' : 'Event to reverse';
}

function controlHelp(controlKind: WealthCorrectionFieldsProps['controlKind'], selected: ReversibleEventOption | undefined): string | null {
  if (!selected) return null;
  return controlKind === 'correction'
    ? 'This keeps the original record in history and writes a typed replacement. Choose a new Activity link only if the money movement changed.'
    : `This creates a dated reversal for ${selected.label}. The original record stays in the audit history.`;
}

function emptyHelp(controlKind: WealthCorrectionFieldsProps['controlKind']): string {
  return controlKind === 'correction' ? 'No replaceable events were found in this ledger.' : 'No reversible events were found in this ledger.';
}

function CorrectionEventSelector({ events, loading, controlKind, targetSourceId, onTargetSourceChange }: Pick<WealthCorrectionFieldsProps, 'controlKind' | 'targetSourceId' | 'onTargetSourceChange'> & { events: readonly ReversibleEventOption[]; loading: boolean }) {
  const selected = events.find((event) => event.sourceId === targetSourceId);
  const onChange = (value: string) => onTargetSourceChange(value, events.find((item) => item.sourceId === value));
  return <label>{controlLabel(controlKind)}
    <select value={targetSourceId} onChange={(event) => onChange(event.target.value)} disabled={loading}>
      <option value="">{loading ? 'Loading recorded events…' : 'Choose a recorded event'}</option>
      {events.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.label}</option>)}
    </select>
    {controlHelp(controlKind, selected) ? <small>{controlHelp(controlKind, selected)}</small> : null}
    {!loading && events.length === 0 ? <small>{emptyHelp(controlKind)}</small> : null}
  </label>;
}

export function WealthCorrectionFields({ api, accounts, targetSourceId, controlKind, onTargetSourceChange }: WealthCorrectionFieldsProps) {
  const state = useCorrectionEvents(api, accounts);
  return <CorrectionEventSelector {...state} controlKind={controlKind} targetSourceId={targetSourceId} onTargetSourceChange={onTargetSourceChange} />;
}
