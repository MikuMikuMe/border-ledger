import { useEffect, useState } from 'react';
import { CircleAlert, RefreshCw, X } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { CanonicalInstrument } from '../../domain/wealth-types';
import type { WealthPayload } from './wealth-utils';
import { formatQuantity, formatWealthMoney, isRecord, normalizeEventHistory, normalizeValuationHistory, type WealthEventHistoryItem, type WealthEventHistoryReplacement, type WealthValuationHistoryItem } from './wealth-utils';

interface WealthAccountHistoryProps {
  api: LedgerApi;
  snapshot: WealthPayload;
  accountId: string;
  instrument?: CanonicalInstrument;
  onClose: () => void;
}

interface AccountHistoryState {
  events: WealthEventHistoryItem[];
  valuations: WealthValuationHistoryItem[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function sameInstrument(left: CanonicalInstrument | null, right: CanonicalInstrument): boolean {
  return left !== null && instrumentKey(left) === instrumentKey(right);
}

function instrumentKey(instrument: CanonicalInstrument): string {
  return `${instrument.exchange}:${instrument.ticker}:${instrument.type}:${instrument.currency}`;
}

function scopedHistory<T extends { instrument: CanonicalInstrument | null }>(rows: T[], instrument?: CanonicalInstrument): T[] {
  return instrument ? rows.filter((row) => sameInstrument(row.instrument, instrument)) : rows;
}

function isNonNegativeRevision(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isSafeInteger(value)) return false;
  return value >= 0;
}

function responseRevision(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return isNonNegativeRevision(value.revision) ? value.revision : null;
}

function revisionsMatch(eventRevision: number | null, valuationRevision: number | null, expectedRevision: number): boolean {
  if (eventRevision === null || valuationRevision === null) return false;
  if (eventRevision !== valuationRevision) return false;
  return eventRevision === expectedRevision;
}

function assertHistoryRevision(eventsResponse: unknown, valuationsResponse: unknown, expectedRevision: number): void {
  const eventRevision = responseRevision(eventsResponse);
  const valuationRevision = responseRevision(valuationsResponse);
  if (!revisionsMatch(eventRevision, valuationRevision, expectedRevision)) throw new Error('Account history changed while loading.');
}

function useAccountHistory(api: LedgerApi, accountId: string, snapshotRevision: number, instrument?: CanonicalInstrument): AccountHistoryState {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<Omit<AccountHistoryState, 'retry'>>({ events: [], valuations: [], loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
    const suffix = `?accountId=${encodeURIComponent(accountId)}&limit=500`;
    void Promise.all([api(`/api/wealth/events${suffix}`), api(`/api/wealth/valuations${suffix}`)])
      .then(([eventsResponse, valuationsResponse]) => { assertHistoryRevision(eventsResponse, valuationsResponse, snapshotRevision); if (!cancelled) setState({ events: scopedHistory(normalizeEventHistory(eventsResponse), instrument), valuations: scopedHistory(normalizeValuationHistory(valuationsResponse), instrument), loading: false, error: null }); })
      .catch((cause) => { if (!cancelled) setState((current) => ({ ...current, loading: false, error: cause instanceof Error && cause.message.includes('changed') ? 'Account history changed while loading. Retry to read a consistent revision.' : 'Account history is unavailable right now.' })); });
    return () => { cancelled = true; };
  }, [api, accountId, snapshotRevision, instrument, retryKey]);
  return { ...state, retry: () => setRetryKey((key) => key + 1) };
}

function historyDetailsBase(event: Pick<WealthEventHistoryItem, 'instrument' | 'quantity' | 'money' | 'memo'> | WealthEventHistoryReplacement): string {
  if (event.instrument) return `${event.instrument.exchange}:${event.instrument.ticker}${event.quantity ? ` · ${formatQuantity(event.quantity)} shares` : ''}`;
  if (event.money) return formatWealthMoney(event.money.amountMinor, event.money.currency);
  return event.memo ?? 'Recorded event';
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function historyActivityLabel(event: Pick<WealthEventHistoryItem, 'kind' | 'instrument' | 'quantity' | 'money' | 'memo'> | WealthEventHistoryReplacement, prefix?: string): string {
  return `${prefix ?? titleCase(event.kind)} · ${historyDetailsBase(event)}`;
}

function historyDetails(event: WealthEventHistoryItem, events: readonly WealthEventHistoryItem[]): string {
  if (event.replacement) {
    const target = event.targetSourceId ? events.find((item) => item.sourceId === event.targetSourceId) : undefined;
    const original = target ? historyActivityLabel(target, 'Original ' + titleCase(target.kind)) : 'Original event';
    const replacement = historyActivityLabel(event.replacement, 'Corrected ' + titleCase(event.replacement.kind));
    return `${original} → ${replacement}`;
  }
  return historyDetailsBase(event);
}

function EventHistory({ events, loading }: { events: readonly WealthEventHistoryItem[]; loading: boolean }) {
  if (loading) return <p className="wealth-empty-copy"><RefreshCw size={14} className="is-spinning" /> Loading event history…</p>;
  if (!events.length) return <p className="wealth-empty-copy">No event history returned for this account.</p>;
  return <div className="wealth-table-wrap"><table><caption>Account event history</caption><thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Details</th></tr></thead><tbody>{events.map((event) => <tr key={event.sourceId}><th scope="row">{event.date}</th><td>{titleCase(event.kind)}</td><td>{historyDetails(event, events)}</td></tr>)}</tbody></table></div>;
}

function ValuationHistory({ valuations, loading, accountCurrency }: { valuations: readonly WealthValuationHistoryItem[]; loading: boolean; accountCurrency?: string }) {
  if (loading) return <p className="wealth-empty-copy"><RefreshCw size={14} className="is-spinning" /> Loading valuation history…</p>;
  if (!valuations.length) return <p className="wealth-empty-copy">No dated values returned for this account.</p>;
  return <div className="wealth-table-wrap"><table><caption>Account valuation history</caption><thead><tr><th scope="col">Date</th><th scope="col">Instrument</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>{valuations.map((valuation) => { const currency = valuation.instrument?.currency ?? accountCurrency; return <tr key={valuation.id}><th scope="row">{valuation.asOf}</th><td>{valuation.instrument ? `${valuation.instrument.exchange}:${valuation.instrument.ticker}` : 'Account total'}</td><td>{currency ? formatWealthMoney(valuation.priceMinor, currency) : 'Unavailable'}</td><td>{valuation.source === 'provider' ? 'Provider quote' : 'Manual value'}</td></tr>; })}</tbody></table></div>;
}

export function WealthAccountHistory({ api, snapshot, accountId, instrument, onClose }: WealthAccountHistoryProps) {
  const account = snapshot.accounts.find((item) => item.id === accountId);
  const positions = snapshot.positions.filter((item) => item.accountId === accountId && (!instrument || sameInstrument(item.instrument, instrument)));
  const history = useAccountHistory(api, accountId, snapshot.revision, instrument);
  const title = instrument ? `${instrument.exchange}:${instrument.ticker}` : account?.name ?? 'Unknown account';
  return <section className="wealth-drilldown" aria-labelledby="wealth-drilldown-title">
    <div className="wealth-section-heading"><div><h2 id="wealth-drilldown-title">{title} detail</h2><p>{instrument ? 'Security event and valuation history from the account’s dated records.' : 'Event and valuation history is read from the account’s dated records.'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close account detail"><X size={16} /></button></div>
    {history.error ? <div className="wealth-form-error" role="alert"><CircleAlert size={15} /><span>{history.error}</span><button type="button" className="quiet-button" onClick={history.retry}><RefreshCw size={14} /> Retry history</button></div> : null}
    <div className="wealth-drilldown-grid"><div><h3>Instruments</h3>{positions.length ? positions.map((position) => <div className="wealth-detail-row" key={`${position.instrument.exchange}-${position.instrument.ticker}`}><span><strong>{position.instrument.ticker}</strong><small>{position.instrument.exchange} · {formatQuantity(position.quantity)} shares</small></span><span>{formatWealthMoney(position.marketValueMinor, position.instrument.currency)}</span></div>) : <p className="wealth-empty-copy">No instrument events yet.</p>}</div><div><h3>Event history</h3><EventHistory events={history.events} loading={history.loading} /></div><div><h3>Valuation history</h3><ValuationHistory valuations={history.valuations} loading={history.loading} accountCurrency={account?.currency} /></div></div>
  </section>;
}
