import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CloudUpload,
  Database,
  FileCheck2,
  FileUp,
  Filter,
  Landmark,
  LayoutDashboard,
  Link2,
  ListFilter,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  WalletCards,
  X,
} from 'lucide-react';
import { calculateSpending, filterTransactions } from './domain/ledger';
import { parseStatementCsv } from './domain/imports';
import { demoAccounts, demoDaily, demoTransactions } from './domain/demo-data';
import { formatDate, formatMoney } from './domain/format';
import { ledgerApi, LedgerApiError } from './domain/api';
import { serializeTransactionsCsv } from './domain/export';
import { openPlaidLink, type PlaidAccountMetadata, type PlaidInstitutionMetadata } from './plaid-link';
import { formatReportingDay, getReportWindows, type ReportingTimezone, type WeekStartsOn } from './domain/reporting';
import type { Account, ReportWindow, Transaction } from './domain/types';
import { getCurrencyMeta, supportedCurrencyCodes, type CurrencyCode } from './domain/currencies';
import RecurringView from './components/RecurringView';
import MobileAuthorizationPage from './MobileAuthorizationPage';

type View = 'overview' | 'recurring' | 'transactions' | 'imports' | 'accounts';
type UtilityPanel = 'notifications' | 'profile' | null;
type ChartRange = 'daily' | 'weekly' | 'monthly';
type AppRoute = 'landing' | 'workspace' | 'mobile-authorization';
type AppAccount = Omit<Account, 'currency'> & { currency: CurrencyCode };
type CurrencyTotals = Record<string, number>;
interface ChartEntry {
  day: string;
  totals: CurrencyTotals;
}

interface ReportCurrencyTotal {
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
  confirmedCount: number;
  provisionalCount: number;
}

interface ReportDailyTotal {
  date: string;
  currency: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
}

interface ConvertedTotals {
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
  confirmedCount: number;
  provisionalCount: number;
}

interface ConvertedDailyTotal {
  date: string;
  confirmedMinorUnits: number;
  provisionalMinorUnits: number;
}

interface ChineseBankBand {
  eligible: true;
  currency: CurrencyCode;
  baseMinorUnits: number;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  percentageBasisPoints: 150;
}

interface ReportFx {
  provider: 'frankfurter';
  complete: boolean;
  unavailableSourceCurrencies: CurrencyCode[];
  lockedDateCount: number;
  observedDateRange: { earliest: string | null; latest: string | null };
  chineseBankBand: ChineseBankBand | null;
}

interface OverviewReport {
  ledgerId: string;
  asOf: string | null;
  timeBasis: string;
  timeZone: string | null;
  from: string | null;
  to: string | null;
  includeProvisional: boolean;
  currencyTotals: ReportCurrencyTotal[];
  dailyTotals: ReportDailyTotal[];
  reportingCurrency: CurrencyCode | null;
  convertedTotals: ConvertedTotals | null;
  convertedDailyTotals: ConvertedDailyTotal[];
  fx: ReportFx;
  reviewCount: number;
  excludedCount: number;
  sourceCoverage: Record<string, number>;
}

interface ReportingPreferences {
  reportingTimezone: ReportingTimezone;
  weekStart: 0 | 1;
  preferredCurrency: CurrencyCode | null;
  revision: number;
}

const chartRangeLabels: Record<ChartRange, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const landingWindows: ReportWindow[] = [
  { key: 'today', label: 'Today', start: '2026-10-12', end: '2026-10-12' },
  { key: 'week', label: 'This week', start: '2026-10-06', end: '2026-10-12' },
  { key: 'month', label: 'This month', start: '2026-10-01', end: '2026-10-12' },
];

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'recurring', label: 'Recurring payments', icon: Repeat2 },
  { id: 'transactions', label: 'Transactions', icon: ListFilter },
  { id: 'imports', label: 'Import & review', icon: FileUp },
  { id: 'accounts', label: 'Accounts & settings', icon: Landmark },
];

const currencyLabels: Partial<Record<CurrencyCode, { name: string; flag: string; accent: string }>> = {
  CAD: { name: 'Canadian dollars', flag: 'CA', accent: 'cad' },
  CNY: { name: 'Chinese yuan', flag: 'CN', accent: 'cny' },
};

function orderedCurrencies(currencies: Iterable<string>, preferredCurrency: CurrencyCode | null = null) {
  const ordered = [...new Set(currencies)]
    .filter((currency) => getCurrencyMeta(currency) !== null)
    .sort((left, right) => {
      const priority = (currency: string) => currency === 'CAD' ? 0 : currency === 'CNY' ? 1 : 2;
      return priority(left) - priority(right) || left.localeCompare(right);
    });
  if (!preferredCurrency || !ordered.includes(preferredCurrency)) return ordered;
  return [preferredCurrency, ...ordered.filter((currency) => currency !== preferredCurrency)];
}

function currencyPresentation(currency: CurrencyCode) {
  return currencyLabels[currency] ?? { name: 'Source currency', flag: currency, accent: 'source' };
}

function sumChartEntries(entries: CurrencyTotals[]) {
  return entries.reduce<CurrencyTotals>((totals, entry) => {
    for (const [currency, amount] of Object.entries(entry)) totals[currency] = (totals[currency] ?? 0) + amount;
    return totals;
  }, {});
}

function reportTotals(report: OverviewReport, includeProvisional: boolean) {
  return report.currencyTotals.reduce<CurrencyTotals>((totals, entry) => {
    totals[entry.currency] = entry.confirmedMinorUnits + (includeProvisional ? entry.provisionalMinorUnits : 0);
    return totals;
  }, {});
}

function convertedReportTotal(report: OverviewReport, includeProvisional: boolean) {
  if (!report.reportingCurrency || !report.convertedTotals) return null;
  const amount = report.convertedTotals.confirmedMinorUnits + (includeProvisional ? report.convertedTotals.provisionalMinorUnits : 0);
  return Number.isSafeInteger(amount) ? amount : null;
}

function conversionState(report: OverviewReport): 'complete' | 'partial' | 'unavailable' | null {
  if (!report.reportingCurrency) return null;
  if (report.fx.complete) return 'complete';
  const convertedCount = (report.convertedTotals?.confirmedCount ?? 0) + (report.convertedTotals?.provisionalCount ?? 0);
  return convertedCount > 0 ? 'partial' : 'unavailable';
}

function chartCurrenciesForReport(report: OverviewReport, preferredCurrency: CurrencyCode | null = null) {
  if (report.reportingCurrency) return [report.reportingCurrency];
  return orderedCurrencies([
    ...report.currencyTotals.map((entry) => entry.currency),
    ...report.dailyTotals.map((entry) => entry.currency),
  ], preferredCurrency);
}

function chartDataForRange(range: ChartRange, report: OverviewReport, includeProvisional: boolean, selectedWindow: ReportWindow): ChartEntry[] {
  const daily = new Map<string, CurrencyTotals>();
  const dailyTotals = report.reportingCurrency
    ? report.convertedDailyTotals.map((entry) => ({ ...entry, currency: report.reportingCurrency! }))
    : report.dailyTotals;
  for (const entry of dailyTotals) {
    if (entry.date < selectedWindow.start || entry.date > selectedWindow.end) continue;
    const current = daily.get(entry.date) ?? {};
    const amount = entry.confirmedMinorUnits + (includeProvisional ? entry.provisionalMinorUnits : 0);
    // Preserve signed refunds in the chart model. The visual uses magnitude
    // only for bar height and marks the direction; the table exposes the
    // signed amount to assistive technology.
    current[entry.currency] = (current[entry.currency] ?? 0) + amount;
    daily.set(entry.date, current);
  }
  const dates = [...daily.keys()].sort();
  if (range === 'daily') {
    return (dates.length > 0 ? dates : [selectedWindow.end]).slice(-12).map((date) => ({
      day: date.slice(8),
      totals: daily.get(date) ?? {},
    }));
  }
  if (range === 'weekly') {
    const split = Math.max(1, Math.ceil(dates.length / 2));
    return [
      { day: 'W1', totals: sumChartEntries(dates.slice(0, split).map((date) => daily.get(date) ?? {})) },
      { day: 'W2', totals: sumChartEntries(dates.slice(split).map((date) => daily.get(date) ?? {})) },
    ];
  }
  return [{ day: selectedWindow.end.slice(0, 7).replace('-', ' '), totals: sumChartEntries(dates.map((date) => daily.get(date) ?? {})) }];
}

function chartPeriodLabel(range: ChartRange, selectedWindow: ReportWindow) {
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short' }).format(new Date(`${selectedWindow.end}T12:00:00Z`)).toUpperCase();
  if (range === 'weekly') return `W1 — W2 ${month}`;
  if (range === 'monthly') return `${month} ${selectedWindow.end.slice(0, 4)}`;
  return `${selectedWindow.start.slice(5)} — ${selectedWindow.end.slice(5)}`;
}

