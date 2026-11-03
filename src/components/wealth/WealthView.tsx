import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, CircleAlert, Coins, Download, Landmark, RefreshCw, Scale, ShieldCheck, UploadCloud, WalletCards, X } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { CanonicalInstrument } from '../../domain/wealth-types';
import { WealthAccountHistory } from './WealthAccountHistory';
import { WealthCashFlowDetails } from './WealthCashFlowDetails';
import { WealthHistoryChart } from './WealthHistoryChart';
import { WealthAccountForm, WealthEventForm, WealthImportPanel, WealthQuoteSettings, WealthValuationForm, type WealthQuoteInstrumentOption, type WealthValuationInstrumentOption } from './WealthForms';
import { formatQuantity, formatWealthMoney, formatWealthPercent, isRecord, normalizeReport, normalizeSnapshot, type WealthCashFlowView, type WealthPayload, type WealthReportPayload } from './wealth-utils';

type WealthSubview = 'overview' | 'investments' | 'cashflow';
type LoadStatus = 'loading' | 'ready' | 'error';

function reportRange(): { from: string; to: string } {
  const now = new Date(); const to = now.toISOString().slice(0, 10); const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); return { from, to };
}

function reportPath(range: { from: string; to: string }): string { return `/api/wealth/report?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&asOf=${encodeURIComponent(range.to)}&reportingCurrency=CAD`; }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The wealth service could not be reached. Try again.'; }

function validReportRange(range: { from: string; to: string }): boolean {
  return Boolean(range.from && range.to && range.from <= range.to);
}

async function loadWealthData(api: LedgerApi, range: { from: string; to: string }): Promise<{ snapshot: WealthPayload; report: WealthReportPayload }> {
  const snapshotPath = `/api/wealth/snapshot?asOf=${encodeURIComponent(range.to)}&reportingCurrency=CAD`;
  const [snapshotValue, reportValue] = await Promise.all([api(snapshotPath), api(reportPath(range))]);
  const snapshot = normalizeSnapshot(snapshotValue);
  if (!snapshot) throw new Error('The wealth snapshot response was incomplete.');
  const report = normalizeReport(reportValue, snapshot);
  if (!report) throw new Error('The wealth report response was incomplete.');
  if (report.revision !== snapshot.revision) throw new Error('Wealth data changed while loading. Refresh and try again.');
  return { snapshot, report };
}

function useWealthData(api: LedgerApi, range: { from: string; to: string }) {
  const [status, setStatus] = useState<LoadStatus>('loading'); const [error, setError] = useState<string | null>(null); const [snapshot, setSnapshot] = useState<WealthPayload | null>(null); const [report, setReport] = useState<WealthReportPayload | null>(null); const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(async () => { setReloadKey((key) => key + 1); }, []);
  useEffect(() => { let cancelled = false; if (!validReportRange(range)) { setStatus('error'); setError('Choose a start date on or before the end date.'); return () => { cancelled = true; }; } setStatus('loading'); setError(null); void loadWealthData(api, range).then((next) => { if (cancelled) return; setSnapshot(next.snapshot); setReport(next.report); setStatus('ready'); }).catch((cause) => { if (cancelled) return; setSnapshot(null); setReport(null); setStatus('error'); setError(errorMessage(cause)); }); return () => { cancelled = true; }; }, [api, range.from, range.to, reloadKey]);
  return { status, error, snapshot, report, reload };
}

