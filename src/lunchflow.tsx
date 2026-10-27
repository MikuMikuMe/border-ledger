import {connectionApi,type LunchFlowConnection} from './domain/lunchflow-connection';
import {LunchFlowConnectionControls,useLunchFlowConnection} from './components/LunchFlowConnectionControls';
import { useLedgerApi } from './components/PrivateSession';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BadgeCheck, CircleAlert, CircleHelp, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { LedgerApiError, type LedgerApi } from './domain/api';
import { getCurrencyMeta } from './domain/currencies';

export type LunchFlowKind = 'chequing' | 'savings' | 'credit';

export interface LunchFlowAccount {
  providerAccountId: string;
  name: string;
  institution: string;
  currencies: string[];
  selected: boolean;
  accountId: string | null;
  kind: LunchFlowKind | null;
  currency: string | null;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

interface LunchFlowDraft {
  selected: boolean;
  currency: string;
  kind: LunchFlowKind | '';
}

interface LunchFlowResponse {
  configured: boolean;
  accounts: LunchFlowAccount[];
}

interface LunchFlowNotice {
  tone: 'success' | 'info' | 'error';
  message: string;
}

interface LunchFlowSectionProps {
  onWorkspaceRefresh?: () => Promise<void> | void;
}

interface LunchFlowSelectionResponse {
  selected: number;
  queued: boolean;
}

interface LunchFlowSyncResponse {
  queued: boolean;
  accounts: number;
}

interface LunchFlowSyncBaseline {
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

const lunchFlowKinds: Array<{ value: LunchFlowKind; label: string }> = [
  { value: 'chequing', label: 'Chequing' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit' },
];

const lunchFlowPollIntervalMs = 500;
const lunchFlowPollDeadlineMs = 10_000;

function isLunchFlowKind(value: unknown): value is LunchFlowKind {
  return value === 'chequing' || value === 'savings' || value === 'credit';
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readCurrencies(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((currency): currency is string => typeof currency === 'string' && currency.length > 0 && getCurrencyMeta(currency) !== null))];
}

function normalizedAccountCurrency(value: unknown) {
  const currency = stringOrNull(value);
  if (!currency) return null;
  return getCurrencyMeta(currency) ? currency : null;
}

function hasRequiredAccountFields(values: [string | null, string | null, string | null]): values is [string, string, string] {
  return values.every((field) => field !== null);
}

function mapLunchFlowAccount(value: unknown): LunchFlowAccount | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const providerAccountId = stringOrNull(record.providerAccountId);
  const name = stringOrNull(record.name);
  const institution = stringOrNull(record.institution);
  const requiredFields: [string | null, string | null, string | null] = [providerAccountId, name, institution];
  if (!hasRequiredAccountFields(requiredFields)) return null;
  const [safeProviderAccountId, safeName, safeInstitution] = requiredFields;
  const currencies = readCurrencies(record.currencies);
  const currency = normalizedAccountCurrency(record.currency);
  if (currency && !currencies.includes(currency)) currencies.push(currency);
  return {
    providerAccountId: safeProviderAccountId,
    name: safeName,
    institution: safeInstitution,
    currencies,
    selected: record.selected === true,
    accountId: stringOrNull(record.accountId),
    kind: isLunchFlowKind(record.kind) ? record.kind : null,
    currency,
    lastSyncedAt: stringOrNull(record.lastSyncedAt),
    lastAttemptAt: stringOrNull(record.lastAttemptAt),
    lastError: stringOrNull(record.lastError),
  };
}

function mapLunchFlowResponse(value: unknown): LunchFlowResponse | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.configured !== 'boolean' || !Array.isArray(record.accounts)) return null;
  return {
    configured: record.configured,
    accounts: record.accounts.map(mapLunchFlowAccount).filter((account): account is LunchFlowAccount => account !== null),
  };
}

async function fetchLunchFlowAccounts(ledgerApi: LedgerApi, status?: 'local') {
  const path = status === 'local' ? '/api/lunchflow/accounts?status=local' : '/api/lunchflow/accounts';
  const response = mapLunchFlowResponse(await ledgerApi<unknown>(path));
  if (!response) throw new Error('The Lunch Flow account response was incomplete.');
  return response;
}

