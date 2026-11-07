import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ReducedMotionContext } from '../auth/presentationPolicy';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { WealthBankAccount, WealthBankTransaction, WealthCashFlowRow, WealthCsvMapping, WealthEventRow, WealthInvestmentDetail, WealthView, WealthWireSnapshot } from './contracts';
import { parseMoneyMinor } from '../../../../src/domain/currencies';
import type { CanonicalInstrument } from '../../../../src/domain/wealth-types';
import { createSecureIdentifier } from './identity';

const light = { canvas: '#F3EFE6', ink: '#18201F', muted: '#68706D', rule: '#D2CCC0', signal: '#1B6B5B', danger: '#A83F3F', panel: '#F8F5EE' };
const darkTheme = { canvas: '#101715', ink: '#EEF1E8', muted: '#B1BDB5', rule: '#43534B', signal: '#83C9B1', danger: '#FFB4AB', panel: '#17221D' };
const theme = (dark: boolean) => dark ? darkTheme : light;

const money = (value: number | null | undefined, currency: string) => value === null || value === undefined || !Number.isFinite(value) ? 'Unavailable' : `${currency} ${(value / 100).toFixed(2)}`;
const parseMinor = (value: string, currency: string): number | null => {
  const input = value.trim();
  if (!input) return null;
  try { return parseMoneyMinor(input, currency); } catch { return null; }
};
const parseInteger = (value: string): number | null => {
  const input = value.trim();
  if (!input || !/^-?\d+$/.test(input)) return null;
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const todayIsoDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseQuantity = (value: string): string | null => {
  const input = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input) || !/[1-9]/.test(input)) return null;
  return input;
};
const titleForAction: Record<string, string> = {
  account: 'Save account', instrument: 'Save instrument', valuation: 'Save dated value', event: 'Save event', correction: 'Save correction', reversal: 'Reverse event',
  'quote-save': 'Save quote key', 'quote-remove': 'Remove quote key', 'quote-refresh': 'Refresh dated prices', 'csv-preview': 'Preview CSV', 'csv-commit': 'Commit CSV', 'csv-export': 'Export CSV',
};
const operationActions = Object.keys(titleForAction);
const eventKinds = ['opening_cash', 'opening_position', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split', 'transfer'];
const instrumentEventKinds = new Set(['opening_position', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'split']);
const bankLinkEventKinds = new Set(['dividend', 'withholding', 'fee', 'contribution', 'withdrawal']);
export const newDraftId = (): string => createSecureIdentifier();

function bankTransactionLabel(transaction: WealthBankTransaction): string {
  const date = transaction.occurredAt.slice(0, 10);
  const merchant = transaction.merchant?.trim() || transaction.category?.trim() || 'Bank record';
  const account = transaction.accountLabel?.trim() || 'Account unavailable';
  const amount = Number(transaction.signedMinorUnits);
  return `${date} · ${merchant} · ${account} · ${money(Number.isFinite(amount) ? amount : null, transaction.currency)}`;
}

export function Copy({ dark, children, heading, muted, error, accessibilityLiveRegion }: { dark: boolean; children: React.ReactNode; heading?: boolean; muted?: boolean; error?: boolean; accessibilityLiveRegion?: 'none' | 'polite' | 'assertive' }) {
  const colors = theme(dark);
  return <Text accessibilityRole={heading ? 'header' : undefined} accessibilityLiveRegion={accessibilityLiveRegion} style={[heading ? styles.heading : styles.copy, { color: error ? colors.danger : muted ? colors.muted : colors.ink }]}>{children}</Text>;
}

export function Action({ dark, label, onPress, disabled, selected }: { dark: boolean; label: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  const colors = theme(dark);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { borderColor: colors.rule, backgroundColor: selected ? (dark ? '#244C3D' : '#DEE7DE') : colors.panel, opacity: disabled ? 0.5 : pressed ? 0.68 : 1 }]}><Text style={[styles.actionText, { color: selected ? colors.signal : colors.ink }]}>{label}</Text></Pressable>;
}

function Field({ dark, label, value, onChange, placeholder, multiline = false, secure = false }: { dark: boolean; label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; secure?: boolean }) {
  const colors = theme(dark);
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} placeholder={placeholder} placeholderTextColor={colors.muted} onChangeText={onChange} secureTextEntry={secure} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[styles.input, { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.panel }, multiline && styles.multiline]} /></View>;
}

function Status({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  const missingLabel = (item: string) => {
    const parts = item.split(':');
    if (parts[0] === 'account') return `Account ${data.accounts.find(account => account.id === parts[1])?.name ?? 'unavailable'}`;
    if (parts[0] === 'position') return 'Holding value';
    if (parts[0] === 'valuation') return 'Dated valuation';
    return item;
  };
  return <View style={[styles.status, { borderColor: colors.rule, backgroundColor: colors.panel }]} accessibilityRole="summary">
    <Copy dark={dark} muted>{data.asOf ? `As of ${data.asOf}` : 'As of unavailable'}</Copy>
    {data.stale ? <Copy dark={dark} error>Showing the last confirmed Wealth report. Refresh to check again.</Copy> : null}
    {data.missingData?.length ? <Copy dark={dark} error>Some balances or prices are missing. Add dated values to complete this view.</Copy> : null}
    {data.missingData?.map(item => <Copy key={item} dark={dark} error>Unavailable: {missingLabel(item)}. Add a dated value to complete this view.</Copy>)}
  </View>;
}

function HistoryTable({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  if (data.history.length === 0) return <Copy dark={dark} muted>No dated net worth observations yet. Add a dated balance or price to begin the history.</Copy>;
  return <View accessibilityRole="list" accessibilityLabel="Net worth history list" style={[styles.table, { borderColor: colors.rule }]}>{data.history.map(row => {
    const values = Object.entries(row.totals).map(([currency, amount]) => money(amount, currency)).join(' · ');
    const coverage = row.complete ? 'Complete observation' : 'Known subtotal';
    const accessibleValues = values || 'Unavailable';
    return <View accessible accessibilityLabel={`${row.date} · ${coverage} · ${accessibleValues}`} key={row.date} style={[styles.tableRow, { borderBottomColor: colors.rule }]}><Text style={[styles.tableKey, { color: colors.ink }]}>{row.date}</Text><Text style={[styles.tableValue, { color: colors.ink }]}>{accessibleValues}</Text><Text style={[styles.tableValue, { color: row.complete ? colors.muted : colors.danger, fontSize: 13, lineHeight: 18 }]}>{coverage}</Text></View>;
  })}</View>;
}

function historyCoverageSummary(rows: ReadonlyArray<{ complete: boolean }>): string {
  const incompleteCount = rows.filter(row => !row.complete).length;
  if (incompleteCount === 0) return 'Complete observations';
  const pointLabel = rows.length === 1 ? 'point' : 'points';
  return `Known subtotal for ${incompleteCount} of ${rows.length} dated ${pointLabel}; some dated observations are missing`;
}

function HistoryChart({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  const currencies = [...new Set(data.history.flatMap(row => Object.keys(row.totals)))].sort();
  if (!currencies.length) return null;
  return <View style={styles.chartGroup}>{currencies.map(currency => {
    const rows = data.history.slice(-12).map(row => ({ date: row.date, value: row.totals[currency] ?? null, complete: row.complete }));
    const coverage = historyCoverageSummary(rows);
    const chartLabel = `${currency} net worth history chart · ${coverage}`;
    const values = rows.flatMap(row => row.value === null ? [] : [row.value]);
    if (!values.length) return <View key={currency} accessibilityRole="image" accessibilityLabel={chartLabel} style={[styles.chart, { borderColor: colors.rule }]}><Text style={[styles.chartCaption, { color: colors.muted }]}>{currency} net worth trend unavailable · {rows.length} dated points · {coverage}</Text></View>;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    return <View key={currency} accessibilityRole="image" accessibilityLabel={chartLabel} style={[styles.chart, { borderColor: colors.rule }]}><Text style={[styles.chartCaption, { color: colors.muted }]}>{currency} net worth trend · {rows.length} dated points · {coverage}</Text>{rows.map(row => <View key={row.date} style={styles.chartRow}><View style={{ width: 118, gap: 2 }}><Text style={[styles.chartDate, { color: colors.muted }]}>{row.date}</Text><Text style={[styles.chartDate, { color: row.complete ? colors.muted : colors.danger, fontFamily: 'DMSans', fontSize: 10, lineHeight: 14, width: undefined }]}>{row.complete ? 'Complete' : 'Known subtotal'}</Text></View><View style={[styles.chartTrack, { backgroundColor: colors.rule }]}>{row.value === null ? <Text style={[styles.chartUnavailable, { color: colors.muted }]}>Unavailable</Text> : <View style={[styles.chartBar, { backgroundColor: colors.signal, width: `${range === 0 ? 100 : Math.max(8, ((row.value - min) / range) * 100)}%` }]}/>}</View></View>)}</View>;
  })}</View>;
}

function fxConversionNeeded(data: WealthWireSnapshot): boolean {
  return Object.keys(data.totalByCurrency).some(currency => currency !== 'CAD');
}

type FxMetadata = { effectiveDate: string; provider: 'frankfurter'; baseCurrency: 'EUR'; cadRate: string | null };

function fxMetadata(fx: WealthWireSnapshot['fx'], conversionNeeded: boolean): FxMetadata | null {
  if (!fx || !fx.effectiveDate || fx.provider !== 'frankfurter' || fx.baseCurrency !== 'EUR') return null;
  if (conversionNeeded && !fx.rates.CAD) return null;
  return { effectiveDate: fx.effectiveDate, provider: fx.provider, baseCurrency: fx.baseCurrency, cadRate: fx.rates.CAD ?? null };
}

function fxDateNote(data: WealthWireSnapshot, effectiveDate: string): string {
  const reportDate = data.asOf?.slice(0, 10);
  return reportDate && effectiveDate < reportDate ? ' · provider date precedes report date' : '';
}

function fxProvenance(data: WealthWireSnapshot): { text: string; available: boolean } {
  const fx = data.fx;
  const conversionNeeded = fxConversionNeeded(data);
  if (!conversionNeeded) return { text: 'No conversion required; the original CAD total is shown.', available: true };
  const metadata = fxMetadata(fx, conversionNeeded);
  if (!metadata) return { text: 'FX source details unavailable; source-currency totals remain authoritative.', available: false };
  const cadRate = metadata.cadRate;
  if (!cadRate) return { text: 'FX source details unavailable; source-currency totals remain authoritative.', available: false };
  return { text: `${metadata.provider} · ${metadata.baseCurrency} base · effective ${metadata.effectiveDate}${fxDateNote(data, metadata.effectiveDate)} · EUR → CAD ${cadRate}`, available: true };
}

function fxEstimate(fx: WealthWireSnapshot['fx']): { text: string; available: boolean } {
  if (!fx || !fx.complete || fx.convertedCadMinor === null) return { text: 'Unavailable', available: false };
  return { text: money(fx.convertedCadMinor, 'CAD'), available: true };
}

function FxSummary({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  const estimate = fxEstimate(data.fx);
  const provenance = fxProvenance(data);
  const estimateLabel = estimate.available ? `CAD estimate ${estimate.text}` : 'CAD estimate unavailable';
  return <View accessibilityRole="summary" accessibilityLabel={`${estimateLabel} · ${provenance.text}`} style={[styles.fxSummary, { borderColor: colors.rule, backgroundColor: colors.panel }]}>
    <Text style={[styles.fxTitle, { color: colors.muted }]}>CAD estimate</Text>
    <Text style={[styles.totalValue, { color: colors.ink }]}>{estimate.text}</Text>
    <Text style={[styles.rowMeta, { color: provenance.available ? colors.muted : colors.danger }]}>{provenance.text}</Text>
    {!estimate.available ? <Text style={[styles.rowMeta, { color: colors.danger }]}>Add dated FX coverage before treating this estimate as complete.</Text> : null}
  </View>;
}

export function WealthOverview({ dark, data, onAction }: { dark: boolean; data: WealthWireSnapshot; onAction: (action: string, body?: string) => void }) {
  const colors = theme(dark);
  const totals = Object.entries(data.totalByCurrency);
  return <View style={styles.sectionGroup}>
    <Copy dark={dark} heading>Net worth</Copy><Status dark={dark} data={data}/>
    <View accessibilityRole="summary" style={[styles.totalStrip, { borderColor: colors.rule, backgroundColor: colors.panel }]}>{totals.length ? totals.map(([currency, amount]) => <View key={currency} style={styles.total}><Text style={[styles.totalValue, { color: colors.ink }]}>{money(amount, currency)}</Text><Text style={[styles.totalLabel, { color: colors.muted }]}>{currency} total</Text></View>) : <Copy dark={dark} muted>No valued balances yet.</Copy>}</View>
    <FxSummary dark={dark} data={data}/>
    <Copy dark={dark} heading>Net worth history</Copy><HistoryChart dark={dark} data={data}/><HistoryTable dark={dark} data={data}/>
    <View style={styles.actionRow}><Action dark={dark} label="Add a dated balance or price" onPress={() => onAction('valuation')}/><Action dark={dark} label="Refresh Wealth report" onPress={() => onAction('refresh')}/></View>
  </View>;
}

function PortfolioRow({ dark, position, onOpen }: { dark: boolean; position: WealthWireSnapshot['positions'][number]; onOpen: () => void }) {
  const colors = theme(dark);
  const instrument = `${position.instrument.exchange}:${position.instrument.ticker}`;
  return <View style={[styles.portfolioRow, { borderBottomColor: colors.rule }]}><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: colors.ink }]}>{instrument} · {position.instrument.type} · {position.instrument.currency}</Text><Text style={[styles.rowMeta, { color: colors.muted }]}>{position.quantity} units · basis {position.basisKnown ? money(position.costBasisMinor, position.instrument.currency) : 'Unknown'}</Text><Text style={[styles.rowMeta, { color: colors.ink }]}>{money(position.marketValueMinor, position.instrument.currency)} market value · {position.valuation ? `price ${money(position.valuation.priceMinor, position.instrument.currency)} on ${position.valuation.asOf}` : 'No dated prices'}</Text><Text style={[styles.rowMeta, { color: colors.muted }]}>Unrealized gain: {money(position.unrealizedGainMinor, position.instrument.currency)} · realized gain: {money(position.realizedGainMinor, position.instrument.currency)}</Text></View><Action dark={dark} label={`Open ${instrument} ${position.instrument.currency} details`} onPress={onOpen}/></View>;
}

function InvestmentAccounts({ dark, accounts, onOpen }: { dark: boolean; accounts: WealthWireSnapshot['accounts']; onOpen: (id: string) => void }) {
  if (!accounts.length) return <Copy dark={dark} muted>No investment accounts yet.</Copy>;
  return <>{accounts.map(account => <View key={account.id} style={styles.accountRow}><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: theme(dark).ink }]}>{account.name}</Text><Text style={[styles.rowMeta, { color: theme(dark).muted }]}>{account.kind} · {account.mode}{account.currency ? ` · ${account.currency}` : ''}</Text></View><Action dark={dark} label={`Open ${account.name}`} onPress={() => onOpen(account.id)}/></View>)}</>;
}