export function WealthView({ api, linkedAccounts = [] }: { api: LedgerApi; linkedAccounts?: readonly { id: string; name: string; currency?: string }[] }) {
  const [range, setRange] = useState(reportRange); const state = useWealthData(api, range); const [subview, setSubview] = useState<WealthSubview>('overview'); const [showCadEstimate, setShowCadEstimate] = useState(false); const [accountFormOpen, setAccountFormOpen] = useState(false); const [eventFormOpen, setEventFormOpen] = useState(false); const [valuationFormOpen, setValuationFormOpen] = useState(false); const [accountManagementOpen, setAccountManagementOpen] = useState(false); const [editingAccount, setEditingAccount] = useState<WealthPayload['accounts'][number] | null>(null); const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null); const [selectedInstrument, setSelectedInstrument] = useState<{ accountId: string; instrument: CanonicalInstrument } | null>(null); const [notice, setNotice] = useState<string | null>(null); const [showTools, setShowTools] = useState(false);
  const accounts = state.snapshot?.accounts ?? []; const openAccountForm = (account: WealthPayload['accounts'][number] | null = null) => { setEditingAccount(account); setAccountManagementOpen(true); setAccountFormOpen(true); }; const onSaved = async () => { setAccountFormOpen(false); setEditingAccount(null); setEventFormOpen(false); setValuationFormOpen(false); await state.reload(); };
  if ((state.status === 'loading' || state.status === 'error') && (!state.snapshot || !state.report)) return <WealthState status={state.status === 'loading' ? 'loading' : 'error'} message={state.error} onRetry={state.reload} />;
  if (!state.snapshot || !state.report) return <WealthState status="error" message={state.error} onRetry={state.reload} />;
  if (accounts.length === 0 && !accountFormOpen && !accountManagementOpen) return <WealthEmpty onAdd={() => openAccountForm()} onImport={() => setAccountManagementOpen(true)} />;
  const commonProps = { snapshot: state.snapshot, report: state.report, showCadEstimate, onSelectAccount: setSelectedAccountId };
  const exportWealth = async () => { try { const response = await api('/api/wealth/export?format=json'); const csv = isRecord(response) && typeof response.csv === 'string' ? response.csv : null; if (!csv) throw new Error('The canonical wealth export was not available.'); downloadText('border-ledger-wealth.csv', csv); setNotice('Canonical wealth CSV exported.'); } catch (cause) { setNotice(errorMessage(cause)); } };
  return <div className="wealth-page">
    <header className="wealth-page-intro"><div><h1>Wealth</h1><p>Keep assets, debts, and investments legible across currencies. Every value carries its source date.</p></div><div className="wealth-page-actions"><label className="wealth-date-field">From<input type="date" value={range.from} max={range.to} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} aria-label="Report start date" /></label><label className="wealth-date-field">To<input type="date" value={range.to} min={range.from} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} aria-label="Report end date" /></label><button type="button" className="outline-button" onClick={() => { void state.reload(); }}><RefreshCw size={15} /> Refresh</button></div></header>
    {state.status === 'loading' ? <div className="wealth-notice" role="status"><RefreshCw size={16} className="is-spinning" /><span>Refreshing the selected dated period…</span></div> : null}{state.status === 'error' ? <div className="wealth-coverage is-incomplete" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
    {notice ? <div className="wealth-notice" role="status"><ShieldCheck size={16} /><span>{notice}</span><button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss wealth notice"><X size={15} /></button></div> : null}
    <nav className="wealth-subnav" aria-label="Wealth sections">{([['overview', 'Overview'], ['investments', 'Investments'], ['cashflow', 'Cash flow']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={subview === id} className={subview === id ? 'is-active' : ''} onClick={() => { setSubview(id); setSelectedInstrument(null); }}>{label}</button>)}</nav>
    <div className="wealth-toolbar"><div><strong>{subview === 'overview' ? 'Net worth at a glance' : subview === 'investments' ? 'Investment ledger' : 'Cash movement'}</strong><span>As of {state.snapshot.asOf} · source currencies stay separate</span></div><div className="wealth-toolbar-actions"><button type="button" className="outline-button" onClick={() => { void exportWealth(); }}><Download size={15} /> Export</button><button type="button" className="outline-button" onClick={() => setAccountManagementOpen(true)}>Manage accounts</button><button type="button" className="primary-button" onClick={() => setShowTools((open) => !open)} aria-expanded={showTools} aria-controls="wealth-tools"><Coins size={15} /> Add data</button></div></div>
    {showTools ? <div id="wealth-tools" className="wealth-tools" role="region" aria-label="Add wealth data"><button type="button" onClick={() => { openAccountForm(); setShowTools(false); }}>Add account</button><button type="button" onClick={() => { setEventFormOpen(true); setShowTools(false); }}>Record event</button><button type="button" onClick={() => { setValuationFormOpen(true); setShowTools(false); }}>Add dated value</button><button type="button" onClick={() => { setAccountManagementOpen(true); setShowTools(false); }}>Manage accounts</button></div> : null}
    {accountFormOpen ? <WealthAccountForm key={editingAccount?.id ?? 'new'} api={api} revision={state.snapshot.revision} account={editingAccount ?? undefined} hasHoldingsData={editingAccount ? state.snapshot.positions.some((position) => position.accountId === editingAccount.id) || state.snapshot.cash.some((cash) => cash.accountId === editingAccount.id) : false} linkedAccounts={linkedAccounts} onSaved={onSaved} onCancel={() => { setAccountFormOpen(false); setEditingAccount(null); }} /> : null}{eventFormOpen ? <WealthEventForm api={api} revision={state.snapshot.revision} accounts={accounts} linkedAccounts={linkedAccounts} onSaved={onSaved} onCancel={() => setEventFormOpen(false)} /> : null}{valuationFormOpen ? <WealthValuationForm api={api} revision={state.snapshot.revision} accounts={accounts} positions={valuationInstruments(state.snapshot)} onSaved={onSaved} onCancel={() => setValuationFormOpen(false)} /> : null}
    {accountManagementOpen ? <section className="wealth-management-view" aria-labelledby="wealth-management-title"><div className="wealth-management-heading"><button type="button" className="quiet-button" onClick={() => { setAccountManagementOpen(false); setSubview('overview'); setSelectedInstrument(null); }}>← Back to Overview</button><div><h2 id="wealth-management-title">Manage wealth accounts</h2><p>Edit representation only when the next dated events are ready. Aggregate history is never copied into holdings.</p></div></div><WealthAccounts api={api} snapshot={state.snapshot} onSaved={onSaved} onNotice={setNotice} onAddAccount={() => openAccountForm()} onEditAccount={openAccountForm} onAddEvent={() => setEventFormOpen(true)} onAddValue={() => setValuationFormOpen(true)} selectedAccountId={selectedAccountId} setSelectedAccountId={setSelectedAccountId} /></section> : <>{subview === 'overview' ? <WealthOverview api={api} {...commonProps} selectedAccountId={selectedAccountId} showCadEstimate={showCadEstimate} setShowCadEstimate={setShowCadEstimate} /> : null}{subview === 'investments' ? <WealthInvestments api={api} {...commonProps} selectedAccountId={selectedAccountId} selectedInstrument={selectedInstrument} setSelectedInstrument={setSelectedInstrument} setSelectedAccountId={setSelectedAccountId} /> : null}{subview === 'cashflow' ? <WealthCashFlow api={api} linkedAccounts={linkedAccounts} report={state.report} snapshot={state.snapshot} /> : null}</>}
  </div>;
}

function WealthState({ status, message, onRetry }: { status: 'loading' | 'error'; message?: string | null; onRetry: () => Promise<void> }) {
  return <section className={`wealth-state ${status === 'error' ? 'is-error' : ''}`} role={status === 'error' ? 'alert' : 'status'} aria-live="polite"><div className="wealth-state-mark">{status === 'loading' ? <RefreshCw size={19} className="is-spinning" /> : <CircleAlert size={19} />}</div><h1>{status === 'loading' ? 'Reading your wealth ledger' : 'Wealth is not available yet'}</h1><p>{status === 'loading' ? 'Loading dated balances, holdings, and source coverage.' : message ?? 'The private wealth route returned an error.'}</p>{status === 'error' ? <button type="button" className="outline-button" onClick={() => { void onRetry(); }}>Try again <RefreshCw size={15} /></button> : null}</section>;
}

function WealthEmpty({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) { return <section className="wealth-state" role="status"><div className="wealth-state-mark"><Scale size={19} /></div><h1>Start your wealth ledger</h1><p>Add a manual asset, debt, linked bank balance, or brokerage account. Unknown history stays unavailable until you record a dated observation.</p><div className="wealth-state-actions"><button type="button" className="primary-button" onClick={onAdd}>Add your first account <ArrowUpRight size={15} /></button><button type="button" className="outline-button" onClick={onImport}>Import a portfolio CSV <UploadCloud size={15} /></button></div></section>; }

function CoverageNotice({ coverage }: { coverage: WealthPayload['coverage'] }) { if (coverage.status === 'complete') return null; return <div className={`wealth-coverage is-${coverage.status}`} role={coverage.status === 'unavailable' ? 'status' : 'alert'}><CircleAlert size={15} /><span><strong>{coverage.status === 'stale' ? 'Some prices are stale.' : coverage.status === 'incomplete' ? 'History is incomplete.' : 'Dated coverage is unavailable.'}</strong> {coverage.message}</span></div>; }

function addCurrencyAmount(target: Record<string, number>, currency: string, amount: number | null | undefined): void { if (amount === null || amount === undefined) return; target[currency] = (target[currency] ?? 0) + amount; }

function formatCurrencyLanes(values: Readonly<Record<string, number>>, incomplete = false, includeCodes = false): string {
  if (incomplete) return 'Unavailable';
  const entries = Object.entries(values).filter(([, amount]) => Number.isSafeInteger(amount));
  return entries.length ? entries.sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => includeCodes ? `${formatWealthMoney(amount, currency)} ${currency}` : formatWealthMoney(amount, currency)).join(' · ') : 'Unavailable';
}

function formatSourceTotal(snapshot: WealthPayload, currency: string): string { return snapshot.totalStatusByCurrency[currency] === 'incomplete' ? 'Unavailable' : formatWealthMoney(snapshot.totalByCurrency[currency], currency); }

function accountKindLabel(kind: WealthPayload['accounts'][number]['kind']): string {
  return { manual_asset: 'Manual asset', debt: 'Debt', brokerage: 'Brokerage', linked_bank: 'Linked bank' }[kind];
}

interface WealthBreakdown {
  values: Record<string, number>;
  incomplete: boolean;
  hasAccounts: boolean;
}

function accountAggregateAmount(account: WealthPayload['accounts'][number]): number | null {
  const value = account.valueState === 'missing' ? null : account.valueMinor ?? account.amountMinor ?? null;
  if (value === null) return null;
  return account.kind === 'debt' ? -Math.abs(value) : value;
}

function holdingsBreakdown(snapshot: WealthPayload, account: WealthPayload['accounts'][number]): WealthBreakdown {
  const values: Record<string, number> = {};
  let incomplete = false;
  const positions = snapshot.positions.filter((position) => position.accountId === account.id);
  const cash = snapshot.cash.filter((balance) => balance.accountId === account.id);
  for (const position of positions) {
    if (position.marketValueMinor === null) incomplete = true;
    else addCurrencyAmount(values, position.instrument.currency, position.marketValueMinor);
  }
  for (const balance of cash) addCurrencyAmount(values, balance.currency, balance.amountMinor);
  return { values, incomplete, hasAccounts: true };
}

function accountBreakdown(snapshot: WealthPayload, account: WealthPayload['accounts'][number]): WealthBreakdown {
  if (account.mode === 'aggregate') {
    const values: Record<string, number> = {};
    const amount = accountAggregateAmount(account);
    const incomplete = amount === null || !account.currency;
    if (!incomplete) addCurrencyAmount(values, account.currency, amount);
    return { values, incomplete, hasAccounts: true };
  }
  return holdingsBreakdown(snapshot, account);
}

function wealthBreakdown(snapshot: WealthPayload, includeDebt: boolean): WealthBreakdown {
  const values: Record<string, number> = {};
  let incomplete = false;
  const matchingAccounts = snapshot.accounts.filter((account) => (account.kind === 'debt') === includeDebt);
  for (const account of matchingAccounts) {
    const result = accountBreakdown(snapshot, account);
    incomplete ||= result.incomplete;
    Object.entries(result.values).forEach(([currency, amount]) => addCurrencyAmount(values, currency, amount));
  }
  return { values, incomplete, hasAccounts: matchingAccounts.length > 0 };
}

function breakdownMetric(breakdown: WealthBreakdown, emptyLabel: string): string {
  if (breakdown.incomplete) return 'Unavailable';
  return Object.keys(breakdown.values).length ? formatCurrencyLanes(breakdown.values) : breakdown.hasAccounts ? 'No dated values' : emptyLabel;
}

function fxProvenanceText(fx: WealthReportPayload['fx']): string | null {
  if (!fx.provider || !fx.effectiveDate || !fx.baseCurrency) return null;
  const provider = fx.provider === 'frankfurter' ? 'Frankfurter' : fx.provider;
  const quotes = Object.entries(fx.rates)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rate]) => `1 ${fx.baseCurrency} = ${rate} ${currency}`)
    .join(' · ');
  return [`Rate source: ${provider}`, `Effective ${fx.effectiveDate}`, quotes].filter(Boolean).join(' · ');
}

