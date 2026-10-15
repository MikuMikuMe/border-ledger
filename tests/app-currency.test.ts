// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('registered extra-currency workspace data', () => {
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

  it('keeps registered extra currencies in source totals, chart legends, and filters without FX conversion', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/api/accounts')) {
        return new Response(JSON.stringify({ accounts: [{ id: 'usd-account', name: 'USD account', institution: 'Synthetic bank', currency: 'USD', kind: 'chequing', status: 'import_only', last_synced_at: null, plaid_item_id: null }] }), { status: 200 });
      }
      if (String(input).includes('/api/reports/summary')) {
        return new Response(JSON.stringify({
          from: '2026-10-01',
          to: '2026-10-14',
          includeProvisional: false,
          currencyTotals: [
            { currency: 'CAD', confirmedMinorUnits: 1000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
            { currency: 'CNY', confirmedMinorUnits: 2000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
            { currency: 'USD', confirmedMinorUnits: 3000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
          ],
          dailyTotals: [
            { date: '2026-10-12', currency: 'CAD', confirmedMinorUnits: 1000, provisionalMinorUnits: 0 },
            { date: '2026-10-11', currency: 'CNY', confirmedMinorUnits: 2000, provisionalMinorUnits: 0 },
            { date: '2026-10-10', currency: 'USD', confirmedMinorUnits: 3000, provisionalMinorUnits: 0 },
          ],
          reviewCount: 0,
          excludedCount: 0,
          sourceCoverage: { statement: 3 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ transactions: [
        { id: 'cad-1', account_id: 'usd-account', date: '2026-10-12', merchant: 'CAD row', amount_minor: -1000, currency: 'CAD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'cad-1' },
        { id: 'cny-1', account_id: 'usd-account', date: '2026-10-11', merchant: 'CNY row', amount_minor: -2000, currency: 'CNY', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'cny-1' },
        { id: 'usd-1', account_id: 'usd-account', date: '2026-10-10', merchant: 'USD row', amount_minor: -3000, currency: 'USD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'usd-1' },
      ] }), { status: 200 });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await Promise.resolve();
    });

    const currencyStack = container.querySelector('.currency-stack')?.textContent ?? '';
    expect(currencyStack.indexOf('CAD')).toBeLessThan(currencyStack.indexOf('CNY'));
    expect(currencyStack.indexOf('CNY')).toBeLessThan(currencyStack.indexOf('USD'));
    expect(container.querySelector('.chart-legend')?.textContent).toContain('USD');

    const transactionsButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Transactions');
    expect(transactionsButton).toBeDefined();
    await act(async () => {
      transactionsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const currencyOptions = Array.from(container.querySelectorAll('.filter-selects label:first-child select option')).map((option) => option.getAttribute('value'));
    expect(currencyOptions).toEqual(['all', 'CAD', 'CNY', 'USD']);
  });

  it('renders an overview for a USD/HKD-only ledger without inventing a CAD total', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/accounts')) {
        return new Response(JSON.stringify({ accounts: [{ id: 'usd-account', name: 'USD account', institution: 'Synthetic bank', currency: 'USD', kind: 'chequing', status: 'import_only', last_synced_at: null, plaid_item_id: null }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/reports/summary')) {
        return new Response(JSON.stringify({
          ledgerId: 'personal',
          asOf: '2026-10-14T12:00:00.000Z',
          timeBasis: 'accounting_date',
          timeZone: 'America/Toronto',
          from: '2026-10-01',
          to: '2026-10-14',
          includeProvisional: false,
          currencyTotals: [
            { currency: 'USD', confirmedMinorUnits: 12_000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
            { currency: 'HKD', confirmedMinorUnits: 8_000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
          ],
          dailyTotals: [
            { date: '2026-10-13', currency: 'USD', confirmedMinorUnits: 12_000, provisionalMinorUnits: 0 },
            { date: '2026-10-14', currency: 'HKD', confirmedMinorUnits: 8_000, provisionalMinorUnits: 0 },
          ],
          reviewCount: 0,
          excludedCount: 0,
          sourceCoverage: { statement: 2 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ transactions: [
        { id: 'usd-1', account_id: 'usd-account', date: '2026-10-13', merchant: 'USD row', amount_minor: -12_000, currency: 'USD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'usd-1' },
        { id: 'hkd-1', account_id: 'usd-account', date: '2026-10-14', merchant: 'HKD row', amount_minor: -8_000, currency: 'HKD', category: 'Other', kind: 'expense', status: 'confirmed', source: 'statement', fingerprint: 'hkd-1' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.workspace-state-panel')).toBeNull();
    const primaryAmount = container.querySelector('.primary-amount')?.textContent ?? '';
    expect(primaryAmount).toMatch(/USD|HKD/);
    expect(primaryAmount).not.toContain('CAD');
    expect(container.querySelector('.currency-stack')?.textContent).toContain('USD');
    expect(container.querySelector('.currency-stack')?.textContent).toContain('HKD');
  });
});
