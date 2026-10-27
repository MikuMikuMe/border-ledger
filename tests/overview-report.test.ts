// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('full-window Overview report', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  function jsonResponse(value: unknown) {
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('uses full-window totals and daily data instead of the bounded transaction list', async () => {
    const reportCalls: URL[] = [];
    privateFetchSpy().mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://ledger.example.test');
      if (url.pathname === '/api/accounts') {
        return jsonResponse({ accounts: [{ id: 'usd-account', name: 'USD account', institution: 'Synthetic bank', currency: 'USD', kind: 'chequing', status: 'import_only', last_synced_at: null, plaid_item_id: null }] });
      }
      if (url.pathname === '/api/reports/summary') {
        reportCalls.push(url);
        const includeProvisional = url.searchParams.get('includeProvisional') === 'true';
        return jsonResponse({
          ledgerId: 'personal',
          asOf: '2026-10-14T12:00:00.000Z',
          timeBasis: 'accounting_date',
          timeZone: 'America/Toronto',
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          includeProvisional,
          currencyTotals: [
            { currency: 'CAD', confirmedMinorUnits: 100_000, provisionalMinorUnits: includeProvisional ? 3_000 : 0, confirmedCount: 501, provisionalCount: includeProvisional ? 1 : 0 },
            { currency: 'USD', confirmedMinorUnits: 20_000, provisionalMinorUnits: includeProvisional ? 500 : 0, confirmedCount: 1, provisionalCount: includeProvisional ? 1 : 0 },
          ],
          dailyTotals: [
            { date: '2026-10-05', currency: 'USD', confirmedMinorUnits: 20_000, provisionalMinorUnits: includeProvisional ? 500 : 0 },
            { date: '2026-10-12', currency: 'CAD', confirmedMinorUnits: 100_000, provisionalMinorUnits: includeProvisional ? 3_000 : 0 },
          ],
          reviewCount: 7,
          excludedCount: 4,
          sourceCoverage: { statement: 501 },
        });
      }
      return jsonResponse({ transactions: [{ id: 'bounded-row', account_id: 'usd-account', date: '2026-10-12', merchant: 'Only visible page row', amount_minor: -100, currency: 'CAD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'bounded-row' }] });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(reportCalls).toHaveLength(1);
    expect(reportCalls[0].pathname).toBe('/api/reports/summary');
    expect(reportCalls[0].searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(reportCalls[0].searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(reportCalls[0].searchParams.get('timeZone')).toBe('America/Toronto');
    expect(reportCalls[0].searchParams.get('includeProvisional')).toBe('false');
    expect(container.querySelector('.primary-amount')?.textContent).toContain('$1,000.00');
    expect(container.querySelector('.currency-stack')?.textContent).toContain('USD');
    expect(container.querySelector('.chart-legend')?.textContent).toContain('USD');
    expect(container.querySelector('.review-number')?.textContent).toBe('7');

    const provisionalToggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(provisionalToggle).not.toBeNull();
    await act(async () => {
      provisionalToggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(reportCalls).toHaveLength(2);
    expect(reportCalls[1].searchParams.get('includeProvisional')).toBe('true');
    expect(container.querySelector('.primary-amount')?.textContent).toContain('$1,030.00');
  });

  it('makes a partial converted total primary while keeping source lanes and the eligible bank estimate visible', async () => {
    const reportCalls: URL[] = [];
    privateFetchSpy().mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://ledger.example.test');
      if (url.pathname === '/api/accounts') {
        return jsonResponse({ accounts: [{ id: 'usd-account', name: 'USD account', institution: 'Bank of China', currency: 'USD', kind: 'chequing', status: 'import_only', last_synced_at: null, plaid_item_id: null }] });
      }
      if (url.pathname === '/api/preferences') {
        return jsonResponse({ reportingTimezone: 'America/Toronto', weekStart: 1, preferredCurrency: 'CAD', revision: 4 });
      }
      if (url.pathname === '/api/reports/summary') {
        reportCalls.push(url);
        const target = url.searchParams.get('reportingCurrency');
        return jsonResponse({
          ledgerId: 'personal',
          asOf: '2026-10-14T12:00:00.000Z',
          timeBasis: 'accounting_date',
          timeZone: 'America/Toronto',
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          includeProvisional: url.searchParams.get('includeProvisional') === 'true',
          currencyTotals: [
            { currency: 'USD', confirmedMinorUnits: 8000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
            { currency: 'JPY', confirmedMinorUnits: 2000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
          ],
          dailyTotals: [
            { date: '2026-10-10', currency: 'USD', confirmedMinorUnits: 8000, provisionalMinorUnits: 0 },
            { date: '2026-10-11', currency: 'JPY', confirmedMinorUnits: 2000, provisionalMinorUnits: 0 },
          ],
          reportingCurrency: target,
          convertedTotals: target ? { confirmedMinorUnits: 3456, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 } : null,
          convertedDailyTotals: target ? [{ date: '2026-10-10', confirmedMinorUnits: 3456, provisionalMinorUnits: 0 }] : [],
          fx: {
            provider: 'frankfurter',
            complete: false,
            unavailableSourceCurrencies: ['JPY'],
            lockedDateCount: 2,
            observedDateRange: { earliest: '2026-10-10', latest: '2026-10-10' },
            chineseBankBand: target ? { eligible: true, currency: 'CAD', baseMinorUnits: 3400, lowerMinorUnits: 3350, upperMinorUnits: 3450, percentageBasisPoints: 150 } : null,
          },
          reviewCount: 0,
          excludedCount: 0,
          sourceCoverage: { statement: 2 },
        });
      }
      return jsonResponse({ transactions: [
        { id: 'usd-row', account_id: 'usd-account', date: '2026-10-10', merchant: 'USD row', amount_minor: -8000, currency: 'USD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'usd-row' },
        { id: 'jpy-row', account_id: 'usd-account', date: '2026-10-11', merchant: 'JPY row', amount_minor: -2000, currency: 'JPY', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'jpy-row' },
      ] });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (let attempt = 0; attempt < 4; attempt += 1) await settle();

    expect(reportCalls.some((url) => url.searchParams.get('reportingCurrency') === 'CAD')).toBe(true);
    expect(container.querySelector('.primary-amount')?.textContent).toContain('$34.56');
    expect(container.querySelector('.chart-legend')?.textContent).toContain('CAD');
    expect(container.querySelector('.currency-stack')?.textContent).toContain('USD');
    expect(container.querySelector('.currency-stack')?.textContent).toContain('JPY');
    expect(container.textContent).toContain('Partial conversion');
    expect(container.textContent).toContain('Unavailable source currencies: JPY');
    expect(container.querySelector('.fx-band')?.textContent).toContain('$33.50 – $34.50 CAD');
    expect(container.querySelector('.fx-band')?.textContent).toContain('±1.5% Chinese bank settlement estimate; CNY spending excluded');
    expect(container.querySelector('.fx-band')?.getAttribute('aria-label')).toContain('CNY spending excluded');
  });

  it('keeps refund direction in the chart and exposes a signed accessible data table', async () => {
    privateFetchSpy().mockImplementation(async (input) => {
      const url = new URL(String(input), 'https://ledger.example.test');
      if (url.pathname === '/api/accounts') {
        return jsonResponse({ accounts: [{ id: 'cad-account', name: 'CAD account', institution: 'Synthetic bank', currency: 'CAD', kind: 'chequing', status: 'import_only', last_synced_at: null, plaid_item_id: null }] });
      }
      if (url.pathname === '/api/reports/summary') {
        return jsonResponse({
          ledgerId: 'personal', asOf: '2026-10-14T12:00:00.000Z', timeBasis: 'accounting_date', timeZone: 'America/Toronto',
          from: url.searchParams.get('from'), to: url.searchParams.get('to'), includeProvisional: false,
          currencyTotals: [{ currency: 'CAD', confirmedMinorUnits: -500, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 }],
          dailyTotals: [{ date: '2026-10-12', currency: 'CAD', confirmedMinorUnits: -500, provisionalMinorUnits: 0 }],
          reviewCount: 0, excludedCount: 0, sourceCoverage: { statement: 1 },
        });
      }
      return jsonResponse({ transactions: [{ id: 'refund-row', account_id: 'cad-account', date: '2026-10-12', merchant: 'Refund row', amount_minor: 500, currency: 'CAD', category: 'Other', kind: 'refund', status: 'confirmed', source: 'statement', fingerprint: 'refund-row' }] });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();

    expect(container.querySelector('.refund-bar')?.getAttribute('data-direction')).toBe('refund');
    const table = container.querySelector('.chart-data-table');
    expect(table?.textContent).toContain('Refund');
    expect(table?.textContent).toContain('-$5.00');
  });
});