function mergeLunchFlowStatus(discovery: LunchFlowResponse, local: LunchFlowResponse): LunchFlowResponse {
  const localById = new Map(local.accounts.map((account) => [account.providerAccountId, account]));
  const discoveryIds = new Set(discovery.accounts.map((account) => account.providerAccountId));
  const accounts = discovery.accounts.map((account) => {
    const status = localById.get(account.providerAccountId);
    if (!status) return account;
    return {
      ...account,
      selected: status.selected,
      accountId: status.accountId,
      kind: status.kind,
      currency: status.currency,
      lastSyncedAt: status.lastSyncedAt,
      lastAttemptAt: status.lastAttemptAt,
      lastError: status.lastError,
    };
  });
  for (const account of local.accounts) {
    if (!discoveryIds.has(account.providerAccountId)) accounts.push(account);
  }
  return { configured: discovery.configured, accounts };
}

function draftForAccount(account: LunchFlowAccount): LunchFlowDraft {
  return {
    selected: account.selected,
    // A null key currency stays empty. The account can only use a currency
    // that Lunch Flow returned from its observed transaction rows.
    currency: account.currency ?? '',
    kind: account.kind ?? '',
  };
}

function draftsForAccounts(accounts: LunchFlowAccount[]) {
  return Object.fromEntries(accounts.map((account) => [account.providerAccountId, draftForAccount(account)]));
}

function accountTimestamp(value: string | null) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Not synced yet';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function lunchFlowErrorMessage(error: unknown) {
  if (error instanceof LedgerApiError && error.status === 401) return 'This private connection needs Cloudflare Access before Lunch Flow can open.';
  if (error instanceof LedgerApiError && error.status === 404) return 'The Worker does not have the Lunch Flow route yet.';
  if (error instanceof Error && error.message) return error.message;
  return 'Lunch Flow could not complete that request. Try again.';
}

function accountCountLabel(count: number) {
  return `${count} account${count === 1 ? '' : 's'}`;
}

function safeCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

interface LunchFlowSyncProgress {
  state: 'advanced' | 'pending' | 'failed';
  failedAccount?: LunchFlowAccount;
}

function syncProgress(accounts: LunchFlowAccount[], providerAccountIds: string[], baseline: ReadonlyMap<string, LunchFlowSyncBaseline>): LunchFlowSyncProgress {
  const accountsById = new Map(accounts.map((account) => [account.providerAccountId, account]));
  const failedAccount = providerAccountIds
    .map((providerAccountId) => accountsById.get(providerAccountId))
    .find((account) => hasNewProviderError(account, baseline));
  if (failedAccount) return { state: 'failed', failedAccount };
  const everyAccountSynced = providerAccountIds.length > 0 && providerAccountIds.every((providerAccountId) => accountSyncedSinceBaseline(accountsById.get(providerAccountId), baseline.get(providerAccountId)));
  return { state: everyAccountSynced ? 'advanced' : 'pending' };
}

function hasNewProviderError(account: LunchFlowAccount | undefined, baseline: ReadonlyMap<string, LunchFlowSyncBaseline>) {
  if (!account?.lastError) return false;
  const previous = baseline.get(account.providerAccountId);
  const errorChanged = account.lastError !== (previous?.lastError ?? null);
  const attemptChanged = account.lastAttemptAt !== (previous?.lastAttemptAt ?? null);
  return errorChanged || attemptChanged;
}

function accountSyncedSinceBaseline(account: LunchFlowAccount | undefined, previous: LunchFlowSyncBaseline | undefined) {
  return Boolean(account?.lastSyncedAt && account.lastSyncedAt !== (previous?.lastSyncedAt ?? null));
}

function invalidSelectionAccount(accounts: LunchFlowAccount[], drafts: Record<string, LunchFlowDraft>) {
  return accounts.find((account) => {
    const draft = drafts[account.providerAccountId];
    return !draft?.currency || !account.currencies.includes(draft.currency) || getCurrencyMeta(draft.currency) === null || !draft.kind;
  });
}