function syncLabel(accounts: AppAccount[]) {
  const latest = accounts
    .map((account) => account.lastSyncedAt ? new Date(account.lastSyncedAt).valueOf() : 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  if (!latest) return 'Not synced yet';
  const minutes = Math.max(0, Math.floor((Date.now() - latest) / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes === 1) return 'Updated 1 min ago';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function syncTimestampLabel(value: string | null) {
  if (!value) return 'not yet';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'not yet';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function mapApiAccount(value: Record<string, unknown>): AppAccount | null {
  const currency = typeof value.currency === 'string' && getCurrencyMeta(value.currency) ? value.currency : null;
  const kind = value.kind === 'savings' || value.kind === 'credit' ? value.kind : value.kind === 'chequing' ? value.kind : null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.institution !== 'string' || !currency || !kind) return null;
  return {
    id: value.id,
    name: value.name,
    institution: value.institution,
    currency,
    kind,
    status: value.status === 'connected' ? 'connected' : value.status === 'needs_attention' ? 'needs_attention' : 'import_only',
    lastSyncedAt: typeof value.last_synced_at === 'string' ? value.last_synced_at : null,
    plaidItemId: typeof value.plaid_item_id === 'string' ? value.plaid_item_id : null,
  };
}

function mapApiPreferences(value: unknown): ReportingPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const reportingTimezone = record.reportingTimezone === 'Asia/Shanghai' ? 'Asia/Shanghai' : record.reportingTimezone === 'America/Toronto' ? 'America/Toronto' : null;
  const weekStart = record.weekStart === 0 ? 0 : record.weekStart === 1 ? 1 : null;
  const preferredCurrency = record.preferredCurrency === null || record.preferredCurrency === undefined
    ? null
    : typeof record.preferredCurrency === 'string' && getCurrencyMeta(record.preferredCurrency)
      ? record.preferredCurrency
      : null;
  if (!reportingTimezone || weekStart === null || !Number.isInteger(record.revision) || Number(record.revision) < 0) return null;
  return { reportingTimezone, weekStart, preferredCurrency, revision: Number(record.revision) };
}

function mapApiTransaction(value: Record<string, unknown>): Transaction | null {
  const currency = typeof value.currency === 'string' && getCurrencyMeta(value.currency) ? value.currency : null;
  const kind = ['expense', 'income', 'transfer', 'refund', 'fee'].includes(value.kind as string) ? value.kind as Transaction['kind'] : null;
  const status = ['confirmed', 'provisional', 'needs_review'].includes(value.status as string) ? value.status as Transaction['status'] : null;
  const source = ['statement', 'plaid', 'alert', 'manual'].includes(value.source as string) ? value.source as Transaction['source'] : null;
  if (typeof value.id !== 'string' || typeof value.account_id !== 'string' || typeof value.date !== 'string' || typeof value.merchant !== 'string' || typeof value.amount_minor !== 'number' || !Number.isInteger(value.amount_minor) || !currency || !kind || !status || !source || typeof value.category !== 'string' || typeof value.fingerprint !== 'string') return null;
  return {
    id: value.id,
    accountId: value.account_id,
    date: value.date,
    merchant: value.merchant,
    amountMinor: value.amount_minor,
    currency,
    category: value.category,
    kind,
    status,
    source,
    fingerprint: value.fingerprint,
    note: typeof value.note === 'string' ? value.note : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeSafeInteger(value: unknown) {
  const integer = safeInteger(value);
  return integer !== null && integer >= 0 ? integer : null;
}

function mapRegisteredCurrency(value: unknown): CurrencyCode | null {
  return typeof value === 'string' && getCurrencyMeta(value) ? value : null;
}

function validReportDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function mapConvertedTotals(value: unknown): ConvertedTotals | null {
  if (!isRecord(value)) return null;
  const confirmedMinorUnits = safeInteger(value.confirmedMinorUnits);
  const provisionalMinorUnits = safeInteger(value.provisionalMinorUnits);
  const confirmedCount = nonNegativeSafeInteger(value.confirmedCount);
  const provisionalCount = nonNegativeSafeInteger(value.provisionalCount);
  if (confirmedMinorUnits === null || provisionalMinorUnits === null || confirmedCount === null || provisionalCount === null) return null;
  return { confirmedMinorUnits, provisionalMinorUnits, confirmedCount, provisionalCount };
}

function mapConvertedDailyTotals(value: unknown): ConvertedDailyTotal[] | null {
  if (!Array.isArray(value)) return null;
  const totals: ConvertedDailyTotal[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !validReportDate(entry.date)) return null;
    const confirmedMinorUnits = safeInteger(entry.confirmedMinorUnits);
    const provisionalMinorUnits = safeInteger(entry.provisionalMinorUnits);
    if (confirmedMinorUnits === null || provisionalMinorUnits === null) return null;
    totals.push({ date: entry.date, confirmedMinorUnits, provisionalMinorUnits });
  }
  return totals;
}

function mapReportFx(value: unknown): ReportFx | null {
  if (!isRecord(value) || value.provider !== 'frankfurter' || typeof value.complete !== 'boolean') return null;
  if (!Array.isArray(value.unavailableSourceCurrencies)) return null;
  const unavailableSourceCurrencies: CurrencyCode[] = [];
  for (const currency of value.unavailableSourceCurrencies) {
    const code = mapRegisteredCurrency(currency);
    if (!code) return null;
    unavailableSourceCurrencies.push(code);
  }
  const lockedDateCount = nonNegativeSafeInteger(value.lockedDateCount);
  if (lockedDateCount === null || !isRecord(value.observedDateRange)) return null;
  const earliest = value.observedDateRange.earliest;
  const latest = value.observedDateRange.latest;
  if (earliest !== null && !validReportDate(earliest)) return null;
  if (latest !== null && !validReportDate(latest)) return null;

  let chineseBankBand: ChineseBankBand | null = null;
  if (value.chineseBankBand !== null) {
    if (!isRecord(value.chineseBankBand) || value.chineseBankBand.eligible !== true) return null;
    const currency = mapRegisteredCurrency(value.chineseBankBand.currency);
    const baseMinorUnits = safeInteger(value.chineseBankBand.baseMinorUnits);
    const lowerMinorUnits = safeInteger(value.chineseBankBand.lowerMinorUnits);
    const upperMinorUnits = safeInteger(value.chineseBankBand.upperMinorUnits);
    if (!currency || baseMinorUnits === null || lowerMinorUnits === null || upperMinorUnits === null || value.chineseBankBand.percentageBasisPoints !== 150) return null;
    chineseBankBand = { eligible: true, currency, baseMinorUnits, lowerMinorUnits, upperMinorUnits, percentageBasisPoints: 150 };
  }

  return {
    provider: 'frankfurter',
    complete: value.complete,
    unavailableSourceCurrencies,
    lockedDateCount,
    observedDateRange: { earliest, latest },
    chineseBankBand,
  };
}

const sourceOnlyReportFx: ReportFx = {
  provider: 'frankfurter',
  complete: true,
  unavailableSourceCurrencies: [],
  lockedDateCount: 0,
  observedDateRange: { earliest: null, latest: null },
  chineseBankBand: null,
};

export function mapApiReport(value: unknown): OverviewReport | null {
  if (!isRecord(value)) return null;
  const report = isRecord(value.report) ? value.report : value;
  if (!Array.isArray(report.currencyTotals) || !Array.isArray(report.dailyTotals)) return null;
  const currencyTotals: ReportCurrencyTotal[] = [];
  for (const entry of report.currencyTotals) {
    if (!isRecord(entry) || typeof entry.currency !== 'string' || getCurrencyMeta(entry.currency) === null) return null;
    const confirmedMinorUnits = safeInteger(entry.confirmedMinorUnits);
    const provisionalMinorUnits = safeInteger(entry.provisionalMinorUnits);
    const confirmedCount = safeInteger(entry.confirmedCount);
    const provisionalCount = safeInteger(entry.provisionalCount);
    if (confirmedMinorUnits === null || provisionalMinorUnits === null || confirmedCount === null || provisionalCount === null) return null;
    currencyTotals.push({ currency: entry.currency, confirmedMinorUnits, provisionalMinorUnits, confirmedCount, provisionalCount });
  }
  const dailyTotals: ReportDailyTotal[] = [];
  for (const entry of report.dailyTotals) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || typeof entry.currency !== 'string' || getCurrencyMeta(entry.currency) === null) return null;
    const confirmedMinorUnits = safeInteger(entry.confirmedMinorUnits);
    const provisionalMinorUnits = safeInteger(entry.provisionalMinorUnits);
    if (confirmedMinorUnits === null || provisionalMinorUnits === null) return null;
    dailyTotals.push({ date: entry.date, currency: entry.currency, confirmedMinorUnits, provisionalMinorUnits });
  }
  const reviewCount = safeInteger(report.reviewCount);
  const excludedCount = safeInteger(report.excludedCount);
  if (reviewCount === null || excludedCount === null) return null;

  let reportingCurrency: CurrencyCode | null = null;
  if (report.reportingCurrency !== undefined && report.reportingCurrency !== null) {
    reportingCurrency = mapRegisteredCurrency(report.reportingCurrency);
    if (!reportingCurrency) return null;
  }
  let convertedTotals: ConvertedTotals | null = null;
  if (report.convertedTotals !== undefined && report.convertedTotals !== null) {
    convertedTotals = mapConvertedTotals(report.convertedTotals);
    if (!convertedTotals || reportingCurrency === null) return null;
  }
  let convertedDailyTotals: ConvertedDailyTotal[] = [];
  if (report.convertedDailyTotals !== undefined) {
    const mappedDailyTotals = mapConvertedDailyTotals(report.convertedDailyTotals);
    if (!mappedDailyTotals || (reportingCurrency === null && mappedDailyTotals.length > 0)) return null;
    convertedDailyTotals = mappedDailyTotals;
  }
  let fx = sourceOnlyReportFx;
  if (report.fx !== undefined) {
    const mappedFx = mapReportFx(report.fx);
    if (!mappedFx) return null;
    fx = mappedFx;
  }
  if (reportingCurrency !== null && (convertedTotals === null || report.fx === undefined)) return null;
  const sourceCoverage = isRecord(report.sourceCoverage)
    ? Object.fromEntries(Object.entries(report.sourceCoverage).flatMap(([source, count]) => {
      const safeCount = safeInteger(count);
      return safeCount === null ? [] : [[source, safeCount]];
    }))
    : {};
  return {
    ledgerId: typeof report.ledgerId === 'string' ? report.ledgerId : 'personal',
    asOf: typeof report.asOf === 'string' ? report.asOf : null,
    timeBasis: typeof report.timeBasis === 'string' ? report.timeBasis : 'accounting_date',
    timeZone: typeof report.timeZone === 'string' ? report.timeZone : null,
    from: typeof report.from === 'string' ? report.from : null,
    to: typeof report.to === 'string' ? report.to : null,
    includeProvisional: report.includeProvisional === true,
    currencyTotals,
    dailyTotals,
    reportingCurrency,
    convertedTotals,
    convertedDailyTotals,
    fx,
    reviewCount,
    excludedCount,
    sourceCoverage,
  };
}

export function reportRequestPath(window: ReportWindow, includeProvisional: boolean, timeZone: ReportingTimezone, reportingCurrency: CurrencyCode | null = null) {
  const params = new URLSearchParams({
    from: window.start,
    to: window.end,
    includeProvisional: String(includeProvisional),
    timeZone,
  });
  if (reportingCurrency !== null) params.set('reportingCurrency', reportingCurrency);
  return `/api/reports/summary?${params.toString()}`;
}

function connectionErrorMessage(error: unknown) {
  if (error instanceof LedgerApiError && error.status === 401) return 'This private connection needs Cloudflare Access before it can open.';
  if (error instanceof LedgerApiError && error.status === 404) return 'The local Worker API is not serving this preview yet.';
  if (error instanceof Error) return error.message;
  return 'The bank connection could not be completed. Try again.';
}

interface AppProps {
  initialRoute?: AppRoute;
  authorizationRequestId?: string | null;
  authorizationState?: string | null;
}

interface PendingPlaidConnection {
  publicToken: string;
  institutionName: string;
  accounts: PlaidAccountMetadata[];
}

function App({ initialRoute = 'workspace', authorizationRequestId = null, authorizationState = null }: AppProps) {
  if (initialRoute === 'landing') return <LandingPage />;
  if (initialRoute === 'mobile-authorization') {
    return <MobileAuthorizationPage requestId={authorizationRequestId} state={authorizationState} />;
  }
  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const [activeView, setActiveView] = useState<View>('overview');
  const [selectedWindowKey, setSelectedWindowKey] = useState<ReportWindow['key']>('month');
  const [reportingNow, setReportingNow] = useState(() => new Date());
  const [reportingTimezone, setReportingTimezone] = useState<ReportingTimezone>('America/Toronto');
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStartsOn>('monday');
  const [preferredCurrency, setPreferredCurrency] = useState<CurrencyCode | null>(null);
  const [preferencesRevision, setPreferencesRevision] = useState(0);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [includeProvisional, setIncludeProvisional] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<AppAccount[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [reports, setReports] = useState<{ selected: OverviewReport; month: OverviewReport } | null>(null);
  const [reportStatus, setReportStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportError, setReportError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidNotice, setPlaidNotice] = useState<string | null>(null);
  const [plaidNoticeError, setPlaidNoticeError] = useState(false);
  const [pendingPlaidConnection, setPendingPlaidConnection] = useState<PendingPlaidConnection | null>(null);

  const reportingWindows = useMemo(() => getReportWindows(reportingNow, reportingTimezone, weekStartsOn), [reportingNow, reportingTimezone, weekStartsOn]);
  const selectedWindow = reportingWindows.find((window) => window.key === selectedWindowKey) ?? reportingWindows[2];
  const monthWindow = reportingWindows.find((window) => window.key === 'month') ?? reportingWindows[2];

  const refreshWorkspace = async () => {
    setWorkspaceStatus('loading');
    setWorkspaceError(null);
    try {
      const [accountsResponse, transactionsResponse] = await Promise.all([
        ledgerApi<{ accounts: Array<Record<string, unknown>> }>('/api/accounts'),
        ledgerApi<{ transactions: Array<Record<string, unknown>> }>('/api/transactions'),
      ]);
      setAccounts((Array.isArray(accountsResponse.accounts) ? accountsResponse.accounts : []).map(mapApiAccount).filter((account): account is AppAccount => account !== null));
      setTransactions((Array.isArray(transactionsResponse.transactions) ? transactionsResponse.transactions : []).map(mapApiTransaction).filter((transaction): transaction is Transaction => transaction !== null));
      setWorkspaceStatus('ready');
    } catch (error) {
      setAccounts([]);
      setTransactions([]);
      setWorkspaceStatus('error');
      setWorkspaceError(connectionErrorMessage(error));
    }
  };

  useEffect(() => { void refreshWorkspace(); }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPreferences = async () => {
      try {
        const preferences = mapApiPreferences(await ledgerApi<unknown>('/api/preferences'));
        if (!preferences || cancelled) return;
        setReportingTimezone(preferences.reportingTimezone);
        setWeekStartsOn(preferences.weekStart === 0 ? 'sunday' : 'monday');
        setPreferredCurrency(preferences.preferredCurrency);
        setPreferencesRevision(preferences.revision);
      } catch {
        // The legacy web surface can still be served without the shared preference route.
        // Keep the documented defaults until the protected route is available.
      }
    };
    void loadPreferences();
    return () => { cancelled = true; };
  }, []);

  const updateReportingPreferences = async (next: {
    reportingTimezone: ReportingTimezone;
    weekStartsOn: WeekStartsOn;
    preferredCurrency: CurrencyCode | null;
  }) => {
    setReportingTimezone(next.reportingTimezone);
    setWeekStartsOn(next.weekStartsOn);
    setPreferredCurrency(next.preferredCurrency);
    setPreferencesBusy(true);
    try {
      const saved = mapApiPreferences(await ledgerApi<unknown>('/api/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: preferencesRevision,
          reportingTimezone: next.reportingTimezone,
          weekStart: next.weekStartsOn === 'sunday' ? 0 : 1,
          preferredCurrency: next.preferredCurrency,
        }),
      }));
      if (!saved) throw new Error('The reporting preferences response was incomplete.');
      setReportingTimezone(saved.reportingTimezone);
      setWeekStartsOn(saved.weekStart === 0 ? 'sunday' : 'monday');
      setPreferredCurrency(saved.preferredCurrency);
      setPreferencesRevision(saved.revision);
    } catch (error) {
      setActionNotice(connectionErrorMessage(error));
      try {
        const refreshed = mapApiPreferences(await ledgerApi<unknown>('/api/preferences'));
        if (refreshed) {
          setReportingTimezone(refreshed.reportingTimezone);
          setWeekStartsOn(refreshed.weekStart === 0 ? 'sunday' : 'monday');
          setPreferredCurrency(refreshed.preferredCurrency);
          setPreferencesRevision(refreshed.revision);
        }
      } catch {
        // Preserve the optimistic value if the protected route is temporarily unavailable.
      }
    } finally {
      setPreferencesBusy(false);
    }
  };

  useEffect(() => {
    if (workspaceStatus !== 'ready') return;
    let cancelled = false;
    setReports(null);
    setReportStatus('loading');
    setReportError(null);

    const loadReports = async () => {
      try {
        const selectedRequest = ledgerApi<unknown>(reportRequestPath(selectedWindow, includeProvisional, reportingTimezone, preferredCurrency));
        const monthRequest = selectedWindow.start === monthWindow.start && selectedWindow.end === monthWindow.end
          ? selectedRequest
          : ledgerApi<unknown>(reportRequestPath(monthWindow, includeProvisional, reportingTimezone, preferredCurrency));
        const [selectedResponse, monthResponse] = await Promise.all([selectedRequest, monthRequest]);
        const selectedReport = mapApiReport(selectedResponse);
        const monthReport = mapApiReport(monthResponse);
        if (!selectedReport || !monthReport) throw new Error('The reporting service returned an incomplete response.');
        if (!cancelled) {
          setReports({ selected: selectedReport, month: monthReport });
          setReportStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          setReports(null);
          setReportStatus('error');
          setReportError(connectionErrorMessage(error));
        }
      }
    };

    void loadReports();
    return () => { cancelled = true; };
  }, [includeProvisional, monthWindow.end, monthWindow.start, preferredCurrency, reportingTimezone, selectedWindow.end, selectedWindow.start, workspaceStatus]);

  useEffect(() => {
    const refreshClock = () => setReportingNow(new Date());
    window.addEventListener('focus', refreshClock);
    document.addEventListener('visibilitychange', refreshClock);
    const timer = window.setInterval(refreshClock, 60_000);
    return () => {
      window.removeEventListener('focus', refreshClock);
      document.removeEventListener('visibilitychange', refreshClock);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!mobileNavOpen && utilityPanel === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        setUtilityPanel(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen, utilityPanel]);

  const connectPlaid = async () => {
    setPlaidBusy(true);
    setPlaidNotice(null);
    setPlaidNoticeError(false);
    try {
      const { link_token: linkToken } = await ledgerApi<{ link_token: string }>('/api/plaid/link-token', { method: 'POST' });
      await openPlaidLink({
        token: linkToken,
        onSuccess: (publicToken, metadata: PlaidInstitutionMetadata) => {
          const accounts = metadata.accounts ?? [];
          if (accounts.length === 0) {
            setPlaidBusy(false);
            setPlaidNoticeError(true);
            setPlaidNotice('Plaid did not return selectable accounts. Close the connection and try again.');
            return;
          }
          setPendingPlaidConnection({
            publicToken,
            institutionName: metadata.institution?.name ?? 'Bank',
            accounts,
          });
          setPlaidBusy(false);
          setPlaidNoticeError(false);
          setPlaidNotice('Choose the accounts this ledger is allowed to sync.');
        },
        onExit: (error) => {
          setPlaidBusy(false);
          setPendingPlaidConnection(null);
          if (error) {
            setPlaidNoticeError(true);
            setPlaidNotice(error.display_message ?? 'Plaid Link closed before the connection was completed.');
          }
        },
      });
    } catch (error) {
      setPlaidBusy(false);
      setPlaidNoticeError(true);
      setPlaidNotice(connectionErrorMessage(error));
    }
  };

  const confirmPlaidConnection = async (accountIds: string[]) => {
    if (!pendingPlaidConnection) return;
    setPlaidBusy(true);
    setPlaidNotice(null);
    setPlaidNoticeError(false);
    try {
      const response = await ledgerApi<{ institution?: string; queued?: boolean }>('/api/plaid/exchange', {
        method: 'POST',
        body: JSON.stringify({ publicToken: pendingPlaidConnection.publicToken, accountIds }),
      });
      setPendingPlaidConnection(null);
      await refreshWorkspace();
      setPlaidNoticeError(false);
      setPlaidNotice(`${response.institution ?? pendingPlaidConnection.institutionName} connected. ${response.queued ? 'The first transaction sync is queued.' : 'The connection is saved; refresh is not queued yet.'}`);
    } catch (error) {
      setPlaidNoticeError(true);
      setPlaidNotice(connectionErrorMessage(error));
    } finally {
      setPlaidBusy(false);
    }
  };

  const cancelPlaidConnection = () => {
    setPendingPlaidConnection(null);
    setPlaidBusy(false);
    setPlaidNoticeError(false);
    setPlaidNotice('The connection was not saved.');
  };

  const syncPlaid = async () => {
    setPlaidBusy(true);
    setPlaidNotice(null);
    setPlaidNoticeError(false);
    try {
      const response = await ledgerApi<{ queued: string[]; recurringQueued?: string[] }>('/api/plaid/sync', { method: 'POST', body: JSON.stringify({}) });
      setPlaidNoticeError(false);
      setPlaidNotice(response.queued.length > 0 || (response.recurringQueued?.length ?? 0) > 0 ? 'A fresh transaction and recurring refresh is queued.' : 'There are no saved Plaid connections to sync yet.');
    } catch (error) {
      setPlaidNoticeError(true);
      setPlaidNotice(connectionErrorMessage(error));
    } finally {
      setPlaidBusy(false);
    }
  };

  const disconnectPlaid = async (itemId: string, institution: string) => {
    if (!window.confirm(`Disconnect ${institution} from Plaid? Existing ledger history will stay here, but new bank syncs will stop.`)) return;
    setPlaidBusy(true);
    setPlaidNotice(null);
    setPlaidNoticeError(false);
    try {
      await ledgerApi<{ disconnected: boolean }>('/api/plaid/disconnect', {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      });
      await refreshWorkspace();
      setPlaidNotice('The Plaid connection was revoked. Existing ledger history was preserved.');
    } catch (error) {
      setPlaidNoticeError(true);
      setPlaidNotice(connectionErrorMessage(error));
    } finally {
      setPlaidBusy(false);
    }
  };

  const exportLedger = () => {
    const csv = serializeTransactionsCsv(transactions);
    const message = `CSV export prepared for ${transactions.length} ledger records.`;

    if (typeof URL.createObjectURL !== 'function') {
      setActionNotice(message);
      return;
    }

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'border-ledger.csv';
    link.click();
    URL.revokeObjectURL(url);
    setActionNotice(message);
  };

  const provisionalCount = transactions.filter((transaction) => transaction.status === 'provisional').length;
  const reviewCount = transactions.filter((transaction) => transaction.status === 'needs_review').length;
  const alertCount = provisionalCount + reviewCount;

  const handleImport = async (imported: Transaction[], errors: string[], fileSha256: string | null, filename: string): Promise<boolean> => {
    if (errors.length > 0 || imported.length === 0) {
      setImportNotice(`${imported.length} row${imported.length === 1 ? '' : 's'} ready; ${errors.length} row${errors.length === 1 ? '' : 's'} need attention.`);
      return false;
    }
    if (!fileSha256) {
      setImportNotice('The statement could not be identified safely. Choose the file again.');
      return false;
    }
    try {
      const result = await ledgerApi<{ accepted: number; duplicates: number; needsReview: number }>('/api/imports/commit', {
        method: 'POST',
        body: JSON.stringify({
          accountId: imported[0].accountId,
          filename,
          fileSha256,
          operationId: crypto.randomUUID(),
          transactions: imported,
        }),
      });
      await refreshWorkspace();
      setImportNotice(`${result.accepted} row${result.accepted === 1 ? '' : 's'} saved; ${result.duplicates} replay${result.duplicates === 1 ? '' : 's'} skipped${result.needsReview > 0 ? `; ${result.needsReview} need review` : ''}.`);
      return true;
    } catch (error) {
      setImportNotice(connectionErrorMessage(error));
      return false;
    }
  };

  return (
    <div className="app-shell">
      <aside id="mobile-navigation" className={`app-nav ${mobileNavOpen ? 'is-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>↗</span><span>↙</span></div>
          <div>
            <p className="brand-name">Border Ledger</p>
            <p className="brand-caption">private spending desk</p>
          </div>
          <button type="button" className="icon-button nav-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <div className="nav-section-label">Workspace</div>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeView === id ? 'is-active' : ''}`}
              onClick={() => { setActiveView(id); setMobileNavOpen(false); }}
              aria-current={activeView === id ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {id === 'imports' && reviewCount > 0 ? <span className="nav-count">{reviewCount}</span> : null}
            </button>
          ))}
        </nav>

        <div className="nav-spacer" />
        <div className="connection-card">
          <div className="connection-card-top"><span className="live-dot" /> <span>Ledger status</span></div>
          <strong>All local data is private</strong>
          <p>Cloud sync is ready for the next step. No bank passwords live here.</p>
          <button className="text-button" onClick={() => { setActiveView('accounts'); setMobileNavOpen(false); }}>Review connections <ArrowUpRight size={14} /></button>
        </div>
        <div className="nav-footer"><ShieldCheck size={14} /> <span>Access boundary next</span><CircleHelp size={14} /></div>
      </aside>

      {mobileNavOpen ? (
        <button type="button" className="nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation menu" />
      ) : null}

      <main className="main-column">
        <header className="topbar">
          <button type="button" className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" aria-expanded={mobileNavOpen} aria-controls="mobile-navigation"><Menu size={21} /></button>
          <div className="breadcrumb"><span>Personal</span><span className="breadcrumb-slash">/</span><strong>{navItems.find((item) => item.id === activeView)?.label}</strong></div>
          <div className="topbar-actions">
            <span className="sync-label"><span className="live-dot" /> {syncLabel(accounts)}</span>
            <button type="button" className="icon-button" onClick={() => setUtilityPanel((current) => current === 'notifications' ? null : 'notifications')} aria-label="Notifications" aria-expanded={utilityPanel === 'notifications'} aria-controls="notifications-panel"><Bell size={18} /><span className="notification-dot" /></button>
            <button type="button" className="avatar" onClick={() => setUtilityPanel((current) => current === 'profile' ? null : 'profile')} aria-label="Open profile menu" aria-expanded={utilityPanel === 'profile'} aria-controls="profile-panel">LM</button>
          </div>
        </header>

        {utilityPanel === 'notifications' ? (
          <section id="notifications-panel" className="utility-panel" role="region" aria-label="Notifications">
            <div className="utility-panel-heading"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Review queue</h2></div><button type="button" className="icon-button" onClick={() => setUtilityPanel(null)} aria-label="Close notifications"><X size={16} /></button></div>
            <p>{alertCount} records are waiting for review.</p>
            <button type="button" className="text-button" onClick={() => { setActiveView('imports'); setUtilityPanel(null); }}>Open review desk <ArrowUpRight size={14} /></button>
          </section>
        ) : null}
        {utilityPanel === 'profile' ? (
          <section id="profile-panel" className="utility-panel" role="region" aria-label="Profile">
            <div className="utility-panel-heading"><div><p className="eyebrow">PRIVATE SESSION</p><h2>Profile</h2></div><button type="button" className="icon-button" onClick={() => setUtilityPanel(null)} aria-label="Close profile menu"><X size={16} /></button></div>
            <p>GitHub sign-in through Cloudflare Access</p>
            <span className="utility-panel-note">This personal ledger is protected before it reaches the Worker.</span>
          </section>
        ) : null}

        {actionNotice ? <div className="notice-banner app-notice" role="status"><CircleHelp size={17} /><span>{actionNotice}</span><button type="button" className="icon-button" onClick={() => setActionNotice(null)} aria-label="Dismiss action notice"><X size={16} /></button></div> : null}

        <div className="page-content">
          {activeView === 'overview' ? workspaceStatus === 'loading' || workspaceStatus === 'error' || transactions.length === 0 ? (
            <WorkspaceStatePanel status={workspaceStatus === 'ready' ? 'empty' : workspaceStatus} error={workspaceError} onRetry={refreshWorkspace} />
          ) : reportStatus === 'loading' ? (
            <WorkspaceStatePanel status="loading" error={null} onRetry={refreshWorkspace} />
          ) : reportStatus === 'error' || !reports ? (
            <WorkspaceStatePanel status="error" error={reportError} onRetry={refreshWorkspace} />
          ) : (
            <Overview
              selectedWindow={selectedWindow}
              reportingWindows={reportingWindows}
              reportingTimezone={reportingTimezone}
              monthWindow={monthWindow}
              setSelectedWindowKey={setSelectedWindowKey}
              report={reports.selected}
              monthReport={reports.month}
              preferredCurrency={preferredCurrency}
              includeProvisional={includeProvisional}
              setIncludeProvisional={setIncludeProvisional}
              transactions={transactions}
              onNavigate={setActiveView}
            />
          ) : null}
          {activeView === 'recurring' ? <RecurringView today={monthWindow.end} startDate={monthWindow.start} endDate={monthWindow.end} /> : null}
          {activeView === 'transactions' ? <TransactionsView transactions={transactions} onExport={exportLedger} /> : null}
          {activeView === 'imports' ? (
            <ImportsView
              accounts={accounts}
              transactions={transactions}
              notice={importNotice}
              onImport={handleImport}
              onClearNotice={() => setImportNotice(null)}
            />
          ) : null}
          {activeView === 'accounts' ? <AccountsView accounts={accounts} connectionBusy={plaidBusy} connectionNotice={plaidNotice} connectionNoticeError={plaidNoticeError} pendingConnection={pendingPlaidConnection} reportingTimezone={reportingTimezone} weekStartsOn={weekStartsOn} preferredCurrency={preferredCurrency} preferencesBusy={preferencesBusy} onReportingPreferencesChange={(next) => { void updateReportingPreferences(next); }} onConnect={connectPlaid} onConfirmConnection={confirmPlaidConnection} onCancelConnection={cancelPlaidConnection} onSync={syncPlaid} onDisconnect={disconnectPlaid} onNavigate={setActiveView} onNotice={setActionNotice} /> : null}
        </div>
      </main>
    </div>
  );
}