function InvestmentHoldings({ dark, positions, onOpen }: { dark: boolean; positions: WealthWireSnapshot['positions']; onOpen: (position: WealthWireSnapshot['positions'][number]) => void }) {
  if (!positions.length) return <Copy dark={dark} muted>No holdings yet. Record an opening position or a buy.</Copy>;
  return <>{positions.map(position => <PortfolioRow dark={dark} key={`${position.accountId}:${position.instrument.exchange}:${position.instrument.ticker}`} position={position} onOpen={() => onOpen(position)}/>)}</>;
}

function InvestmentCash({ dark, cash }: { dark: boolean; cash: WealthWireSnapshot['cash'] }) {
  if (!cash.length) return <Copy dark={dark} muted>No cash balances recorded yet.</Copy>;
  return <>{cash.map(item => <Copy dark={dark} key={`${item.accountId}:${item.currency}`}>{item.currency} {money(item.amountMinor, item.currency)}</Copy>)}</>;
}

function InvestmentAllocation({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  const rows = data.allocations ?? [];
  if (!rows.length) return <Copy dark={dark} muted>No server-calculated allocation rows are available yet.</Copy>;
  return <View accessibilityRole="list" accessibilityLabel="Wealth allocation by original currency" style={[styles.table, { borderColor: colors.rule }]}>{rows.map((row, index) => {
    const account = data.accounts.find(item => item.id === row.accountId)?.name ?? 'Account unavailable';
    const name = row.kind === 'cash' ? 'Cash' : row.kind === 'aggregate' ? 'Aggregate balance' : row.instrument ? `${row.instrument.exchange}:${row.instrument.ticker}` : 'Holding';
    const share = row.available && row.share !== null ? `${(row.share * 100).toFixed(2)}%` : 'Allocation unavailable';
    const value = `${money(row.valueMinor, row.currency)} · ${share}`;
    return <View accessible accessibilityLabel={`${row.currency} · ${account} · ${name} · ${value}`} key={`${row.currency}:${row.accountId}:${row.kind}:${name}:${index}`} style={[styles.tableRow, { borderBottomColor: colors.rule }]}><Text style={[styles.tableKey, { color: colors.ink }]}>{row.currency} · {account} · {name}</Text><Text style={[styles.tableValue, { color: colors.ink }]}>{value}</Text></View>;
  })}</View>;
}

function PositionDetail({ dark, account, position }: { dark: boolean; account: WealthWireSnapshot['accounts'][number] | null; position: WealthWireSnapshot['positions'][number] }) {
  return <><Copy dark={dark}>Account: {account?.name ?? 'Account unavailable'}</Copy><Copy dark={dark}>Canonical instrument: {position.instrument.exchange} · {position.instrument.ticker} · {position.instrument.type} · {position.instrument.currency}</Copy><Copy dark={dark}>Position: {position.quantity} units · basis {position.basisKnown ? money(position.costBasisMinor, position.instrument.currency) : 'Unknown'}</Copy><Copy dark={dark}>Latest dated price: {position.valuation ? `${money(position.valuation.priceMinor, position.instrument.currency)} on ${position.valuation.asOf}` : 'Unavailable'}</Copy></>;
}

function AccountDetail({ dark, account, cash, events, valuations }: { dark: boolean; account: WealthWireSnapshot['accounts'][number]; cash: WealthWireSnapshot['cash']; events: WealthEventRow[]; valuations: NonNullable<WealthWireSnapshot['valuations']> }) {
  return <><Copy dark={dark}>Account: {account.kind} · {account.mode} · {account.currency ?? 'Currency unavailable'}</Copy>{cash.map(item => <Copy dark={dark} key={`${item.accountId}:${item.currency}`}>Cash: {money(item.amountMinor, item.currency)}</Copy>)}<Copy dark={dark} muted>{events.length ? `${events.length} server events in this account.` : 'No server events recorded for this account.'}</Copy>{valuations.length ? <><Copy dark={dark} muted>Dated values</Copy>{valuations.map(value => <Copy dark={dark} key={value.id}>{value.asOf} · {value.instrument ? `${value.instrument.exchange}:${value.instrument.ticker}` : 'Account balance'} · {money(value.priceMinor, value.instrument?.currency ?? account.currency ?? 'Currency unavailable')} · {value.source}</Copy>)}</> : <Copy dark={dark} muted>No dated values recorded for this selection.</Copy>}</>;
}

function InvestmentDetail({ dark, account, position, cash, events, valuations, loading, error, onRetry, onClose }: { dark: boolean; account: WealthWireSnapshot['accounts'][number] | null; position: WealthWireSnapshot['positions'][number] | null; cash: WealthWireSnapshot['cash']; events: WealthEventRow[]; valuations: NonNullable<WealthWireSnapshot['valuations']>; loading: boolean; error?: string; onRetry?: () => void; onClose: () => void }) {
  if (!account && !position) return null;
  const title = position ? `${position.instrument.exchange}:${position.instrument.ticker}` : account?.name;
  return <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={[styles.detail, { borderColor: theme(dark).rule, backgroundColor: theme(dark).panel }]}><Copy dark={dark} heading accessibilityLiveRegion="polite">Selected Wealth detail: {title}</Copy>{loading ? <Copy dark={dark} muted>Loading dated account history…</Copy> : null}{error ? <><Copy dark={dark} error>{error}</Copy>{onRetry ? <Action dark={dark} label="Retry Wealth history" onPress={onRetry}/> : null}</> : null}{position ? <PositionDetail dark={dark} account={account} position={position}/> : null}{account ? <AccountDetail dark={dark} account={account} cash={cash} events={events} valuations={valuations}/> : null}<Action dark={dark} label="Close Wealth detail" onPress={onClose}/></View>;
}

function InvestmentList({ dark, data, onOpenAccount, onOpenPosition }: { dark: boolean; data: WealthWireSnapshot; onOpenAccount: (id: string) => void; onOpenPosition: (position: WealthWireSnapshot['positions'][number]) => void }) {
  return <><Copy dark={dark} heading>Accounts</Copy><InvestmentAccounts dark={dark} accounts={data.accounts} onOpen={onOpenAccount}/><Copy dark={dark} heading>Holdings</Copy><InvestmentHoldings dark={dark} positions={data.positions} onOpen={onOpenPosition}/><Copy dark={dark} heading>Cash across holdings accounts</Copy><InvestmentCash dark={dark} cash={data.cash}/><Copy dark={dark} heading>Allocation by original currency</Copy><Copy dark={dark} muted>Shares are server-calculated within each currency. Missing prices remain unavailable and never become zero.</Copy><InvestmentAllocation dark={dark} data={data}/></>;
}

function uniqueInstruments(positions: WealthWireSnapshot['positions']): CanonicalInstrument[] {
  return [...new Map(positions.map(position => [`${position.instrument.exchange}:${position.instrument.ticker}:${position.instrument.type}:${position.instrument.currency}`, position.instrument])).values()];
}

function filterSelectedEvents(detail: WealthInvestmentDetail | null, accountId: string | null, events: WealthEventRow[]): WealthEventRow[] {
  if (detail) return detail.events.filter(event => !detail.instrumentKey || event.instrumentKey === detail.instrumentKey);
  return accountId ? events.filter(event => event.accountId === accountId) : [];
}

function filterSelectedValuations(detail: WealthInvestmentDetail | null, accountId: string | null): NonNullable<WealthWireSnapshot['valuations']> {
  if (!detail) return [];
  return detail.valuations.filter(valuation => {
    if (!accountId || valuation.accountId !== accountId) return false;
    if (!detail.instrumentKey) return true;
    return valuation.instrument ? `${valuation.instrument.exchange}:${valuation.instrument.ticker}:${valuation.instrument.type}:${valuation.instrument.currency}` === detail.instrumentKey : false;
  });
}

function useInvestmentSelection(data: WealthWireSnapshot, events: WealthEventRow[], onAction: (action: string, body?: string) => void) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<WealthWireSnapshot['positions'][number] | null>(null);
  const selectedAccount = data.accounts.find(account => account.id === selectedAccountId) ?? null;
  const selectedCash = selectedAccountId ? data.cash.filter(item => item.accountId === selectedAccountId) : [];
  const openAccount = (id: string) => { setSelectedAccountId(id); setSelectedPosition(null); onAction('open-account', JSON.stringify({ accountId: id })); };
  const openPosition = (position: WealthWireSnapshot['positions'][number]) => {
    setSelectedPosition(position);
    setSelectedAccountId(position.accountId);
    const instrumentKey = `${position.instrument.exchange}:${position.instrument.ticker}:${position.instrument.type}:${position.instrument.currency}`;
    onAction('open-instrument', JSON.stringify({ accountId: position.accountId, instrumentKey }));
  };
  const close = () => { setSelectedAccountId(null); setSelectedPosition(null); };
  return { selectedAccount, selectedPosition, selectedCash, selectedEvents: filterSelectedEvents(null, selectedAccountId, events), selectedValuations: [] as NonNullable<WealthWireSnapshot['valuations']>, openAccount, openPosition, close };
}

type InvestmentSelection = ReturnType<typeof useInvestmentSelection>;
type InvestmentDetailView = { account: WealthWireSnapshot['accounts'][number] | null; position: WealthWireSnapshot['positions'][number] | null; cash: WealthWireSnapshot['cash']; events: WealthEventRow[]; valuations: NonNullable<WealthWireSnapshot['valuations']> };
type InvestmentDetailInput = { detail: WealthInvestmentDetail | null; detailError?: string; detailLoading: boolean; selection: InvestmentSelection; events: WealthEventRow[] };