function selectionOutcome(response: LunchFlowSelectionResponse, selectedCount: number) {
  if (response.queued && selectedCount > 0) {
    return {
      poll: true,
      pendingMessage: `Lunch Flow selection saved for ${accountCountLabel(selectedCount)}. This page shows the last known data until the queued sync completes. Waiting for completion…`,
      notice: null,
    } as const;
  }
  if (!response.queued && selectedCount > 0) {
    return {
      poll: false,
      pendingMessage: null,
      notice: { tone: 'error' as const, message: `Lunch Flow selection saved for ${accountCountLabel(selectedCount)}. The server did not queue a sync, so no new data was imported.` },
    } as const;
  }
  return {
    poll: false,
    pendingMessage: null,
    notice: { tone: 'info' as const, message: `Lunch Flow selection saved for ${accountCountLabel(selectedCount)}. Existing Lunch Flow history stays in the ledger; no sync was queued.` },
  } as const;
}

interface LunchFlowPollingDependencies {
  api: LedgerApi;
  providerAccountIds: string[];
  baseline: ReadonlyMap<string, LunchFlowSyncBaseline>;
  operationId: number;
  pendingMessage: string;
  isCurrentOperation: (operationId: number) => boolean;
  applyResponse: (response: LunchFlowResponse, mode?: 'discovery' | 'local') => void;
  notifyWorkspaceRefresh: () => Promise<boolean>;
  setNotice: (notice: LunchFlowNotice) => void;
  pollTimerRef: { current: number | null };
}

type LunchFlowPollResult = 'advanced' | 'pending' | 'stopped' | 'error' | 'failed';

async function reassertNoticeAfterWorkspaceRefresh(dependencies: LunchFlowPollingDependencies, tone: LunchFlowNotice['tone'], message: string) {
  const workspaceRefreshed = await dependencies.notifyWorkspaceRefresh();
  if (workspaceRefreshed && dependencies.isCurrentOperation(dependencies.operationId)) dependencies.setNotice({ tone, message });
}

function failedSyncMessage(account: LunchFlowAccount | undefined) {
  return `Lunch Flow sync failed for ${account?.name ?? 'a selected account'}: ${account?.lastError ?? 'The provider reported an error.'}`;
}

async function completeQueuedSync(response: LunchFlowResponse, progress: LunchFlowSyncProgress, dependencies: LunchFlowPollingDependencies): Promise<LunchFlowPollResult> {
  dependencies.applyResponse(response, 'local');
  if (progress.state === 'failed') {
    const message = failedSyncMessage(progress.failedAccount);
    dependencies.setNotice({ tone: 'error', message });
    await reassertNoticeAfterWorkspaceRefresh(dependencies, 'error', message);
    return 'failed';
  }
  dependencies.setNotice({ tone: 'success', message: 'Lunch Flow sync completed. Refreshing the ledger…' });
  await reassertNoticeAfterWorkspaceRefresh(dependencies, 'success', 'Lunch Flow sync completed and the ledger was refreshed.');
  return 'advanced';
}

async function reportQueuedSyncError(error: unknown, dependencies: LunchFlowPollingDependencies): Promise<LunchFlowPollResult> {
  if (!dependencies.isCurrentOperation(dependencies.operationId)) return 'error';
  const message = `Lunch Flow sync status could not be checked: ${lunchFlowErrorMessage(error)}`;
  dependencies.setNotice({ tone: 'error', message });
  await reassertNoticeAfterWorkspaceRefresh(dependencies, 'error', message);
  return 'error';
}

function waitForPollInterval(pollTimerRef: { current: number | null }, milliseconds: number) {
  return new Promise<void>((resolve) => {
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      resolve();
    }, milliseconds);
  });
}

async function checkQueuedSync(dependencies: LunchFlowPollingDependencies): Promise<LunchFlowPollResult> {
  try {
    const response = await fetchLunchFlowAccounts(dependencies.api, 'local');
    if (!dependencies.isCurrentOperation(dependencies.operationId)) return 'stopped';
    const progress = syncProgress(response.accounts, dependencies.providerAccountIds, dependencies.baseline);
    if (progress.state === 'pending') return 'pending';
    return completeQueuedSync(response, progress, dependencies);
  } catch (error) {
    return reportQueuedSyncError(error, dependencies);
  }
}