function fxEstimateStatus(fx: WealthReportPayload['fx'], showCadEstimate: boolean): string {
  if (!showCadEstimate) return fx.unavailable.length ? `CAD conversion unavailable for ${fx.unavailable.join(', ')}.` : 'Original currencies stay separate.';
  if (fx.complete && fx.convertedCadMinor !== null) {
    const provider = fx.provider === 'frankfurter' ? 'Frankfurter' : fx.provider;
    return fx.effectiveDate && provider ? `CAD conversion is dated ${fx.effectiveDate} by ${provider}.` : 'CAD conversion is complete for the server report.';
  }
  return fx.unavailable.length ? `CAD conversion unavailable for ${fx.unavailable.join(', ')}.` : 'CAD estimate unavailable · conversion coverage incomplete';
}

function WealthOverviewMetrics({ snapshot, assets, debts, currencies, firstCurrency, cadEstimate, showCadEstimate }: { snapshot: WealthPayload; assets: WealthBreakdown; debts: WealthBreakdown; currencies: readonly string[]; firstCurrency: string; cadEstimate: number | null; showCadEstimate: boolean }) {
  const sourceLaneCurrencies = showCadEstimate ? currencies : currencies.slice(1);
  const leadValue = showCadEstimate ? formatWealthMoney(cadEstimate, 'CAD') : formatSourceTotal(snapshot, firstCurrency);
  const leadNote = showCadEstimate ? (cadEstimate === null ? 'CAD estimate unavailable · conversion coverage incomplete' : 'CAD estimate · server conversion complete') : `${firstCurrency} total · ${snapshot.asOf}`;
  return <>
    <section className="wealth-metric-grid" aria-label="Net worth summary"><div className="wealth-lead-metric"><span>Net worth</span><strong>{leadValue}</strong><small>{leadNote}</small></div>{sourceLaneCurrencies.map((currency) => <div className="wealth-source-metric" key={currency}><span>{currency} total</span><strong>{formatSourceTotal(snapshot, currency)}</strong><small>{snapshot.totalStatusByCurrency[currency] === 'incomplete' ? 'Incomplete valuation · no complete total shown' : 'Original currency'}</small></div>)}</section>
    <section className="wealth-metric-grid wealth-overview-subtotals" aria-label="Assets and debts"><div className="wealth-source-metric"><span>Assets</span><strong>{breakdownMetric(assets, 'No assets recorded')}</strong><small>Assets by original currency</small></div><div className="wealth-source-metric"><span>Debts</span><strong>{breakdownMetric(debts, 'No debts recorded')}</strong><small>Liabilities by original currency</small></div></section>
  </>;
}

