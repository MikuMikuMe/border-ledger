// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { LedgerApi } from '../src/domain/api';
import { WealthView } from '../src/components/wealth/WealthView';
import { WealthImportPanel } from '../src/components/wealth/WealthImportPanel';
import { buildEventBody, type EventDraft } from '../src/components/wealth/wealth-event-utils';
import { normalizeEventHistory, normalizeReport, normalizeSnapshot } from '../src/components/wealth/wealth-utils';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = {
  asOf: '2026-10-31',
  accounts: [{ id: 'brokerage', name: 'Questrade', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
  positions: [{
    accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2.5', costBasisMinor: 25000, basisKnown: true, realizedGainMinor: 1000,
    valuation: { accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, asOf: '2026-10-31', priceMinor: 12000, source: 'manual' }, marketValueMinor: 30000, unrealizedGainMinor: 5000,
  }],
  cash: [{ accountId: 'brokerage', currency: 'CAD', amountMinor: 5000 }], totalByCurrency: { CAD: 35000, CNY: 120000 }, totalStatusByCurrency: { CAD: 'complete', CNY: 'complete' }, revision: 7, fx: { convertedCadMinor: 215000, complete: true, unavailable: [] },
};
const report = {
  ...snapshot,
  cashFlows: [{ sourceId: 'flow-1', date: '2026-10-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 1000 }, classification: 'external_contribution', includedInPerformance: true, reason: 'Explicit contribution' }],
  investmentCashFlows: [],
  modifiedDietz: { value: 0.12, available: true, reason: null },
  history: [{ date: '2026-10-01', totals: { CAD: 30000, CNY: 120000 }, convertedCadMinor: 210000 }, { date: '2026-10-31', totals: { CAD: 35000, CNY: 120000 }, convertedCadMinor: 215000 }],
};
const emptySnapshot = { ...snapshot, accounts: [], positions: [], cash: [], totalByCurrency: {}, totalStatusByCurrency: {}, revision: 0 };
const emptyReport = { ...report, ...emptySnapshot, cashFlows: [], history: [], modifiedDietz: { value: null, available: false, reason: 'missing_start_valuation' } };
const incompleteCurrencySnapshot = {
  ...snapshot,
  accounts: [
    ...snapshot.accounts,
    { id: 'unvalued-cny', name: 'Unvalued CNY asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CNY', valueState: 'missing', valueMinor: null },
    { id: 'known-cny', name: 'Known CNY asset', kind: 'manual_asset', mode: 'aggregate', currency: 'CNY', valueState: 'fresh', valueMinor: 10000 },
  ],
  totalByCurrency: { ...snapshot.totalByCurrency, CNY: 10000 },
  totalStatusByCurrency: { ...snapshot.totalStatusByCurrency, CNY: 'complete' },
};
const incompleteCurrencyReport = { ...report, ...incompleteCurrencySnapshot };
const aggregateBrokerageSnapshot = {
  ...snapshot,
  accounts: [{ id: 'brokerage', name: 'Questrade', kind: 'brokerage', mode: 'aggregate', currency: 'CAD', valueMinor: 100000, valueState: 'fresh', valueObservedAt: '2026-10-01' }],
  positions: [],
  cash: [],
  totalByCurrency: { CAD: 100000 },
  totalStatusByCurrency: { CAD: 'complete' },
};
const aggregateBrokerageReport = { ...report, ...aggregateBrokerageSnapshot, cashFlows: [], householdCashFlows: [], investmentCashFlows: [], history: [] };
const etfSnapshot = {
  ...snapshot,
  accounts: [{ id: 'brokerage', name: 'Questrade', kind: 'brokerage', mode: 'holdings', currency: 'USD' }],
  positions: [{ ...snapshot.positions[0], instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'USD' }, valuation: { accountId: 'brokerage', instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'USD' }, asOf: '2026-10-31', priceMinor: 12000, source: 'manual' }, marketValueMinor: 30000 }],
  cash: [{ accountId: 'brokerage', currency: 'USD', amountMinor: 5000 }],
  totalByCurrency: { USD: 35000 },
  totalStatusByCurrency: { USD: 'complete' },
};
const etfReport = { ...report, ...etfSnapshot, cashFlows: [], householdCashFlows: [], investmentCashFlows: [], history: [] };
const manualOnlySnapshot = { ...snapshot, accounts: [{ id: 'savings', name: 'Emergency savings', kind: 'manual_asset', mode: 'aggregate', currency: 'CAD', valueMinor: 150000, valueState: 'fresh' }], positions: [], cash: [], totalByCurrency: { CAD: 150000 }, totalStatusByCurrency: { CAD: 'complete' } };
const manualOnlyReport = { ...report, ...manualOnlySnapshot, cashFlows: [], householdCashFlows: [], investmentCashFlows: [], history: [] };
const twoAccountSnapshot = {
  ...snapshot,
  accounts: [...snapshot.accounts, { id: 'usd-brokerage', name: 'US brokerage', kind: 'brokerage', mode: 'holdings', currency: 'USD' }],
  cash: [...snapshot.cash, { accountId: 'usd-brokerage', currency: 'USD', amountMinor: 99900 }],
  totalByCurrency: { CAD: 35000, USD: 99900 },
  totalStatusByCurrency: { CAD: 'complete', USD: 'complete' },
};
const twoAccountReport = { ...report, ...twoAccountSnapshot, cashFlows: [], householdCashFlows: [], investmentCashFlows: [], history: [] };

function mount(api: LedgerApi, linkedAccounts: readonly { id: string; name: string; currency?: string }[] = []) {
  const node = document.createElement('div'); const root = createRoot(node); document.body.append(node);
  return act(async () => { root.render(createElement(WealthView, { api, linkedAccounts })); await new Promise((resolve) => setTimeout(resolve, 0)); return { node, close: () => { act(() => root.unmount()); node.remove(); } }; });
}

type CapturedWrite = { path: string; body: Record<string, unknown> };

function captureApi(writes: CapturedWrite[], snapshotValue: unknown, reportValue: unknown, responses: Record<string, unknown> = {}): LedgerApi {
  return (async (path: string, init?: RequestInit) => {
    if (init) { writes.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> }); return { revision: 8 }; }
    if (Object.hasOwn(responses, path)) return responses[path];
    return path.startsWith('/api/wealth/report') ? reportValue : snapshotValue;
  }) as LedgerApi;
}

function revisionConflictApi(writes: CapturedWrite[]): LedgerApi {
  let attempts = 0;
  return (async (path: string, init?: RequestInit) => {
    if (init && path === '/api/wealth/accounts') {
      writes.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      attempts += 1;
      if (attempts === 1) throw new Error('revision conflict');
      return { revision: 8 };
    }
    return path.startsWith('/api/wealth/report') ? aggregateBrokerageReport : aggregateBrokerageSnapshot;
  }) as LedgerApi;
}

function twoAccountApi(): LedgerApi {
  return (async (path: string) => path.startsWith('/api/wealth/report') ? twoAccountReport : twoAccountSnapshot) as LedgerApi;
}