async function waitForQueuedSyncTask({ api, providerAccountIds, baseline, operationId, pendingMessage, isCurrentOperation, applyResponse, notifyWorkspaceRefresh, setNotice, pollTimerRef }: LunchFlowPollingDependencies) {
  if (!isCurrentOperation(operationId)) return;
  setNotice({ tone: 'info', message: pendingMessage });
  const deadline = Date.now() + lunchFlowPollDeadlineMs;
  while (isCurrentOperation(operationId)) {
    const remainingBeforeCheck = deadline - Date.now();
    if (remainingBeforeCheck <= 0) break;
    await waitForPollInterval(pollTimerRef, Math.min(lunchFlowPollIntervalMs, remainingBeforeCheck));
    if (!isCurrentOperation(operationId)) return;
    const result = await checkQueuedSync({ api, providerAccountIds, baseline, operationId, pendingMessage, isCurrentOperation, applyResponse, notifyWorkspaceRefresh, setNotice, pollTimerRef });
    if (result !== 'pending') return;
  }
  if (!isCurrentOperation(operationId)) return;
  const workspaceRefreshed = await notifyWorkspaceRefresh();
  if (workspaceRefreshed && isCurrentOperation(operationId)) setNotice({ tone: 'info', message: 'Lunch Flow sync is still pending. The page keeps last-known data; use Refresh to check again.' });
}

function useLunchFlowLifecycle() {
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  return { mountedRef, operationRef, pollTimerRef };
}

function applyLunchFlowResponse(response: LunchFlowResponse, mountedRef: { current: boolean }, setConfigured: (value: boolean) => void, setAccounts: (value: LunchFlowAccount[]) => void, setDrafts: (value: Record<string, LunchFlowDraft>) => void, setLoadState: (value: 'loading' | 'ready' | 'error') => void, setLoadError: (value: string | null) => void) {
  if (!mountedRef.current) return;
  setConfigured(response.configured);
  setAccounts(response.accounts);
  setDrafts(draftsForAccounts(response.accounts));
  setLoadState('ready');
  setLoadError(null);
}

async function loadLunchFlowAccounts(api: LedgerApi, mountedRef: { current: boolean }, applyResponse: (response: LunchFlowResponse, mode?: 'discovery' | 'local') => void, setLoadState: (value: 'loading' | 'ready' | 'error') => void, setLoadError: (value: string | null) => void) {
  if (mountedRef.current) {
    setLoadState('loading');
    setLoadError(null);
  }
  try {
    const response = await fetchLunchFlowAccounts(api);
    applyResponse(response);
    return response;
  } catch (error) {
    if (mountedRef.current) {
      setLoadState('error');
      setLoadError(lunchFlowErrorMessage(error));
    }
    throw error;
  }
}

async function notifyWorkspaceRefreshTask(onWorkspaceRefresh: LunchFlowSectionProps['onWorkspaceRefresh'], mountedRef: { current: boolean }, setNotice: (notice: LunchFlowNotice) => void): Promise<boolean> {
  if (!onWorkspaceRefresh) return true;
  try {
    await onWorkspaceRefresh();
    return true;
  } catch (error) {
    if (mountedRef.current) setNotice({ tone: 'error', message: `Lunch Flow data saved, but the ledger could not refresh: ${lunchFlowErrorMessage(error)}` });
    return false;
  }
}

function useBoundConnectionApi(api:LedgerApi,connection:LunchFlowConnection|null) {
  const {connectionId,generation,connected}=connection??{};
  // Status-only refreshes must retain the account loader and its unsaved drafts.
  return useMemo(()=>connection?.connected?connectionApi(api,connection):null,[api,connectionId,generation,connected]);
}