function WealthOverviewFxOptions({ fx, showCadEstimate, setShowCadEstimate }: { fx: WealthReportPayload['fx']; showCadEstimate: boolean; setShowCadEstimate: (value: boolean) => void }) {
  const provenance = fxProvenanceText(fx);
  return <div className="wealth-view-options"><label className="wealth-switch"><input type="checkbox" checked={showCadEstimate} onChange={(event) => setShowCadEstimate(event.target.checked)} /><span aria-hidden="true" />Show dated CAD estimate</label><div className="wealth-fx-context"><span>{fxEstimateStatus(fx, showCadEstimate)}</span>{provenance ? <span className="wealth-fx-provenance">{provenance}</span> : null}</div></div>;
}

function WealthOverview({ api, snapshot, report, showCadEstimate, setShowCadEstimate, selectedAccountId, onSelectAccount }: { api: LedgerApi; snapshot: WealthPayload; report: WealthReportPayload; showCadEstimate: boolean; setShowCadEstimate: (value: boolean) => void; selectedAccountId: string | null; onSelectAccount: (id: string | null) => void }) {
  const assets = wealthBreakdown(snapshot, false);
  const debts = wealthBreakdown(snapshot, true);
  const currencies = [...new Set([...Object.keys(snapshot.totalByCurrency), ...Object.keys(assets.values), ...Object.keys(debts.values)])].sort((left, right) => left === 'CAD' ? -1 : right === 'CAD' ? 1 : left.localeCompare(right));
  const firstCurrency = currencies[0] ?? 'CAD';
  const cadEstimate = report.fx.complete ? report.fx.convertedCadMinor : null;
  return <>
    <CoverageNotice coverage={report.coverage} />
    <WealthOverviewMetrics snapshot={snapshot} assets={assets} debts={debts} currencies={currencies} firstCurrency={firstCurrency} cadEstimate={cadEstimate} showCadEstimate={showCadEstimate} />
    <WealthOverviewFxOptions fx={report.fx} showCadEstimate={showCadEstimate} setShowCadEstimate={setShowCadEstimate} />
    <section className="wealth-overview-grid"><div className="wealth-panel wealth-history-panel"><div className="wealth-section-heading"><div><h2>Net worth history</h2><p>Only observations that exist in the ledger are plotted.</p></div><BarChart3 size={18} aria-hidden="true" /></div><WealthHistoryChart history={report.history} showCadEstimate={showCadEstimate} preferredCurrency={firstCurrency} /></div><WealthAccountBreakdown snapshot={snapshot} onSelectAccount={onSelectAccount} /></section>
    {selectedAccountId ? <WealthAccountHistory api={api} snapshot={snapshot} accountId={selectedAccountId} onClose={() => onSelectAccount(null)} /> : null}
  </>;
}

function accountHasExplicitZeroHoldings(account: WealthPayload['accounts'][number], positions: WealthPayload['positions'], cash: WealthPayload['cash']): boolean {
  if (account.mode !== 'holdings') return false;
  if (account.amountMinor !== 0) return false;
  if (!account.currency) return false;
  return positions.length === 0 && cash.length === 0;
}

