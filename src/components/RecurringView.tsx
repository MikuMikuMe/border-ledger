import { useLedgerApi } from './PrivateSession';
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, CircleCheck, Clock3, Filter, RefreshCw, ShieldCheck, Tag, TrendingUp } from 'lucide-react';
import { formatDate, formatMoney } from '../domain/format';
import { LedgerApiError } from '../domain/api';
import type { RecurringClassification, RecurringPage, RecurringStream, RecurringSummary } from '../domain/recurring';
import type { Currency } from '../domain/types';
import { supportedCurrencyCodes } from '../domain/currencies';
import RecurringDetails from './RecurringDetails';

interface RecurringViewProps {
  today: string;
  startDate: string;
  endDate: string;
}

type FeedStatus = 'loading' | 'ready' | 'error';

function displayAmount(amountMinor: number | null, currency: Currency) {
  return amountMinor === null ? '—' : formatMoney(Math.abs(amountMinor), currency, { signDisplay: 'never' });
}

function errorMessage(error: unknown) {
  if (error instanceof LedgerApiError && error.status === 401) return 'This private recurring feed needs Cloudflare Access before it can open.';
  if (error instanceof Error) return error.message;
  return 'The recurring feed could not be loaded.';
}

function stateCopy(state: RecurringPage['state']) {
  if (state === 'waiting') return { title: 'Waiting for the first recurring snapshot', body: 'The connection is ready, but the provider has not published a recurring snapshot yet.' };
  if (state === 'empty') return { title: 'No recurring payments found', body: 'The latest private snapshot did not identify a recurring stream.' };
  if (state === 'stale') return { title: 'Showing the last good snapshot', body: 'The recurring source is more than a day old. New data will replace it after the next successful refresh.' };
  if (state === 'incomplete') return { title: 'Recurring history is still maturing', body: 'The provider has returned a partial history. Estimates remain separate from confirmed ledger cost.' };
  if (state === 'error') return { title: 'The recurring refresh needs attention', body: 'The last good snapshot remains visible while the source reports an error.' };
  if (state === 'unavailable') return { title: 'Connect a source to see recurring payments', body: 'Recurring analysis appears after a permitted registered-currency account completes its first source sync.' };
  return null;
}

function currencyTotal(summary: RecurringSummary | null, key: 'monthlyByCurrency' | 'actualCostByCurrency', currency: Currency) {
  return summary ? summary[key][currency] : 0;
}

function StreamRow({ stream, onOpen }: { stream: RecurringStream; onOpen: (id: string) => void }) {
  const frequency = stream.frequency === 'UNKNOWN' ? stream.sourceFrequency : stream.frequency.replace('_', ' ');
  return <button type="button" className="recurring-stream-row" onClick={() => onOpen(stream.id)}><span className={`recurring-stream-mark ${stream.currency.toLowerCase()}`} aria-hidden="true" /><span className="recurring-stream-main"><strong>{stream.merchantName ?? 'Unnamed recurring stream'}</strong><small>{frequency} · {stream.sourceStatus.replace('_', ' ')}</small></span><span className="recurring-stream-next">{stream.predictedNextDate ? <><b>{formatDate(stream.predictedNextDate)}</b><small>next expected</small></> : <><b>—</b><small>no prediction</small></>}</span><span className="recurring-stream-amount"><b>{displayAmount(stream.lastAmountMinor ?? stream.averageAmountMinor, stream.currency)}</b><small>{stream.currency}</small></span><span className="recurring-stream-arrow" aria-hidden="true">→</span></button>;
}

function SummaryCell({ currency, label, value, tone = 'neutral' }: { currency: Currency; label: string; value: number; tone?: 'neutral' | 'actual' }) {
  return <div className={`recurring-summary-cell ${currency.toLowerCase()} ${tone}`}><span>{currency} · {label}</span><strong>{formatMoney(Math.abs(value), currency, { signDisplay: 'never' })}</strong><small>{tone === 'actual' ? 'linked posted cost' : 'source estimate'}</small></div>;
}

