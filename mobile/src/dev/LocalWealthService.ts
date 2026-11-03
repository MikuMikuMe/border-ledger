/** Debug-only synthetic local-backend transport for Wealth emulator QA. */
import type { WealthBankTransaction, WealthCsvMapping, WealthService } from '../features/wealth/contracts';
import { nativeWealthFixture } from './NativeWealthFixture';

const root = 'http://127.0.0.1:8794/api/wealth';
type LocalOperation = { operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null };
const operations = new Map<string, LocalOperation>();
const csvPreviews = new Map<string, string>();
const csvSources = new Map<string, string>();

async function request(path: string, init?: RequestInit): Promise<string> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) throw new Error('Debug fixture only');
  const response = await fetch(`${root}${path}`, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`Local Wealth service unavailable (${response.status}).`);
  return response.text();
}

function statusFor(status: number) {
  if (status >= 200 && status < 300) return 'completed';
  if (status === 409) return 'revision_conflict';
  if (status === 400 || status === 404) return 'rejected';
  return 'reconciliation_required';
}

type LocalRecord = Record<string, unknown>;

function localRecord(value: unknown): LocalRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LocalRecord : null;
}

function localMoney(value: unknown): { currency: string; amountMinor: string } | null {
  const money = localRecord(value);
  if (!money || typeof money.currency !== 'string') return null;
  if (typeof money.amountMinor !== 'number' && typeof money.amountMinor !== 'string') return null;
  return { currency: money.currency, amountMinor: String(money.amountMinor) };
}

function localText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function localBankTransaction(value: unknown): WealthBankTransaction | null {
  const row = localRecord(value);
  if (!row) return null;
  const id = localText(row?.transactionId);
  const date = localText(row?.date);
  if (!id || !date) return null;
  const money = localMoney(row.money);
  if (!money) return null;
  try {
    const amount = BigInt(money.amountMinor);
    const signed = row.direction === 'outflow' ? -amount : amount;
    return {
      id, occurredAt: date, currency: money.currency, signedMinorUnits: signed.toString(),
      merchant: localText(row.merchant), accountLabel: localText(row.accountName),
      status: localText(row.status) ?? 'confirmed', sourceLabel: localText(row.source), category: localText(row.category),
      note: null, kind: localText(row.bankKind) ?? 'bank', revision: 0, accountId: localText(row.accountId),
    };
  } catch {
    return null;
  }
}