function WealthAccountBreakdown({ snapshot, onSelectAccount }: { snapshot: WealthPayload; onSelectAccount?: (id: string) => void }) { return <section className="wealth-panel wealth-account-breakdown" aria-labelledby="wealth-account-breakdown-title"><div className="wealth-section-heading"><div><h2 id="wealth-account-breakdown-title">Account breakdown</h2><p>Aggregate accounts are counted once; holdings accounts show cash and positions separately.</p></div><Landmark size={18} aria-hidden="true" /></div><div className="wealth-account-list">{snapshot.accounts.map((account) => { const accountPositions = snapshot.positions.filter((position) => position.accountId === account.id); const accountCash = snapshot.cash.filter((cash) => cash.accountId === account.id); const lanes: Record<string, number> = {}; accountPositions.forEach((position) => addCurrencyAmount(lanes, position.instrument.currency, position.marketValueMinor)); accountCash.forEach((cash) => addCurrencyAmount(lanes, cash.currency, cash.amountMinor)); const incomplete = account.mode === 'holdings' && accountPositions.some((position) => position.marketValueMinor === null); const explicitZero = accountHasExplicitZeroHoldings(account, accountPositions, accountCash); const aggregateValue = account.valueState === 'missing' ? null : account.valueMinor ?? account.amountMinor ?? null; const aggregateUnavailable = account.mode === 'aggregate' && (!account.currency || aggregateValue === null); const value = account.mode === 'aggregate' ? aggregateUnavailable ? 'Unavailable' : formatWealthMoney(aggregateValue, account.currency!) : explicitZero ? formatWealthMoney(0, account.currency!) : formatCurrencyLanes(lanes, incomplete); const state = account.mode === 'aggregate' ? aggregateUnavailable ? 'Missing dated value or currency' : account.valueState === 'stale' ? 'Stale dated value' : account.valueObservedAt ? `Observed ${account.valueObservedAt}` : 'Aggregate value' : explicitZero ? 'Observed zero balance' : incomplete ? 'Incomplete valuation' : Object.keys(lanes).length ? 'Original currency values' : 'No holdings'; return <button type="button" className="wealth-account-row" key={account.id} onClick={() => onSelectAccount?.(account.id)}><span className="wealth-account-row-main"><strong>{account.name}</strong><small>{accountKindLabel(account.kind)} · {account.mode === 'aggregate' ? 'Aggregate value' : 'Holdings + cash'}</small></span><span className="wealth-account-row-value">{value}<small>{state} · {accountPositions.length ? `${accountPositions.length} holding${accountPositions.length === 1 ? '' : 's'}` : 'No holdings'}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>; })}</div></section>; }

interface InvestmentSummary {
  positions: WealthPayload['positions'];
  allocations: WealthPayload['allocations'];
  holdingsByCurrency: Record<string, number>;
  cashByCurrency: Record<string, number>;
  gainsByCurrency: Record<string, number>;
  unknownValue: boolean;
  unknownGain: boolean;
}

function moneyByCurrency<T>(items: readonly T[], currencyOf: (item: T) => string, amountOf: (item: T) => number | null): { values: Record<string, number>; incomplete: boolean } {
  const values: Record<string, number> = {};
  let incomplete = false;
  for (const item of items) {
    const amount = amountOf(item);
    if (amount === null) incomplete = true;
    else addCurrencyAmount(values, currencyOf(item), amount);
  }
  return { values, incomplete };
}

function cashByCurrency(items: readonly WealthPayload['cash'][number][]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const item of items) addCurrencyAmount(values, item.currency, item.amountMinor);
  return values;
}

function investmentSummary(snapshot: WealthPayload, allocations: WealthPayload['allocations'], selectedAccountId: string | null): InvestmentSummary {
  const positions = selectedAccountId ? snapshot.positions.filter((position) => position.accountId === selectedAccountId) : snapshot.positions;
  const cash = selectedAccountId ? snapshot.cash.filter((item) => item.accountId === selectedAccountId) : snapshot.cash;
  const selectedAllocations = selectedAccountId ? allocations.filter((row) => row.accountId === selectedAccountId) : allocations;
  const holdings = moneyByCurrency(positions, (position) => position.instrument.currency, (position) => position.marketValueMinor);
  const realized = moneyByCurrency(positions, (position) => position.instrument.currency, (position) => position.realizedGainMinor);
  const unrealized = moneyByCurrency(positions, (position) => position.instrument.currency, (position) => position.unrealizedGainMinor);
  const gainsByCurrency = { ...realized.values };
  Object.entries(unrealized.values).forEach(([currency, amount]) => { gainsByCurrency[currency] = (gainsByCurrency[currency] ?? 0) + amount; });
  return { positions, allocations: selectedAllocations, holdingsByCurrency: holdings.values, cashByCurrency: cashByCurrency(cash), gainsByCurrency, unknownValue: holdings.incomplete, unknownGain: realized.incomplete || unrealized.incomplete };
}

function WealthInvestmentMetrics({ summary }: { summary: InvestmentSummary }) {
  return <section className="wealth-metric-grid wealth-investment-metrics"><div className="wealth-lead-metric"><span>Holdings value</span><strong>{formatCurrencyLanes(summary.holdingsByCurrency, summary.unknownValue)}</strong><small>{summary.positions.length} positions · each original currency stays separate</small></div><div className="wealth-source-metric"><span>Cash balances</span><strong>{formatCurrencyLanes(summary.cashByCurrency)}</strong><small>Stored cash values · no cross-currency sum</small></div><div className="wealth-source-metric"><span>Gains</span><strong>{formatCurrencyLanes(summary.gainsByCurrency, summary.unknownGain)}</strong><small>Realized and unrealized stay in their original currencies</small></div></section>;
}

function WealthHoldingsPanel({ snapshot, summary, onSelectHolding }: { snapshot: WealthPayload; summary: InvestmentSummary; onSelectHolding: (position: WealthPayload['positions'][number]) => void }) {
  return <div className="wealth-panel"><div className="wealth-section-heading"><div><h2>Holdings</h2><p>Long-only positions with weighted basis. Unknown basis never becomes zero.</p></div><WalletCards size={18} aria-hidden="true" /></div><div className="wealth-holdings-list">{summary.positions.length ? summary.positions.map((position) => <HoldingRow key={`${position.accountId}-${position.instrument.exchange}-${position.instrument.ticker}`} position={position} accountName={snapshot.accounts.find((account) => account.id === position.accountId)?.name ?? 'Unknown account'} onClick={() => onSelectHolding(position)} />) : <p className="wealth-empty-copy">No holdings in this representation yet.</p>}</div></div>;
}

function allocationShare(row: WealthPayload['allocations'][number]): string {
  return row.available && row.share !== null ? `${(row.share * 100).toFixed(2)}% ${row.currency}` : 'Unavailable';
}

function allocationName(row: WealthPayload['allocations'][number]): string {
  if (row.kind === 'aggregate') return 'Account total';
  return row.instrument ? row.instrument.ticker : 'Cash';
}

function allocationKindLabel(row: WealthPayload['allocations'][number]): string {
  if (row.kind === 'aggregate') return 'Account total';
  return row.kind === 'holding' ? `${row.instrument?.exchange ?? 'Unknown exchange'} · ${row.instrument?.type.toUpperCase() ?? 'Holding'}` : 'Cash';
}