function investmentDetailView({ detail, detailError, detailLoading, selection, events }: InvestmentDetailInput): InvestmentDetailView {
  const active = Boolean(detail || detailLoading || detailError);
  const accountId = selection.selectedAccount?.id ?? null;
  return {
    account: active ? selection.selectedAccount : null,
    position: active ? selection.selectedPosition : null,
    cash: selection.selectedCash,
    events: detail ? filterSelectedEvents(detail, accountId, events) : selection.selectedEvents,
    valuations: detail ? filterSelectedValuations(detail, accountId) : selection.selectedValuations,
  };
}

export function WealthInvestments({ dark, data, revision = data.revision, events: eventRows, eventsError, bankAccounts = [], bankTransactions = [], csv = data.csv, quote = data.quote, csvSourceOperationId, detail = null, detailError, detailLoading = false, operation, onCsvImport, onCsvRemap, onCsvTemplate, onRetryDetail, onRetryEvents, onCloseDetail, onAction }: { dark: boolean; data: WealthWireSnapshot; revision?: number | null; events?: WealthEventRow[]; eventsError?: string; bankAccounts?: WealthBankAccount[]; bankTransactions?: WealthBankTransaction[]; csv?: WealthWireSnapshot['csv']; quote?: WealthWireSnapshot['quote']; csvSourceOperationId?: string | null; detail?: WealthInvestmentDetail | null; detailError?: string; detailLoading?: boolean; operation?: string; onCsvImport?: () => void; onCsvRemap?: (mapping: WealthCsvMapping) => void; onCsvTemplate?: () => void; onRetryDetail?: () => void; onRetryEvents?: () => void; onCloseDetail?: () => void; onAction: (action: string, body?: string, draftId?: string) => void }) {
  const events = eventRows ?? data.events ?? [];
  const selection = useInvestmentSelection(data, events, onAction);
  const detailView = investmentDetailView({ detail, detailError, detailLoading, selection, events });
  const instruments = uniqueInstruments(data.positions);
  return <View style={styles.sectionGroup}>
    <Copy dark={dark} heading>Investments</Copy><Copy dark={dark} muted>Long-only stocks and ETFs. Dated prices and original currencies stay visible.</Copy>
    <InvestmentDetail dark={dark} account={detailView.account} position={detailView.position} cash={detailView.cash} events={detailView.events} valuations={detailView.valuations} loading={detailLoading} error={detailError} onRetry={onRetryDetail} onClose={() => { selection.close(); onCloseDetail?.(); }}/>
    <InvestmentList dark={dark} data={data} onOpenAccount={selection.openAccount} onOpenPosition={selection.openPosition}/>
    {eventsError ? <View style={styles.error}><Copy dark={dark} error>Event history could not be loaded. Corrections and reversals need a refreshed server history.</Copy><Action dark={dark} label="Retry event history" onPress={() => onRetryEvents?.()}/></View> : null}
    <InvestmentOperations dark={dark} accounts={data.accounts} instruments={instruments} events={events} bankAccounts={bankAccounts} bankTransactions={bankTransactions} initialAction={operation} csvSourceOperationId={csvSourceOperationId} onCsvImport={onCsvImport} onCsvRemap={onCsvRemap} onCsvTemplate={onCsvTemplate} onAction={onAction} quote={quote} csv={csv} revision={revision}/>
  </View>;
}

function EventPicker({ dark, events, selected, onSelect }: { dark: boolean; events: WealthEventRow[]; selected: WealthEventRow | null; onSelect: (event: WealthEventRow) => void }) {
  if (!events.length) return <Copy dark={dark} muted>No existing events are available to select. Refresh after recording an event before correcting or reversing it.</Copy>;
  return <View style={styles.actionRow}>{events.map(event => <Action key={event.id} dark={dark} label={`${event.date} · ${event.label ?? event.kind}`} selected={selected?.id === event.id} onPress={() => onSelect(event)}/>)}</View>;
}

function BankTransactionPicker({ dark, transactions, selected, onSelect }: { dark: boolean; transactions: WealthBankTransaction[]; selected: WealthBankTransaction | null; onSelect: (transaction: WealthBankTransaction) => void }) {
  if (!transactions.length) return <Copy dark={dark} muted>No confirmed bank records are available for linking. Refresh Activity and try again.</Copy>;
  return <><Copy dark={dark} muted>Link a confirmed Activity record only when it is the same money movement.</Copy><View style={styles.actionRow}>{transactions.slice(0, 100).map(transaction => <Action key={transaction.id} dark={dark} label={bankTransactionLabel(transaction)} selected={selected?.id === transaction.id} onPress={() => onSelect(transaction)}/>)}</View>{transactions.length > 100 ? <Copy dark={dark} muted>Showing the 100 most recent confirmed records.</Copy> : null}</>;
}

function AccountPicker({ dark, accounts, selected, onSelect, filter }: { dark: boolean; accounts: WealthWireSnapshot['accounts']; selected: string; onSelect: (id: string) => void; filter?: (account: WealthWireSnapshot['accounts'][number]) => boolean }) {
  const visible = filter ? accounts.filter(filter) : accounts;
  if (!visible.length) return <Copy dark={dark} muted>Create a compatible Wealth account before recording this event.</Copy>;
  return <View style={styles.actionRow}>{visible.map(account => <Action key={account.id} dark={dark} label={`Use ${account.name}`} selected={selected === account.id} onPress={() => onSelect(account.id)}/>)}</View>;
}

function InstrumentFields({ dark, options = [], exchange, ticker, type, currency, setExchange, setTicker, setType, setCurrency }: { dark: boolean; options?: CanonicalInstrument[]; exchange: string; ticker: string; type: 'stock' | 'etf'; currency: string; setExchange: (value: string) => void; setTicker: (value: string) => void; setType: (value: 'stock' | 'etf') => void; setCurrency: (value: string) => void }) {
  const choose = (instrument: CanonicalInstrument) => { setExchange(instrument.exchange); setTicker(instrument.ticker); setType(instrument.type); setCurrency(instrument.currency); };
  return <><Copy dark={dark} muted>Select a stored instrument when available; canonical exchange, ticker, type, and currency travel together.</Copy>{options.length ? <View style={styles.actionRow}>{options.map(instrument => <Action key={`${instrument.exchange}:${instrument.ticker}:${instrument.type}:${instrument.currency}`} dark={dark} label={`${instrument.exchange}:${instrument.ticker} · ${instrument.type} · ${instrument.currency}`} selected={instrument.exchange === exchange && instrument.ticker === ticker && instrument.type === type && instrument.currency === currency} onPress={() => choose(instrument)}/>)}</View> : null}<Field dark={dark} label="Exchange" value={exchange} onChange={value => setExchange(value.toUpperCase())}/><Field dark={dark} label="Ticker" value={ticker} onChange={value => setTicker(value.toUpperCase())}/><View style={styles.actionRow}><Action dark={dark} label="Stock" selected={type === 'stock'} onPress={() => setType('stock')}/><Action dark={dark} label="ETF" selected={type === 'etf'} onPress={() => setType('etf')}/></View><Field dark={dark} label="Instrument currency" value={currency} onChange={value => setCurrency(value.toUpperCase())}/></>;
}

type OperationValues = {
  accountId: string;
  accountIdSuffix: string;
  accountName: string;
  accountKind: string;
  accountMode: 'aggregate' | 'holdings';
  originalAccountMode: 'aggregate' | 'holdings' | null;
  linkedBankAccountId: string;
  openingAmountMinor: string;
  effectiveDate: string;
  openingPosition: OpeningPositionValues;
  currency: string;
  exchange: string;
  ticker: string;
  instrumentType: 'stock' | 'etf';
  valuationTarget: 'instrument' | 'account';
  date: string;
  quantity: string;
  amountMinor: string;
  priceMinor: string;
  eventKind: string;
  targetEvent: WealthEventRow | null;
  selectedBankTransaction: WealthBankTransaction | null;
  numerator: string;
  denominator: string;
  toAccountId: string;
  transferKind: 'cash' | 'position';
  quoteKey: string;
  csvText: string;
  csvMapping: WealthCsvMapping;
};

type OpeningPositionValues = {
  exchange: string;
  ticker: string;
  type: 'stock' | 'etf';
  currency: string;
  quantity: string;
  basis: string;
  price: string;
};

function defaultOpeningPosition(): OpeningPositionValues {
  return { exchange: 'TSX', ticker: '', type: 'stock', currency: 'CAD', quantity: '', basis: '', price: '' };
}

type OperationSetters = {
  setAccountId: (value: string) => void;
  setAccountIdSuffix: (value: string) => void;
  setAccountName: (value: string) => void;
  setAccountKind: (value: string) => void;
  setAccountMode: (value: 'aggregate' | 'holdings') => void;
  setLinkedBankAccountId: (value: string) => void;
  setOpeningAmountMinor: (value: string) => void;
  setEffectiveDate: (value: string) => void;
  setOpeningPosition: (value: OpeningPositionValues | ((current: OpeningPositionValues) => OpeningPositionValues)) => void;
  setCurrency: (value: string) => void;
  setExchange: (value: string) => void;
  setTicker: (value: string) => void;
  setInstrumentType: (value: 'stock' | 'etf') => void;
  setValuationTarget: (value: 'instrument' | 'account') => void;
  setDate: (value: string) => void;
  setQuantity: (value: string) => void;
  setAmountMinor: (value: string) => void;
  setPriceMinor: (value: string) => void;
  setEventKind: (value: string) => void;
  setTargetEvent: (value: WealthEventRow | null) => void;
  setSelectedBankTransaction: (value: WealthBankTransaction | null) => void;
  setNumerator: (value: string) => void;
  setDenominator: (value: string) => void;
  setToAccountId: (value: string) => void;
  setTransferKind: (value: 'cash' | 'position') => void;
  setQuoteKey: (value: string) => void;
  setCsvText: (value: string) => void;
  setCsvMapping: (value: WealthCsvMapping) => void;
};

type OperationEditorProps = {
  dark: boolean;
  accounts: WealthWireSnapshot['accounts'];
  bankAccounts: WealthBankAccount[];
  revision?: number | null;
  instruments: CanonicalInstrument[];
  events: WealthEventRow[];
  bankTransactions: WealthBankTransaction[];
  quote: WealthWireSnapshot['quote'];
  csv: WealthWireSnapshot['csv'];
  values: OperationValues;
  setters: OperationSetters;
  onCsvImport?: () => void;
  onCsvRemap?: (mapping: WealthCsvMapping) => void;
  onCsvTemplate?: () => void;
  csvSourceOperationId?: string | null;
  onExistingAccount?: (id: string) => void;
  onSubmit?: () => void;
  submitDisabled?: boolean;
};

const buildInstrument = (values: OperationValues): CanonicalInstrument => ({ exchange: values.exchange.trim().toUpperCase(), ticker: values.ticker.trim().toUpperCase(), type: values.instrumentType, currency: values.currency });
const buildMoney = (values: OperationValues) => ({ currency: values.currency, amountMinor: parseMinor(values.amountMinor, values.currency) });
type EventValue = Record<string, unknown>;
type EventBuilder = (values: OperationValues, instrument: CanonicalInstrument) => EventValue;
const buildTransferEvent: EventBuilder = (values, instrument) => values.transferKind === 'position'
  ? { date: values.date, kind: values.eventKind, transferKind: values.transferKind, fromAccountId: values.accountId.trim(), toAccountId: values.toAccountId.trim(), instrument, quantity: values.quantity.trim(), transferId: null }
  : { date: values.date, kind: values.eventKind, transferKind: values.transferKind, fromAccountId: values.accountId.trim(), toAccountId: values.toAccountId.trim(), money: buildMoney(values), transferId: null };
