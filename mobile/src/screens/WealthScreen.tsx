import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Operation } from '../features/finance/contracts';
import { WealthController } from '../features/wealth/WealthController';
import type { WealthBankAccount, WealthBankTransaction, WealthCsvMapping, WealthCsvState, WealthEventRow, WealthInvestmentDetail, WealthPorts, WealthService, WealthView, WealthWireSnapshot } from '../features/wealth/contracts';
import { nativeWealthPorts, nativeWealthService } from '../features/wealth/wealthService';
import { decodeWealthCsvPreview, decodeWealthEvents, decodeWealthQuoteSettings, decodeWealthValuations } from '../features/wealth/model';
import { WealthCashFlow, WealthError, WealthInvestments, WealthLoading, WealthOverview, WealthTabs } from '../features/wealth/WealthViews';

type Props = { dark: boolean; service?: WealthService; isFocused?: boolean };

let operationSequence = 0;
function operationId() {
  operationSequence += 1;
  return `wealth_${Date.now().toString(36)}_${operationSequence.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function portsFor(service?: WealthService): WealthPorts {
  if (!service) return nativeWealthPorts;
  return {
    read: service.read,
    startWrite: service.startWrite,
    startCsvImport: service.startCsvImport,
    startCsvTemplate: service.startCsvTemplate,
    startCsvRemap: service.startCsvRemap,
    readCsvPreview: service.readCsvPreview,
    readOperations: async (offset, limit) => [],
    queryOperation: async () => null,
    onChanged: service.onChanged ?? (() => ({ remove() {} })),
  };
}

let eventIdentitySequence = 0;
function newEventIdentity(action: string): string {
  eventIdentitySequence += 1;
  return `mobile-${action}-${Date.now().toString(36)}-${eventIdentitySequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DraftOperationIdentityRegistry {
  private readonly identities = new Map<string, string>();
  private readonly completed = new Set<string>();

  resolve(action: string, draftId?: string): string {
    if (!draftId) return newEventIdentity(action);
    const key = `${action}:${draftId}`;
    const existing = this.identities.get(key);
    if (existing && !this.completed.has(key)) return existing;
    const identity = newEventIdentity(action);
    this.identities.set(key, identity);
    this.completed.delete(key);
    return identity;
  }

  markCompleted(action: string, draftId?: string): void {
    if (draftId) this.completed.add(`${action}:${draftId}`);
  }
}

export function safeEventPayload(action: string, body: string, identity = newEventIdentity(action)): string {
  if (!['event', 'correction', 'reversal'].includes(action)) return body;
  const value = JSON.parse(body) as Record<string, unknown>;
  // The typed form never accepts source IDs. The screen supplies a draft-scoped
  // identity so a lost response can retry safely while a confirmed draft can
  // be submitted again as a distinct event. Revision is deliberately excluded
  // from the identity so a refreshed report can retry the same event.
  const eventIdentity = { id: identity, sourceId: identity };
  if (action === 'correction') return JSON.stringify({ ...value, ...eventIdentity, kind: 'correction' });
  if (action === 'reversal') return JSON.stringify({ ...value, ...eventIdentity, kind: 'reversal' });
  return JSON.stringify({ ...value, ...eventIdentity });
}

type WealthPeriod = { start: string; end: string };

function isDateOrEmpty(value: string): boolean {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validatePeriod({ start, end }: WealthPeriod): string {
  if (!isDateOrEmpty(start)) return 'Enter dates as YYYY-MM-DD.';
  if (!isDateOrEmpty(end)) return 'Enter dates as YYYY-MM-DD.';
  if (start === '') return '';
  if (end === '') return '';
  if (start > end) return 'The period start must be on or before the period end.';
  return '';
}

function detailTarget(body: string): { accountId: string; instrumentKey: string | null } | null {
  try {
    const target = JSON.parse(body) as { accountId?: unknown; instrumentKey?: unknown };
    if (typeof target.accountId !== 'string') return null;
    return { accountId: target.accountId, instrumentKey: typeof target.instrumentKey === 'string' ? target.instrumentKey : null };
  } catch {
    return null;
  }
}

const actionsOpeningInvestments = { valuation: true, event: true };
const actionsOpeningDetails = new Set(['open-account', 'open-instrument']);
const QUOTE_SUCCESS_STATUSES = new Set(['matched', 'cached', 'configured', 'removed', 'ok', 'refreshed', 'manual', 'stale', 'skipped']);

type WealthActionRouting = { refresh(): void; clearCsv(): void; openEditor(action: string): void; openDetail(body: string | undefined): void };

function routeWealthAction(action: string, body: string | undefined, routing: WealthActionRouting): boolean {
  if (action === 'refresh') { routing.refresh(); return true; }
  if (action === 'csv-preview') routing.clearCsv();
  if (body === undefined) {
    const editor = actionsOpeningInvestments[action as keyof typeof actionsOpeningInvestments];
    if (editor) { routing.openEditor(action); return true; }
  }
  if (actionsOpeningDetails.has(action)) { routing.openDetail(body); return true; }
  return false;
}

type WealthWriteRuntime = {
  controller: WealthController;
  operationIdentities: DraftOperationIdentityRegistry;
  refreshQuoteSettings: () => void;
  applyQuoteReceipt: (operation: Operation | null) => void;
  refreshInvestmentEvents: () => void;
  clearCsvPreview: () => void;
  setWriteError: (message: string | null) => void;
};

function isEventWrite(action: string): boolean {
  return action === 'event' || action === 'correction' || action === 'reversal';
}

function operationIdentityFor(action: string, draftId: string | undefined, runtime: WealthWriteRuntime): string | undefined {
  if (isEventWrite(action) || action === 'csv-export') return runtime.operationIdentities.resolve(action, draftId);
  return undefined;
}

export function decodeQuoteReceiptError(resultId: string | null): string | null {
  if (!resultId) return null;
  try {
    const receipt = JSON.parse(resultId) as { status?: unknown; reason?: unknown };
    const status = typeof receipt.status === 'string' ? receipt.status : '';
    const reason = typeof receipt.reason === 'string' ? receipt.reason : '';
    return reason || (status && !QUOTE_SUCCESS_STATUSES.has(status) ? `Quote provider status: ${status}.` : null);
  } catch {
    return null;
  }
}

export function decodeWealthWriteFailure(resultId: string | null, status = ''): string | null {
  if (resultId) {
    try {
      const receipt = JSON.parse(resultId) as { reason?: unknown; message?: unknown };
      const reason = typeof receipt.reason === 'string' ? receipt.reason.trim() : '';
      if (reason) return reason;
      const message = typeof receipt.message === 'string' ? receipt.message.trim() : '';
      if (message) return message;
    } catch {
      // Older native receipts may be plain provider strings; do not render them as server reasons.
    }
  }
  if (status === 'revision_conflict') return 'The Wealth data changed on the server. Refresh before saving.';
  if (status === 'rejected') return 'The server rejected this Wealth change. Review the current report and try again.';
  return null;
}

type WealthWriteCompletion = { action: string; draftId?: string; identity?: string; operation: Operation | null; runtime: WealthWriteRuntime };

function completeDraftIdentity(completion: WealthWriteCompletion, completed: boolean): void {
  if (!completed || !completion.identity) return;
  completion.runtime.operationIdentities.markCompleted(completion.action, completion.draftId);
}

function completeCsvCommit(completion: WealthWriteCompletion, completed: boolean): void {
  if (completed && completion.action === 'csv-commit') completion.runtime.clearCsvPreview();
}

function completeQuoteWrite(completion: WealthWriteCompletion): void {
  if (!completion.action.startsWith('quote-')) return;
  completion.runtime.applyQuoteReceipt(completion.operation);
  completion.runtime.refreshQuoteSettings();
}

function completeEventWrite(completion: WealthWriteCompletion): void {
  if (isEventWrite(completion.action)) completion.runtime.refreshInvestmentEvents();
}

function completeWealthWrite({ action, draftId, identity, operation, runtime }: WealthWriteCompletion): void {
  const completed = runtime.controller.mutation.current().status === 'completed';
  runtime.setWriteError(completed ? null : decodeWealthWriteFailure(operation?.resultId ?? null, operation?.status ?? runtime.controller.mutation.current().status));
  const completion = { action, draftId, identity, operation, runtime };
  completeDraftIdentity(completion, completed);
  completeCsvCommit(completion, completed);
  completeQuoteWrite(completion);
  completeEventWrite(completion);
}

function writeWealthAction(action: string, body: string | undefined, draftId: string | undefined, runtime: WealthWriteRuntime): void {
  runtime.setWriteError(null);
  const identity = operationIdentityFor(action, draftId, runtime);
  const payload = safeEventPayload(action, body ?? '{}', isEventWrite(action) ? identity : undefined);
  void runtime.controller.write(action, payload, identity ?? operationId()).then(operation => completeWealthWrite({ action, draftId, identity, operation, runtime }));
}

export function WealthScreen({ dark, service, isFocused = true }: Props) {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const ports = useMemo(() => portsFor(service), [service]);
  const controller = useMemo(() => new WealthController(ports, render), [ports]);
  const [selected, setSelected] = useState<WealthView>('overview');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [periodError, setPeriodError] = useState('');
  const [investmentOperation, setInvestmentOperation] = useState<string | undefined>();
  const [quoteSettings, setQuoteSettings] = useState<WealthWireSnapshot['quote'] | null>(null);
  const [investmentDetail, setInvestmentDetail] = useState<WealthInvestmentDetail | null>(null);
  const [bankTransactions, setBankTransactions] = useState<WealthBankTransaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<WealthBankAccount[]>([]);
  const [investmentEvents, setInvestmentEvents] = useState<WealthEventRow[] | null>(null);
  const [investmentEventsError, setInvestmentEventsError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [csvPreview, setCsvPreview] = useState<WealthCsvState | null>(null);
  const [csvSourceOperationId, setCsvSourceOperationId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState('');
  const [writeError, setWriteError] = useState<string | null>(null);
  const [detailBody, setDetailBody] = useState<string | null>(null);
  const detailService = service ?? nativeWealthService;
  const detailRequest = useRef(0);
  const detailOpen = useRef(false);
  const quoteRequest = useRef(0);
  const quoteReceiptError = useRef<string | null>(null);
  const bankTransactionsRequest = useRef(0);
  const bankAccountsRequest = useRef(0);
  const investmentEventsRequest = useRef(0);
  const pendingCsvImport = useRef<string | null>(null);
  const operationIdentities = useRef(new DraftOperationIdentityRegistry());

  const closeInvestmentDetail = () => {
    detailRequest.current += 1;
    setDetailBody(null);
    setInvestmentDetail(null);
    setDetailError('');
    setDetailLoading(false);
  };
  detailOpen.current = Boolean(detailBody || investmentDetail || detailLoading || detailError);

  const refreshQuoteSettings = () => {
    const readQuoteSettings = detailService.readQuoteSettings;
    if (!readQuoteSettings) return;
    const request = quoteRequest.current + 1;
    quoteRequest.current = request;
    void readQuoteSettings().then(raw => {
      if (quoteRequest.current === request) setQuoteSettings({ ...decodeWealthQuoteSettings(raw), error: quoteReceiptError.current });
    }).catch(() => { /* The report remains usable when quote settings are unavailable. */ });
  };

  const refreshBankTransactions = () => {
    const readBankTransactions = detailService.readBankTransactions;
    if (!readBankTransactions) return;
    const request = bankTransactionsRequest.current + 1;
    bankTransactionsRequest.current = request;
    void readBankTransactions().then(rows => {
      if (bankTransactionsRequest.current === request) setBankTransactions(rows);
    }).catch(() => {
      if (bankTransactionsRequest.current === request) setBankTransactions([]);
    });
  };

  const applyQuoteReceipt = (operation: Operation | null) => {
    quoteReceiptError.current = decodeQuoteReceiptError(operation?.resultId ?? null);
    setQuoteSettings(previous => previous ? { ...previous, error: quoteReceiptError.current } : previous);
  };

  const refreshBankAccounts = () => {
    const readBankAccounts = detailService.readBankAccounts;
    if (!readBankAccounts) return;
    const request = bankAccountsRequest.current + 1;
    bankAccountsRequest.current = request;
    void readBankAccounts().then(rows => {
      if (bankAccountsRequest.current === request) setBankAccounts(rows);
    }).catch(() => {
      if (bankAccountsRequest.current === request) setBankAccounts([]);
    });
  };

  const refreshInvestmentEvents = () => {
    const readEvents = detailService.readEvents;
    if (!readEvents) return;
    const request = investmentEventsRequest.current + 1;
    investmentEventsRequest.current = request;
    void readEvents(null).then(raw => {
      if (investmentEventsRequest.current === request) { setInvestmentEvents(decodeWealthEvents(raw) ?? []); setInvestmentEventsError(''); }
    }).catch(() => {
      if (investmentEventsRequest.current === request) setInvestmentEventsError('Event history is unavailable.');
    });
  };

  useEffect(() => {
    void controller.start();
    refreshQuoteSettings();
    refreshBankTransactions();
    refreshBankAccounts();
    refreshInvestmentEvents();
    const resume = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (controller.mutation.current().status !== 'saving') void controller.recover();
      void controller.load();
      refreshQuoteSettings();
      refreshBankTransactions();
      refreshBankAccounts();
      refreshInvestmentEvents();
    });
    return () => { resume.remove(); controller.dispose(); };
  }, [controller]);

  useEffect(() => {
    if (!isFocused) {
      if (detailOpen.current) closeInvestmentDetail();
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!detailOpen.current) return false;
      closeInvestmentDetail();
      return true;
    });
    return () => subscription.remove();
  }, [isFocused]);

  useEffect(() => {
    const onChanged = detailService.onChanged;
    if (!onChanged) return undefined;
    const subscription = onChanged(() => {
      const pending = pendingCsvImport.current;
      if (!pending) return;
      void controller.resumeCsvImport(pending).then(raw => {
        if (!raw || pendingCsvImport.current !== pending) return;
        pendingCsvImport.current = null;
        setCsvPreview(decodeWealthCsvPreview(raw));
      });
    });
    return () => subscription.remove();
  }, [controller, detailService]);

  const chooseView = (view: WealthView) => {
    setSelected(view);
    if (view !== 'investments') setInvestmentOperation(undefined);
    if (view === 'investments') refreshInvestmentEvents();
    if (view === 'cash-flow') void controller.load({ view, asOf: periodEnd || null, periodStart: periodStart || null, periodEnd: periodEnd || null });
    else void controller.selectView(view);
  };

  const choosePeriod = (start: string, end: string) => {
    setPeriodStart(start);
    setPeriodEnd(end);
    const error = validatePeriod({ start, end });
    setPeriodError(error);
    if (error) return;
    void controller.load({ view: 'cash-flow', asOf: end || null, periodStart: start || null, periodEnd: end || null });
  };

  const loadInvestmentDetail = (body: string) => {
    const target = detailTarget(body);
    if (!target) return;
    const readEvents = detailService.readEvents;
    if (!readEvents) { setDetailError('Event history is unavailable. Retry after refreshing the Wealth report.'); return; }
    const readValuations = detailService.readValuations;
    if (!readValuations) { setDetailError('Dated value history is unavailable. Retry after refreshing the Wealth report.'); return; }
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    setDetailBody(body);
    setDetailError('');
    setDetailLoading(true);
    void Promise.all([readEvents(target.accountId), readValuations(target.accountId)])
      .then(([events, valuations]) => {
        if (detailRequest.current !== request) return;
        setInvestmentDetail({ accountId: target.accountId, instrumentKey: target.instrumentKey, events: decodeWealthEvents(events) ?? [], valuations: decodeWealthValuations(valuations) });
      })
      .catch(() => { if (detailRequest.current === request) setDetailError('History could not be loaded. Retry to fetch server events and dated values.'); })
      .finally(() => { if (detailRequest.current === request) setDetailLoading(false); });
  };

  const startCsvImport = () => {
    const id = operationId();
    pendingCsvImport.current = id;
    void controller.importCsv(id).then(raw => {
      if (pendingCsvImport.current !== id) return;
      if (raw) {
        pendingCsvImport.current = null;
        setCsvSourceOperationId(id);
        setCsvPreview(decodeWealthCsvPreview(raw));
      } else if (controller.mutation.current().status !== 'reconciliation_required') {
        pendingCsvImport.current = null;
      }
    });
  };

  const remapCsv = (mapping: WealthCsvMapping) => {
    const source = csvSourceOperationId;
    const operation = operationId();
    if (!source) return;
    pendingCsvImport.current = operation;
    void controller.remapCsv(source, operation, mapping).then(raw => {
      if (pendingCsvImport.current !== operation) return;
      pendingCsvImport.current = null;
      if (raw) setCsvPreview(decodeWealthCsvPreview(raw));
    });
  };

  const saveCsvTemplate = () => { void controller.saveCsvTemplate(operationId()); };

  const onAction = (action: string, body?: string, draftId?: string) => {
    const routed = routeWealthAction(action, body, {
      refresh: () => { void controller.load(); },
      clearCsv: () => setCsvPreview(null),
      openEditor: operation => { setInvestmentOperation(operation); chooseView('investments'); },
      openDetail: detail => { setInvestmentOperation(undefined); setInvestmentDetail(null); chooseView('investments'); if (detail) loadInvestmentDetail(detail); },
    });
    if (routed) return;
    setInvestmentOperation(undefined);
    writeWealthAction(action, body, draftId, { controller, operationIdentities: operationIdentities.current, refreshQuoteSettings, applyQuoteReceipt, refreshInvestmentEvents, clearCsvPreview: () => setCsvPreview(null), setWriteError });
  };

  const state = controller.state.current();
  const data = state.data;
  const mutation = controller.mutation.current();
  const message = controller.message();
  const retry = () => { void controller.load(); };

  return <View style={styles.root}>
    {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.message, { color: dark ? '#FFB4AB' : '#A83F3F' }]}>{message}</Text> : null}
    {!data && state.phase === 'loading' ? <WealthLoading dark={dark}/> : null}
    {!data && state.phase !== 'loading' ? <WealthError dark={dark} message={state.message ?? message} onRetry={retry}/> : null}
    {data ? <>
      <WealthTabs dark={dark} selected={selected} onSelect={chooseView}/>
      {selected !== 'overview' ? <Pressable accessibilityRole="button" accessibilityLabel="Open Wealth Overview" onPress={() => chooseView('overview')} style={styles.overviewLink}><Text style={[styles.overviewLinkText, { color: dark ? '#83C9B1' : '#1B6B5B' }]}>Overview</Text></Pressable> : null}
      {selected === 'overview' ? <WealthOverview dark={dark} data={data} onAction={onAction}/> : null}
      {selected === 'investments' ? <WealthInvestments dark={dark} data={data} revision={data.revision} events={investmentEvents ?? data.events} eventsError={investmentEventsError} bankAccounts={bankAccounts} bankTransactions={bankTransactions} quote={quoteSettings ?? data.quote} csv={csvPreview ?? data.csv} csvSourceOperationId={csvSourceOperationId} detail={investmentDetail} detailError={detailError} detailLoading={detailLoading} operation={investmentOperation} onCsvImport={detailService.startCsvImport ? startCsvImport : undefined} onCsvRemap={detailService.startCsvRemap ? remapCsv : undefined} onCsvTemplate={detailService.startCsvTemplate ? saveCsvTemplate : undefined} onRetryDetail={() => { if (detailBody) loadInvestmentDetail(detailBody); }} onRetryEvents={refreshInvestmentEvents} onCloseDetail={closeInvestmentDetail} onAction={onAction}/> : null}
      {selected === 'cash-flow' ? <WealthCashFlow dark={dark} data={data} periodStart={periodStart} periodEnd={periodEnd} periodError={periodError} onPeriod={choosePeriod} onAction={onAction}/> : null}
      {writeError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.mutation, { color: dark ? '#FFB4AB' : '#A83F3F' }]}>Wealth save could not be applied: {writeError}</Text> : null}
      {mutation.status !== 'ready' && mutation.status !== 'checking' ? <Text accessibilityLiveRegion="polite" style={[styles.mutation, { color: mutation.status === 'completed' ? (dark ? '#83C9B1' : '#1B6B5B') : (dark ? '#FFB4AB' : '#A83F3F') }]}>{mutation.status === 'saving' ? 'Saving Wealth change…' : mutation.status === 'completed' ? 'Saved. Refreshing server-calculated Wealth…' : `Wealth action ${mutation.status.replaceAll('_', ' ')}. Review the current report before retrying.`}</Text> : null}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingTop: 4 },
  message: { fontFamily: 'DMSans', fontSize: 15, lineHeight: 22 },
  mutation: { fontFamily: 'DMSans', fontSize: 15, lineHeight: 22, paddingVertical: 8 },
  overviewLink: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },
  overviewLinkText: { fontFamily: 'DMSans', fontSize: 15, fontWeight: '700' },
});