function WealthAllocationPanel({ allocations, accounts, hasInvestmentData }: { allocations: WealthPayload['allocations']; accounts: WealthPayload['accounts']; hasInvestmentData: boolean }) {
  const rows = allocations.length ? allocations : [];
  return <div className="wealth-allocation"><h3>Allocation by original currency</h3>{rows.length ? <div role="table" aria-label="Allocation by original currency">{rows.map((row) => <div className="wealth-allocation-row" role="row" key={`${row.accountId}-${row.kind}-${row.currency}-${row.instrument ? `${row.instrument.exchange}-${row.instrument.ticker}` : 'account'}`}><span role="cell">{allocationName(row)}<small>{accounts.find((account) => account.id === row.accountId)?.name ?? 'Unknown account'} · {allocationKindLabel(row)} · {row.currency}</small></span><strong role="cell">{allocationShare(row)}<small>{row.available ? formatWealthMoney(row.valueMinor, row.currency) : 'Coverage incomplete'}</small></strong></div>)}</div> : <p className="wealth-empty-copy">{hasInvestmentData ? 'Allocation is unavailable until the server provides complete coverage.' : 'Add a holding to see allocation.'}</p>}</div>;
}

function WealthPerformancePanel({ report, summary, accounts }: { report: WealthReportPayload; summary: InvestmentSummary; accounts: WealthPayload['accounts'] }) {
  const rows = performanceRows(report);
  return <div className="wealth-panel wealth-performance-panel"><div className="wealth-section-heading"><div><h2>Performance</h2><p>Modified Dietz requires complete dated start/end values and external flows.</p></div><Scale size={18} aria-hidden="true" /></div>{rows.map(({ label, result }) => <div className="wealth-performance-result" key={label}><span>{label}</span><strong>{result.available ? formatWealthPercent(result.value) : 'Unavailable'}</strong><small>{result.available ? 'Complete period inputs' : result.reason ? `Missing ${result.reason.replaceAll('_', ' ')}` : 'Add dated valuations and external flows'}</small></div>)}<WealthAllocationPanel allocations={summary.allocations} accounts={accounts} hasInvestmentData={summary.positions.length > 0 || Object.keys(summary.cashByCurrency).length > 0} /></div>;
}

function WealthInvestments({ api, snapshot, report, selectedAccountId, selectedInstrument, setSelectedInstrument, setSelectedAccountId }: { api: LedgerApi; snapshot: WealthPayload; report: WealthReportPayload; selectedAccountId: string | null; selectedInstrument: { accountId: string; instrument: CanonicalInstrument } | null; setSelectedInstrument: (value: { accountId: string; instrument: CanonicalInstrument } | null) => void; setSelectedAccountId: (id: string | null) => void }) {
  const summary = investmentSummary(snapshot, report.allocations, selectedAccountId);
  const openHolding = (position: WealthPayload['positions'][number]) => { setSelectedAccountId(position.accountId); setSelectedInstrument({ accountId: position.accountId, instrument: position.instrument }); };
  return <><CoverageNotice coverage={report.coverage} /><WealthInvestmentMetrics summary={summary} /><section className="wealth-investment-grid"><WealthHoldingsPanel snapshot={snapshot} summary={summary} onSelectHolding={openHolding} /><WealthPerformancePanel report={report} summary={summary} accounts={snapshot.accounts} /></section>{selectedAccountId ? <WealthAccountHistory api={api} snapshot={snapshot} accountId={selectedAccountId} instrument={selectedInstrument?.accountId === selectedAccountId ? selectedInstrument.instrument : undefined} onClose={() => { setSelectedAccountId(null); setSelectedInstrument(null); }} /> : null}</>;
}

function performanceRows(report: WealthReportPayload): Array<{ label: string; result: WealthReportPayload['modifiedDietz'] }> {
  const byCurrency = Object.entries(report.modifiedDietzByCurrency);
  return byCurrency.length ? byCurrency.map(([currency, result]) => ({ label: `Modified Dietz · ${currency}`, result })) : [{ label: 'Modified Dietz', result: report.modifiedDietz }];
}

function HoldingRow({ position, accountName, onClick }: { position: WealthPayload['positions'][number]; accountName: string; onClick: () => void }) { const name = `${position.instrument.exchange}:${position.instrument.ticker}`; return <button type="button" className="wealth-holding-row" onClick={onClick}><span><strong>{name}</strong><small>{accountName} · {position.instrument.type.toUpperCase()} · {formatQuantity(position.quantity)} shares · {position.instrument.currency}</small></span><span><strong>{formatWealthMoney(position.marketValueMinor, position.instrument.currency)}</strong><small>Basis {position.basisKnown ? formatWealthMoney(position.costBasisMinor, position.instrument.currency) : 'Unknown'} · Gain {formatWealthMoney(position.unrealizedGainMinor, position.instrument.currency)}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>; }

function isInvestmentIncomeExpense(row: WealthCashFlowView): boolean {
  return row.eventKind === 'dividend' || row.eventKind === 'withholding' || row.eventKind === 'fee';
}

function flowIdentity(row: WealthCashFlowView): string {
  if (row.linkedWealthSourceId) return `wealth:${row.linkedWealthSourceId}`;
  if (row.transactionId) return `transaction:${row.transactionId}`;
  return `source:${row.sourceId}`;
}

function mergeFlowDetails(existing: WealthCashFlowView, investment: WealthCashFlowView): WealthCashFlowView {
  return { ...existing, ...investment, accountName: investment.accountName ?? existing.accountName, merchant: investment.merchant ?? existing.merchant, category: investment.category ?? existing.category, source: investment.source ?? existing.source, status: investment.status ?? existing.status, transactionId: investment.transactionId ?? existing.transactionId };
}