export function RecurringView({ today, startDate, endDate }: RecurringViewProps) {
  const ledgerApi = useLedgerApi();
  const [page, setPage] = useState<RecurringPage | null>(null);
  const [summary, setSummary] = useState<RecurringSummary | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency | 'all'>('all');
  const [classification, setClassification] = useState<RecurringClassification | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = () => setReloadToken((value) => value + 1);

  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const params = new URLSearchParams({ limit: '50', today, cursor: page.nextCursor });
    if (currency !== 'all') params.set('currency', currency);
    if (classification !== 'all') params.set('classification', classification);
    try {
      const nextPage = await ledgerApi<RecurringPage>(`/api/recurring?${params.toString()}`);
      setPage((current) => current ? {
        ...current,
        streams: [...current.streams, ...nextPage.streams],
        nextCursor: nextPage.nextCursor,
        coverageWarnings: [...new Set([...current.coverageWarnings, ...nextPage.coverageWarnings])],
      } : nextPage);
    } catch (reason: unknown) {
      setLoadMoreError(errorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const params = new URLSearchParams({ limit: '50', today });
    if (currency !== 'all') params.set('currency', currency);
    if (classification !== 'all') params.set('classification', classification);
    const summaryParams = new URLSearchParams({ start: startDate, end: endDate, today });
    if (currency !== 'all') summaryParams.set('currency', currency);
    if (classification !== 'all') summaryParams.set('classification', classification);
    void Promise.all([
      ledgerApi<RecurringPage>(`/api/recurring?${params.toString()}`),
      ledgerApi<RecurringSummary>(`/api/recurring/summary?${summaryParams.toString()}`),
    ]).then(([nextPage, nextSummary]) => {
      if (cancelled) return;
      setPage(nextPage);
      setSummary(nextSummary);
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(errorMessage(reason));
    });
    return () => { cancelled = true; };
  }, [classification, currency, endDate, reloadToken, startDate, today]);

  const state = page?.state ?? summary?.state ?? 'unavailable';
  const notice = stateCopy(state);
  const streamCount = summary?.streamCount ?? page?.streams.length ?? 0;
  const upcoming = summary?.upcoming ?? [];
  const changes = summary?.latestPaymentChanges ?? [];
  const lastGoodLabel = page?.checkedAt ? `Last good snapshot ${formatDate(page.checkedAt.slice(0, 10))}` : 'No successful snapshot yet';
  const selectedStream = useMemo(() => page?.streams.find((stream) => stream.id === selectedId) ?? null, [page, selectedId]);
  const summaryCurrencies = useMemo(() => {
    const observed = new Set<Currency>([
      ...Object.keys(summary?.monthlyByCurrency ?? {}),
      ...Object.keys(summary?.actualCostByCurrency ?? {}),
      ...(page?.streams ?? []).map((stream) => stream.currency),
    ]);
    const nonZero = supportedCurrencyCodes.filter((code) => observed.has(code) && (
      (summary?.monthlyByCurrency[code] ?? 0) !== 0 ||
      (summary?.actualCostByCurrency[code] ?? 0) !== 0
    ));
    if (nonZero.length > 0) return nonZero;
    return supportedCurrencyCodes.filter((code) => code === 'CAD' || code === 'CNY');
  }, [page?.streams, summary]);
  const primaryCurrency = summaryCurrencies[0] ?? 'CAD';

  return <>
    <div className="page-intro recurring-page-intro"><div><p className="eyebrow">THE RECURRING LEDGER</p><h1>Make the repeatable visible.</h1><p className="intro-copy">Provider-detected streams, source currencies kept apart, and actual posted cost grounded in the ledger.</p></div><button type="button" className="outline-button" onClick={load} disabled={status === 'loading'}><RefreshCw size={16} className={status === 'loading' ? 'is-spinning' : undefined} /> Refresh recurring feed</button></div>
    {status === 'error' ? <section className="panel recurring-state-panel is-error" role="alert"><CircleAlert size={18} /><div><strong>Could not load recurring payments</strong><p>{error}</p></div><button type="button" className="outline-button" onClick={load}>Try again <RefreshCw size={14} /></button></section> : null}
    {status === 'loading' ? <section className="panel recurring-state-panel" role="status" aria-live="polite"><RefreshCw size={18} className="is-spinning" /><div><strong>Reading your private recurring feed</strong><p>Loading the latest stored projection. No provider call is made from this screen.</p></div></section> : null}
    {status === 'ready' && notice ? <section className={`panel recurring-state-panel ${state === 'error' || state === 'stale' ? 'is-warning' : ''}`} role={state === 'error' ? 'alert' : 'status'}><span className="recurring-state-icon">{state === 'waiting' ? <Clock3 size={18} /> : state === 'unavailable' ? <ShieldCheck size={18} /> : state === 'error' || state === 'stale' ? <CircleAlert size={18} /> : <CircleCheck size={18} />}</span><div><strong>{notice.title}</strong><p>{notice.body}</p>{page?.lastError ? <small>{page.lastError}</small> : null}</div>{state === 'waiting' || state === 'stale' || state === 'error' ? <button type="button" className="quiet-button" onClick={load}>Refresh <RefreshCw size={14} /></button> : null}</section> : null}

    {status === 'ready' && (summary || page) ? <>
      <section className="recurring-summary-grid" aria-label="Recurring payment summary">
        <div className="panel recurring-summary-lead"><div className="section-heading"><div><p className="eyebrow">RUN-RATE VIEW</p><h2>Monthly run-rate</h2></div><TrendingUp size={18} className="section-icon" /></div><div className="recurring-summary-total"><strong>{formatMoney(Math.abs(currencyTotal(summary, 'monthlyByCurrency', primaryCurrency)), primaryCurrency, { signDisplay: 'never' })}</strong><span>{primaryCurrency} source estimate · {streamCount} stream{streamCount === 1 ? '' : 's'}</span></div><div className="recurring-summary-meta"><span><span className="live-dot" /> {lastGoodLabel}</span><span>{state === 'incomplete' ? 'History incomplete' : 'Provider history'}</span></div></div>
        <div className="panel recurring-summary-cells">{summaryCurrencies.flatMap((code) => [
          <SummaryCell key={`${code}-monthly`} currency={code} label="monthly" value={currencyTotal(summary, 'monthlyByCurrency', code)} />,
          <SummaryCell key={`${code}-actual`} currency={code} label="actual" value={currencyTotal(summary, 'actualCostByCurrency', code)} tone="actual" />,
        ])}</div>
      </section>

      <div className="recurring-toolbar"><div className="toolbar-title"><Filter size={17} /><strong>Filter the source map</strong><span>Classification changes stay local to this stream.</span></div><div className="recurring-filters"><label><span>Currency</span><select aria-label="Recurring currency" value={currency} onChange={(event) => setCurrency(event.target.value as Currency | 'all')}><option value="all">All currencies</option>{supportedCurrencyCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label><span>Classification</span><select aria-label="Recurring classification" value={classification} onChange={(event) => setClassification(event.target.value as RecurringClassification | 'all')}><option value="all">All classifications</option><option value="unclassified">Unclassified</option><option value="subscription">Subscription</option><option value="bill">Bill</option><option value="other">Other</option><option value="excluded">Excluded</option></select></label></div></div>

      {page?.coverageWarnings?.length ? <div className="recurring-warning-line" role="status"><CircleAlert size={14} /><span>{page.coverageWarnings.join(' · ')}</span></div> : null}
      <section className="panel recurring-stream-panel" aria-labelledby="recurring-streams-title"><div className="section-heading recurring-list-heading"><div><p className="eyebrow">SOURCE MAP</p><h2 id="recurring-streams-title">Recurring streams</h2></div><span>{page?.streams.length ?? 0} shown · {lastGoodLabel}</span></div>{page?.streams.length ? <div className="recurring-stream-list">{page.streams.map((stream) => <StreamRow key={stream.id} stream={stream} onOpen={setSelectedId} />)}</div> : <div className="recurring-empty-state"><Tag size={20} /><strong>{notice?.title ?? 'No recurring streams in this view'}</strong><span>{notice?.body ?? 'Adjust the filters or wait for the next successful source snapshot.'}</span></div>}{page?.nextCursor ? <div className="recurring-load-more"><button type="button" className="outline-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <RefreshCw size={15} className="is-spinning" /> : null}{loadingMore ? 'Loading streams…' : 'Load more streams'}</button>{loadMoreError ? <span role="alert">{loadMoreError}</span> : null}</div> : null}</section>

      <section className="recurring-lower-grid"><div className="panel recurring-upcoming-panel"><div className="section-heading"><div><p className="eyebrow">NEXT 30 DAYS</p><h2>Upcoming payments</h2></div><CalendarClock size={18} className="section-icon" /></div>{upcoming.length ? <div className="recurring-small-list">{upcoming.slice(0, 5).map((stream) => <div key={stream.id}><span className={`recurring-stream-mark ${stream.currency.toLowerCase()}`} /><span><strong>{stream.merchantName ?? 'Unnamed stream'}</strong><small>{stream.predictedNextDate ? formatDate(stream.predictedNextDate) : 'No date'} · {stream.currency}</small></span><b>{displayAmount(stream.nextExpectedAmountMinor, stream.currency)}</b></div>)}</div> : <p className="recurring-muted-copy">Nothing is expected in the next 30 days.</p>}</div><div className="panel recurring-changes-panel"><div className="section-heading"><div><p className="eyebrow">AMOUNT WATCH</p><h2>Latest payment changes</h2></div><TrendingUp size={18} className="section-icon" /></div>{changes.length ? <div className="recurring-small-list">{changes.slice(0, 5).map((stream) => <button type="button" key={stream.id} onClick={() => setSelectedId(stream.id)}><span className={`recurring-stream-mark ${stream.currency.toLowerCase()}`} /><span><strong>{stream.merchantName ?? 'Unnamed stream'}</strong><small>Two posted members differ</small></span><b>{displayAmount(stream.lastAmountMinor, stream.currency)}</b></button>)}</div> : <p className="recurring-muted-copy">No change signal yet. It takes two distinct posted members.</p>}</div></section>
      <p className="recurring-boundary-note"><ShieldCheck size={14} /> Source estimates never create ledger rows. Actual cost counts distinct confirmed expense, fee, and refund members only; transfers stay out.</p>
    </> : null}
    {selectedStream ? <RecurringDetails streamId={selectedStream.id} onClose={() => setSelectedId(null)} onSaved={load} /> : null}
  </>;
}

export default RecurringView;