function landingTransactionsForWindow(window: ReportWindow) {
  return demoTransactions.filter((transaction) => transaction.date >= window.start && transaction.date <= window.end);
}

function landingChartDataForWindow(window: ReportWindow) {
  if (window.key === 'today') return demoDaily.slice(-1);
  if (window.key === 'week') return demoDaily.slice(-7);
  return demoDaily;
}

function LandingPage() {
  const [selectedWindow, setSelectedWindow] = useState<ReportWindow>(landingWindows[2]);
  const [includeProvisional, setIncludeProvisional] = useState(false);
  const [pulse, setPulse] = useState(0);
  const windowTransactions = useMemo(() => landingTransactionsForWindow(selectedWindow), [selectedWindow]);
  const summary = useMemo(
    () => calculateSpending(windowTransactions, { includeProvisional }),
    [includeProvisional, windowTransactions],
  );
  const reviewCount = windowTransactions.filter((transaction) => transaction.status !== 'confirmed').length;

  useEffect(() => {
    const interval = window.setInterval(() => setPulse((current) => current + 1), 5000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="landing-page">
      <div className="landing-rule-field" aria-hidden="true" />
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Border Ledger home">
          <span className="brand-mark" aria-hidden="true"><span>↗</span><span>↙</span></span>
          <span><strong>Border Ledger</strong><small>private spending desk</small></span>
        </a>
        <nav className="landing-nav" aria-label="Landing page navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#boundaries">Boundaries</a>
        </nav>
        <a className="landing-header-cta" href="/app">Open workspace <ArrowUpRight size={15} /></a>
      </header>

      <div className="landing-body">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-status"><span className="live-dot" /> Private spending desk · CAD / CNY</p>
            <h1 id="landing-title">See the whole border, <em>one ledger at a time.</em></h1>
            <p className="landing-lede">A calmer way to understand spending across countries, currencies, and sources—without smoothing the uncertain parts out of the story.</p>
            <div className="landing-actions">
              <a className="primary-button landing-primary-action" href="/app">Enter private ledger <ArrowUpRight size={16} /></a>
              <a className="landing-text-link" href="#how-it-works">See how it works <ArrowUpRight size={14} /></a>
            </div>
            <div className="landing-trust-note"><ShieldCheck size={16} /><span>Bank passwords never enter the ledger. Your workspace stays behind its own access boundary.</span></div>
          </div>

          <LandingLedgerSnapshot
            selectedWindow={selectedWindow}
            setSelectedWindow={setSelectedWindow}
            includeProvisional={includeProvisional}
            onToggleProvisional={() => setIncludeProvisional((current) => !current)}
            windowTransactions={windowTransactions}
            summary={summary}
            reviewCount={reviewCount}
            pulse={pulse}
          />
        </section>

        <div className="landing-proof-line" aria-label="Product principles">
          <span><strong>02</strong> source currencies</span>
          <span><strong>01</strong> review queue</span>
          <span><strong>0</strong> silent conversions</span>
          <span><strong>100%</strong> explicit totals</span>
        </div>

        <section id="how-it-works" className="landing-story" aria-labelledby="story-title">
          <div className="landing-story-intro">
            <h2 id="story-title">Make the uncertain parts legible.</h2>
            <p>Border Ledger is built for the quiet work after a payment happens: bringing sources together, checking what belongs, and knowing why a total moved.</p>
          </div>
          <div className="landing-sequence">
            <article className="landing-sequence-row">
              <div className="landing-sequence-icon"><CloudUpload size={19} /></div>
              <div><h3>Bring in the source</h3><p>Connect a supported bank feed or import a statement locally. Every entry keeps its original currency and date.</p></div>
              <span className="landing-sequence-tag">IMPORT</span>
            </article>
            <article className="landing-sequence-row">
              <div className="landing-sequence-icon"><BadgeCheck size={19} /></div>
              <div><h3>Check before it counts</h3><p>Transfers, refunds, and provisional alerts stay distinct so a tidy total never hides a messy source.</p></div>
              <span className="landing-sequence-tag">REVIEW</span>
            </article>
            <article className="landing-sequence-row">
              <div className="landing-sequence-icon"><ShieldCheck size={19} /></div>
              <div><h3>Trust the shape of it</h3><p>Read CAD and CNY side by side, then choose when a converted view is useful—and see the rate date with it.</p></div>
              <span className="landing-sequence-tag">RECONCILE</span>
            </article>
          </div>
        </section>

        <section id="boundaries" className="landing-boundaries" aria-labelledby="boundaries-title">
          <div className="landing-boundaries-copy">
            <h2 id="boundaries-title">The ledger keeps its boundaries.</h2>
            <p>Personal finance should feel clear without asking you to trade away control. The private workspace is designed around explicit inputs, visible states, and small decisions you can undo.</p>
          </div>
          <div className="landing-boundary-table">
            <div><span>Source of truth</span><strong>Statements stay reviewable</strong></div>
            <div><span>Currency policy</span><strong>CAD and CNY stay separate</strong></div>
            <div><span>Access boundary</span><strong>Private workspace via Cloudflare Access</strong></div>
          </div>
        </section>

        <section className="landing-cta-band" aria-labelledby="cta-title">
          <div><h2 id="cta-title">Start with a clearer view.</h2><p>Your workspace is ready when you are.</p></div>
          <a className="primary-button landing-band-action" href="/app">Enter private ledger <ArrowUpRight size={16} /></a>
        </section>
      </div>

      <footer className="landing-footer">
        <span>Border Ledger · private spending desk</span>
        <span>Public page values are representative. Your ledger stays private.</span>
      </footer>
    </main>
  );
}

function LandingLedgerSnapshot({
  selectedWindow,
  setSelectedWindow,
  includeProvisional,
  onToggleProvisional,
  windowTransactions,
  summary,
  reviewCount,
  pulse,
}: {
  selectedWindow: ReportWindow;
  setSelectedWindow: (window: ReportWindow) => void;
  includeProvisional: boolean;
  onToggleProvisional: () => void;
  windowTransactions: Transaction[];
  summary: CurrencyTotals;
  reviewCount: number;
  pulse: number;
}) {
  const chartData = landingChartDataForWindow(selectedWindow);
  const chartMax = Math.max(...chartData.map((entry) => entry.CAD + entry.CNY), 1);
  const statusLabel = includeProvisional ? 'Provisional included' : 'Confirmed only';
  const activity = windowTransactions.slice(0, 3);

  return (
    <section className="landing-snapshot" aria-label="Interactive ledger snapshot">
      <div className="landing-snapshot-topline">
        <div><p className="snapshot-kicker">LIVE LEDGER SNAPSHOT</p><h2>What the ledger keeps visible</h2></div>
        <span className="snapshot-updated"><span className="live-dot" />{pulse % 2 === 0 ? 'Updated moments ago' : 'Updated just now'}</span>
      </div>
      <div className="landing-window-picker" role="group" aria-label="Snapshot reporting window">
        {landingWindows.map((window) => (
          <button key={window.key} type="button" className={selectedWindow.key === window.key ? 'is-selected' : ''} onClick={() => setSelectedWindow(window)} aria-pressed={selectedWindow.key === window.key}>
            {window.label}
          </button>
        ))}
      </div>
      <div className="landing-snapshot-total">
        <span className="snapshot-label">CONFIRMED SPENDING · {selectedWindow.label.toUpperCase()}</span>
        <strong>{formatMoney(summary.CAD, 'CAD')}</strong>
        <span>{statusLabel} · after transfers and refunds</span>
      </div>
      <div className="landing-currency-grid">
        <div className="landing-currency-cell cad"><span>CAD</span><strong>{formatMoney(summary.CAD, 'CAD')}</strong><small>Canadian dollars</small></div>
        <div className="landing-currency-cell cny"><span>CNY</span><strong>{formatMoney(summary.CNY, 'CNY')}</strong><small>Chinese yuan</small></div>
      </div>
      <div className="landing-snapshot-controls">
        <button type="button" className="landing-toggle" onClick={onToggleProvisional} aria-pressed={includeProvisional}><span className={`landing-toggle-track ${includeProvisional ? 'is-on' : ''}`} aria-hidden="true"><span /></span>Include provisional alerts</button>
        <span>{reviewCount} held outside confirmed totals</span>
      </div>
      <div className="landing-mini-chart" role="img" aria-label={`${selectedWindow.label} spending rhythm in CAD and CNY`}>
        <div className="landing-mini-chart-labels"><span>spending rhythm</span><span>{selectedWindow.label.toUpperCase()}</span></div>
        <div className="landing-mini-bars">{chartData.map((entry) => <span key={entry.day} className="landing-mini-column"><i className="landing-mini-bar cny" style={{ height: `${Math.max(3, (entry.CNY / chartMax) * 100)}%` }} /><i className="landing-mini-bar cad" style={{ height: `${Math.max(3, (entry.CAD / chartMax) * 100)}%` }} /></span>)}</div>
      </div>
      <div className="landing-activity">
        <div className="landing-activity-heading"><span>Recent ledger entries</span><span>{windowTransactions.length} records</span></div>
        {activity.map((transaction) => <div className="landing-activity-row" key={transaction.id}><span className={`landing-activity-mark ${transaction.currency.toLowerCase()}`} /><strong>{transaction.merchant}</strong><span>{formatMoney(Math.abs(transaction.amountMinor), transaction.currency, { signDisplay: 'never' })}</span><small className={`landing-activity-state ${transaction.status}`}>{transaction.status === 'needs_review' ? 'Review' : transaction.status === 'provisional' ? 'Provisional' : 'Confirmed'}</small></div>)}
      </div>
    </section>
  );
}

function PageIntro({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="page-intro"><div>{children}</div>{action}</div>;
}

function WorkspaceStatePanel({ status, error, onRetry }: { status: 'loading' | 'error' | 'empty'; error: string | null; onRetry: () => void }) {
  if (status === 'loading') {
    return <section className="panel workspace-state-panel" role="status" aria-live="polite"><div className="workspace-state-mark"><RefreshCw size={19} className="is-spinning" /></div><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Loading your private ledger</h1><p>Reading the latest accounts and confirmed activity from the protected workspace.</p></section>;
  }
  if (status === 'error') {
    return <section className="panel workspace-state-panel is-error" role="alert"><div className="workspace-state-mark"><CircleAlert size={19} /></div><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Could not load your private ledger</h1><p>{error ?? 'The protected workspace did not return a usable response.'}</p><button type="button" className="outline-button" onClick={onRetry}>Retry loading data <RefreshCw size={15} /></button></section>;
  }
  return <section className="panel workspace-state-panel" role="status"><div className="workspace-state-mark"><Database size={19} /></div><p className="eyebrow">PRIVATE WORKSPACE</p><h1>No confirmed activity yet</h1><p>Your private workspace is connected, but there are no ledger records to summarize. Connect a source or import a statement to begin.</p></section>;
}

function Overview({
  selectedWindow,
  reportingWindows,
  reportingTimezone,
  monthWindow,
  setSelectedWindowKey,
  report,
  monthReport,
  preferredCurrency,
  includeProvisional,
  setIncludeProvisional,
  transactions,
  onNavigate,
}: {
  selectedWindow: ReportWindow;
  reportingWindows: ReportWindow[];
  reportingTimezone: ReportingTimezone;
  monthWindow: ReportWindow;
  setSelectedWindowKey: (key: ReportWindow['key']) => void;
  report: OverviewReport;
  monthReport: OverviewReport;
  preferredCurrency: CurrencyCode | null;
  includeProvisional: boolean;
  setIncludeProvisional: (value: boolean) => void;
  transactions: Transaction[];
  onNavigate: (view: View) => void;
}) {
  const latest = [...transactions].sort((left, right) => right.date.localeCompare(left.date)).filter((transaction) => transaction.kind === 'expense' || transaction.kind === 'refund').slice(0, 5);
  const summary = reportTotals(report, includeProvisional);
  const monthSummary = reportTotals(monthReport, includeProvisional);
  const reportingCurrency = report.reportingCurrency;
  const conversion = conversionState(report);
  const convertedTotal = convertedReportTotal(report, includeProvisional);
  const monthConvertedTotal = convertedReportTotal(monthReport, includeProvisional);
  const reportCurrencies = orderedCurrencies([
    ...Object.keys(summary),
    ...Object.keys(monthSummary),
    ...report.currencyTotals.map((entry) => entry.currency),
    ...report.dailyTotals.map((entry) => entry.currency),
  ], preferredCurrency);
  const overviewCurrencies = orderedCurrencies([
    'CAD',
    'CNY',
    ...reportCurrencies,
  ], preferredCurrency);
  const total = overviewCurrencies.reduce((amount, currency) => amount + Math.abs(summary[currency] ?? 0), 0);
  const shareFor = (currency: CurrencyCode) => total > 0 ? `${Math.round((Math.abs(summary[currency] ?? 0) / total) * 100)}%` : '—';
  const primaryCurrency = reportingCurrency
    ?? (preferredCurrency && (summary[preferredCurrency] ?? 0) !== 0 ? preferredCurrency : null)
    ?? reportCurrencies.find((currency) => (summary[currency] ?? 0) !== 0)
    ?? reportCurrencies[0]
    ?? 'CAD';
  const insightCurrency = reportingCurrency
    ?? overviewCurrencies.find((currency) => currency === 'CNY' && (monthSummary[currency] ?? 0) !== 0)
    ?? overviewCurrencies.find((currency) => (monthSummary[currency] ?? 0) !== 0)
    ?? 'CAD';
  const primaryShare = reportingCurrency ? 'All available sources' : shareFor(primaryCurrency);
  const primaryAmount = reportingCurrency ? convertedTotal : summary[primaryCurrency] ?? 0;
  const monthAmount = reportingCurrency ? monthConvertedTotal : monthSummary[primaryCurrency] ?? 0;
  const reviewTransactions = transactions.filter((transaction) => transaction.status === 'needs_review' || transaction.status === 'provisional').slice(0, 3);
  const reviewCount = report.reviewCount;
  const [chartRange, setChartRange] = useState<ChartRange>('daily');
  const [chartRangeOpen, setChartRangeOpen] = useState(false);

  return (
    <>
      <PageIntro action={<WindowPicker windows={reportingWindows} selectedWindow={selectedWindow} setSelectedWindow={(window) => setSelectedWindowKey(window.key)} />}>
        <p className="eyebrow">{formatReportingDay(selectedWindow.end, reportingTimezone)}</p>
        <h1>Know where the month is going.</h1>
        <p className="intro-copy">A clear view across every registered source currency, with the uncertain bits kept in the margin.</p>
      </PageIntro>

      <section className="hero-grid" aria-label="Spending summary">
        <div className="primary-summary panel ruled-panel">
          <div className="panel-kicker"><span>{reportingCurrency ? `CONVERTED SPENDING${conversion === 'partial' ? ' · PARTIAL' : conversion === 'unavailable' ? ' · UNAVAILABLE' : ''}` : 'CONFIRMED SPENDING'}</span><span className="period-note">{selectedWindow.label.toUpperCase()}</span></div>
          <div className="primary-amount">{primaryAmount === null ? 'Unavailable' : formatMoney(primaryAmount, primaryCurrency)}<sup>{primaryCurrency}</sup></div>
          <div className="summary-meta"><span className="summary-trend positive"><ArrowDownLeft size={14} /> {includeProvisional ? 'Confirmed + provisional records' : 'Confirmed records only'}</span><span>•</span><span>after transfers &amp; refunds</span></div>
          {reportingCurrency && conversion ? <div className={`fx-report-status ${conversion}`} role={conversion === 'complete' ? 'status' : 'alert'}>
            {conversion === 'complete' ? <BadgeCheck size={14} /> : <CircleAlert size={14} />}
            <span><strong>{conversion === 'complete' ? 'Complete conversion' : conversion === 'partial' ? 'Partial conversion' : 'Converted total unavailable'}</strong>{conversion === 'complete' ? 'Locked to purchase dates · Frankfurter daily rates.' : <>{' '}Source totals remain usable. {report.fx.unavailableSourceCurrencies.length > 0 ? `Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.join(', ')}.` : 'Some source rates were unavailable.'}</>}</span>
          </div> : null}
          <div className="primary-rail">{overviewCurrencies.map((currency) => <span key={currency} style={{ width: `${total > 0 ? Math.max(8, Math.round((Math.abs(summary[currency] ?? 0) / total) * 100)) : 0}%` }} />)}</div>
          <div className="rail-labels"><span>{reportingCurrency ? `${primaryShare} converted to ${primaryCurrency}` : `${primaryShare} of this window in ${primaryCurrency}`}</span><span>{monthAmount === null ? 'Unavailable this month' : `${formatMoney(monthAmount, primaryCurrency)} this month`}</span></div>
        </div>
        <div className="currency-stack">
          {overviewCurrencies.map((currency) => <CurrencyLane key={currency} currency={currency} amount={summary[currency] ?? 0} share={shareFor(currency)} detail={reportingCurrency ? 'Source currency preserved · audit lane' : 'Source currency preserved'} />)}
        </div>
      </section>

      {report.fx.chineseBankBand ? <ChineseBankBandView band={report.fx.chineseBankBand} /> : null}

      <div className="summary-toolbar">
        <div className="toolbar-title"><BarChart3 size={17} /><strong>Reporting lens</strong><span>{reportingCurrency ? `Converted total in ${reportingCurrency}; source lanes stay visible.` : 'Source currencies stay separate by default.'}</span></div>
        <label className="switch-label"><input type="checkbox" checked={includeProvisional} onChange={(event) => setIncludeProvisional(event.target.checked)} /><span className="switch" aria-hidden="true" /><span>Include provisional alerts</span></label>
      </div>

      <section className="overview-grid">
        <div className="panel chart-panel">
          <div className="section-heading"><div><p className="eyebrow">THE DAILY PULSE</p><h2>Spending rhythm</h2></div><div className="chart-range-control"><button type="button" className="quiet-button" onClick={() => setChartRangeOpen((open) => !open)} aria-expanded={chartRangeOpen} aria-controls="chart-range-menu">{chartRangeLabels[chartRange]} <ChevronDown size={15} /></button>{chartRangeOpen ? <div id="chart-range-menu" className="chart-range-menu" role="region" aria-label="Chart period options">{(Object.keys(chartRangeLabels) as ChartRange[]).map((range) => <button type="button" key={range} className={chartRange === range ? 'is-selected' : undefined} onClick={() => { setChartRange(range); setChartRangeOpen(false); }}>{chartRangeLabels[range]}</button>)}</div> : null}</div></div>
          <div className="chart-legend">{chartCurrenciesForReport(report, preferredCurrency).map((currency) => <span key={currency}><i className={`legend-dot ${currency === 'CAD' ? 'cad-dot' : currency === 'CNY' ? 'cny-dot' : ''}`} style={currency === 'CAD' || currency === 'CNY' ? undefined : { backgroundColor: 'var(--muted)' }} /> {currency}</span>)}<span className="chart-period">{chartPeriodLabel(chartRange, selectedWindow)}</span></div>
          <SpendingChart range={chartRange} report={report} includeProvisional={includeProvisional} selectedWindow={selectedWindow} preferredCurrency={preferredCurrency} />
        </div>
        <div className="panel review-panel">
          <div className="section-heading"><div><p className="eyebrow">RECONCILIATION DESK</p><h2>Needs your eye</h2></div><CircleAlert className="review-icon" size={18} /></div>
          <div className="review-callout"><span className="review-number">{reviewCount}</span><div><strong>{reviewCount === 1 ? 'record needs review' : 'records need review'}</strong><p>Provisional alerts stay outside confirmed totals until a statement confirms them.</p></div></div>
          <div className="review-list">
            {reviewTransactions.length > 0 ? reviewTransactions.map((transaction) => <ReviewRow key={transaction.id} label={transaction.merchant} detail={`${formatMoney(Math.abs(transaction.amountMinor), transaction.currency, { signDisplay: 'never' })} · ${formatDate(transaction.date)}`} provisional={transaction.status === 'provisional'} />) : <div className="review-empty">Nothing is waiting for review.</div>}
          </div>
          <button className="outline-button full-width" onClick={() => onNavigate('imports')}>Open review desk <ArrowUpRight size={15} /></button>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="section-heading table-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Latest ledger entries</h2></div><button className="text-button" onClick={() => onNavigate('transactions')}>View all <ArrowUpRight size={14} /></button></div>
        <TransactionTable transactions={latest} compact />
      </section>

      <section className="insight-strip">
        <div className="insight-mark"><Sparkles size={17} /></div>
        <div><strong>One calm check-in at a time.</strong><p>{reportingCurrency && monthConvertedTotal !== null ? `You have ${formatMoney(monthConvertedTotal, insightCurrency)} in ${includeProvisional ? 'confirmed and provisional' : 'confirmed'} converted ${insightCurrency} spending this month. ` : reportingCurrency ? `The converted ${insightCurrency} total is unavailable for this month; ` : `You have ${formatMoney(monthSummary[insightCurrency] ?? 0, insightCurrency)} in ${includeProvisional ? 'confirmed and provisional' : 'confirmed'} ${insightCurrency} spending this month. `}A future exchange rate will be shown with its date—never silently blended in.</p></div>
        <button className="text-button" onClick={() => onNavigate('accounts')}>Set reporting rules <Settings2 size={14} /></button>
      </section>
    </>
  );
}

function ChineseBankBandView({ band }: { band: ChineseBankBand }) {
  const lower = formatMoney(band.lowerMinorUnits, band.currency, { signDisplay: 'never' });
  const upper = formatMoney(band.upperMinorUnits, band.currency, { signDisplay: 'never' });
  const base = formatMoney(band.baseMinorUnits, band.currency, { signDisplay: 'never' });
  const description = `${lower} to ${upper} ${band.currency}; ±1.5% Chinese bank settlement estimate; CNY spending excluded.`;
  return <aside className="fx-band" role="note" aria-label={description}><div className="fx-band-heading"><span>CHINESE BANK SETTLEMENT RANGE</span><span>SERVER ESTIMATE</span></div><strong>{lower} – {upper} {band.currency}</strong><p>±1.5% Chinese bank settlement estimate; CNY spending excluded.</p><small>Based on {base} of eligible non-CNY Bank of China spending.</small></aside>;
}

function WindowPicker({ windows, selectedWindow, setSelectedWindow }: { windows: ReportWindow[]; selectedWindow: ReportWindow; setSelectedWindow: (window: ReportWindow) => void }) {
  return <div className="window-picker" role="group" aria-label="Reporting window">{windows.map((window) => <button key={window.key} type="button" className={selectedWindow.key === window.key ? 'is-selected' : ''} onClick={() => setSelectedWindow(window)} aria-pressed={selectedWindow.key === window.key}>{window.label}</button>)}</div>;
}

function CurrencyLane({ currency, amount, share, detail }: { currency: CurrencyCode; amount: number; share: string; detail: string }) {
  const meta = currencyPresentation(currency);
  return <div className={`currency-lane ${meta.accent}`}><div className="currency-lane-head"><span className="currency-code"><span className="currency-flag">{meta.flag}</span>{currency}</span><span className="currency-share">{share} of total</span></div><div className="currency-amount">{formatMoney(amount, currency)}</div><div className="currency-lane-foot"><span>{meta.name}</span><span>{detail}</span></div></div>;
}

function SpendingChart({ range, report, includeProvisional, selectedWindow, preferredCurrency }: { range: ChartRange; report: OverviewReport; includeProvisional: boolean; selectedWindow: ReportWindow; preferredCurrency: CurrencyCode | null }) {
  const entries = chartDataForRange(range, report, includeProvisional, selectedWindow);
  const currencies = chartCurrenciesForReport(report, preferredCurrency);
  const max = Math.max(...entries.map((entry) => currencies.reduce((total, currency) => total + Math.abs(entry.totals[currency] ?? 0), 0)), 1);
  const chartLabel = `Bar chart showing ${chartRangeLabels[range].toLowerCase()} spending in ${currencies.join(', ')}`;
  return <>
    <div className="spending-chart" role="img" aria-label={chartLabel}>
      <div className="chart-y-labels"><span>largest</span><span>midpoint</span><span>zero</span></div>
      <div className="chart-bars">{entries.map((entry) => <div className="chart-column" key={entry.day}><div className="bar-track">{[...currencies].reverse().map((currency) => {
        const amount = entry.totals[currency] ?? 0;
        const direction = amount < 0 ? 'refund' : 'spending';
        return <span key={currency} className={`bar ${amount < 0 ? 'refund-bar' : ''} ${currency === 'CAD' ? 'cad-bar' : currency === 'CNY' ? 'cny-bar' : ''}`} data-direction={direction} aria-label={`${entry.day} ${currency} ${formatMoney(amount, currency)} ${direction}`} style={{ height: `${(Math.abs(amount) / max) * 100}%`, ...(currency === 'CAD' || currency === 'CNY' ? {} : { backgroundColor: 'var(--muted)', opacity: 0.72 }) }} />;
      })}</div><span className="bar-label">{entry.day}</span></div>)}</div>
    </div>
    <details className="chart-data-details">
      <summary>View spending data table</summary>
      <table className="chart-data-table">
        <caption>{chartLabel}; signed refunds are shown as negative amounts.</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Currency</th><th scope="col">Amount</th><th scope="col">Type</th></tr></thead>
        <tbody>{entries.flatMap((entry) => currencies.map((currency) => {
          const amount = entry.totals[currency] ?? 0;
          return <tr key={`${entry.day}-${currency}`}><th scope="row">{entry.day}</th><td>{currency}</td><td>{formatMoney(amount, currency)}</td><td>{amount < 0 ? 'Refund' : 'Spending'}</td></tr>;
        }))}</tbody>
      </table>
    </details>
  </>;
}

function ReviewRow({ label, detail, provisional = false }: { label: string; detail: string; provisional?: boolean }) {
  return <div className="review-row"><span className={`review-symbol ${provisional ? 'is-provisional' : ''}`}>{provisional ? <Bell size={13} /> : <CircleAlert size={13} />}</span><span><strong>{label}</strong><small>{detail}</small></span><MoreHorizontal size={16} className="muted-icon" /></div>;
}

function TransactionsView({ transactions, onExport }: { transactions: Transaction[]; onExport: () => void }) {
  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode | 'all'>('all');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [status, setStatus] = useState<Transaction['status'] | 'all'>('all');
  const [source, setSource] = useState<Transaction['source'] | 'all'>('all');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const categories = Array.from(new Set(transactions.map((transaction) => transaction.category))).sort();
  const currencies = orderedCurrencies(transactions.map((transaction) => transaction.currency));
  const filtered = filterTransactions(transactions, { query, currency, category, status, source });

  return <>
    <PageIntro action={<button type="button" className="outline-button" onClick={onExport}><FileCheck2 size={16} /> Export ledger</button>}><p className="eyebrow">THE FULL LEDGER</p><h1>Transactions</h1><p className="intro-copy">Search, sort, and annotate every record without losing its source.</p></PageIntro>
    <section className="panel filter-panel"><div className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search merchant, category, or note" aria-label="Search transactions" />{query ? <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button> : null}</div><div className="filter-selects"><label><span>Currency</span><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode | 'all')}><option value="all">All currencies</option>{currencies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>State</span><select value={status} onChange={(event) => setStatus(event.target.value as Transaction['status'] | 'all')}><option value="all">All states</option><option value="confirmed">Confirmed</option><option value="provisional">Provisional</option><option value="needs_review">Needs review</option></select></label><button type="button" className="icon-button filter-button" onClick={() => setMoreFiltersOpen((open) => !open)} aria-label="More filters" aria-expanded={moreFiltersOpen} aria-controls="transaction-more-filters"><SlidersHorizontal size={17} /></button></div>{moreFiltersOpen ? <div id="transaction-more-filters" className="more-filters" role="region" aria-label="Additional transaction filters"><label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value as Transaction['source'] | 'all')} aria-label="Source"><option value="all">All sources</option><option value="plaid">Plaid</option><option value="statement">Statement</option><option value="alert">BOC alert</option><option value="manual">Manual</option></select></label></div> : null}</section>
    <section className="panel table-panel"><div className="table-toolbar"><span>{filtered.length} records</span><span className="table-toolbar-note"><BadgeCheck size={14} /> Confirmed and provisional states are kept distinct</span></div><TransactionTable transactions={filtered} /></section>
  </>;
}

function TransactionTable({ transactions, compact = false }: { transactions: Transaction[]; compact?: boolean }) {
  return <div className={`transaction-table-wrap ${compact ? 'is-compact' : ''}`}><table className="transaction-table"><thead><tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Source</th><th scope="col">State</th><th scope="col" className="amount-cell">Amount</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id}><td className="date-cell">{formatDate(transaction.date)}</td><td><strong className="merchant-name">{transaction.merchant}</strong>{transaction.note ? <small className="note-line">{transaction.note}</small> : null}</td><td><span className={`category-mark ${transaction.currency.toLowerCase()}`} />{transaction.category}</td><td><span className="source-name">{transaction.source === 'plaid' ? 'Plaid' : transaction.source === 'alert' ? 'BOC alert' : 'Statement'}</span></td><td><StateBadge status={transaction.status} /></td><td className={`amount-cell ${transaction.kind === 'refund' || transaction.kind === 'income' ? 'is-credit' : ''}`}>{transaction.kind === 'income' || transaction.kind === 'refund' ? '+' : transaction.kind === 'transfer' ? '↔ ' : '− '}{formatMoney(Math.abs(transaction.amountMinor), transaction.currency, { signDisplay: 'never' })}</td></tr>)}</tbody></table>{transactions.length === 0 ? <div className="empty-state"><Filter size={22} /><strong>No records match that filter.</strong><span>Try a wider search or clear one of the filters.</span></div> : null}</div>;
}