const buildOpeningPositionEvent: EventBuilder = (values, instrument) => ({ date: values.date, kind: values.eventKind, accountId: values.accountId.trim(), instrument, quantity: values.quantity.trim(), basis: values.amountMinor.trim() ? buildMoney(values) : null });
const buildSplitEvent: EventBuilder = (values, instrument) => ({ date: values.date, kind: values.eventKind, accountId: values.accountId.trim(), instrument, numerator: parseInteger(values.numerator), denominator: parseInteger(values.denominator) });
const buildStandardEvent: EventBuilder = (values, instrument) => ({ date: values.date, kind: values.eventKind, accountId: values.accountId.trim(), instrument: instrumentEventKinds.has(values.eventKind) ? instrument : null, quantity: values.quantity.trim(), money: buildMoney(values), consideration: buildMoney(values), proceeds: buildMoney(values), fee: null });
const eventBuilders: Record<string, EventBuilder> = { transfer: buildTransferEvent, opening_position: buildOpeningPositionEvent, split: buildSplitEvent };
const withBankLink = (event: EventValue, values: OperationValues): EventValue => {
  const existingLink = values.targetEvent?.linkedBankSourceId;
  const selectedLink = values.selectedBankTransaction?.id ?? null;
  const linkedBankSourceId = existingLink ? selectedLink ?? existingLink : (bankLinkEventKinds.has(values.eventKind) ? selectedLink : null);
  return linkedBankSourceId ? { ...event, linkedBankSourceId } : event;
};
const buildEventValue = (values: OperationValues, instrument: CanonicalInstrument): EventValue => withBankLink((eventBuilders[values.eventKind] ?? buildStandardEvent)(values, instrument), values);

const revisionPayload = (revision: number | null | undefined): Record<string, number> => revision === null || revision === undefined ? {} : { expectedRevision: revision };

function isAccountModeTransition(values: OperationValues): boolean {
  return Boolean(values.accountId.trim() && values.originalAccountMode && values.originalAccountMode !== values.accountMode);
}

type OpeningPositionPayload = {
  instrument: CanonicalInstrument;
  quantity: string;
  basis?: { currency: string; amountMinor: number };
  priceMinor?: number;
};

function optionalMinor(value: string, currency: string): { valid: boolean; amount: number | null } {
  if (!value.trim()) return { valid: true, amount: null };
  const amount = parseMinor(value, currency);
  if (amount === null) return { valid: false, amount: null };
  if (amount < 0) return { valid: false, amount: null };
  return { valid: true, amount };
}

function openingPositionInstrument(position: OpeningPositionValues, currency: string): CanonicalInstrument | null {
  const exchange = position.exchange.trim();
  const ticker = position.ticker.trim();
  if (!exchange) return null;
  if (!ticker) return null;
  if (currency.length !== 3) return null;
  return { exchange: exchange.toUpperCase(), ticker: ticker.toUpperCase(), type: position.type, currency };
}

function openingPositionReady(quantity: string | null, instrument: CanonicalInstrument | null, basis: { valid: boolean }, price: { valid: boolean }): boolean {
  if (!quantity) return false;
  if (!instrument) return false;
  if (!basis.valid) return false;
  return price.valid;
}

function openingPositionPayload(values: OperationValues): OpeningPositionPayload | null {
  const position = values.openingPosition;
  const quantity = parseQuantity(position.quantity);
  const currency = position.currency.trim().toUpperCase();
  const instrument = openingPositionInstrument(position, currency);
  const basis = optionalMinor(position.basis, currency);
  const price = optionalMinor(position.price, currency);
  if (!quantity) return null;
  if (!instrument) return null;
  if (!openingPositionReady(quantity, instrument, basis, price)) return null;
  return {
    instrument,
    quantity,
    ...(basis.amount === null ? {} : { basis: { currency, amountMinor: basis.amount } }),
    ...(price.amount === null ? {} : { priceMinor: price.amount }),
  };
}

function nonNegativeMinor(value: string, currency: string): number | null {
  const amount = parseMinor(value, currency);
  return amount !== null && amount >= 0 ? amount : null;
}

function aggregateOpeningNeedsDate(values: OperationValues, amountMinor: number | null): boolean {
  if (amountMinor === null) return false;
  if (values.accountKind === 'linked_bank') return false;
  return !values.accountId.trim();
}

function newAccountOpeningPayload(values: OperationValues): Record<string, unknown> {
  const amountMinor = values.openingAmountMinor.trim() ? parseMinor(values.openingAmountMinor, values.currency) : null;
  if (values.accountMode !== 'aggregate') {
    return { amountMinor: values.accountId.trim() ? amountMinor : null };
  }
  if (!aggregateOpeningNeedsDate(values, amountMinor)) return { amountMinor };
  return { amountMinor, asOf: values.effectiveDate };
}

function accountTransitionPayload(values: OperationValues): Record<string, unknown> | null {
  if (!isAccountModeTransition(values) || !isIsoDate(values.effectiveDate)) return null;
  const openingValue = nonNegativeMinor(values.openingAmountMinor, values.currency);
  if (values.accountMode === 'aggregate') return openingValue === null ? null : { effectiveDate: values.effectiveDate, openingValueMinor: openingValue };
  const position = openingPositionPayload(values);
  if (openingValue === null && position === null) return null;
  return { effectiveDate: values.effectiveDate, ...(openingValue === null ? {} : { openingCashMinor: openingValue }), ...(position === null ? {} : { openingPositions: [position] }) };
}

const buildOperationBody = (action: string, values: OperationValues, csv: WealthWireSnapshot['csv'], instrument: CanonicalInstrument, revision?: number | null): string => {
  if (action === 'account') {
    const slug = values.accountName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wealth-account';
    const generatedId = values.accountId.trim() || `${slug}-${values.accountIdSuffix}`;
    const linkedBankAccountId = values.accountKind === 'linked_bank' ? values.linkedBankAccountId.trim() || null : null;
    const transition = accountTransitionPayload(values);
    return JSON.stringify({ id: generatedId, name: values.accountName.trim(), kind: values.accountKind, mode: values.accountMode, currency: values.currency, linkedBankAccountId, ...(transition ? { amountMinor: null, ...transition } : newAccountOpeningPayload(values)), ...revisionPayload(revision) });
  }
  if (action === 'instrument') return JSON.stringify({ id: `instrument-${instrument.exchange}-${instrument.ticker}-${instrument.type}-${instrument.currency}`.toLowerCase(), ...instrument, ...revisionPayload(revision) });
  if (action === 'valuation') return JSON.stringify({ id: `valuation-${values.accountId.trim() || 'account'}-${values.date}`, accountId: values.accountId.trim(), instrument: values.valuationTarget === 'account' ? null : instrument, asOf: values.date, priceMinor: parseMinor(values.priceMinor, values.currency), source: 'manual', provider: null, ...revisionPayload(revision) });
  if (action === 'quote-save') return JSON.stringify({ provider: 'alpha_vantage', credential: values.quoteKey });
  if (action === 'quote-remove') return JSON.stringify({ provider: 'alpha_vantage' });
  if (action === 'quote-refresh') return JSON.stringify({ instrument });
  if (action === 'csv-preview') return JSON.stringify({ csv: values.csvText, ...(Object.keys(values.csvMapping).length ? { mapping: values.csvMapping } : {}) });
  if (action === 'csv-commit') return JSON.stringify({ previewId: csv.previewId, expectedRevision: csv.revision, rowIds: csv.validRowIds ?? [] });
  if (action === 'csv-export') return JSON.stringify({ fileName: 'border-ledger-wealth.csv' });
  if (action === 'reversal') return JSON.stringify({ date: values.date, kind: 'reversal', targetSourceId: values.targetEvent?.sourceId, ...revisionPayload(revision) });
  const eventValue = buildEventValue(values, instrument);
  return action === 'correction' ? JSON.stringify({ date: values.date, kind: 'correction', targetSourceId: values.targetEvent?.sourceId, replacement: eventValue, ...revisionPayload(revision) }) : JSON.stringify({ ...eventValue, ...revisionPayload(revision) });
};