function displayedCashFlowRows(report: WealthReportPayload): WealthCashFlowView[] {
  const householdRows = report.householdCashFlows.length ? report.householdCashFlows : report.cashFlows;
  const rows = new Map<string, WealthCashFlowView>(householdRows.map((row) => [flowIdentity(row), row]));
  report.investmentCashFlows.filter(isInvestmentIncomeExpense).forEach((row) => {
    const key = flowIdentity(row);
    const existing = rows.get(key);
    rows.set(key, existing ? mergeFlowDetails(existing, row) : row);
  });
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date) || left.sourceId.localeCompare(right.sourceId));
}

function cashFlowTotals(rows: readonly WealthCashFlowView[], matches: (row: WealthCashFlowView) => boolean): Record<string, number> {
  const totals: Record<string, number> = {};
  rows.filter(matches).forEach((row) => addCurrencyAmount(totals, row.money.currency, row.money.amountMinor));
  return totals;
}

function isHouseholdFlow(row: WealthCashFlowView): boolean {
  return row.classification !== 'internal_transfer' && row.kind !== 'internal_transfer';
}

function investmentFlowCategory(row: WealthCashFlowView): 'income' | 'expense' | null {
  if (row.eventKind === 'dividend') return 'income';
  if (row.eventKind === 'withholding' || row.eventKind === 'fee') return 'expense';
  return null;
}

function isHouseholdIncome(row: WealthCashFlowView): boolean {
  return isHouseholdFlow(row) && (row.bankKind === 'income' || row.bankKind === 'refund' || investmentFlowCategory(row) === 'income');
}

function isHouseholdExpense(row: WealthCashFlowView): boolean {
  return isHouseholdFlow(row) && (row.bankKind === 'expense' || row.bankKind === 'fee' || investmentFlowCategory(row) === 'expense');
}

function isInvestmentTransfer(row: WealthCashFlowView): boolean {
  return isHouseholdFlow(row) && (row.eventKind === 'contribution' || row.eventKind === 'withdrawal' || row.classification === 'external_contribution' || row.classification === 'external_withdrawal');
}

function investmentTransferRows(report: WealthReportPayload, householdRows: readonly WealthCashFlowView[]): WealthCashFlowView[] {
  const lane = report.investmentCashFlows.filter(isInvestmentTransfer);
  return lane.length ? lane : householdRows.filter(isInvestmentTransfer);
}

function cashFlowLabel(row: WealthCashFlowView): string {
  if (row.category?.trim()) return row.category.trim();
  if (row.merchant?.trim()) return row.merchant.trim();
  if (row.eventKind) return { dividend: 'Dividend', withholding: 'Withholding', fee: 'Investment fee', contribution: 'Contribution', withdrawal: 'Withdrawal' }[row.eventKind];
  return row.bankKind || row.classification.replaceAll('_', ' ');
}

function cashFlowDirection(row: WealthCashFlowView): 'inflow' | 'outflow' | null {
  if (row.direction === 'inflow' || row.direction === 'outflow') return row.direction;
  if (['dividend', 'contribution'].includes(row.eventKind ?? '') || ['income', 'refund'].includes(row.bankKind ?? '')) return 'inflow';
  if (['withholding', 'fee', 'withdrawal'].includes(row.eventKind ?? '') || ['expense', 'fee'].includes(row.bankKind ?? '')) return 'outflow';
  return null;
}

function cashFlowTypeLabel(row: WealthCashFlowView): string {
  const eventLabel = row.eventKind ? { dividend: 'Income', withholding: 'Withholding', fee: 'Fee', contribution: 'Contribution', withdrawal: 'Withdrawal' }[row.eventKind] : null;
  if (eventLabel) return eventLabel;
  const bankLabel = row.bankKind ? { income: 'Income', refund: 'Refund', expense: 'Expense', fee: 'Fee' }[row.bankKind] : null;
  if (bankLabel) return bankLabel;
  if (row.kind === 'internal_transfer' || row.classification === 'internal_transfer') return 'Internal transfer';
  const direction = cashFlowDirection(row);
  return direction === 'inflow' ? 'Inflow' : direction === 'outflow' ? 'Outflow' : 'Unclassified';
}

function cashFlowAmountLabel(row: WealthCashFlowView): string {
  const amount = formatWealthMoney(Math.abs(row.money.amountMinor), row.money.currency);
  const direction = cashFlowDirection(row);
  const sign = direction === 'inflow' ? '+' : direction === 'outflow' ? '−' : '';
  return `${sign}${amount} ${row.money.currency}`;
}

function cashFlowAccountLabel(row: WealthCashFlowView, snapshot: WealthPayload, linkedAccounts: readonly { id: string; name: string }[]): string {
  return row.accountName?.trim() || snapshot.accounts.find((account) => account.id === row.accountId)?.name || linkedAccounts.find((account) => account.id === row.accountId)?.name || 'Unknown account';
}

function netCashFlowTotals(income: Readonly<Record<string, number>>, expenses: Readonly<Record<string, number>>): Record<string, number> {
  const currencies = new Set([...Object.keys(income), ...Object.keys(expenses)]);
  return Object.fromEntries([...currencies].map((currency) => [currency, (income[currency] ?? 0) - (expenses[currency] ?? 0)]));
}

function flowMetric(values: Readonly<Record<string, number>>, emptyLabel: string): string {
  return Object.keys(values).length ? formatCurrencyLanes(values, false, true) : emptyLabel;
}