function securityHistoryApi(revision: { value: number } = { value: 7 }): LedgerApi {
  return (async (path: string) => {
    const selected = new URL(path, 'https://fixture.test').searchParams.get('instrumentKey');
    const matches = (entry: { instrument: { exchange: string; ticker: string; type: string; currency: string } }) => !selected || Object.values(entry.instrument).join(':') === selected;
    if (path.startsWith('/api/wealth/events?accountId=brokerage')) return { revision: revision.value, events: [{ sourceId: 'shop-event', date: '2026-10-01', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' } }, { sourceId: 'vti-event', date: '2026-10-02', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'USD' } }].filter(matches) };
    if (path.startsWith('/api/wealth/valuations?accountId=brokerage')) return { revision: revision.value, valuations: [{ id: 'shop-value', accountId: 'brokerage', asOf: '2026-10-01', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, priceMinor: 12000, source: 'manual' }, { id: 'vti-value', accountId: 'brokerage', asOf: '2026-10-02', instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'USD' }, priceMinor: 22000, source: 'manual' }].filter(matches) };
    return path.startsWith('/api/wealth/report') ? report : snapshot;
  }) as LedgerApi;
}

function correctionHistoryApi(original: Record<string, unknown>, correction: Record<string, unknown>): LedgerApi {
  return (async (path: string) => {
    if (path.startsWith('/api/wealth/events?accountId=brokerage')) return { revision: 7, events: [original, correction] };
    if (path.startsWith('/api/wealth/valuations?accountId=brokerage')) return { revision: 7, valuations: [] };
    return path.startsWith('/api/wealth/report') ? report : snapshot;
  }) as LedgerApi;
}

function correctionWriteFailure(path: string, failFirstWrite: boolean, attempts: { value: number }): boolean {
  if (!failFirstWrite || path !== '/api/wealth/events') return false;
  const first = attempts.value === 0;
  attempts.value += 1;
  return first;
}

function correctionEventApi(writes: CapturedWrite[], target: Record<string, unknown>, failFirstWrite = false): LedgerApi {
  const attempts = { value: 0 };
  const responses = new Map<string, unknown>([
    ['/api/wealth/events?limit=500', { events: [target], revision: 7 }],
    ['/api/transactions?currency=all', { transactions: [{ id: 'bank-tx-1', date: '2026-10-01', merchant: 'Questrade funding', account_id: 'bank', amount_minor: -24100, currency: 'CAD', status: 'confirmed' }, { id: 'bank-tx-2', date: '2026-10-02', merchant: 'Replacement funding', account_id: 'bank', amount_minor: -24100, currency: 'CAD', status: 'confirmed' }] }],
  ]);
  return (async (path: string, init?: RequestInit) => {
    if (init) {
      writes.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (correctionWriteFailure(path, failFirstWrite, attempts)) throw new Error('temporary event write failure');
      return { revision: 8 };
    }
    return responses.get(path) ?? (path.startsWith('/api/wealth/report') ? report : snapshot);
  }) as LedgerApi;
}

async function clickButton(node: HTMLElement, label: string): Promise<HTMLButtonElement> {
  const button = [...node.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label) as HTMLButtonElement | undefined;
  expect(button).toBeTruthy();
  await act(async () => { button?.click(); });
  return button!;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tableByCaption(node: HTMLElement, caption: string): HTMLTableElement | undefined {
  return [...node.querySelectorAll('table')].find((table) => table.querySelector('caption')?.textContent === caption) as HTMLTableElement | undefined;
}

describe('wealth web view', () => {
  it('loads the overview with source-currency totals and an accessible history table', async () => {
    const paths: string[] = [];
    const api = (async (path: string) => { paths.push(path); return path.startsWith('/api/wealth/report') ? report : snapshot; }) as LedgerApi;
    const view = await mount(api);
    try { expect(paths.some((path) => path.startsWith('/api/wealth/snapshot') && path.includes('asOf='))).toBe(true); expect(paths.some((path) => path.startsWith('/api/wealth/report') && path.includes('from=') && path.includes('to=') && path.includes('asOf='))).toBe(true); expect(view.node.textContent).toContain('Net worth'); expect(view.node.textContent).toContain('As of 2026-10-31'); expect(view.node.textContent).toContain('CAD'); expect(view.node.textContent).toContain('CNY'); expect(view.node.textContent).toContain('Questrade'); expect(view.node.querySelector('table[aria-label="Net worth history"]')).toBeTruthy(); } finally { view.close(); }
  });

  it('renders the server FX source, effective date, and exact quotes beside the optional estimate', async () => {
    const fx = { convertedCadMinor: 215000, complete: true, unavailable: [], effectiveDate: '2026-10-30', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.4821', CNY: '8.0412' } };
    const fxSnapshot = { ...snapshot, fx };
    const fxReport = { ...report, ...fxSnapshot, fx };
    expect(normalizeReport(fxReport, normalizeSnapshot(fxSnapshot)!)).toMatchObject({ fx: { effectiveDate: '2026-10-30', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.4821', CNY: '8.0412' } } });
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? fxReport : fxSnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      expect(view.node.textContent).toContain('Rate source: Frankfurter');
      expect(view.node.textContent).toContain('Effective 2026-10-30');
      expect(view.node.textContent).toContain('1 EUR = 1.4821 CAD');
      expect(view.node.textContent).toContain('1 EUR = 8.0412 CNY');
      const toggle = view.node.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(toggle).toBeTruthy();
      await act(async () => { toggle?.click(); });
      expect(view.node.textContent).toContain('CAD conversion is dated 2026-10-30 by Frankfurter.');
      expect(view.node.textContent).toContain('$2,150.00');
    } finally { view.close(); }
  });

  it('keeps the CAD estimate unavailable when the server has no FX provenance', async () => {
    const fx = { convertedCadMinor: null, complete: false, unavailable: ['CNY'], effectiveDate: null, provider: null, baseCurrency: null, rates: {} };
    const fxSnapshot = { ...snapshot, fx };
    const fxReport = { ...report, ...fxSnapshot, fx };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? fxReport : fxSnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const toggle = view.node.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      await act(async () => { toggle?.click(); });
      expect(view.node.textContent).toContain('CAD estimate unavailable');
      expect(view.node.textContent).toContain('CAD conversion unavailable for CNY.');
      expect(view.node.textContent).not.toContain('Rate source:');
      expect(view.node.textContent).not.toContain('Effective 2026-10-30');
    } finally { view.close(); }
  });

  it('preserves history completeness and labels known subtotals without presenting them as full totals', async () => {
    const workerHistory = [
      { date: '2026-10-01', totals: { CAD: 0 }, convertedCadMinor: 0, complete: false, stale: true, missingData: ['Debt account'] },
      { date: '2026-10-31', totals: { CAD: 35000 }, convertedCadMinor: 35000, complete: true, stale: false, missingData: [] },
    ];
    const workerReport = { ...report, history: workerHistory };
    const normalized = normalizeReport(workerReport, normalizeSnapshot(snapshot)!);
    expect(normalized?.history).toMatchObject([{ complete: false }, { complete: true }]);
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? workerReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const table = view.node.querySelector('table[aria-label="Net worth history"]');
      expect(table?.textContent).toContain('Coverage');
      expect(table?.textContent).toContain('Incomplete · known subtotal · 1 dated observation missing');
      expect(table?.textContent).not.toContain('Debt account');
      expect(table?.textContent).toContain('Complete');
      expect(view.node.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('incomplete known subtotals');
      expect(view.node.querySelectorAll('.wealth-history-bar.is-incomplete')).toHaveLength(1);
    } finally { view.close(); }
  });

  it('does not double-count a generic valuation gap already explained by a missing account', async () => {
    const workerFx = { convertedCadMinor: null, complete: false, unavailable: [], effectiveDate: '2026-11-02', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.5', USD: '1.1' } };
    const workerReport = {
      ...report,
      ...snapshot,
      fx: workerFx,
      missingData: ['account:debt-account', 'valuation:CAD'],
      history: [{ date: '2026-11-02', totals: { CAD: 1000 }, convertedCadMinor: null, complete: false, stale: false, missingData: ['account:debt-account', 'valuation:CAD'] }],
    };
    const normalized = normalizeReport(workerReport, normalizeSnapshot({ ...snapshot, fx: workerFx })!);
    expect(normalized?.coverage.message).toBe('1 dated value still need review.');
    expect(normalized?.history[0]?.missingData).toEqual(['account:debt-account']);
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? workerReport : { ...snapshot, fx: workerFx }) as LedgerApi;
    const view = await mount(api);
    try {
      expect(view.node.textContent).toContain('1 dated value still need review.');
      expect(view.node.textContent).not.toContain('2 dated values need review.');
      expect(view.node.textContent).not.toContain('CAD conversion unavailable');
    } finally { view.close(); }
  });

  it('plots negative net-worth history below zero instead of mirroring it positive', async () => {
    const signedReport = {
      ...report,
      history: [
        { date: '2026-10-01', totals: { CAD: -10000 }, convertedCadMinor: -10000, complete: true, stale: false, missingData: [] },
        { date: '2026-10-31', totals: { CAD: 20000 }, convertedCadMinor: 20000, complete: true, stale: false, missingData: [] },
      ],
    };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? signedReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const bars = [...view.node.querySelectorAll('.wealth-history-bar')];
      const negative = bars.find((bar) => bar.classList.contains('is-negative')) as HTMLElement | undefined;
      const positive = bars.find((bar) => !bar.classList.contains('is-negative')) as HTMLElement | undefined;
      expect(negative).toBeTruthy();
      expect(negative?.style.top).toBe('50%');
      expect(positive?.style.bottom).toBe('50%');
      expect(view.node.querySelector('.wealth-history-track.is-signed')).toBeTruthy();
      expect(view.node.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Negative values extend below zero');
      expect(view.node.querySelector('table[aria-label="Net worth history"]')?.textContent).toContain('-$100.00');
    } finally { view.close(); }
  });

  it('shows an explicitly observed zero holdings balance without inventing one for unknown accounts', async () => {
    const zeroHoldingsSnapshot = {
      ...snapshot,
      accounts: [
        { id: 'zero-holdings', name: 'Zero holdings', kind: 'brokerage', mode: 'holdings', currency: 'CAD', amountMinor: 0 },
        { id: 'unknown-holdings', name: 'Unknown holdings', kind: 'brokerage', mode: 'holdings', currency: 'CAD', amountMinor: null },
      ],
      positions: [],
      cash: [],
      totalByCurrency: {},
      totalStatusByCurrency: {},
    };
    const zeroHoldingsReport = { ...report, ...zeroHoldingsSnapshot, history: [] };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? zeroHoldingsReport : zeroHoldingsSnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const zeroRow = [...view.node.querySelectorAll('.wealth-account-row')].find((row) => row.textContent?.includes('Zero holdings'));
      const unknownRow = [...view.node.querySelectorAll('.wealth-account-row')].find((row) => row.textContent?.includes('Unknown holdings'));
      expect(zeroRow?.textContent).toContain('$0.00');
      expect(zeroRow?.textContent).toContain('Observed zero balance');
      expect(zeroRow?.textContent).not.toContain('Unavailable');
      expect(unknownRow?.textContent).toContain('Unavailable');
    } finally { view.close(); }
  });

  it('renders household cash-flow categories when the report provides separate flow lanes', async () => {
    const householdReport = { ...report, cashFlows: undefined, householdCashFlows: [{ sourceId: 'bank-1', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 4200 }, bankKind: 'expense', category: 'Groceries', classification: 'ambiguous', includedInPerformance: false, reason: 'Household category' }], investmentCashFlows: [] };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? householdReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try { const cashFlow = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cash flow'); expect(cashFlow).toBeTruthy(); await act(async () => { cashFlow?.click(); }); expect(view.node.textContent).toContain('Household cash flow'); expect(view.node.textContent).toContain('Groceries'); expect(view.node.textContent).toContain('Money out'); } finally { view.close(); }
  });

  it('drills into standalone wealth events without requiring a bank transaction', async () => {
    const eventReport = { ...report, cashFlows: undefined, householdCashFlows: [{ sourceId: 'wealth-dividend-1', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 4200 }, eventKind: 'dividend', kind: 'contribution', classification: 'ambiguous', includedInPerformance: false, reason: 'Recorded investment income' }], investmentCashFlows: [] };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? eventReport : snapshot) as LedgerApi; const view = await mount(api);
    try { const cashFlow = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cash flow'); await act(async () => { cashFlow?.click(); }); const detail = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'View wealth event'); expect(detail).toBeTruthy(); await act(async () => { detail?.click(); }); expect(view.node.textContent).toContain('Wealth ledger event'); expect(view.node.textContent).toContain('dividend'); } finally { view.close(); }
  });

  it('counts standalone investment income and withholding in household cash-flow totals', async () => {
    const eventReport = {
      ...report,
      cashFlows: undefined,
      householdCashFlows: [
        { sourceId: 'wealth-dividend-1', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 4200 }, eventKind: 'dividend', kind: 'contribution', classification: 'ambiguous', includedInPerformance: false, reason: 'Recorded investment income' },
        { sourceId: 'wealth-withholding-1', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, eventKind: 'withholding', kind: 'withdrawal', classification: 'ambiguous', includedInPerformance: false, reason: 'Recorded withholding' },
      ],
      investmentCashFlows: [],
    };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? eventReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Cash flow');
      expect(view.node.textContent).toContain('Money in$42.00 CAD');
      expect(view.node.textContent).toContain('Money out$1.00 CAD');
      expect(view.node.textContent).toContain('Net cash flow$41.00 CAD');
      expect(view.node.textContent).toContain('Type');
      expect(view.node.textContent).toContain('Dividend');
      expect(view.node.textContent).toContain('Withholding');
      expect(view.node.textContent).toContain('Income');
      expect(view.node.textContent).toContain('Withholding');
    } finally { view.close(); }
  });

  it('adds standalone investment income and deduplicates its linked bank record', async () => {
    const eventReport = {
      ...report,
      cashFlows: undefined,
      householdCashFlows: [{ sourceId: 'bank-fee', transactionId: 'txn-fee', linkedWealthSourceId: 'wealth-fee', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, bankKind: 'fee', category: 'Brokerage fee', classification: 'ambiguous', includedInPerformance: false, reason: 'Linked investment fee' }],
      investmentCashFlows: [
        { sourceId: 'wealth-dividend', date: '2026-10-10', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 4200 }, eventKind: 'dividend', direction: 'inflow', kind: 'contribution', classification: 'ambiguous', includedInPerformance: false, reason: 'Standalone wealth dividend' },
        { sourceId: 'wealth-fee', linkedWealthSourceId: 'wealth-fee', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 100 }, eventKind: 'fee', direction: 'outflow', kind: 'withdrawal', classification: 'ambiguous', includedInPerformance: false, reason: 'Linked investment fee' },
      ],
    };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? eventReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Cash flow');
      expect(view.node.textContent).toContain('Money in$42.00 CAD');
      expect(view.node.textContent).toContain('Money out$1.00 CAD');
      expect(view.node.textContent).toContain('Net cash flow$41.00 CAD');
      expect(view.node.textContent).toContain('Dividend');
      expect(view.node.textContent).toContain('Brokerage fee');
      expect(view.node.querySelectorAll('tbody tr')).toHaveLength(2);
      const wealthDetail = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'View wealth event');
      expect(wealthDetail).toBeTruthy();
      await act(async () => { wealthDetail?.click(); });
      expect(view.node.textContent).toContain('Wealth ledger event');
    } finally { view.close(); }
  });

  it('shows explicit investment contributions from the investment flow lane', async () => {
    const investmentReport = {
      ...report,
      cashFlows: undefined,
      householdCashFlows: [],
      investmentCashFlows: [{ sourceId: 'wealth-contribution-1', date: '2026-10-12', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 10000 }, direction: 'inflow', kind: 'contribution', classification: 'external_contribution', includedInPerformance: true, reason: 'Explicit contribution' }],
    };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? investmentReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Cash flow');
      expect(view.node.textContent).toContain('External investment flows$100.00 CAD in');
    } finally { view.close(); }
  });

  it('keeps an empty ledger actionable so the first account form opens', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? emptyReport : emptySnapshot) as LedgerApi; const view = await mount(api);
    try { const first = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Add your first account')); expect(first).toBeTruthy(); await act(async () => { first?.click(); }); expect(view.node.textContent).toContain('Manual asset'); expect(view.node.querySelector('input[name="account-name"]')).toBeTruthy(); } finally { view.close(); }
  });

  it('keeps empty-ledger import reachable and preserves management after cancelling account setup', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? emptyReport : emptySnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const importButton = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Import a portfolio CSV'));
      expect(importButton).toBeTruthy();
      await act(async () => { importButton?.click(); });
      expect(view.node.textContent).toContain('Manage wealth accounts');
      expect(view.node.textContent).toContain('CSV activity import');
      const back = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Back to Overview'));
      await act(async () => { back?.click(); });
      const first = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Add your first account'));
      await act(async () => { first?.click(); });
      const close = view.node.querySelector('button[aria-label="Close account form"]') as HTMLButtonElement;
      expect(close).toBeTruthy();
      await act(async () => { close.click(); });
      expect(view.node.textContent).toContain('Manage wealth accounts');
      expect(view.node.textContent).toContain('CSV activity import');
      expect(view.node.querySelector('input[name="account-name"]')).toBeNull();
    } finally { view.close(); }
  });

  it('switches to investments and supports an account drilldown', async () => {
    const paths: string[] = []; const api = (async (path: string) => { paths.push(path); return path.startsWith('/api/wealth/report') ? report : snapshot; }) as LedgerApi; const view = await mount(api);
    try { const investments = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Investments'); expect(investments).toBeTruthy(); await act(async () => { investments?.click(); }); expect(view.node.textContent).toContain('Holdings'); expect(view.node.textContent).toContain('Modified Dietz'); const account = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Questrade')); expect(account).toBeTruthy(); await act(async () => { account?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(paths.some((path) => path.startsWith('/api/wealth/events?accountId=brokerage'))).toBe(true); expect(paths.some((path) => path.startsWith('/api/wealth/valuations?accountId=brokerage'))).toBe(true); expect(view.node.textContent).toContain('SHOP'); expect(view.node.textContent).toContain('Valuation history'); } finally { view.close(); }
  });

  it('scopes security drilldown history to the selected instrument', async () => {
    const view = await mount(securityHistoryApi());
    try {
      await clickButton(view.node, 'Investments');
      const holding = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('TSX:SHOP'));
      expect(holding).toBeTruthy();
      await act(async () => { (holding as HTMLButtonElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const eventTable = tableByCaption(view.node, 'Account event history');
      const valuationTable = tableByCaption(view.node, 'Account valuation history');
      expect(eventTable?.textContent).toContain('SHOP');
      expect(eventTable?.textContent).not.toContain('VTI');
      expect(valuationTable?.textContent).toContain('SHOP');
      expect(valuationTable?.textContent).not.toContain('VTI');
    } finally { view.close(); }
  });

  it('requests server-scoped security history and retains its reversal controls', async () => {
    const paths: string[] = [];
    const base = securityHistoryApi();
    const api = (async (path: string) => {
      paths.push(path);
      if (path.startsWith('/api/wealth/events?accountId=brokerage')) return { revision: 7, events: [{ id: 'undo', sourceId: 'undo', date: '2026-10-03', kind: 'reversal', targetSourceId: 'shop-event' }] };
      return base(path);
    }) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Investments');
      const security = [...view.node.querySelectorAll('button')].find(button => button.textContent?.includes('SHOP'));
      await act(async () => { security?.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(paths.some(path => path.includes('instrumentKey=TSX%3ASHOP%3Astock%3ACAD'))).toBe(true);
      expect(tableByCaption(view.node, 'Account event history')?.textContent).toContain('Reversal');
    } finally { view.close(); }
  });

  it('fails and retries drilldown history when endpoint revisions do not match the snapshot', async () => {
    const revision = { value: 8 };
    const view = await mount(securityHistoryApi(revision));
    try {
      await clickButton(view.node, 'Investments');
      const holding = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('TSX:SHOP')) as HTMLButtonElement;
      expect(holding).toBeTruthy();
      await act(async () => { holding.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.textContent).toContain('Account history changed while loading');
      const retry = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Retry history')) as HTMLButtonElement;
      expect(retry).toBeTruthy();
      revision.value = 7;
      await act(async () => { retry.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.textContent).toContain('Account event history');
      expect(view.node.textContent).toContain('Valuation history');
    } finally { view.close(); }
  });

  it('opens account history from the overview account breakdown', async () => {
    const paths: string[] = []; const api = (async (path: string) => { paths.push(path); return path.startsWith('/api/wealth/report') ? report : snapshot; }) as LedgerApi; const view = await mount(api);
    try { const account = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Questrade')); expect(account).toBeTruthy(); await act(async () => { account?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(paths.some((path) => path.startsWith('/api/wealth/events?accountId=brokerage'))).toBe(true); expect(view.node.textContent).toContain('Valuation history'); } finally { view.close(); }
  });

  it('renders Modified Dietz separately for each source currency', async () => {
    const dietzReport = { ...report, modifiedDietzByCurrency: { CAD: { value: 0.1, available: true, reason: null }, USD: { value: null, available: false, reason: 'incomplete_flows' } } };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? dietzReport : snapshot) as LedgerApi; const view = await mount(api);
    try { const investments = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Investments'); await act(async () => { investments?.click(); }); expect(view.node.textContent).toContain('Modified Dietz · CAD'); expect(view.node.textContent).toContain('Modified Dietz · USD'); expect(view.node.textContent).toContain('10.00%'); expect(view.node.textContent).toContain('Missing incomplete flows'); } finally { view.close(); }
  });

  it('renders server-authoritative per-currency allocation coverage', async () => {
    const allocationReport = { ...report, allocations: [{ currency: 'CAD', accountId: 'brokerage', kind: 'holding', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, valueMinor: 30000, share: 0.25, available: true }, { currency: 'CAD', accountId: 'brokerage', kind: 'cash', instrument: null, valueMinor: 5000, share: 0.05, available: true }] };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? allocationReport : snapshot) as LedgerApi; const view = await mount(api);
    try { const investments = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Investments'); await act(async () => { investments?.click(); }); expect(view.node.textContent).toContain('25.00% CAD'); expect(view.node.textContent).toContain('Cash'); expect(view.node.textContent).toContain('$300.00'); } finally { view.close(); }
  });

  it('renders aggregate account allocation rows from the Worker response shape', async () => {
    const allocationReport = { ...report, allocations: [{ currency: 'CAD', accountId: 'brokerage', kind: 'aggregate', instrument: null, valueMinor: 100000, share: 1, available: true }] };
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? allocationReport : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Investments');
      expect(view.node.textContent).toContain('Account total');
      expect(view.node.textContent).toContain('$1,000.00');
    } finally { view.close(); }
  });

  it('scopes investment cash to the selected account', async () => {
    const view = await mount(twoAccountApi());
    try { const investments = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Investments'); await act(async () => { investments?.click(); }); const account = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Questrade')); expect(account).toBeTruthy(); await act(async () => { account?.click(); }); const cashMetric = [...view.node.querySelectorAll('.wealth-source-metric')].find((metric) => metric.textContent?.includes('Cash balances')); expect(cashMetric?.textContent).toContain('$50.00'); expect(cashMetric?.textContent).not.toContain('$999.00'); } finally { view.close(); }
  });

  it('does not present a partial currency lane as complete when an account value is missing', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? incompleteCurrencyReport : incompleteCurrencySnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const cnyMetric = [...view.node.querySelectorAll('.wealth-source-metric')].find((metric) => metric.textContent?.includes('CNY total'));
      expect(cnyMetric?.textContent).toContain('Unavailable');
      expect(view.node.textContent).toContain('Unvalued CNY asset');
    } finally { view.close(); }
  });

  it('labels an empty debt bucket instead of treating it as unknown valuation', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? manualOnlyReport : manualOnlySnapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const subtotals = view.node.querySelector('.wealth-overview-subtotals');
      expect(subtotals?.textContent).toContain('No debts recorded');
      expect(subtotals?.textContent).not.toContain('Unavailable');
    } finally { view.close(); }
  });

  it('keeps an open form while validating a changed report period', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? report : snapshot) as LedgerApi;
    const view = await mount(api);
    try {
      const accounts = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Manage accounts');
      await act(async () => { accounts?.click(); });
      const add = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Add account'));
      await act(async () => { add?.click(); });
      const from = view.node.querySelector('input[aria-label="Report start date"]') as HTMLInputElement;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(from, '2999-01-01'); from.dispatchEvent(new Event('input', { bubbles: true })); from.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.querySelector('input[name="account-name"]')).toBeTruthy();
      expect(view.node.textContent).toContain('Choose a start date on or before the end date.');
    } finally { view.close(); }
  });

  it('fails closed when snapshot and report revisions differ', async () => {
    const api = (async (path: string) => path.startsWith('/api/wealth/report') ? { ...report, revision: 8 } : snapshot) as LedgerApi; const view = await mount(api);
    try { expect(view.node.textContent).toContain('Wealth data changed while loading'); expect(view.node.textContent).not.toContain('Net worth at a glance'); } finally { view.close(); }
  });

  it('opens the account form and sends a manual asset without echoing quote secrets', async () => {
    const writes: CapturedWrite[] = []; const view = await mount(captureApi(writes, snapshot, report));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Add account');
      expect(view.node.textContent).toContain('Manual asset');
      expect(view.node.textContent).toContain('Aggregate value');
      const name = view.node.querySelector('input[name="account-name"]') as HTMLInputElement;
      expect(name).toBeTruthy();
      await act(async () => { setInputValue(name, 'Home'); });
      const amount = view.node.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(amount, '1000'); });
      const save = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Save account')) as HTMLButtonElement;
      await act(async () => { save.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { expectedRevision: 7 } });
      expect(writes[1]).toMatchObject({ path: '/api/wealth/valuations', body: { expectedRevision: 8, asOf: expect.any(String) } });
      expect(view.node.textContent).not.toContain('demo-alpha-vantage-secret');
    } finally { view.close(); }
  });

  it('sends a newly created aggregate value with the chosen effective date', async () => {
    const writes: CapturedWrite[] = [];
    const api = (async (path: string, init?: RequestInit) => {
      if (init) {
        writes.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return path === '/api/wealth/accounts' ? { revision: 1, initialValuation: { asOf: '2026-11-02', priceMinor: 150000 } } : { revision: 2 };
      }
      return path.startsWith('/api/wealth/report') ? emptyReport : emptySnapshot;
    }) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Add your first account');
      const name = view.node.querySelector('input[name="account-name"]') as HTMLInputElement;
      const amount = view.node.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      const date = view.node.querySelector('form.wealth-form input[type="date"]') as HTMLInputElement;
      await act(async () => { setInputValue(name, 'Past savings'); setInputValue(amount, '1500'); setInputValue(date, '2026-11-02'); });
      await clickButton(view.node, 'Save account');
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { amountMinor: 150000, asOf: '2026-11-02' } });
    } finally { view.close(); }
  });

  it('preserves an inactive account flag when editing an account', async () => {
    const inactiveSnapshot = { ...snapshot, accounts: [{ ...snapshot.accounts[0], active: false }] };
    const inactiveReport = { ...report, ...inactiveSnapshot };
    const writes: CapturedWrite[] = [];
    const view = await mount(captureApi(writes, inactiveSnapshot, inactiveReport));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Edit account');
      const form = view.node.querySelector('form.wealth-form') as HTMLFormElement;
      const date = form.querySelector('input[type="date"]') as HTMLInputElement;
      await act(async () => { setInputValue(date, '2026-10-31'); });
      await clickButton(view.node, 'Save account');
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { active: false } });
    } finally { view.close(); }
  });

  it('keeps debt accounts aggregate-only', async () => {
    const view = await mount(captureApi([], manualOnlySnapshot, manualOnlyReport));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Add account');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'debt')) as HTMLSelectElement;
      await act(async () => { kind.value = 'debt'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
      const representation = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'holdings')) as HTMLSelectElement;
      expect(representation.disabled).toBe(true);
      expect(representation.value).toBe('aggregate');
    } finally { view.close(); }
  });

  it('guides an aggregate brokerage into holdings with an opening cash event', async () => {
    const writes: CapturedWrite[] = []; const view = await mount(captureApi(writes, aggregateBrokerageSnapshot, aggregateBrokerageReport));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Edit account');
      const mode = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'holdings')) as HTMLSelectElement;
      await act(async () => { mode.value = 'holdings'; mode.dispatchEvent(new Event('input', { bubbles: true })); mode.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(mode.value).toBe('holdings');
      expect(view.node.textContent).toContain('Opening cash for holdings');
      const openingCash = [...view.node.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Opening cash for holdings'))?.querySelector('input') as HTMLInputElement;
      await act(async () => { setInputValue(openingCash, '2500'); await new Promise((resolve) => setTimeout(resolve, 0)); });
      await clickButton(view.node, 'Save account');
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { id: 'brokerage', mode: 'holdings', expectedRevision: 7, modeTransition: { effectiveDate: expect.any(String), openingCashMinor: 250000 } } });
    } finally { view.close(); }
  });

  it('supports an aggregate-to-holdings opening position without opening cash', async () => {
    const writes: CapturedWrite[] = []; const view = await mount(captureApi(writes, aggregateBrokerageSnapshot, aggregateBrokerageReport));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Edit account');
      const form = view.node.querySelector('form.wealth-form') as HTMLFormElement;
      const mode = [...form.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'holdings')) as HTMLSelectElement;
      await act(async () => { mode.value = 'holdings'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
      const ticker = form.querySelector('input[placeholder="SHOP"]') as HTMLInputElement;
      const quantity = form.querySelector('input[placeholder="0"]') as HTMLInputElement;
      const exchange = form.querySelector('input[list="wealth-opening-exchanges"]') as HTMLInputElement;
      const type = [...form.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'etf')) as HTMLSelectElement;
      await act(async () => { setInputValue(exchange, 'NYSE ARCA'); setInputValue(ticker, 'VTI'); setInputValue(quantity, '3'); type.value = 'etf'; type.dispatchEvent(new Event('change', { bubbles: true })); });
      await clickButton(view.node, 'Save account');
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { mode: 'holdings', modeTransition: { effectiveDate: expect.any(String), openingPositions: [{ instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'CAD' }, quantity: '3' }] } } });
      expect((writes[0].body.modeTransition as Record<string, unknown>).openingCashMinor).toBeUndefined();
    } finally { view.close(); }
  });

  it('switches holdings to aggregate with one atomic opening-value request', async () => {
    const writes: CapturedWrite[] = []; const view = await mount(captureApi(writes, snapshot, report));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Edit account');
      const form = view.node.querySelector('form.wealth-form') as HTMLFormElement;
      const mode = [...form.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'aggregate')) as HTMLSelectElement;
      await act(async () => { mode.value = 'aggregate'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
      const date = form.querySelector('input[type="date"]') as HTMLInputElement;
      const value = [...form.querySelectorAll('input[placeholder="0.00"]')].at(-1) as HTMLInputElement;
      await act(async () => { setInputValue(date, '2026-11-01'); setInputValue(value, '1800'); });
      await clickButton(view.node, 'Save account');
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ path: '/api/wealth/accounts', body: { id: 'brokerage', mode: 'aggregate', amountMinor: 180000, expectedRevision: 7, modeTransition: { effectiveDate: '2026-11-01', openingValueMinor: 180000 } } });
    } finally { view.close(); }
  });

  it('keeps an atomic mode transition draft stable after a revision conflict', async () => {
    const writes: CapturedWrite[] = [];
    const view = await mount(revisionConflictApi(writes));
    try {
      await clickButton(view.node, 'Manage accounts');
      await clickButton(view.node, 'Edit account');
      const mode = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'holdings')) as HTMLSelectElement;
      await act(async () => { mode.value = 'holdings'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
      const openingCash = [...view.node.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Opening cash for holdings'))?.querySelector('input') as HTMLInputElement;
      await act(async () => { setInputValue(openingCash, '2500'); });
      const save = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Save account')) as HTMLButtonElement;
      await act(async () => { save.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.textContent).toContain('data changed while the form was open');
      await act(async () => { save.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes).toHaveLength(2);
      expect(writes[1].body).toEqual(writes[0].body);
      expect(writes.every((write) => write.path === '/api/wealth/accounts')).toBe(true);
    } finally { view.close(); }
  });

  it('saves an ETF valuation with its existing NYSE Arca instrument and reflects the price', async () => {
    const writes: CapturedWrite[] = [];
    let currentSnapshot: any = etfSnapshot;
    let currentReport: any = etfReport;
    const api = (async (path: string, init?: RequestInit) => {
      if (init) {
        const body = JSON.parse(String(init.body)) as Record<string, any>;
        writes.push({ path, body });
        if (path === '/api/wealth/valuations') {
          currentSnapshot = { ...currentSnapshot, positions: [{ ...currentSnapshot.positions[0], valuation: { ...currentSnapshot.positions[0].valuation, priceMinor: 13000 }, marketValueMinor: 32500, unrealizedGainMinor: 7500 },], totalByCurrency: { USD: 37500 } };
          currentReport = { ...currentReport, ...currentSnapshot };
        }
        return { revision: 8 };
      }
      return path.startsWith('/api/wealth/report') ? currentReport : currentSnapshot;
    }) as LedgerApi;
    const view = await mount(api);
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Add dated value');
      const holding = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent?.includes('VTI'))) as HTMLSelectElement;
      expect(holding).toBeTruthy();
      expect(holding?.options[1]?.textContent).toContain('NYSE ARCA');
      await act(async () => { holding.value = holding.options[1].value; holding.dispatchEvent(new Event('change', { bubbles: true })); });
      expect((view.node.querySelector('input[placeholder="TSX or NYSE ARCA"]') as HTMLInputElement).value).toBe('NYSE ARCA');
      const securityType = [...view.node.querySelectorAll('.wealth-form select[disabled]')].find((select) => [...(select as HTMLSelectElement).options].some((option) => option.value === 'etf')) as HTMLSelectElement;
      expect(securityType.value).toBe('etf');
      const price = view.node.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(price, '130'); await new Promise((resolve) => setTimeout(resolve, 0)); });
      await clickButton(view.node, 'Save dated value');
      expect(writes[0]).toMatchObject({ path: '/api/wealth/valuations', body: { instrument: { exchange: 'NYSE ARCA', ticker: 'VTI', type: 'etf', currency: 'USD' }, priceMinor: 13000 } });
      expect(view.node.textContent).toContain('US$375.00');
    } finally { view.close(); }
  });

  it('keeps a past valuation date when date and aggregate value change in one batch', async () => {
    const writes: CapturedWrite[] = [];
    const view = await mount(captureApi(writes, aggregateBrokerageSnapshot, aggregateBrokerageReport));
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Add dated value');
      const form = view.node.querySelector('form.wealth-form') as HTMLFormElement;
      const date = form.querySelector('input[type="date"]') as HTMLInputElement;
      const value = form.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(date, '2026-11-02'); setInputValue(value, '300'); });
      await clickButton(view.node, 'Save dated value');
      expect(writes[0]).toMatchObject({ path: '/api/wealth/valuations', body: { asOf: '2026-11-02', priceMinor: 30000 } });
    } finally { view.close(); }
  });

  it('keeps a past event date when date and amount change in one batch', async () => {
    const writes: CapturedWrite[] = [];
    const view = await mount(captureApi(writes, snapshot, report));
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Record event');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'contribution')) as HTMLSelectElement;
      await act(async () => { kind.value = 'contribution'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
      const form = view.node.querySelector('form.wealth-form') as HTMLFormElement;
      const date = form.querySelector('input[type="date"]') as HTMLInputElement;
      const amount = form.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(date, '2026-11-02'); setInputValue(amount, '300'); });
      await clickButton(view.node, 'Save event');
      expect(writes.find((write) => write.path === '/api/wealth/events')?.body).toMatchObject({ event: { date: '2026-11-02', money: { amountMinor: 30000 } } });
    } finally { view.close(); }
  });

  it('links an event to a confirmed Activity record without exposing its id', async () => {
    const writes: CapturedWrite[] = [];
    const api = captureApi(writes, snapshot, report, { '/api/transactions?currency=all': { transactions: [{ id: 'bank-tx-1', date: '2026-10-12', merchant: 'Questrade funding', account_id: 'bank', amount_minor: -50000, currency: 'CAD', status: 'confirmed', category: 'Transfer', source: 'statement' }] } });
    const view = await mount(api, [{ id: 'bank', name: 'Everyday chequing', currency: 'CAD' }]);
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Record event');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'contribution')) as HTMLSelectElement;
      await act(async () => { kind.value = 'contribution'; kind.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.textContent).toContain('Already recorded in Activity?');
      expect(view.node.textContent).toContain('Questrade funding');
      expect(view.node.textContent).toContain('Everyday chequing');
      expect(view.node.textContent).toContain('2026-10-12');
      expect(view.node.textContent).not.toContain('bank-tx-1');
      const link = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent?.includes('Questrade funding'))) as HTMLSelectElement;
      await act(async () => { link.value = 'bank-tx-1'; link.dispatchEvent(new Event('change', { bubbles: true })); });
      const amount = view.node.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(amount, '500'); await new Promise((resolve) => setTimeout(resolve, 0)); });
      await clickButton(view.node, 'Save event');
      expect(writes.find((write) => write.path === '/api/wealth/events')?.body).toMatchObject({ event: { kind: 'contribution', linkedBankSourceId: 'bank-tx-1' } });
    } finally { view.close(); }
  });

  it('keeps an event’s currency aligned with the selected account', async () => {
    const writes: CapturedWrite[] = [];
    const view = await mount(captureApi(writes, twoAccountSnapshot, twoAccountReport));
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Record event');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'opening_cash')) as HTMLSelectElement;
      await act(async () => { kind.value = 'opening_cash'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
      const account = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent?.includes('US brokerage'))) as HTMLSelectElement;
      expect([...account.options].some((option) => option.textContent?.includes('Questrade · CAD'))).toBe(true);
      expect([...account.options].some((option) => option.textContent?.includes('US brokerage · USD'))).toBe(true);
      await act(async () => { account.value = 'usd-brokerage'; account.dispatchEvent(new Event('change', { bubbles: true })); });
      const amount = view.node.querySelector('input[placeholder="0.00"]') as HTMLInputElement;
      await act(async () => { setInputValue(amount, '25'); });
      await clickButton(view.node, 'Save event');
      expect(writes.find((write) => write.path === '/api/wealth/events')?.body).toMatchObject({ event: { accountId: 'usd-brokerage', money: { currency: 'USD', amountMinor: 2500 } } });
    } finally { view.close(); }
  });

  it('rejects holdings events for aggregate accounts before writing', async () => {
    const writes: CapturedWrite[] = []; const view = await mount(captureApi(writes, manualOnlySnapshot, manualOnlyReport));
    try { await clickButton(view.node, 'Add data'); await clickButton(view.node, 'Record event'); const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'contribution')) as HTMLSelectElement; await act(async () => { kind.value = 'contribution'; kind.dispatchEvent(new Event('change', { bubbles: true })); }); await clickButton(view.node, 'Save event'); expect(view.node.textContent).toContain('needs a holdings account'); expect(writes).toHaveLength(0); } finally { view.close(); }
  });

  it('uses a human-readable event selector for reversals instead of exposing source ids', async () => {
    const writes: CapturedWrite[] = [];
    const view = await mount(captureApi(writes, snapshot, report, { '/api/wealth/events?limit=500': { events: [{ sourceId: 'source-buy', date: '2026-10-01', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP' } }] } }));
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Record event');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'reversal')) as HTMLSelectElement;
      expect(kind).toBeTruthy();
      await act(async () => { kind.value = 'reversal'; kind.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(view.node.textContent).toContain('Event to reverse');
      expect(view.node.textContent).not.toContain('source-buy');
      expect([...view.node.querySelectorAll('option')].some((option) => option.textContent?.includes('buy · Questrade'))).toBe(true);
      const target = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'source-buy')) as HTMLSelectElement;
      await act(async () => { target.value = 'source-buy'; target.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(view.node.textContent).toContain('The original record stays in the audit history.');
      const save = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Save event'));
      await act(async () => { save?.click(); });
      expect(writes.find((write) => write.path === '/api/wealth/events')?.body).toMatchObject({ expectedRevision: 7, event: { kind: 'reversal', targetSourceId: 'source-buy' } });
    } finally { view.close(); }
  });

  it('submits a typed correction replacement with the selected Activity link', async () => {
    const writes: CapturedWrite[] = [];
    const target = { id: 'event-buy', sourceId: 'source-buy', date: '2026-10-01', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2', consideration: { currency: 'CAD', amountMinor: 24000 }, fee: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId: 'bank-tx-1', memo: 'Original purchase' };
    const api = correctionEventApi(writes, target, true);
    const view = await mount(api, [{ id: 'bank', name: 'Everyday chequing', currency: 'CAD' }]);
    try {
      await clickButton(view.node, 'Add data');
      await clickButton(view.node, 'Record event');
      const kind = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.value === 'correction')) as HTMLSelectElement;
      await act(async () => { kind.value = 'correction'; kind.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const targetSelect = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent?.includes('buy · Questrade'))) as HTMLSelectElement;
      expect(targetSelect).toBeTruthy();
      expect(view.node.textContent).not.toContain('source-buy');
      await act(async () => { targetSelect.value = 'source-buy'; targetSelect.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const replacementKind = view.node.querySelector('select[aria-label="Replacement event type"]') as HTMLSelectElement;
      expect(replacementKind.value).toBe('buy');
      expect([...replacementKind.options].some((option) => option.value === 'correction' || option.value === 'reversal')).toBe(false);
      const link = [...view.node.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent?.includes('Questrade funding'))) as HTMLSelectElement;
      expect(link.value).toBe('bank-tx-1');
      await act(async () => { link.value = 'bank-tx-2'; link.dispatchEvent(new Event('change', { bubbles: true })); });
      await clickButton(view.node, 'Save event');
      expect(view.node.textContent).toContain('temporary event write failure');
      await clickButton(view.node, 'Save event');
      const eventWrites = writes.filter((write) => write.path === '/api/wealth/events');
      expect(eventWrites).toHaveLength(2);
      expect(eventWrites[1].body).toEqual(eventWrites[0].body);
      expect(eventWrites[0].body).toMatchObject({ expectedRevision: 7, event: { kind: 'correction', targetSourceId: 'source-buy', replacement: { kind: 'buy', date: '2026-10-01', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2', consideration: { currency: 'CAD', amountMinor: 24000 }, fee: { currency: 'CAD', amountMinor: 100 }, linkedBankSourceId: 'bank-tx-2' } } });
    } finally { view.close(); }
  });

  it('keeps event identity stable across a retry and rejects blank money', () => {
    const draft: EventDraft = { id: 'event-stable', sourceId: 'source-stable', kind: 'contribution', accountId: 'brokerage', date: '2026-10-31', ticker: '', exchange: 'TSX', instrumentType: 'stock', currency: 'CAD', quantity: '', amount: '25', fee: '', memo: '', targetSourceId: '', linkedBankSourceId: '', transferKind: 'cash', toAccountId: '', basisKnown: true };
    const first = buildEventBody(draft, 7); const second = buildEventBody(draft, 7);
    expect(first.error).toBeNull(); expect(second.body).toMatchObject({ id: 'event-stable', sourceId: 'source-stable' }); expect(second.body).toEqual(first.body);
    expect(buildEventBody({ ...draft, amount: '' }, 7).error).toContain('valid amount');
  });

  it('builds a typed correction replacement without nesting another control', () => {
    const draft: EventDraft = {
      id: 'correction-stable', sourceId: 'correction-source-stable', kind: 'correction', accountId: 'brokerage', date: '2026-11-03',
      replacementKind: 'buy', replacementDate: '2026-10-01', ticker: 'SHOP', exchange: 'TSX', instrumentType: 'stock', currency: 'CAD',
      quantity: '3', amount: '360', fee: '', memo: 'Corrected quantity', targetSourceId: 'source-buy', linkedBankSourceId: 'bank-tx-1', transferKind: 'cash', toAccountId: '', basisKnown: true,
    };
    const first = buildEventBody(draft, 7);
    const second = buildEventBody(draft, 7);
    expect(first.error).toBeNull();
    expect(second.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      id: 'correction-stable', sourceId: 'correction-source-stable', kind: 'correction', date: '2026-11-03', targetSourceId: 'source-buy',
      replacement: { kind: 'buy', date: '2026-10-01', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '3', consideration: { currency: 'CAD', amountMinor: 36000 }, linkedBankSourceId: 'bank-tx-1' },
    });
    expect(first.body?.instrument).toBeUndefined();
    expect((first.body?.replacement as Record<string, unknown>).targetSourceId).toBeUndefined();
  });

  it('renders correction lineage from Worker-shaped history without exposing source ids', async () => {
    const original = { id: 'event-buy', sourceId: 'source-buy', date: '2026-10-01', kind: 'buy', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2', consideration: { currency: 'CAD', amountMinor: 24000 }, memo: 'Original purchase' };
    const correction = { id: 'event-correction', sourceId: 'source-correction', date: '2026-11-03', kind: 'correction', targetSourceId: 'source-buy', replacement: { kind: 'buy', date: '2026-10-01', accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '3', consideration: { currency: 'CAD', amountMinor: 36000 }, memo: 'Corrected purchase' } };
    const normalized = normalizeEventHistory({ events: [original, correction] });
    expect(normalized[1]).toMatchObject({ kind: 'correction', targetSourceId: 'source-buy', replacement: { kind: 'buy', date: '2026-10-01', quantity: '3' } });
    const api = correctionHistoryApi(original, correction);
    const view = await mount(api);
    try {
      const account = [...view.node.querySelectorAll('button')].find((button) => button.textContent?.includes('Questrade'));
      await act(async () => { account?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const eventTable = tableByCaption(view.node, 'Account event history');
      expect(eventTable?.textContent).toContain('Correction');
      expect(eventTable?.textContent).toContain('Original Buy');
      expect(eventTable?.textContent).toContain('Corrected Buy');
      expect(eventTable?.textContent).not.toContain('source-buy');
    } finally { view.close(); }
  });

  it('reports canonical export failures without downloading a partial snapshot', async () => {
    const api = (async (path: string) => { if (path === '/api/wealth/export?format=json') throw new Error('Canonical wealth export is unavailable.'); return path.startsWith('/api/wealth/report') ? report : snapshot; }) as LedgerApi; const view = await mount(api);
    try { await clickButton(view.node, 'Export'); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(view.node.textContent).toContain('Canonical wealth export is unavailable.'); } finally { view.close(); }
  });

  it('maps source columns through a fresh server preview without exposing import JSON', async () => {
    const writes: CapturedWrite[] = [];
    let previewCount = 0;
    const api = (async (path: string, init?: RequestInit) => {
      if (init) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push({ path, body });
        if (path === '/api/wealth/imports/preview') {
          previewCount += 1;
          return { previewId: `preview-${previewCount}`, revision: 7, headers: ['record_type', 'when', 'kind', 'account'], rows: [], errors: [], duplicates: [] };
        }
        return { revision: 8 };
      }
      return snapshot;
    }) as LedgerApi;
    const node = document.createElement('div'); const root = createRoot(node); document.body.append(node);
    await act(async () => { root.render(createElement(WealthImportPanel, { api, onSaved: async () => undefined, onNotice: () => undefined })); });
    try {
      const input = node.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['record_type,when,kind,account\nevent,2026-10-01,contribution,brokerage\n'], 'wealth.csv', { type: 'text/csv' });
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(node.textContent).toContain('Match source columns');
      expect((node.querySelector('details.wealth-import-mapping') as HTMLDetailsElement | null)?.open).toBe(false);
      const date = node.querySelector('select[aria-label="Source column for Event date"]') as HTMLSelectElement;
      await act(async () => { date.value = 'when'; date.dispatchEvent(new Event('change', { bubbles: true })); });
      const rebuild = [...node.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Rebuild server preview');
      expect(rebuild).toBeTruthy();
      await act(async () => { rebuild?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(writes).toHaveLength(2);
      expect(writes[0].body).toMatchObject({ operationId: expect.any(String) });
      expect(writes[1].body).toMatchObject({ mapping: { date: 'when' }, operationId: expect.any(String) });
      expect(writes[1].body.operationId).not.toBe(writes[0].body.operationId);
      expect(node.textContent).not.toContain('preview-2');
    } finally { act(() => root.unmount()); node.remove(); }
  });

  it('allows the same CSV file to be selected again after clearing the file input', async () => {
    let previewCount = 0;
    const api = (async (path: string, init?: RequestInit) => {
      if (init && path === '/api/wealth/imports/preview') {
        previewCount += 1;
        return { previewId: `preview-${previewCount}`, revision: 7, headers: ['record_type'], rows: [], errors: [], duplicates: [] };
      }
      return snapshot;
    }) as LedgerApi;
    const node = document.createElement('div'); const root = createRoot(node); document.body.append(node);
    await act(async () => { root.render(createElement(WealthImportPanel, { api, onSaved: async () => undefined, onNotice: () => undefined })); });
    try {
      const input = node.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['record_type\nevent\n'], 'wealth.csv', { type: 'text/csv' });
      const choose = async () => {
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      };
      await choose();
      expect(input.value).toBe('');
      expect(previewCount).toBe(1);
      await choose();
      expect(previewCount).toBe(2);
    } finally { act(() => root.unmount()); node.remove(); }
  });

  it('resolves valuation account labels from accounts created in the same preview', async () => {
    const api = (async (path: string, init?: RequestInit) => {
      if (init && path === '/api/wealth/imports/preview') {
        return {
          previewId: 'preview-account-labels',
          revision: 7,
          headers: ['record_type', 'id', 'name', 'account_id', 'as_of', 'price_minor', 'currency', 'account_kind', 'account_mode'],
          rows: [
            { rowId: 'account-row', rowIndex: 0, recordType: 'account', record: { recordType: 'account', account: { id: 'new-brokerage', name: 'Imported brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' } }, event: null, error: null, duplicateOf: null },
            { rowId: 'value-row', rowIndex: 1, recordType: 'valuation', record: { recordType: 'valuation', valuation: { id: 'value-1', accountId: 'new-brokerage', asOf: '2026-10-31', priceMinor: 12300, instrument: null } }, event: null, error: null, duplicateOf: null },
          ],
          errors: [],
          duplicates: [],
        };
      }
      return snapshot;
    }) as LedgerApi;
    const node = document.createElement('div'); const root = createRoot(node); document.body.append(node);
    await act(async () => { root.render(createElement(WealthImportPanel, { api, onSaved: async () => undefined, onNotice: () => undefined })); });
    try {
      const input = node.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['record_type,id,name,account_id,as_of,price_minor,currency,account_kind,account_mode\naccount,new-brokerage,Imported brokerage,,,,CAD,brokerage,aggregate\nvaluation,value-1,,new-brokerage,2026-10-31,12300,CAD,,\n'], 'wealth.csv', { type: 'text/csv' });
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(node.textContent).toContain('Imported brokerage');
      expect(node.textContent).not.toContain('Unknown account');
    } finally { act(() => root.unmount()); node.remove(); }
  });

  it('renders and commits mode transition preview rows from the transition payload', async () => {
    const writes: CapturedWrite[] = [];
    const api = (async (path: string, init?: RequestInit) => {
      if (init) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push({ path, body });
        if (path === '/api/wealth/imports/preview') {
          return {
            previewId: 'preview-transition',
            revision: 7,
            rows: [{
              rowId: 'transition-row', rowIndex: 0, recordType: 'mode_transition',
              record: { recordType: 'mode_transition', transition: {
                id: 'mode-transition-brokerage-2026-11-02', accountId: 'brokerage', fromMode: 'aggregate', toMode: 'holdings',
                effectiveDate: '2026-11-02', openingCashMinor: 250000, openingValueMinor: null, openingPositions: [], accountCurrency: 'CAD',
              } }, event: null, error: null, duplicateOf: null,
            }],
            errors: [], duplicates: [],
          };
        }
        return { revision: 8, committed: 1 };
      }
      return snapshot;
    }) as LedgerApi;
    const node = document.createElement('div'); const root = createRoot(node); document.body.append(node);
    await act(async () => { root.render(createElement(WealthImportPanel, { api, accounts: [{ id: 'brokerage', name: 'Questrade', kind: 'brokerage', mode: 'holdings', currency: 'CAD' } as const], revision: 7, onSaved: async () => undefined, onNotice: () => undefined })); });
    try {
      const input = node.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['record_type,account_id,effective_date,from_mode,to_mode,opening_cash_minor\nmode_transition,brokerage,2026-11-02,aggregate,holdings,250000\n'], 'transition.csv', { type: 'text/csv' });
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(node.textContent).toContain('2026-11-02');
      expect(node.textContent).toContain('Mode transition');
      expect(node.textContent).toContain('Aggregate value → Holdings + cash');
      expect(node.textContent).toContain('Questrade');
      expect(node.textContent).not.toContain('mode_transition');
      await clickButton(node, 'Commit 1 valid rows');
      expect(writes.find((write) => write.path === '/api/wealth/imports/preview')).toBeTruthy();
      expect(writes.find((write) => write.path === '/api/wealth/imports/preview-transition/commit')?.body).toMatchObject({ expectedRevision: 7, rowIds: ['transition-row'] });
    } finally { act(() => root.unmount()); node.remove(); }
  });

  it('explains permission failures and offers a retry action', async () => {
    const api = (async () => { throw new Error('Wealth access is not enabled for this ledger.'); }) as LedgerApi; const view = await mount(api);
    try { expect(view.node.textContent).toContain('Wealth access is not enabled'); expect([...view.node.querySelectorAll('button')].some((button) => button.textContent?.includes('Try again'))).toBe(true); } finally { view.close(); }
  });
});