function eventRequiresHoldings(kind: string): boolean {
  return ['opening_position', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split'].includes(kind);
}

function accountForEvent(accounts: WealthWireSnapshot['accounts'], id: string): WealthWireSnapshot['accounts'][number] | null {
  return accounts.find(account => account.id === id) ?? null;
}

function accountModeAllowed(values: OperationValues): boolean {
  return values.accountMode === 'aggregate' || (values.accountMode === 'holdings' && values.accountKind === 'brokerage');
}

function accountLinkAllowed(values: OperationValues): boolean {
  return values.accountKind !== 'linked_bank' || values.linkedBankAccountId.trim().length > 0;
}

function accountOpeningValueAllowed(values: OperationValues): boolean {
  if (!values.openingAmountMinor.trim()) return true;
  if (parseMinor(values.openingAmountMinor, values.currency) === null) return false;
  return Boolean(values.accountId.trim()) || values.accountMode !== 'aggregate' || values.accountKind === 'linked_bank' || isIsoDate(values.effectiveDate);
}

function accountIdentityReady(values: OperationValues): boolean {
  if (!values.accountName.trim()) return false;
  return values.currency.length === 3;
}

function canSubmitAccount(values: OperationValues): boolean {
  if (!accountIdentityReady(values)) return false;
  if (!accountModeAllowed(values)) return false;
  if (!accountLinkAllowed(values)) return false;
  if (isAccountModeTransition(values)) return accountTransitionPayload(values) !== null;
  return accountOpeningValueAllowed(values);
}

function csvPreviewErrorCount(csv: WealthWireSnapshot['csv']): number {
  const rowErrors = csv.previewRows?.filter(row => Boolean(row.error)).length ?? 0;
  return Math.max(csv.errors.length, rowErrors);
}

function csvPreviewDuplicateCount(csv: WealthWireSnapshot['csv']): number {
  const rowDuplicates = csv.previewRows?.filter(row => Boolean(row.duplicateOf)).length ?? 0;
  return Math.max(csv.duplicates.length, rowDuplicates);
}

function csvCommitReady(csv: WealthWireSnapshot['csv']): boolean {
  return Boolean(csv.previewId && csv.revision !== null && csv.revision !== undefined && (csv.validRowIds?.length ?? 0) > 0 && csvPreviewErrorCount(csv) === 0);
}

function canSubmitOperation(action: string, values: OperationValues, csv: WealthWireSnapshot['csv'], instrument: CanonicalInstrument, accounts: WealthWireSnapshot['accounts']): boolean {
  const hasInstrument = instrument.exchange.length > 0 && instrument.ticker.length > 0 && values.currency.length === 3;
  const hasDate = isIsoDate(values.date);
  if (['correction', 'reversal'].includes(action) && values.targetEvent === null) return false;
  if (action === 'reversal') return hasDate;
  if (action === 'account') return canSubmitAccount(values);
  if (action === 'instrument') return hasInstrument;
  if (action === 'valuation') return Boolean(values.accountId && hasDate && parseMinor(values.priceMinor, values.currency) !== null && (values.valuationTarget === 'account' || hasInstrument));
  if (action === 'event' || action === 'correction') {
    if (!values.accountId || !hasDate) return false;
    const account = accountForEvent(accounts, values.accountId);
    if (!account || (eventRequiresHoldings(values.eventKind) && account.mode !== 'holdings')) return false;
    if (['opening_position', 'buy', 'sell'].includes(values.eventKind) && (!hasInstrument || parseQuantity(values.quantity) === null)) return false;
    if (values.eventKind === 'split' && (!hasInstrument || parseQuantity(values.quantity) === null || parseInteger(values.numerator) === null || parseInteger(values.denominator) === null)) return false;
    if (values.eventKind === 'transfer') {
      const destination = accountForEvent(accounts, values.toAccountId);
      const validAccounts = destination && destination.id !== account.id && destination.mode === account.mode;
      const positionTransfer = values.transferKind === 'position';
      return Boolean(validAccounts && (!positionTransfer || account.mode === 'holdings') && (positionTransfer ? hasInstrument && parseQuantity(values.quantity) !== null : parseMinor(values.amountMinor, values.currency) !== null));
    }
    return !['opening_cash', 'contribution', 'withdrawal', 'dividend', 'withholding', 'fee', 'transfer', 'buy', 'sell'].includes(values.eventKind) || parseMinor(values.amountMinor, values.currency) !== null;
  }
  if (action === 'quote-save') return values.quoteKey.trim().length > 0;
  if (action === 'quote-refresh') return hasInstrument;
  if (action === 'csv-preview') return values.csvText.trim().length > 0;
  if (action === 'csv-commit') return csvCommitReady(csv);
  return true;
};

function AccountKindPicker({ dark, values, setters }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters'>) {
  return <><Copy dark={dark} heading>Account kind</Copy><View style={styles.actionRow}>{['brokerage', 'manual_asset', 'debt', 'linked_bank'].map(kind => <Action key={kind} dark={dark} label={kind.replace('_', ' ')} selected={values.accountKind === kind} onPress={() => setters.setAccountKind(kind)}/>)}</View></>;
}

function AccountModePicker({ dark, values, setters }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters'>) {
  const aggregateOnly = values.accountKind !== 'brokerage';
  return <><Copy dark={dark} heading>Representation mode</Copy><View style={styles.actionRow}><Action dark={dark} label="Holdings (securities + cash)" selected={values.accountMode === 'holdings'} disabled={aggregateOnly} onPress={() => setters.setAccountMode('holdings')}/><Action dark={dark} label="Aggregate (one dated value)" selected={values.accountMode === 'aggregate'} onPress={() => setters.setAccountMode('aggregate')}/></View>{aggregateOnly ? <Copy dark={dark} muted>Manual assets, debts, and linked bank accounts stay aggregate. Only brokerage accounts can replay securities and cash holdings.</Copy> : null}</>;
}

function AccountLinkPicker({ dark, bankAccounts, values, setters }: Pick<OperationEditorProps, 'dark' | 'bankAccounts' | 'values' | 'setters'>) {
  if (values.accountKind !== 'linked_bank') return null;
  return <><Copy dark={dark} muted>Linked bank accounts stay aggregate and use a confirmed Activity account.</Copy>{bankAccounts.length ? <View style={styles.actionRow}>{bankAccounts.map(account => <Action key={account.id} dark={dark} label={`Link ${account.name}${account.institution ? ` · ${account.institution}` : ''}${account.currencies.length ? ` · ${account.currencies.join(', ')}` : ''}`} selected={values.linkedBankAccountId === account.id} onPress={() => { setters.setLinkedBankAccountId(account.id); setters.setCurrency(account.currencies[0] ?? values.currency); }}/>)}</View> : <Copy dark={dark} muted>No Activity accounts are available to link. Refresh Activity and try again.</Copy>}</>;
}

function OpeningPositionEditor({ dark, instruments, values, setters }: Pick<OperationEditorProps, 'dark' | 'instruments' | 'values' | 'setters'>) {
  const setField = <K extends keyof OpeningPositionValues>(key: K, value: OpeningPositionValues[K]) => setters.setOpeningPosition(current => ({ ...current, [key]: value }));
  const position = values.openingPosition;
  return <><Copy dark={dark} heading>Opening position (optional)</Copy><InstrumentFields dark={dark} options={instruments} exchange={position.exchange} ticker={position.ticker} type={position.type} currency={position.currency} setExchange={value => setField('exchange', value)} setTicker={value => setField('ticker', value)} setType={value => setField('type', value)} setCurrency={value => setField('currency', value)}/><Field dark={dark} label="Opening quantity" value={position.quantity} onChange={value => setField('quantity', value)}/><Field dark={dark} label="Opening basis (optional, for example 980.00)" value={position.basis} onChange={value => setField('basis', value)}/><Field dark={dark} label="Opening dated price (optional, for example 125.00)" value={position.price} onChange={value => setField('price', value)}/></>;
}

function AccountTransitionFields({ dark, instruments, values, setters }: Pick<OperationEditorProps, 'dark' | 'instruments' | 'values' | 'setters'>) {
  const transitioning = isAccountModeTransition(values);
  if (!transitioning && values.accountMode === 'aggregate') return <><Field dark={dark} label="Opening value (optional, for example 1250.00)" value={values.openingAmountMinor} onChange={setters.setOpeningAmountMinor}/><Field dark={dark} label="Opening date (YYYY-MM-DD)" value={values.effectiveDate} onChange={setters.setEffectiveDate}/><Copy dark={dark} muted>A dated opening value seeds the first aggregate Wealth observation. Leave the value blank when you will add a dated balance later.</Copy></>;
  if (!transitioning) return <Copy dark={dark} muted>Holdings accounts start without an opening amount here. Save the brokerage, then record dated Opening cash or Opening position activity so the server creates holdings history.</Copy>;
  return <><Copy dark={dark} heading>Atomic mode transition</Copy><Copy dark={dark} muted>The server records this effective-dated opening state in one account write. No follow-up event or valuation is submitted.</Copy><Field dark={dark} label="Effective date (YYYY-MM-DD)" value={values.effectiveDate} onChange={setters.setEffectiveDate}/>{values.accountMode === 'holdings' ? <><Field dark={dark} label="Opening cash (for example 1250.00)" value={values.openingAmountMinor} onChange={setters.setOpeningAmountMinor}/><OpeningPositionEditor dark={dark} instruments={instruments} values={values} setters={setters}/></> : <Field dark={dark} label="Opening aggregate value (for example 1250.00)" value={values.openingAmountMinor} onChange={setters.setOpeningAmountMinor}/>}</>;
}

function AccountEditor({ dark, accounts, bankAccounts, instruments, values, setters, onExistingAccount }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'bankAccounts' | 'instruments' | 'values' | 'setters' | 'onExistingAccount'>) {
  const startNew = () => { setters.setAccountId(''); setters.setAccountIdSuffix(newDraftId()); setters.setAccountName(''); setters.setAccountKind('brokerage'); setters.setAccountMode('holdings'); setters.setLinkedBankAccountId(''); setters.setOpeningAmountMinor(''); setters.setEffectiveDate(''); setters.setOpeningPosition(defaultOpeningPosition()); };
  return <><Copy dark={dark} heading>Existing account</Copy><AccountPicker dark={dark} accounts={accounts} selected={values.accountId} onSelect={id => onExistingAccount?.(id)}/><Action dark={dark} label="Start a new Wealth account" onPress={startNew}/><Field dark={dark} label="Account name" value={values.accountName} onChange={setters.setAccountName}/><Copy dark={dark} muted>The account identity is generated from this name; retries keep the same identity until a new account draft starts.</Copy><AccountKindPicker dark={dark} values={values} setters={setters}/><AccountModePicker dark={dark} values={values} setters={setters}/><AccountLinkPicker dark={dark} bankAccounts={bankAccounts} values={values} setters={setters}/><Field dark={dark} label="Account currency" value={values.currency} onChange={value => setters.setCurrency(value.toUpperCase())}/><AccountTransitionFields dark={dark} instruments={instruments} values={values} setters={setters}/></>;
}

function InstrumentEditor({ dark, values, setters, options = [] }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters'> & { options?: CanonicalInstrument[] }) {
  return <><Copy dark={dark} heading>Canonical instrument</Copy><InstrumentFields dark={dark} options={options} exchange={values.exchange} ticker={values.ticker} type={values.instrumentType} currency={values.currency} setExchange={setters.setExchange} setTicker={setters.setTicker} setType={setters.setInstrumentType} setCurrency={setters.setCurrency}/></>;
}

function ValuationEditor({ dark, accounts, instruments, values, setters }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'instruments' | 'values' | 'setters'>) {
  return <><Copy dark={dark} heading>Dated balance or price</Copy><View style={styles.actionRow}><Action dark={dark} label="Account balance" selected={values.valuationTarget === 'account'} onPress={() => setters.setValuationTarget('account')}/><Action dark={dark} label="Instrument price" selected={values.valuationTarget === 'instrument'} onPress={() => setters.setValuationTarget('instrument')}/></View><Copy dark={dark} heading>Account</Copy><AccountPicker dark={dark} accounts={accounts} selected={values.accountId} onSelect={setters.setAccountId}/>{values.valuationTarget === 'instrument' ? <InstrumentFields dark={dark} options={instruments} exchange={values.exchange} ticker={values.ticker} type={values.instrumentType} currency={values.currency} setExchange={setters.setExchange} setTicker={setters.setTicker} setType={setters.setInstrumentType} setCurrency={setters.setCurrency}/> : <Field dark={dark} label="Account currency" value={values.currency} onChange={value => setters.setCurrency(value.toUpperCase())}/>}<Field dark={dark} label="Dated observation (YYYY-MM-DD)" value={values.date} onChange={setters.setDate}/><Field dark={dark} label={values.valuationTarget === 'account' ? 'Balance (for example 1250.00)' : 'Price (for example 125.00)'} value={values.priceMinor} onChange={setters.setPriceMinor}/></>;
}

function QuoteEditor({ dark, values, setters, instruments, action }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters' | 'instruments'> & { action: string }) {
  if (action === 'quote-save') return <Field dark={dark} label="Optional Alpha Vantage quote key (kept in native memory)" value={values.quoteKey} onChange={setters.setQuoteKey} secure/>;
  return <><Copy dark={dark} heading>Instrument to refresh</Copy><InstrumentEditor dark={dark} options={instruments} values={values} setters={setters}/></>;
}

function CsvPreviewRow({ dark, row, accounts }: { dark: boolean; row: NonNullable<WealthWireSnapshot['csv']['previewRows']>[number]; accounts: WealthWireSnapshot['accounts'] }) {
  const account = row.accountId ? accounts.find(item => item.id === row.accountId)?.name ?? 'Account unavailable' : 'Account not provided';
  const state = row.error ? `Error: ${row.error}` : row.duplicateOf ? `Duplicate of ${row.duplicateOf}` : 'Ready';
  return <Copy dark={dark} key={row.rowId}>{`Row ${row.rowIndex + 1} · ${row.date ?? 'Date unavailable'} · ${row.kind ?? row.recordType ?? 'unmapped'} · ${account} · ${row.details ?? 'Details unavailable'} · ${state}`}</Copy>;
}

const defaultCanonicalHeaders = [
  'record_type', 'id', 'source_id', 'date', 'effective_date', 'kind', 'account_id', 'from_account_id', 'to_account_id',
  'from_mode', 'to_mode', 'opening_cash_minor', 'opening_value_minor', 'opening_positions_json', 'transition_json',
  'exchange', 'ticker', 'type', 'currency', 'quantity', 'amount_minor', 'price_minor', 'memo', 'linked_bank_source_id',
];

function CsvHeaderPicker({ dark, canonical, current, sourceHeaders, onChoose, onClose }: { dark: boolean; canonical: string | null; current: string | null | undefined; sourceHeaders: string[]; onChoose: (source: string | null) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!canonical) setQuery(''); }, [canonical]);
  if (!canonical) return null;
  const normalizedQuery = query.trim().toLowerCase();
  const matchingHeaders = sourceHeaders.filter(header => header.toLowerCase().includes(normalizedQuery));
  const headers = current && !matchingHeaders.includes(current) ? [current, ...matchingHeaders] : matchingHeaders;
  const colors = theme(dark);
  return <>
        <Copy dark={dark} heading>Choose source column</Copy>
        <Copy dark={dark} muted>{canonical}</Copy>
        <TextInput accessibilityLabel="Search source columns" value={query} onChangeText={setQuery} placeholder="Search source columns" placeholderTextColor={colors.muted} style={[styles.input, styles.mappingSearch, { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.canvas }]}/>
        <ScrollView accessibilityRole="list" accessibilityLabel={`Source columns for ${canonical}`} style={styles.mappingOptions} contentContainerStyle={styles.mappingOptionsContent} keyboardShouldPersistTaps="handled">
          <Action dark={dark} label={`Not mapped for ${canonical}`} selected={!current} onPress={() => onChoose(null)}/>
          {headers.map(source => <Action key={source} dark={dark} label={`${source} for ${canonical}`} selected={current === source} onPress={() => onChoose(source)}/>) }
          {!headers.length ? <Copy dark={dark} muted>No source columns match this search.</Copy> : null}
        </ScrollView>
        <Action dark={dark} label="Close source column picker" onPress={onClose}/>
  </>;
}

function CsvMappingDisclosure({ dark, expanded, matchedCount, total, onToggle }: { dark: boolean; expanded: boolean; matchedCount: number; total: number; onToggle: () => void }) {
  const colors = theme(dark);
  return <Pressable accessibilityRole="button" accessibilityLabel="Show CSV column mapping" accessibilityState={{ expanded }} onPress={onToggle} style={styles.mappingDisclosure}>
    <View style={styles.mappingDisclosureText}><Copy dark={dark} heading>Column mapping</Copy><Text style={[styles.mappingSummary, { color: colors.muted }]}>{matchedCount} of {total} fields matched · optional</Text></View>
    <Text style={[styles.mappingDisclosureAction, { color: colors.signal }]}>{expanded ? 'Hide' : 'Show'}</Text>
  </Pressable>;
}