export function LunchFlowSection({onWorkspaceRefresh}:LunchFlowSectionProps) {
  const api=useLedgerApi(),{connection,error,refresh}=useLunchFlowConnection(api);
  const bound=useBoundConnectionApi(api,connection);
  return <section className="panel lunchflow-panel" aria-label="Lunch Flow connection">
    <h2>Lunch Flow</h2><LunchFlowConnectionControls api={api} value={connection} error={error} refresh={refresh}/>
    {bound&&connection?<LunchFlowAccountsSection key={`${connection.connectionId}:${connection.generation}`} api={bound} onWorkspaceRefresh={onWorkspaceRefresh}/>:null}
  </section>;
}
function LunchFlowAccountsSection({ onWorkspaceRefresh,api:ledgerApi }: LunchFlowSectionProps&{api:LedgerApi}) {
  const [accounts, setAccounts] = useState<LunchFlowAccount[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LunchFlowDraft>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'save' | 'sync' | null>(null);
  const [notice, setNotice] = useState<LunchFlowNotice | null>(null);
  const { mountedRef, operationRef, pollTimerRef } = useLunchFlowLifecycle();
  const appliedResponseRef = useRef<LunchFlowResponse | null>(null);
  const workspaceRefreshRef = useRef(onWorkspaceRefresh);
  const workspaceRefreshStartedRef = useRef(false);
  const workspaceRefreshInFlightRef = useRef<Promise<boolean> | null>(null);
  workspaceRefreshRef.current = onWorkspaceRefresh;

  const isCurrentOperation = useCallback((operationId: number) => mountedRef.current && operationRef.current === operationId, []);
  const beginOperation = useCallback(() => {
    operationRef.current += 1;
    return operationRef.current;
  }, []);

  const applyResponse = useCallback((response: LunchFlowResponse, mode: 'discovery' | 'local' = 'discovery') => {
    const nextResponse = mode === 'local' && appliedResponseRef.current ? mergeLunchFlowStatus(appliedResponseRef.current, response) : response;
    appliedResponseRef.current = nextResponse;
    applyLunchFlowResponse(nextResponse, mountedRef, setConfigured, setAccounts, setDrafts, setLoadState, setLoadError);
  }, [mountedRef]);

  const loadAccounts = useCallback(() => loadLunchFlowAccounts(ledgerApi, mountedRef, applyResponse, setLoadState, setLoadError), [ledgerApi, applyResponse, mountedRef]);

  useEffect(() => {
    void loadAccounts().catch(() => undefined);
  }, [loadAccounts]);

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => drafts[account.providerAccountId]?.selected),
    [accounts, drafts],
  );

  const notifyWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshInFlightRef.current) return workspaceRefreshInFlightRef.current;
    const task = notifyWorkspaceRefreshTask(workspaceRefreshRef.current, mountedRef, setNotice);
    workspaceRefreshInFlightRef.current = task;
    void task.finally(() => {
      if (workspaceRefreshInFlightRef.current === task) workspaceRefreshInFlightRef.current = null;
    });
    return task;
  }, [mountedRef]);

  useEffect(() => {
    const handleFocus = () => { void notifyWorkspaceRefresh(); };
    window.addEventListener('focus', handleFocus);
    if (!workspaceRefreshStartedRef.current) {
      workspaceRefreshStartedRef.current = true;
      void notifyWorkspaceRefresh();
    }
    return () => window.removeEventListener('focus', handleFocus);
  }, [notifyWorkspaceRefresh]);

  const waitForQueuedSync = useCallback((providerAccountIds: string[], baseline: ReadonlyMap<string, LunchFlowSyncBaseline>, operationId: number, pendingMessage: string) => waitForQueuedSyncTask({ api: ledgerApi, providerAccountIds, baseline, operationId, pendingMessage, isCurrentOperation, applyResponse, notifyWorkspaceRefresh, setNotice: (nextNotice) => setNotice(nextNotice), pollTimerRef }), [ledgerApi, applyResponse, isCurrentOperation, notifyWorkspaceRefresh]);

  const updateDraft = (providerAccountId: string, update: Partial<LunchFlowDraft>) => {
    setDrafts((current) => ({
      ...current,
      [providerAccountId]: { ...current[providerAccountId], ...update },
    }));
  };

  const showActionError = (error:unknown,operationId:number) => { if(isCurrentOperation(operationId))setNotice({tone:'error',message:lunchFlowErrorMessage(error)}); };

  const saveSelection = async () => {
    const invalidAccount = invalidSelectionAccount(selectedAccounts, drafts);
    if (invalidAccount) {
      setNotice({ tone: 'error', message: `Choose a returned currency and account kind for ${invalidAccount.name} before saving.` });
      return;
    }
    const operationId = beginOperation();
    const providerAccountIds = selectedAccounts.map((account) => account.providerAccountId);
    const baseline = new Map(selectedAccounts.map((account) => [account.providerAccountId, { lastSyncedAt: account.lastSyncedAt, lastAttemptAt: account.lastAttemptAt, lastError: account.lastError }]));
    setBusyAction('save');
    setNotice(null);
    try {
      const response = await ledgerApi<LunchFlowSelectionResponse>('/api/lunchflow/account-selection', {
        method: 'POST',
        body: JSON.stringify({
          accounts: selectedAccounts.map((account) => {
            const draft = drafts[account.providerAccountId];
            return { providerAccountId: account.providerAccountId, currency: draft.currency, kind: draft.kind };
          }),
        }),
      });
      if (!isCurrentOperation(operationId)) return;
      await loadAccounts();
      const workspaceRefreshed = await notifyWorkspaceRefresh();
      const selectedCount = safeCount(response.selected);
      const outcome = selectionOutcome(response, selectedCount);
      if (outcome.poll && outcome.pendingMessage) await waitForQueuedSync(providerAccountIds, baseline, operationId, outcome.pendingMessage);
      else if (outcome.notice && workspaceRefreshed) setNotice(outcome.notice);
    } catch (error) {
      showActionError(error,operationId);
    } finally {
      if (isCurrentOperation(operationId)) setBusyAction(null);
    }
  };

  const refreshLunchFlow = async () => {
    const operationId = beginOperation();
    const providerAccountIds = selectedAccounts.map((account) => account.providerAccountId);
    const baseline = new Map(selectedAccounts.map((account) => [account.providerAccountId, { lastSyncedAt: account.lastSyncedAt, lastAttemptAt: account.lastAttemptAt, lastError: account.lastError }]));
    setBusyAction('sync');
    setNotice(null);
    try {
      const response = await ledgerApi<LunchFlowSyncResponse>('/api/lunchflow/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!isCurrentOperation(operationId)) return;
      await loadAccounts();
      const workspaceRefreshed = await notifyWorkspaceRefresh();
      const accountCount = safeCount(response.accounts);
      if (response.queued && accountCount > 0) {
        await waitForQueuedSync(providerAccountIds, baseline, operationId, `Lunch Flow refresh queued for ${accountCountLabel(accountCount)}. This page shows the last known data until the queued sync completes. Waiting for completion…`);
      } else if (accountCount > 0) {
        if (workspaceRefreshed) setNotice({ tone: 'error', message: `Lunch Flow reported ${accountCountLabel(accountCount)} but did not queue a sync. No new data was imported.` });
      } else if (workspaceRefreshed) {
        setNotice({ tone: 'info', message: 'Lunch Flow has no selected accounts to refresh. Existing history remains in the ledger.' });
      }
    } catch (error) {
      showActionError(error,operationId);
    } finally {
      if (isCurrentOperation(operationId)) setBusyAction(null);
    }
  };

  const actionsDisabled = busyAction !== null || loadState !== 'ready' || configured !== true;

  return (
    <div aria-labelledby="lunchflow-heading">
      <div className="section-heading lunchflow-heading">
        <div>
          <h2 id="lunchflow-heading">Choose what Lunch Flow brings into the ledger</h2>
        </div>
        <span className="lunchflow-mark" aria-hidden="true">LF</span>
      </div>
      <p className="lunchflow-intro">Lunch Flow connections are managed in Lunch Flow. This private ledger only receives the accounts and currencies you explicitly select.</p>
      <div className="lunchflow-toolbar">
        <a className="text-button" href="https://lunchflow.app" target="_blank" rel="noreferrer">Manage Lunch Flow connection <ArrowUpRight size={14} /></a>
        <div className="lunchflow-actions">
          <button type="button" className="outline-button" onClick={() => { void refreshLunchFlow(); }} disabled={actionsDisabled}>
            <RefreshCw size={15} className={busyAction === 'sync' ? 'is-spinning' : undefined} />
            {busyAction === 'sync' ? 'Waiting for sync…' : 'Refresh'}
          </button>
          <button type="button" className="primary-button" onClick={() => { void saveSelection(); }} disabled={actionsDisabled}>
            <Save size={15} />
            {busyAction === 'save' ? 'Saving selection…' : 'Save selection'}
          </button>
        </div>
      </div>

      {notice ? <div className={`lunchflow-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span className="lunchflow-notice-icon">{notice.tone === 'error' ? <CircleAlert size={16} /> : notice.tone === 'success' ? <BadgeCheck size={16} /> : <CircleHelp size={16} />}</span><span>{notice.message}</span></div> : null}

      {loadState === 'loading' ? <div className="lunchflow-state" role="status" aria-live="polite"><RefreshCw size={18} className="is-spinning" /><span>Reading Lunch Flow accounts…</span></div> : null}
      {loadState === 'error' ? <div className="lunchflow-state is-error" role="alert"><CircleAlert size={18} /><div><strong>Lunch Flow account discovery failed.</strong><span>{loadError}</span><button type="button" className="quiet-button" onClick={() => { void loadAccounts().catch(() => undefined); }}>Try again</button></div></div> : null}
      {loadState === 'ready' && configured === false ? <div className="lunchflow-state is-error" role="alert"><CircleAlert size={18} /><div><strong>Lunch Flow is not configured.</strong><span>Ask the operator to finish connection setup. No secret belongs in the browser.</span></div></div> : null}
      {loadState === 'ready' && configured === true && accounts.length === 0 ? <div className="lunchflow-state"><ShieldCheck size={18} /><div><strong>No Lunch Flow accounts are available yet.</strong><span>Manage the connection in Lunch Flow, then refresh this section to discover accounts.</span></div></div> : null}
      {loadState === 'ready' && configured === true && accounts.length > 0 ? <div className="lunchflow-account-list">{accounts.map((account) => {
        const draft = drafts[account.providerAccountId] ?? draftForAccount(account);
        const currencies = account.currencies;
        const cannotSelect = !draft.selected && (currencies.length === 0 || Boolean(account.lastError));
        return <article key={account.providerAccountId} className={`lunchflow-account ${draft.selected ? 'is-selected' : 'is-deselected'}`}>
          <div className="lunchflow-account-main">
            <label className="lunchflow-account-select"><input type="checkbox" checked={draft.selected} disabled={actionsDisabled || cannotSelect} title={cannotSelect ? 'This account cannot be newly selected until Lunch Flow returns a usable currency and clears its provider error.' : undefined} onChange={(event) => updateDraft(account.providerAccountId, { selected: event.target.checked })} /><span><strong>{account.name}</strong><small>{account.institution} · Lunch Flow</small></span></label>
            <span className={`lunchflow-selection-state ${draft.selected ? 'is-selected' : ''}`}>{draft.selected ? 'Selected for sync' : 'Not selected'}</span>
          </div>
          <div className="lunchflow-account-controls">
            <label><span>Currency</span><select aria-label={`${account.name} currency`} value={draft.currency} disabled={actionsDisabled || cannotSelect} onChange={(event) => updateDraft(account.providerAccountId, { currency: event.target.value })}><option value="">Choose returned currency</option>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            <label><span>Ledger kind</span><select aria-label={`${account.name} kind`} value={draft.kind} disabled={actionsDisabled || cannotSelect} onChange={(event) => updateDraft(account.providerAccountId, { kind: isLunchFlowKind(event.target.value) ? event.target.value : '' })}><option value="">Choose account kind</option>{lunchFlowKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
          </div>
          <div className="lunchflow-account-meta"><span>Last successful sync: {accountTimestamp(account.lastSyncedAt)}</span>{account.accountId ? <span>Existing ledger history stays in the ledger</span> : <span>Ledger account will be created on save</span>}</div>
          {currencies.length === 0 ? <p className="lunchflow-account-warning"><CircleAlert size={14} /> No transaction currency was returned yet. This account cannot be newly selected until Lunch Flow exposes a supported currency.</p> : null}
          {account.lastError ? <p className="lunchflow-account-error" role="alert"><CircleAlert size={14} /><span><strong>Last provider error:</strong> {account.lastError}{!draft.selected ? ' This account stays deselected until the provider recovers.' : ''}</span></p> : null}
        </article>;
      })}</div> : null}
    </div>
  );
}