function bankTransactionsFromReport(raw: string): WealthBankTransaction[] {
  try {
    const report = localRecord(JSON.parse(raw));
    if (!report) return [];
    const groups = ['householdCashFlows', 'investmentCashFlows', 'cashFlows'];
    const values = groups.flatMap(group => Array.isArray(report[group]) ? report[group] : []);
    const seen = new Set<string>();
    return values.map(localBankTransaction).filter((row): row is WealthBankTransaction => {
      if (!row || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  } catch {
    return [];
  }
}

type LocalWritePlan = { path: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; payload?: Record<string, unknown> };
type LocalWritePlanFactory = (operationId: string, payload: Record<string, unknown>) => LocalWritePlan;

function localOperation(operationId: string, action: string, status: string): LocalOperation {
  const result = { operationId, kind: `wealth_${action}`, status, updatedAt: new Date().toISOString(), resultId: null };
  operations.set(operationId, result);
  return result;
}

async function saveFixtureExport(operationId: string): Promise<LocalOperation> {
  const csv = await request('/export');
  const saved = await nativeWealthFixture.saveDocument(csv, 'border-ledger-wealth.csv');
  return localOperation(operationId, 'csv-export', saved ? 'completed' : 'canceled');
}

const wealthWritePlans: Record<string, LocalWritePlanFactory> = {
  account: (_operationId, payload) => ({ path: '/accounts', method: 'PUT', payload }),
  instrument: (_operationId, payload) => ({ path: '/instruments', method: 'PUT', payload }),
  valuation: (_operationId, payload) => ({ path: '/valuations', method: 'PUT', payload }),
  event: (operationId, payload) => ({ path: '/events', method: 'POST', payload: eventEnvelope(operationId, payload) }),
  correction: (operationId, payload) => ({ path: '/events', method: 'POST', payload: eventEnvelope(operationId, payload) }),
  reversal: (operationId, payload) => ({ path: '/events', method: 'POST', payload: eventEnvelope(operationId, payload) }),
  'csv-preview': (operationId, payload) => ({ path: '/imports/preview', method: 'POST', payload: { ...payload, operationId } }),
  'csv-commit': (operationId, payload) => ({ path: `/imports/${encodeURIComponent(String(payload.previewId ?? ''))}/commit`, method: 'POST', payload: { ...payload, operationId } }),
  'csv-export': () => ({ path: '/export', method: 'GET' }),
  'quote-save': (_operationId, payload) => ({ path: '/quotes/settings', method: 'PUT', payload }),
  'quote-remove': (_operationId, payload) => ({ path: `/quotes/settings?provider=${encodeURIComponent(String(payload.provider ?? 'alpha_vantage'))}`, method: 'DELETE' }),
  'quote-refresh': (_operationId, payload) => ({ path: '/quotes/refresh', method: 'POST', payload }),
};

function eventEnvelope(operationId: string, payload: Record<string, unknown>): Record<string, unknown> {
  const { expectedRevision, ...event } = payload;
  return expectedRevision === undefined ? { operationId, event } : { operationId, expectedRevision, event };
}

export const localWealthService: WealthService = {
  async read(query = {}) {
    const path = '/report';
    const params = new URLSearchParams();
    params.set('reportingCurrency', 'CAD');
    if (query.asOf) params.set('asOf', query.asOf);
    if (query.periodStart) params.set('from', query.periodStart);
    if (query.periodEnd) params.set('to', query.periodEnd);
    const suffix = params.toString();
    return request(`${path}${suffix ? `?${suffix}` : ''}`);
  },
  async readBankTransactions() {
    return bankTransactionsFromReport(await request('/report?reportingCurrency=CAD'));
  },
  readQuoteSettings: () => request('/quotes/settings'),
  readEvents: accountId => {
    const suffix = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    return request(`/events${suffix}`);
  },
  readValuations: accountId => {
    const suffix = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    return request(`/valuations${suffix}`);
  },
  readTemplate: () => request('/template'),
  async startCsvImport(operationId) {
    const csv = await nativeWealthFixture.pickCsv();
    if (csv === null) {
      const result = { operationId, kind: 'wealth_csv-preview', status: 'canceled', updatedAt: new Date().toISOString(), resultId: null };
      operations.set(operationId, result);
      return result;
    }
    csvSources.set(operationId, csv);
    const preview = await request('/imports/preview', { method: 'POST', body: JSON.stringify({ operationId, csv }) });
    csvPreviews.set(operationId, preview);
    const result = { operationId, kind: 'wealth_csv-preview', status: 'completed', updatedAt: new Date().toISOString(), resultId: null };
    operations.set(operationId, result);
    return result;
  },
  async startCsvRemap(sourceOperationId: string, operationId: string, mapping: WealthCsvMapping) {
    const csv = csvSources.get(sourceOperationId);
    if (!csv) throw new Error('Choose a Wealth CSV file before mapping columns.');
    const preview = await request('/imports/preview', { method: 'POST', body: JSON.stringify({ operationId, csv, mapping }) });
    csvSources.set(operationId, csv);
    csvPreviews.set(operationId, preview);
    return localOperation(operationId, 'csv-preview', 'completed');
  },
  async startCsvTemplate(operationId) {
    const template = await request('/template');
    const saved = await nativeWealthFixture.saveDocument(template, 'border-ledger-wealth-template.csv');
    const result = { operationId, kind: 'wealth_csv-template', status: saved ? 'completed' : 'canceled', updatedAt: new Date().toISOString(), resultId: null };
    operations.set(operationId, result);
    return result;
  },
  readCsvPreview: async operationId => csvPreviews.get(operationId) ?? null,
  async startWrite(operationId, action, body) {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const plan = wealthWritePlans[action]?.(operationId, payload);
    if (!plan) throw new Error('Unknown Wealth write action.');
    if (action === 'csv-export') return saveFixtureExport(operationId);
    const response = await fetch(`${root}${plan.path}`, {
      method: plan.method,
      headers: { Accept: 'text/csv, application/json', 'Content-Type': 'application/json' },
      ...(plan.payload === undefined ? {} : { body: JSON.stringify(plan.payload) }),
    });
    const result = localOperation(operationId, action, statusFor(response.status));
    if (!response.ok) throw new Error(`Local Wealth write rejected (${response.status}).`);
    return result;
  },
};