function StateBadge({ status }: { status: Transaction['status'] }) {
  const label = status === 'needs_review' ? 'Needs review' : status === 'provisional' ? 'Provisional' : 'Confirmed';
  return <span className={`state-badge ${status}`}><span className="state-dot" />{label}</span>;
}

async function sha256File(file: File) {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function ImportsView({ accounts, transactions, notice, onImport, onClearNotice }: { accounts: AppAccount[]; transactions: Transaction[]; notice: string | null; onImport: (transactions: Transaction[], errors: string[], fileSha256: string | null, filename: string) => Promise<boolean>; onClearNotice: () => void }) {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<Transaction[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [fileSha256, setFileSha256] = useState<string | null>(null);
  const [filename, setFilename] = useState('statement.csv');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accounts.length > 0) setSelectedAccount((current) => accounts.some((account) => account.id === current) ? current : accounts[0].id);
  }, [accounts]);

  const selectedCurrency = accounts.find((account) => account.id === selectedAccount)?.currency;

  const loadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setPreview([]);
      setFileSha256(null);
      setErrors(['Statement files are limited to 10 MiB.']);
      return;
    }
    const hash = await sha256File(file);
    const result = parseStatementCsv(await file.text(), { accountId: selectedAccount, source: 'statement', defaultCurrency: selectedCurrency, fileSha256: hash ?? undefined });
    setPreview(result.transactions);
    setErrors(result.errors);
    setFileSha256(hash);
    setFilename(file.name || 'statement.csv');
    onClearNotice();
  };

  const commitPreview = async () => {
    setBusy(true);
    try {
      const committed = await onImport(preview, errors, fileSha256, filename);
      if (committed) {
        setPreview([]);
        setErrors([]);
        setFileSha256(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageIntro action={<div className="import-trust"><ShieldCheck size={15} /> Preview before saving</div>}><p className="eyebrow">SOURCE CONTROL</p><h1>Import &amp; review</h1><p className="intro-copy">Bring in a statement, see exactly what will change, and keep uncertain alerts visible until they match.</p></PageIntro>
    {notice ? <div className="notice-banner"><BadgeCheck size={17} /><span>{notice}</span><button className="icon-button" onClick={onClearNotice} aria-label="Dismiss notification"><X size={16} /></button></div> : null}
    <section className="import-layout"><div className="panel import-panel"><div className="section-heading"><div><p className="eyebrow">STEP 01</p><h2>Choose a statement</h2></div><FileUp size={18} className="section-icon" /></div><label className="account-select"><span>Import into</span><select value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} disabled={accounts.length === 0}>{accounts.length === 0 ? <option value="">No accounts available</option> : accounts.map((account) => <option key={account.id} value={account.id}>{account.institution} · {account.name} · {account.currency}</option>)}</select></label><label className={`dropzone ${dragActive ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); const file = event.dataTransfer.files[0]; if (file) void loadFile(file); }}><input type="file" accept=".csv,text/csv,.pdf,application/pdf" disabled={accounts.length === 0} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} /><span className="dropzone-icon"><UploadCloud size={23} /></span><strong>Drop a CSV or verified text statement here</strong><span>or browse your files · up to 10 MB</span></label><div className="import-format"><BookOpen size={14} /><span>Required CSV columns: Date, Description, and Amount. Currency is optional when the selected account has a registered default.</span></div></div><div className="panel import-side-panel"><div className="section-heading"><div><p className="eyebrow">STEP 02</p><h2>Review queue</h2></div><span className="queue-count">{preview.length || transactions.filter((transaction) => transaction.status === 'needs_review').length}</span></div><div className="queue-summary"><div><strong>{preview.length || transactions.filter((transaction) => transaction.status === 'needs_review').length}</strong><span>rows ready</span></div><div><strong>{errors.length}</strong><span>row errors</span></div><div><strong>0</strong><span>duplicates</span></div></div>{errors.length > 0 ? <div className="error-list">{errors.slice(0, 3).map((error) => <span key={error}><CircleAlert size={14} />{error}</span>)}</div> : <div className="queue-empty"><FileCheck2 size={20} /><strong>{preview.length > 0 ? 'Preview is ready.' : 'Nothing waiting yet.'}</strong><span>{preview.length > 0 ? 'Check the rows below before committing.' : 'A statement preview will appear here.'}</span></div>}{preview.length > 0 ? <button className="primary-button full-width" onClick={() => { void commitPreview(); }} disabled={preview.length === 0 || busy}>{busy ? 'Saving securely…' : `Commit ${preview.length} rows`} <ArrowUpRight size={15} /></button> : null}</div></section>
    {preview.length > 0 ? <section className="panel table-panel"><div className="section-heading table-heading"><div><p className="eyebrow">STEP 03</p><h2>Statement preview</h2></div><button className="quiet-button" onClick={() => { setPreview([]); setErrors([]); }}>Clear <X size={14} /></button></div><TransactionTable transactions={preview} compact /></section> : null}
  </>;
}

function PlaidAccountSelectionDialog({
  connection,
  busy,
  onConfirm,
  onCancel,
}: {
  connection: PendingPlaidConnection;
  busy: boolean;
  onConfirm: (accountIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(() => connection.accounts.map((account) => account.id));

  return <section className="plaid-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="plaid-account-selection-title">
    <div className="section-heading"><div><p className="eyebrow">PLAID ACCOUNT ACCESS</p><h2 id="plaid-account-selection-title">Choose which accounts to connect</h2></div><ShieldCheck size={20} className="section-icon" /></div>
    <p className="plaid-selection-copy"><strong>{connection.institutionName}</strong> returned these accounts. Only the ones you choose will be stored and synced.</p>
    <div className="plaid-account-list">
      {connection.accounts.map((account) => {
        const checked = selectedAccountIds.includes(account.id);
        return <label key={account.id} className={`plaid-account-option ${checked ? 'is-selected' : ''}`}>
          <input type="checkbox" checked={checked} onChange={() => setSelectedAccountIds((current) => checked ? current.filter((id) => id !== account.id) : [...current, account.id])} />
          <span><strong>{account.name}</strong><small>{account.type}{account.subtype ? ` · ${account.subtype}` : ''}{account.mask ? ` ·••${account.mask}` : ''}</small></span>
        </label>;
      })}
    </div>
    <div className="plaid-selection-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="primary-button" onClick={() => onConfirm(selectedAccountIds)} disabled={busy || selectedAccountIds.length === 0}>{busy ? 'Saving secure connection…' : `Connect ${selectedAccountIds.length} account${selectedAccountIds.length === 1 ? '' : 's'}`} <ArrowUpRight size={15} /></button></div>
  </section>;
}

function AccountsView({
  accounts,
  connectionBusy,
  connectionNotice,
  connectionNoticeError,
  pendingConnection,
  reportingTimezone,
  weekStartsOn,
  preferredCurrency,
  preferencesBusy,
  onReportingPreferencesChange,
  onConnect,
  onConfirmConnection,
  onCancelConnection,
  onSync,
  onDisconnect,
  onNavigate,
  onNotice,
}: {
  accounts: AppAccount[];
  connectionBusy: boolean;
  connectionNotice: string | null;
  connectionNoticeError: boolean;
  pendingConnection: PendingPlaidConnection | null;
  reportingTimezone: ReportingTimezone;
  weekStartsOn: WeekStartsOn;
  preferredCurrency: CurrencyCode | null;
  preferencesBusy: boolean;
  onReportingPreferencesChange: (next: { reportingTimezone: ReportingTimezone; weekStartsOn: WeekStartsOn; preferredCurrency: CurrencyCode | null }) => void;
  onConnect: () => void;
  onConfirmConnection: (accountIds: string[]) => void;
  onCancelConnection: () => void;
  onSync: () => void;
  onDisconnect: (itemId: string, institution: string) => void;
  onNavigate: (view: View) => void;
  onNotice: (notice: string) => void;
}) {
  const [policyOpen, setPolicyOpen] = useState(false);

  return <>
    <PageIntro action={<div className="page-intro-actions"><button type="button" className="outline-button" onClick={onSync} disabled={connectionBusy}><RefreshCw size={16} className={connectionBusy ? 'is-spinning' : undefined} /> Refresh bank data</button><button type="button" className="quiet-button" onClick={() => { onNotice('Reporting rules are below.'); document.getElementById('reporting-settings')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }}><Settings2 size={16} /> Reporting rules</button></div>}><p className="eyebrow">THE SOURCE MAP</p><h1>Accounts &amp; settings</h1><p className="intro-copy">Know which records are automatic, which are imported, and where a fresh connection is still needed.</p></PageIntro>
    {connectionNotice ? <div className={`connection-notice ${connectionNoticeError ? 'is-error' : ''}`} role="status"><BadgeCheck size={17} /><span>{connectionNotice}</span><span className="connection-notice-mark" aria-hidden="true"><CircleHelp size={16} /></span></div> : null}
    {pendingConnection ? <PlaidAccountSelectionDialog connection={pendingConnection} busy={connectionBusy} onConfirm={onConfirmConnection} onCancel={onCancelConnection} /> : null}
    <section className="account-grid">{accounts.map((account) => <AccountCard key={account.id} account={account} connectionBusy={connectionBusy} onSync={onSync} onDisconnect={onDisconnect} onNavigate={onNavigate} />)}<div className="panel add-account-card"><div className="add-account-icon"><Link2 size={19} /></div><h2>Connect another source</h2><p>Connect RBC through Plaid or keep a statement-only account. Credentials stay outside the browser.</p><button className="outline-button" onClick={onConnect} disabled={connectionBusy}><Landmark size={16} />{connectionBusy ? 'Opening secure link…' : 'Start bank connection'} <ArrowUpRight size={15} /></button><small className="connection-helper">Plaid environment is controlled by the Worker; account access is explicit.</small></div></section>
    <section className="settings-layout"><div id="reporting-settings" className="panel settings-panel" tabIndex={-1}><div className="section-heading"><div><p className="eyebrow">REPORTING SETTINGS</p><h2>How totals should read</h2></div><SlidersHorizontal size={18} className="section-icon" /></div><div className="settings-row"><div><strong>Total spending currency</strong><span>Choose a registered target for converted totals; original source currencies and amounts remain visible below.</span></div><select value={preferredCurrency ?? ''} disabled={preferencesBusy} onChange={(event) => onReportingPreferencesChange({ reportingTimezone, weekStartsOn, preferredCurrency: event.target.value ? event.target.value as CurrencyCode : null })} aria-label="Preferred reporting currency"><option value="">Source currencies (no conversion)</option>{supportedCurrencyCodes.map((code) => <option key={code} value={code}>{code} — reporting target</option>)}</select></div><div className="settings-row"><div><strong>Reporting timezone</strong><span>Dates are preserved from the source; this zone scopes the reporting window.</span></div><select value={reportingTimezone} disabled={preferencesBusy} onChange={(event) => onReportingPreferencesChange({ reportingTimezone: event.target.value as ReportingTimezone, weekStartsOn, preferredCurrency })} aria-label="Reporting timezone"><option value="America/Toronto">America/Toronto</option><option value="Asia/Shanghai">Asia/Shanghai</option></select></div><div className="settings-row"><div><strong>Week starts on</strong><span>Used by the “This week” window.</span></div><select value={weekStartsOn} disabled={preferencesBusy} onChange={(event) => onReportingPreferencesChange({ reportingTimezone, weekStartsOn: event.target.value.toLowerCase() as WeekStartsOn, preferredCurrency })} aria-label="Week start"><option value="monday">Monday</option><option value="sunday">Sunday</option></select></div></div><div className="panel privacy-panel"><div className="privacy-seal"><ShieldCheck size={22} /></div><p className="eyebrow">PRIVATE BY DEFAULT</p><h2>The ledger keeps its boundaries.</h2><ul><li><Check size={14} />Bank passwords never touch this app.</li><li><Check size={14} />Provisional alerts never hide in confirmed totals.</li><li><Check size={14} />Exports and backups are explicit actions.</li></ul><button type="button" className="text-button" onClick={() => setPolicyOpen((open) => !open)} aria-expanded={policyOpen} aria-controls="data-policy">{policyOpen ? 'Hide the data policy' : 'Read the data policy'} <ArrowUpRight size={14} /></button>{policyOpen ? <div id="data-policy" className="policy-details" role="region" aria-label="Data policy"><strong>This browser never receives bank passwords.</strong><span>Statements are parsed locally before review, while saved connections stay behind the protected Worker boundary.</span></div> : null}</div></section>
  </>;
}

function AccountCard({ account, connectionBusy, onSync, onDisconnect, onNavigate }: { account: AppAccount; connectionBusy: boolean; onSync: () => void; onDisconnect: (itemId: string, institution: string) => void; onNavigate: (view: View) => void }) {
  const isConnected = account.status === 'connected';
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const optionsPanelId = `${optionsId}-panel`;
  const optionsTitleId = `${optionsId}-title`;

  return <div className={`panel account-card ${account.currency.toLowerCase()}`}><div className="account-card-top"><div className="institution-mark">{account.institution === 'RBC Royal Bank' ? 'RBC' : 'BOC'}</div><StateBadge status={isConnected ? 'confirmed' : 'provisional'} /></div><p className="account-institution">{account.institution}</p><h2>{account.name}</h2><div className="account-currency"><span>{account.currency}</span><span>{account.kind}</span></div><div className="account-card-foot"><span>{isConnected ? <><span className="live-dot" /> Last synced {syncTimestampLabel(account.lastSyncedAt)}</> : <><CircleAlert size={14} /> Import only · connection needed</>}</span><button type="button" className={`icon-button ${optionsOpen ? 'is-active' : ''}`} aria-label={`${optionsOpen ? 'Close' : 'Open'} ${account.name} options`} aria-expanded={optionsOpen} aria-controls={optionsPanelId} onClick={() => setOptionsOpen((open) => !open)}><MoreHorizontal size={17} /></button></div>{optionsOpen ? <section id={optionsPanelId} className="account-options" role="region" aria-labelledby={optionsTitleId}><div className="account-options-heading"><div><p className="eyebrow">ACCOUNT OPTIONS</p><h3 id={optionsTitleId}>Account options</h3></div><button type="button" className="icon-button" aria-label="Close account options" onClick={() => setOptionsOpen(false)}><X size={16} /></button></div><dl className="account-options-details"><div><dt>Institution</dt><dd>{account.institution}</dd></div><div><dt>Currency</dt><dd>{account.currency} · {account.kind}</dd></div><div><dt>Status</dt><dd>{isConnected ? 'Connected via Plaid' : 'Import only'}</dd></div></dl><p className="account-options-copy">{isConnected ? 'A fresh bank sync can be queued without leaving this page.' : 'Add a statement from the import desk to keep this source current.'}</p>{isConnected ? <><button type="button" className="outline-button" onClick={onSync} disabled={connectionBusy}><RefreshCw size={15} className={connectionBusy ? 'is-spinning' : undefined} />{connectionBusy ? 'Refreshing…' : 'Refresh bank data'}</button>{account.plaidItemId ? <button type="button" className="quiet-button disconnect-button" onClick={() => onDisconnect(account.plaidItemId!, account.institution)} disabled={connectionBusy}>Disconnect Plaid connection</button> : null}</> : <button type="button" className="outline-button" onClick={() => onNavigate('imports')}><FileUp size={15} />Open import &amp; review <ArrowUpRight size={15} /></button>}</section> : null}</div>;
}

export default App;