function WealthCashFlow({ api, linkedAccounts, report, snapshot }: { api: LedgerApi; linkedAccounts: readonly { id: string; name: string }[]; report: WealthReportPayload; snapshot: WealthPayload }) {
  const rows = displayedCashFlowRows(report);
  const transferRows = investmentTransferRows(report, rows);
  const income = cashFlowTotals(rows, isHouseholdIncome);
  const expenses = cashFlowTotals(rows, isHouseholdExpense);
  const contributions = cashFlowTotals(transferRows, (row) => row.eventKind === 'contribution' || row.classification === 'external_contribution');
  const withdrawals = cashFlowTotals(transferRows, (row) => row.eventKind === 'withdrawal' || row.classification === 'external_withdrawal');
  const net = netCashFlowTotals(income, expenses);
  return <><CoverageNotice coverage={report.coverage} /><section className="wealth-metric-grid wealth-cashflow-metrics"><div className="wealth-lead-metric"><span>Money in</span><strong>{flowMetric(income, 'No household income')}</strong><small>Confirmed income and refunds · original currencies</small></div><div className="wealth-source-metric"><span>Money out</span><strong>{flowMetric(expenses, 'No household expenses')}</strong><small>Confirmed expenses and fees · original currencies</small></div><div className="wealth-source-metric"><span>Net cash flow</span><strong>{flowMetric(net, 'No household movement')}</strong><small>Money in minus money out · each currency separate</small></div><div className="wealth-source-metric"><span>External investment flows</span><strong>{Object.keys(contributions).length || Object.keys(withdrawals).length ? `${flowMetric(contributions, '—')} in · ${flowMetric(withdrawals, '—')} out` : 'No external investment flows this period'}</strong><small>Explicit wealth links only</small></div></section><section className="wealth-panel wealth-cashflow-panel"><div className="wealth-section-heading"><div><h2>Household cash flow</h2><p>Bank categories explain household movement; only explicit wealth links affect investment performance.</p></div><CalendarDays size={18} aria-hidden="true" /></div>{rows.length ? <div className="wealth-table-wrap"><table><caption>Household cash flows from {snapshot.asOf} report</caption><thead><tr><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Wealth link</th><th scope="col">Record</th></tr></thead><tbody>{rows.map((row) => <tr key={row.sourceId}><th scope="row">{row.date}</th><td>{cashFlowAccountLabel(row, snapshot, linkedAccounts)}</td><td><span className={`wealth-status-mark is-${row.classification}`}>{cashFlowLabel(row)}</span>{row.linkConflict ? <small>Link needs review</small> : null}</td><td>{cashFlowTypeLabel(row)}</td><td>{cashFlowAmountLabel(row)}</td><td>{row.includedInPerformance ? 'Included in performance' : 'Household only'}</td><td><WealthCashFlowDetails api={api} row={row} /></td></tr>)}</tbody></table></div> : <div className="wealth-empty-copy"><strong>No household cash flows in this period.</strong><span>Confirmed income, expenses, refunds, and fees will appear here.</span></div>}</section></>;
}

function uniqueInstruments(snapshot: WealthPayload): WealthQuoteInstrumentOption[] {
  const instruments = new Map<string, WealthQuoteInstrumentOption>();
  for (const position of snapshot.positions) {
    const account = snapshot.accounts.find((item) => item.id === position.accountId);
    const key = `${position.accountId}:${position.instrument.exchange}:${position.instrument.ticker}:${position.instrument.type}:${position.instrument.currency}`;
    instruments.set(key, { accountId: position.accountId, accountName: account?.name ?? 'Unknown account', instrument: position.instrument });
  }
  return [...instruments.values()];
}

function valuationInstruments(snapshot: WealthPayload): WealthValuationInstrumentOption[] {
  const instruments = new Map<string, WealthValuationInstrumentOption>();
  for (const position of snapshot.positions) {
    const account = snapshot.accounts.find((item) => item.id === position.accountId);
    const option: WealthValuationInstrumentOption = { accountId: position.accountId, accountName: account?.name ?? 'Unknown account', exchange: position.instrument.exchange, ticker: position.instrument.ticker, type: position.instrument.type, currency: position.instrument.currency };
    instruments.set(`${option.accountId}:${option.exchange}:${option.ticker}:${option.type}:${option.currency}`, option);
  }
  return [...instruments.values()];
}

function WealthAccounts({ api, snapshot, onSaved, onNotice, onAddAccount, onEditAccount, onAddEvent, onAddValue, selectedAccountId, setSelectedAccountId }: { api: LedgerApi; snapshot: WealthPayload; onSaved: () => Promise<void>; onNotice: (message: string) => void; onAddAccount: () => void; onEditAccount: (account: WealthPayload['accounts'][number]) => void; onAddEvent: () => void; onAddValue: () => void; selectedAccountId: string | null; setSelectedAccountId: (id: string | null) => void }) { return <><section className="wealth-panel wealth-source-panel"><div className="wealth-section-heading"><div><h2>Wealth accounts</h2><p>Aggregate accounts use one dated value. Holdings accounts use cash and events; switching modes opens a guided opening setup.</p></div><div className="wealth-form-actions"><button type="button" className="outline-button" onClick={onAddAccount}>Add account</button><button type="button" className="quiet-button" onClick={onAddEvent}>Record event</button><button type="button" className="quiet-button" onClick={onAddValue}>Add dated value</button></div></div><div className="wealth-account-list">{snapshot.accounts.map((account) => <div className="wealth-account-management-row" key={account.id}><button type="button" className={`wealth-account-row ${selectedAccountId === account.id ? 'is-selected' : ''}`} onClick={() => setSelectedAccountId(account.id)}><span className="wealth-account-row-main"><strong>{account.name}</strong><small>{accountKindLabel(account.kind)} · {account.mode === 'aggregate' ? 'Aggregate value' : 'Holdings + cash'} · {account.currency ?? 'mixed currency'}</small></span><span className="wealth-account-row-value"><small>{account.active === false ? 'Inactive' : 'Active'}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button><button type="button" className="quiet-button wealth-account-edit" onClick={() => onEditAccount(account)}>Edit account</button></div>)}</div></section><WealthImportPanel api={api} accounts={snapshot.accounts} revision={snapshot.revision} onSaved={onSaved} onNotice={onNotice} /><WealthQuoteSettings api={api} instruments={uniqueInstruments(snapshot)} onNotice={onNotice} onRefresh={onSaved} /><p className="wealth-boundary-note"><ShieldCheck size={14} /> Wealth values never fund Budget automatically and investment data is never sent to AI requests.</p></>; }

function downloadText(filename: string, content: string) { if (typeof URL.createObjectURL !== 'function') return; const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