function CsvMappingRows({ dark, canonicalHeaders, mapping, onSelect }: { dark: boolean; canonicalHeaders: string[]; mapping: WealthCsvMapping; onSelect: (canonical: string) => void }) {
  const colors = theme(dark);
  return <>{canonicalHeaders.map(canonical => {
    const current = mapping[canonical] ?? null;
    return <Pressable key={canonical} accessibilityRole="button" accessibilityLabel={`Choose source column for ${canonical}`} onPress={() => onSelect(canonical)} style={[styles.mappingSelector, { borderColor: colors.rule, backgroundColor: colors.canvas }]}>
      <Text style={[styles.mappingField, { color: colors.muted }]}>{canonical}</Text>
      <Text style={[styles.mappingCurrent, { color: colors.ink }]}>{current ?? 'Not mapped'}</Text>
    </Pressable>;
  })}</>;
}

function CsvMappingDetails({ dark, canonicalHeaders, mapping, onSelect, canRemap, onRemap }: { dark: boolean; canonicalHeaders: string[]; mapping: WealthCsvMapping; onSelect: (canonical: string) => void; canRemap: boolean; onRemap?: (mapping: WealthCsvMapping) => void }) {
  return <View style={styles.mappingExpanded}>
    <Copy dark={dark} muted>Use a custom mapping only when the selected file uses different headers. Choose one source column per field, then re-preview.</Copy>
    <CsvMappingRows dark={dark} canonicalHeaders={canonicalHeaders} mapping={mapping} onSelect={onSelect}/>
    <Action dark={dark} label="Re-preview mapped CSV" disabled={!canRemap} onPress={() => onRemap?.(mapping)}/>
  </View>;
}

function csvEditorMapping(csv: WealthWireSnapshot['csv'], mapping: WealthCsvMapping): WealthCsvMapping {
  const headers = new Set(csv.sourceHeaders ?? []);
  const canonicalHeaders = csv.canonicalHeaders?.length ? csv.canonicalHeaders : defaultCanonicalHeaders;
  const resolved: Record<string, string | null> = { ...mapping };
  canonicalHeaders.forEach(canonical => {
    if (resolved[canonical] === undefined && headers.has(canonical)) resolved[canonical] = canonical;
  });
  return resolved;
}

function CsvMappingPanel({dark, activeCanonical, mapping, sourceHeaders, canonicalHeaders, canRemap, choose, closePicker, close, onSelect, onRemap}: {dark:boolean; activeCanonical:string|null; mapping:WealthCsvMapping; sourceHeaders:string[]; canonicalHeaders:string[]; canRemap:boolean; choose:(source:string|null)=>void; closePicker:()=>void; close:()=>void; onSelect:(value:string)=>void; onRemap?:(mapping:WealthCsvMapping)=>void}) {
  const reducedMotion=useContext(ReducedMotionContext),colors=theme(dark);
  return <Modal transparent visible animationType={reducedMotion?'none':'fade'} onRequestClose={activeCanonical?closePicker:close}>
    <KeyboardAvoidingView behavior="padding" style={styles.mappingModalBackdrop}><View accessibilityViewIsModal style={[styles.mappingModal,{backgroundColor:colors.panel,borderColor:colors.rule}]}>
      {activeCanonical?<CsvHeaderPicker dark={dark} canonical={activeCanonical} current={mapping[activeCanonical]} sourceHeaders={sourceHeaders} onChoose={choose} onClose={closePicker}/>:<><Copy dark={dark} heading>Column mapping</Copy><ScrollView keyboardShouldPersistTaps="handled"><CsvMappingDetails dark={dark} canonicalHeaders={canonicalHeaders} mapping={mapping} onSelect={onSelect} canRemap={canRemap} onRemap={value=>{onRemap?.(value);close();}}/></ScrollView><Action dark={dark} label="Close column mapping" onPress={close}/></>}
    </View></KeyboardAvoidingView>
  </Modal>;
}

function CsvMappingEditor({ dark, csv, mapping, onChange, onRemap, canRemap }: { dark: boolean; csv: WealthWireSnapshot['csv']; mapping: WealthCsvMapping; onChange: (mapping: WealthCsvMapping) => void; onRemap?: (mapping: WealthCsvMapping) => void; canRemap: boolean }) {
  const sourceHeaders = csv.sourceHeaders ?? [];
  const canonicalHeaders = csv.canonicalHeaders?.length ? csv.canonicalHeaders : defaultCanonicalHeaders;
  const [expanded, setExpanded] = useState(false);
  const [activeCanonical, setActiveCanonical] = useState<string | null>(null);
  if (!sourceHeaders.length) return null;
  const matchedCount = canonicalHeaders.filter(canonical => typeof mapping[canonical] === 'string' && sourceHeaders.includes(mapping[canonical] as string)).length;
  const choose = (source: string | null) => {
    if (!activeCanonical) return;
    onChange({ ...mapping, [activeCanonical]: source });
    setActiveCanonical(null);
  };
  return <View style={[styles.mapping, { borderColor: theme(dark).rule, backgroundColor: theme(dark).panel }]}>
    <CsvMappingDisclosure dark={dark} expanded={expanded} matchedCount={matchedCount} total={canonicalHeaders.length} onToggle={() => setExpanded(value => !value)}/>
    {expanded ? <CsvMappingPanel dark={dark} activeCanonical={activeCanonical} mapping={mapping} sourceHeaders={sourceHeaders} canonicalHeaders={canonicalHeaders} canRemap={canRemap} choose={choose} closePicker={()=>setActiveCanonical(null)} close={()=>setExpanded(false)} onSelect={setActiveCanonical} onRemap={onRemap}/> : null}
  </View>;
}

function csvCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function CsvPreviewSummary({ dark, csv, onCommit, commitDisabled }: { dark: boolean; csv: WealthWireSnapshot['csv']; onCommit?: () => void; commitDisabled?: boolean }) {
  const errors = csvPreviewErrorCount(csv);
  const duplicates = csvPreviewDuplicateCount(csv);
  const validRows = csv.validRowIds?.length ?? 0;
  const hasPreview = Boolean(csv.previewId && csv.revision !== null && csv.revision !== undefined);
  const colors = theme(dark);
  return <View accessibilityRole="summary" style={[styles.csvSummary, { borderColor: colors.rule, backgroundColor: colors.panel }]}>
    <Copy dark={dark} heading>Preview status</Copy>
    <Copy dark={dark} muted>{hasPreview ? `${validRows} rows ready to commit · ${csv.rowCount} staged` : 'Choose a Wealth CSV file or preview pasted rows to continue.'}</Copy>
    {errors ? <Copy dark={dark} error>{csvCountLabel(errors, 'row error')} found. Fix the source or mapping before committing.</Copy> : null}
    {duplicates ? <Copy dark={dark} muted>{csvCountLabel(duplicates, 'duplicate candidate')} will stay excluded from this commit.</Copy> : null}
    {onCommit ? <Action dark={dark} label="Commit previewed Wealth CSV" disabled={Boolean(commitDisabled)} onPress={onCommit}/> : null}
  </View>;
}

function CsvEditor({ dark, accounts, csv, csvSourceOperationId, values, setters, onCsvImport, onCsvRemap, onCsvTemplate, action, onSubmit, submitDisabled }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'csv' | 'csvSourceOperationId' | 'values' | 'setters' | 'onCsvImport' | 'onCsvRemap' | 'onCsvTemplate' | 'onSubmit' | 'submitDisabled'> & { action: string }) {
  const [pasteExpanded, setPasteExpanded] = useState(false);
  const mapping = csvEditorMapping(csv, Object.keys(values.csvMapping).length ? values.csvMapping : csv.mapping ?? {});
  const colors = theme(dark);
  return <>
    <Copy dark={dark} heading>Import from file</Copy>
    <Copy dark={dark} muted>Select a CSV file or save the canonical template. Pasting rows is available below when a file picker is not convenient.</Copy>
    <View style={styles.actionRow}><Action dark={dark} label="Choose Wealth CSV file" disabled={!onCsvImport} onPress={() => onCsvImport?.()}/><Action dark={dark} label="Save Wealth CSV template" disabled={!onCsvTemplate} onPress={() => onCsvTemplate?.()}/></View>
    <CsvPreviewSummary dark={dark} csv={csv} onCommit={action === 'csv-commit' ? onSubmit : undefined} commitDisabled={submitDisabled}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Show paste CSV option" accessibilityState={{ expanded: pasteExpanded }} onPress={() => setPasteExpanded(value => !value)} style={styles.csvPasteDisclosure}>
      <Text style={[styles.mappingDisclosureAction, { color: colors.signal }]}>{pasteExpanded ? 'Hide' : 'Show'} paste CSV</Text>
      <Text style={[styles.mappingSummary, { color: colors.muted }]}>Optional fallback</Text>
    </Pressable>
    {pasteExpanded ? <Field dark={dark} label="Paste CSV rows" value={values.csvText} onChange={setters.setCsvText} multiline placeholder="record_type,id,source_id,date,kind,account_id,currency,amount_minor"/> : null}
    <CsvMappingEditor dark={dark} csv={csv} mapping={mapping} onChange={setters.setCsvMapping} onRemap={onCsvRemap} canRemap={Boolean(csvSourceOperationId && onCsvRemap)}/>
    <Copy dark={dark} muted>{csv.rowCount} rows staged · {csvPreviewErrorCount(csv)} errors · {csvPreviewDuplicateCount(csv)} duplicate candidates</Copy>
    {csv.previewRows?.slice(0, 25).map(row => <CsvPreviewRow dark={dark} key={row.rowId} row={row} accounts={accounts}/>)}
  </>;
}

function EventKindPicker({ dark, values, setters }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters'>) {
  return <><Copy dark={dark} heading>Replacement event type</Copy><View style={styles.actionRow}>{eventKinds.map(kind => <Action key={kind} dark={dark} label={kind.replaceAll('_', ' ')} selected={values.eventKind === kind} onPress={() => setters.setEventKind(kind)}/>)}</View></>;
}

function EventAccountFields({ dark, accounts, values, setters }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'values' | 'setters'>) {
  const requiresHoldings = eventRequiresHoldings(values.eventKind);
  return <><Copy dark={dark} heading>Account</Copy><Copy dark={dark} muted>{requiresHoldings ? 'This event is available only in a holdings account.' : 'Opening cash and cash transfers can use aggregate or holdings accounts.'}</Copy><AccountPicker dark={dark} accounts={accounts} selected={values.accountId} filter={account => !requiresHoldings || account.mode === 'holdings'} onSelect={setters.setAccountId}/><Field dark={dark} label="Event date (YYYY-MM-DD)" value={values.date} onChange={setters.setDate}/></>;
}

function EventInstrumentOrCurrency({ dark, instruments, values, setters }: Pick<OperationEditorProps, 'dark' | 'instruments' | 'values' | 'setters'>) {
  const positionTransfer = values.eventKind === 'transfer' && values.transferKind === 'position';
  return instrumentEventKinds.has(values.eventKind) || positionTransfer ? <InstrumentFields dark={dark} options={instruments} exchange={values.exchange} ticker={values.ticker} type={values.instrumentType} currency={values.currency} setExchange={setters.setExchange} setTicker={setters.setTicker} setType={setters.setInstrumentType} setCurrency={setters.setCurrency}/> : <Field dark={dark} label="Event currency" value={values.currency} onChange={value => setters.setCurrency(value.toUpperCase())}/>;
}

function EventValueFields({ dark, values, setters }: Pick<OperationEditorProps, 'dark' | 'values' | 'setters'>) {
  const needsQuantity = ['opening_position', 'buy', 'sell', 'split'].includes(values.eventKind) || (values.eventKind === 'transfer' && values.transferKind === 'position');
  const needsAmount = ['opening_cash', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal'].includes(values.eventKind) || (values.eventKind === 'transfer' && values.transferKind === 'cash');
  return <>{needsQuantity ? <Field dark={dark} label="Quantity" value={values.quantity} onChange={setters.setQuantity}/> : null}{needsAmount ? <Field dark={dark} label="Amount (for example 125.00)" value={values.amountMinor} onChange={setters.setAmountMinor}/> : null}{values.eventKind === 'split' ? <><Field dark={dark} label="Split numerator" value={values.numerator} onChange={setters.setNumerator}/><Field dark={dark} label="Split denominator" value={values.denominator} onChange={setters.setDenominator}/></> : null}</>;
}

function EventTransferFields({ dark, accounts, values, setters }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'values' | 'setters'>) {
  const source = accountForEvent(accounts, values.accountId);
  return values.eventKind === 'transfer' ? <><Copy dark={dark} heading>Transfer type</Copy><View style={styles.actionRow}><Action dark={dark} label="Cash transfer" selected={values.transferKind === 'cash'} onPress={() => setters.setTransferKind('cash')}/><Action dark={dark} label="Position transfer" selected={values.transferKind === 'position'} onPress={() => setters.setTransferKind('position')}/></View><Copy dark={dark} heading>Transfer destination</Copy><AccountPicker dark={dark} accounts={accounts} selected={values.toAccountId} filter={account => !source || account.mode === source.mode} onSelect={setters.setToAccountId}/></> : null;
}

function EventBankLinkFields({ dark, bankTransactions, values, setters, action }: Pick<OperationEditorProps, 'dark' | 'bankTransactions' | 'values' | 'setters'> & { action: 'event' | 'correction' }) {
  const showBankLink = bankLinkEventKinds.has(values.eventKind) || (action === 'correction' && Boolean(values.targetEvent?.linkedBankSourceId));
  if (!showBankLink) return null;
  return <><Copy dark={dark} heading>Bank record link</Copy>{action === 'correction' && values.targetEvent?.linkedBankSourceId ? <Copy dark={dark} muted>The existing bank link is preserved automatically; choose another confirmed record only if this correction replaces it.</Copy> : null}<BankTransactionPicker dark={dark} transactions={bankTransactions} selected={values.selectedBankTransaction} onSelect={setters.setSelectedBankTransaction}/></>;
}

function EventEditor({ dark, accounts, instruments, events, bankTransactions, values, setters, action }: Pick<OperationEditorProps, 'dark' | 'accounts' | 'instruments' | 'events' | 'bankTransactions' | 'values' | 'setters'> & { action: 'event' | 'correction' }) {
  const correction = action === 'correction';
  return <><Copy dark={dark} heading>{correction ? 'Choose the event to correct' : 'Event details'}</Copy>{correction ? <EventPicker dark={dark} events={events} selected={values.targetEvent} onSelect={setters.setTargetEvent}/> : null}<EventKindPicker dark={dark} values={values} setters={setters}/><EventAccountFields dark={dark} accounts={accounts} values={values} setters={setters}/><EventInstrumentOrCurrency dark={dark} instruments={instruments} values={values} setters={setters}/><EventValueFields dark={dark} values={values} setters={setters}/><EventTransferFields dark={dark} accounts={accounts} values={values} setters={setters}/><EventBankLinkFields dark={dark} bankTransactions={bankTransactions} values={values} setters={setters} action={action}/></>;
}

type EditorFactory = (props: OperationEditorProps & { action: string }) => React.ReactNode;

const operationEditors: Record<string, EditorFactory> = {
  account: props => <AccountEditor {...props}/>,
  instrument: props => <InstrumentEditor {...props}/>,
  valuation: props => <ValuationEditor {...props}/>,
  'quote-save': props => <QuoteEditor {...props} action="quote-save"/>,
  'quote-refresh': props => <QuoteEditor {...props} action="quote-refresh"/>,
  'csv-preview': props => <CsvEditor {...props}/>,
  'csv-commit': props => <CsvEditor {...props}/>,
  'csv-export': props => <CsvEditor {...props}/>,
  event: props => <EventEditor {...props} action="event"/>,
  correction: props => <EventEditor {...props} action="correction"/>,
  reversal: props => <><Copy dark={props.dark} heading>Choose the event to reverse</Copy><EventPicker dark={props.dark} events={props.events} selected={props.values.targetEvent} onSelect={props.setters.setTargetEvent}/><Field dark={props.dark} label="Reversal date (YYYY-MM-DD)" value={props.values.date} onChange={props.setters.setDate}/></>,
};

function OperationEditor(props: OperationEditorProps & { action: string }) {
  return operationEditors[props.action]?.(props) ?? null;
}

type InvestmentOperationProps = { dark: boolean; accounts: WealthWireSnapshot['accounts']; revision?: number | null; instruments: CanonicalInstrument[]; events: WealthEventRow[]; bankAccounts?: WealthBankAccount[]; bankTransactions?: WealthBankTransaction[]; initialAction?: string; csvSourceOperationId?: string | null; onCsvImport?: () => void; onCsvRemap?: (mapping: WealthCsvMapping) => void; onCsvTemplate?: () => void; onAction: (action: string, body?: string, draftId?: string) => void; quote: WealthWireSnapshot['quote']; csv: WealthWireSnapshot['csv'] };

function correctionBankTransaction(action: string, targetEvent: WealthEventRow | null, bankTransactions: WealthBankTransaction[]): WealthBankTransaction | null {
  if (action !== 'correction') return null;
  const linked = targetEvent?.linkedBankSourceId;
  return linked ? bankTransactions.find(transaction => transaction.id === linked) ?? null : null;
}

function useInvestmentOperationState(initialAction: string, accounts: WealthWireSnapshot['accounts'], bankTransactions: WealthBankTransaction[]) {
  const [action, setAction] = useState(initialAction);
  const [draftId] = useState(newDraftId);
  const [accountId, setAccountId] = useState('');
  const [accountIdSuffix, setAccountIdSuffix] = useState(newDraftId);
  const [accountName, setAccountName] = useState('');
  const [accountKind, setAccountKind] = useState('brokerage');
  const [accountMode, setAccountMode] = useState<'aggregate' | 'holdings'>('holdings');
  const [originalAccountMode, setOriginalAccountMode] = useState<'aggregate' | 'holdings' | null>(null);
  const [linkedBankAccountId, setLinkedBankAccountId] = useState('');
  const [openingAmountMinor, setOpeningAmountMinor] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [openingPosition, setOpeningPosition] = useState<OpeningPositionValues>(defaultOpeningPosition);
  const [currency, setCurrency] = useState('CAD');
  const [exchange, setExchange] = useState('TSX');
  const [ticker, setTicker] = useState('');
  const [instrumentType, setInstrumentType] = useState<'stock' | 'etf'>('stock');
  const [valuationTarget, setValuationTarget] = useState<'instrument' | 'account'>('instrument');
  const [date, setDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [priceMinor, setPriceMinor] = useState('');
  const [eventKind, setEventKind] = useState('opening_cash');
  const [targetEvent, setTargetEvent] = useState<WealthEventRow | null>(null);
  const [selectedBankTransaction, setSelectedBankTransaction] = useState<WealthBankTransaction | null>(null);
  const [numerator, setNumerator] = useState('');
  const [denominator, setDenominator] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [transferKind, setTransferKind] = useState<'cash' | 'position'>('cash');
  const [quoteKey, setQuoteKey] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvMapping, setCsvMapping] = useState<WealthCsvMapping>({});
  const changeAccountMode = (value: 'aggregate' | 'holdings') => {
    setAccountMode(value);
    if (value === 'aggregate' && !accountId && !effectiveDate) setEffectiveDate(todayIsoDate());
  };
  const changeAccountKind = (value: string) => {
    setAccountKind(value);
    if (value !== 'brokerage') {
      setAccountMode('aggregate');
      if (!accountId && !effectiveDate) setEffectiveDate(todayIsoDate());
    }
  };
  const values: OperationValues = { accountId, accountIdSuffix, accountName, accountKind, accountMode, originalAccountMode, linkedBankAccountId, openingAmountMinor, effectiveDate, openingPosition, currency, exchange, ticker, instrumentType, valuationTarget, date, quantity, amountMinor, priceMinor, eventKind, targetEvent, selectedBankTransaction, numerator, denominator, toAccountId, transferKind, quoteKey, csvText, csvMapping };
  const setters: OperationSetters = { setAccountId, setAccountIdSuffix, setAccountName, setAccountKind: changeAccountKind, setAccountMode: changeAccountMode, setLinkedBankAccountId, setOpeningAmountMinor, setEffectiveDate, setOpeningPosition, setCurrency, setExchange, setTicker, setInstrumentType, setValuationTarget, setDate, setQuantity, setAmountMinor, setPriceMinor, setEventKind, setTargetEvent, setSelectedBankTransaction, setNumerator, setDenominator, setToAccountId, setTransferKind, setQuoteKey, setCsvText, setCsvMapping };
  const selectAccount = (id: string) => {
    const account = accounts.find(item => item.id === id);
    setAccountId(id);
    if (!account) return;
    setAccountName(account.name);
    setAccountKind(account.kind);
    setAccountMode(account.mode);
    setOriginalAccountMode(account.mode);
    setCurrency(account.currency ?? currency);
    setLinkedBankAccountId(account.linkedBankAccountId ?? '');
    setEffectiveDate('');
    setOpeningPosition(defaultOpeningPosition());
    const amount = (account as WealthWireSnapshot['accounts'][number] & { amountMinor?: number | null }).amountMinor;
    setOpeningAmountMinor(amount === null || amount === undefined ? '' : (amount / 100).toFixed(2));
  };
  const chooseAction = (value: string) => { setAction(value); setTargetEvent(null); setSelectedBankTransaction(null); if (value === 'account') { setAccountId(''); setOriginalAccountMode(null); setEffectiveDate(''); setOpeningPosition(defaultOpeningPosition()); if (action !== 'account') setAccountIdSuffix(newDraftId()); } };
  useEffect(() => { setAction(initialAction); }, [initialAction]);
  useEffect(() => { if (accountKind !== 'brokerage') setAccountMode('aggregate'); }, [accountKind]);
  useEffect(() => {
    const match = correctionBankTransaction(action, targetEvent, bankTransactions);
    if (match && selectedBankTransaction?.id !== match.id) setSelectedBankTransaction(match);
  }, [action, bankTransactions, selectedBankTransaction?.id, targetEvent]);
  return { action, draftId, values, setters, chooseAction, selectAccount };
}

export function InvestmentOperations({ dark, accounts, revision, instruments, events, bankAccounts = [], bankTransactions = [], initialAction = 'account', csvSourceOperationId, onCsvImport, onCsvRemap, onCsvTemplate, onAction, quote, csv }: InvestmentOperationProps) {
  const colors = theme(dark);
  const { action, draftId, values, setters, chooseAction, selectAccount } = useInvestmentOperationState(initialAction, accounts, bankTransactions);
  const instrument = buildInstrument(values);
  const body = buildOperationBody(action, values, csv, instrument, revision);
  const canSubmit = canSubmitOperation(action, values, csv, instrument, accounts);
  const submit = () => onAction(action, body, draftId);
  return <View style={[styles.editor, { borderTopColor: colors.rule }]}>
    <Copy dark={dark} heading>Manage Wealth</Copy><Copy dark={dark} muted>Every save is append-only and recalculated by the server. Unknown basis or prices remain unavailable.</Copy>
    <View style={styles.actionRow}>{operationActions.map(value => <Action key={value} dark={dark} label={titleForAction[value]} selected={value === action} onPress={() => chooseAction(value)}/>)}</View>
    <OperationEditor dark={dark} accounts={accounts} bankAccounts={bankAccounts} revision={revision} instruments={instruments} events={events} bankTransactions={bankTransactions} quote={quote} csv={csv} values={values} setters={setters} onCsvImport={onCsvImport} onCsvRemap={onCsvRemap} onCsvTemplate={onCsvTemplate} csvSourceOperationId={csvSourceOperationId} onExistingAccount={selectAccount} onSubmit={submit} submitDisabled={!canSubmit} action={action}/>
    {action.startsWith('quote-') ? <><Copy dark={dark} muted>{quote.configured ? `Quote key configured${quote.lastRefreshedAt ? ` · refreshed ${quote.lastRefreshedAt}` : ''}` : 'No quote key configured. Manual dated prices remain available.'}</Copy>{quote.error ? <Copy dark={dark} error>Quote provider: {quote.error}</Copy> : null}</> : null}
    {action === 'csv-commit' ? null : <Action dark={dark} label={titleForAction[action]} disabled={!canSubmit} onPress={submit}/>}
  </View>;
}

type WealthCsvStateForEditor = WealthWireSnapshot['csv'];

function PerformanceSummary({ dark, data }: { dark: boolean; data: WealthWireSnapshot }) {
  const colors = theme(dark);
  const byCurrency = Object.entries(data.modifiedDietzByCurrency ?? {});
  const renderResult = (currency: string, result: WealthWireSnapshot['modifiedDietz'], singular: boolean) => <View key={currency} style={styles.actionRow}><Text style={[styles.performanceValue, { color: colors.ink }]}>{result.available && result.value !== null ? `${(result.value * 100).toFixed(2)}%` : 'Performance unavailable'}</Text><Text style={[styles.rowMeta, { color: colors.muted }]}>{singular ? (result.available ? 'Modified Dietz for the selected dated period' : 'Add complete start/end valuations and dated external flows.') : `${currency} · Modified Dietz for the selected dated period`}</Text></View>;
  return <View accessibilityRole="summary" style={[styles.performance, { borderColor: colors.rule, backgroundColor: colors.panel }]}>{byCurrency.length ? <><Copy dark={dark} heading>Performance by currency</Copy>{byCurrency.map(([currency, result]) => renderResult(currency, result, false))}</> : renderResult('', data.modifiedDietz, true)}</View>;
}

function cashFlowLabel(flow: WealthCashFlowRow): string {
  const value = flow.eventKind ?? flow.kind ?? flow.classification;
  return value.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());
}

function cashFlowDetails(flow: WealthCashFlowRow): string {
  return [flow.merchant, flow.accountName, flow.category, flow.status, flow.linkedWealthSourceId ? 'Linked bank record' : flow.source === 'wealth' ? 'Wealth ledger record' : null, flow.linkConflict ? 'Link needs review' : null].filter((value): value is string => Boolean(value)).join(' · ');
}

function CashFlowLane({ dark, title, flows }: { dark: boolean; title: string; flows: WealthCashFlowRow[] }) {
  const colors = theme(dark);
  return <View style={styles.cashFlowLane} accessibilityRole="list" accessibilityLabel={`${title} list`}>
    <Copy dark={dark} heading>{title}</Copy>
    {flows.map(flow => {
      const details = cashFlowDetails(flow);
      const value = `${money(flow.money.amountMinor, flow.money.currency)} · ${flow.includedInPerformance ? 'included' : 'excluded'} · ${flow.reason}${details ? ` · ${details}` : ''}`;
      return <View accessible accessibilityLabel={`${flow.date} · ${cashFlowLabel(flow)} · ${value}`} key={flow.sourceId} style={[styles.tableRow, { borderBottomColor: colors.rule }]}>
        <Text style={[styles.tableKey, { color: colors.ink }]}>{flow.date} · {cashFlowLabel(flow)}</Text>
        <Text style={[styles.tableValue, { color: colors.ink }]}>{value}</Text>
      </View>;
    })}
  </View>;
}

function InvestmentCashFlowTotals({ dark, totals }: { dark: boolean; totals: NonNullable<WealthWireSnapshot['investmentCashFlowTotals']> }) {
  const colors = theme(dark);
  const entries = Object.entries(totals);
  if (!entries.length) return null;
  return <View accessibilityRole="summary" style={[styles.investmentTotals, { borderColor: colors.rule, backgroundColor: colors.panel }]}>
    <Copy dark={dark} heading>Investment totals</Copy>
    {entries.map(([currency, value]) => <Text key={currency} style={[styles.rowMeta, { color: colors.ink }]}>{currency} · income {money(value.incomeMinor, currency)} · expenses {money(value.expenseMinor, currency)} · fees {money(value.feeMinor, currency)} · net {money(value.netMinor, currency)}</Text>)}
  </View>;
}

export function WealthCashFlow({ dark, data, periodStart = '', periodEnd = '', periodError = '', onPeriod, onAction }: { dark: boolean; data: WealthWireSnapshot; periodStart?: string; periodEnd?: string; periodError?: string; onPeriod?: (start: string, end: string) => void; onAction: (action: string, body?: string) => void }) {
  const colors = theme(dark);
  const [draftStart, setDraftStart] = useState(periodStart);
  const [draftEnd, setDraftEnd] = useState(periodEnd);
  const householdFlows = data.householdCashFlows ?? data.cashFlows;
  const investmentFlows = data.investmentCashFlows ?? [];
  const investmentTotals = data.investmentCashFlowTotals ?? {};
  const hasCashFlows = householdFlows.length > 0 || investmentFlows.length > 0 || Object.keys(investmentTotals).length > 0;
  useEffect(() => { setDraftStart(periodStart); setDraftEnd(periodEnd); }, [periodStart, periodEnd]);
  return <View style={styles.sectionGroup}>
    <Copy dark={dark} heading>Cash flow</Copy>
    <Copy dark={dark} muted>Only explicitly linked external flows affect performance. Ambiguous bank records stay visible and excluded.</Copy>
    <View style={styles.periodFields}><Field dark={dark} label="Period start (YYYY-MM-DD)" value={draftStart} onChange={setDraftStart}/><Field dark={dark} label="Period end (YYYY-MM-DD)" value={draftEnd} onChange={setDraftEnd}/><Action dark={dark} label="Load selected period" onPress={() => onPeriod?.(draftStart, draftEnd)}/>{periodError ? <Copy dark={dark} error>{periodError}</Copy> : null}</View>
    <PerformanceSummary dark={dark} data={data}/>
    {householdFlows.length ? <CashFlowLane dark={dark} title="Household cash flow" flows={householdFlows}/> : null}
    <InvestmentCashFlowTotals dark={dark} totals={investmentTotals}/>
    {investmentFlows.length ? <CashFlowLane dark={dark} title="Investment income and expenses" flows={investmentFlows}/> : null}
    {!hasCashFlows ? <Copy dark={dark} muted>No cash flows recorded yet.</Copy> : null}
    <View style={styles.actionRow}><Action dark={dark} label="Record contribution or withdrawal" onPress={() => onAction('event')}/><Action dark={dark} label="Refresh cash flow" onPress={() => onAction('refresh')}/></View>
  </View>;
}

export function WealthTabs({ dark, selected, onSelect }: { dark: boolean; selected: WealthView; onSelect: (view: WealthView) => void }) {
  return <View accessibilityRole="tablist" style={styles.tabs}>{(['overview', 'investments', 'cash-flow'] as WealthView[]).map(view => <Pressable key={view} accessibilityRole="tab" accessibilityLabel={view === 'cash-flow' ? 'Cash flow' : view[0].toUpperCase() + view.slice(1)} accessibilityState={{ selected: selected === view }} onPress={() => onSelect(view)} style={({ pressed }) => [styles.tab, { borderColor: theme(dark).rule, backgroundColor: selected === view ? (dark ? '#244C3D' : '#DEE7DE') : 'transparent', opacity: pressed ? 0.68 : 1 }]}><Text style={[styles.tabText, { color: selected === view ? theme(dark).signal : theme(dark).muted }]}>{view === 'cash-flow' ? 'Cash flow' : view[0].toUpperCase() + view.slice(1)}</Text></Pressable>)}</View>;
}

export function WealthLoading({ dark }: { dark: boolean }) { return <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading Wealth" color={theme(dark).signal}/><Copy dark={dark} muted>Loading your server-calculated Wealth report…</Copy></View>; }
export function WealthError({ dark, message, onRetry }: { dark: boolean; message: string; onRetry: () => void }) { return <View style={styles.error}><Copy dark={dark} error>{message || 'The Wealth service could not load this view.'}</Copy><Action dark={dark} label="Retry Wealth" onPress={onRetry}/></View>; }

const styles = StyleSheet.create({
  fxSummary: { gap: 5, borderWidth: 1, borderRadius: 14, padding: 16 }, fxTitle: { fontFamily: 'DMSans', fontSize: 14, lineHeight: 20 },
  sectionGroup: { gap: 12, paddingBottom: 28 }, heading: { fontFamily: 'Newsreader', fontSize: 23, lineHeight: 29, fontWeight: '600', marginTop: 10 }, copy: { fontFamily: 'DMSans', fontSize: 16, lineHeight: 24 }, status: { gap: 6, borderWidth: 1, borderRadius: 8, padding: 12 }, totalStrip: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 }, total: { gap: 3 }, totalValue: { fontFamily: 'IBMPlexMono', fontSize: 24, fontWeight: '600' }, totalLabel: { fontFamily: 'DMSans', fontSize: 14 }, table: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' }, tableRow: { padding: 12, gap: 4, borderBottomWidth: 1 }, cashFlowLane: { gap: 8, borderWidth: 1, borderRadius: 8, overflow: 'hidden' }, investmentTotals: { gap: 6, borderWidth: 1, borderRadius: 14, padding: 16 }, tableKey: { fontFamily: 'IBMPlexMono', fontSize: 14 }, tableValue: { fontFamily: 'DMSans', fontSize: 15, lineHeight: 22 }, chartGroup: { gap: 10 }, chart: { gap: 8, borderWidth: 1, borderRadius: 8, padding: 12 }, chartCaption: { fontFamily: 'DMSans', fontSize: 14, lineHeight: 20 }, chartRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, chartDate: { width: 88, fontFamily: 'IBMPlexMono', fontSize: 11 }, chartTrack: { flex: 1, height: 14, borderRadius: 4, overflow: 'hidden', justifyContent: 'center' }, chartBar: { height: 14, borderRadius: 4 }, chartUnavailable: { paddingHorizontal: 4, fontFamily: 'DMSans', fontSize: 11 }, detail: { gap: 8, borderWidth: 1, borderRadius: 14, padding: 16 }, periodFields: { gap: 8 }, mapping: { gap: 10, borderWidth: 1, borderRadius: 10, padding: 12 }, mappingDisclosure: { minHeight: 48, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, mappingDisclosureText: { flex: 1, gap: 2 }, mappingDisclosureAction: { fontFamily: 'DMSans', fontSize: 15, fontWeight: '700' }, mappingSummary: { fontFamily: 'DMSans', fontSize: 14, lineHeight: 20 }, mappingExpanded: { gap: 8 }, mappingSelector: { minHeight: 52, paddingVertical: 9, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, gap: 3 }, mappingField: { fontFamily: 'IBMPlexMono', fontSize: 13 }, mappingCurrent: { fontFamily: 'DMSans', fontSize: 16, lineHeight: 22 }, csvSummary: { gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 }, csvPasteDisclosure: { minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, mappingModalBackdrop: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: '#00000080' }, mappingModal: { maxHeight: '88%', gap: 10, borderWidth: 1, borderRadius: 14, padding: 16 }, mappingSearch: { marginTop: 4 }, mappingOptions: { maxHeight: 360 }, mappingOptionsContent: { gap: 8, paddingVertical: 4 }, mappingRow: { gap: 5 }, actionRow: { gap: 8 }, action: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' }, actionText: { fontFamily: 'DMSans', fontSize: 15, fontWeight: '600' }, accountRow: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#D2CCC0' }, portfolioRow: { gap: 10, paddingVertical: 14, borderBottomWidth: 1 }, rowCopy: { gap: 4 }, rowTitle: { fontFamily: 'DMSans', fontSize: 17, fontWeight: '600' }, rowMeta: { fontFamily: 'DMSans', fontSize: 14, lineHeight: 20 }, performance: { gap: 5, padding: 16, borderWidth: 1, borderRadius: 14 }, performanceValue: { fontFamily: 'IBMPlexMono', fontSize: 24, fontWeight: '600' }, editor: { gap: 10, paddingTop: 18, marginTop: 12, borderTopWidth: 1 }, field: { gap: 5 }, fieldLabel: { fontFamily: 'DMSans', fontSize: 14, lineHeight: 20 }, input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'DMSans', fontSize: 16 }, multiline: { minHeight: 112 }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, tab: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' }, tabText: { fontFamily: 'DMSans', fontSize: 15, fontWeight: '700' }, loading: { minHeight: 120, gap: 12, alignItems: 'center', justifyContent: 'center' }, error: { gap: 12, paddingVertical: 16 },
});
