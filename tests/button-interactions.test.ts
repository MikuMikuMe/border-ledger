// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { demoAccounts, demoTransactions } from '../src/domain/demo-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('button interactions', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let reportCalls: URL[] = [];

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    reportCalls = [];
    privateFetchSpy().mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'https://ledger.example.test');
      if (url.pathname === '/api/accounts') {
        return new Response(JSON.stringify({ accounts: demoAccounts.map((account) => ({
          id: account.id,
          name: account.name,
          institution: account.institution,
          currency: account.currency,
          kind: account.kind,
          status: account.status,
          last_synced_at: account.lastSyncedAt,
          plaid_item_id: account.plaidItemId ?? null,
        })) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/preferences') {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as { expectedRevision: number; reportingTimezone: string; weekStart: 0 | 1; preferredCurrency: string | null };
          return new Response(JSON.stringify({ reportingTimezone: body.reportingTimezone, weekStart: body.weekStart, preferredCurrency: body.preferredCurrency, revision: body.expectedRevision + 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ reportingTimezone: 'America/Toronto', weekStart: 1, preferredCurrency: null, revision: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/reports/summary') {
        reportCalls.push(url);
        const target = url.searchParams.get('reportingCurrency');
        return new Response(JSON.stringify({
          ledgerId: 'personal',
          from: '2026-10-01',
          to: '2026-10-14',
          includeProvisional: false,
          currencyTotals: [
            { currency: 'CAD', confirmedMinorUnits: 10000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
            { currency: 'CNY', confirmedMinorUnits: 20000, provisionalMinorUnits: 0, confirmedCount: 1, provisionalCount: 0 },
          ],
          dailyTotals: [
            { date: '2026-10-12', currency: 'CAD', confirmedMinorUnits: 10000, provisionalMinorUnits: 0 },
            { date: '2026-10-11', currency: 'CNY', confirmedMinorUnits: 20000, provisionalMinorUnits: 0 },
          ],
          reportingCurrency: target,
          convertedTotals: target ? { confirmedMinorUnits: 30000, provisionalMinorUnits: 0, confirmedCount: 2, provisionalCount: 0 } : null,
          convertedDailyTotals: target ? [{ date: '2026-10-12', confirmedMinorUnits: 30000, provisionalMinorUnits: 0 }] : [],
          fx: { provider: 'frankfurter', complete: true, unavailableSourceCurrencies: [], lockedDateCount: 1, observedDateRange: { earliest: '2026-10-12', latest: '2026-10-12' }, chineseBankBand: null },
          reviewCount: 1,
          excludedCount: 0,
          sourceCoverage: { plaid: 1, statement: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ transactions: demoTransactions.map((transaction) => ({
        id: transaction.id,
        account_id: transaction.accountId,
        date: transaction.date,
        merchant: transaction.merchant,
        amount_minor: transaction.amountMinor,
        currency: transaction.currency,
        category: transaction.category,
        kind: transaction.kind,
        status: transaction.status,
        source: transaction.source,
        fingerprint: transaction.fingerprint,
        note: transaction.note,
      })) }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });

  async function renderApp() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(App));
      await Promise.resolve();
    });
  }

  function clickButton(label: string) {
    const button = Array.from(container?.querySelectorAll('button') ?? []).find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
    expect(button).toBeDefined();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  function openView(label: string) {
    clickButton(label);
  }

  it('opens notifications and routes to the review desk', async () => {
    await renderApp();

    clickButton('Notifications');

    expect(container?.querySelector('[role="region"][aria-label="Notifications"]')).not.toBeNull();
    expect(container?.textContent).toContain('2 records are waiting for review.');

    clickButton('Open review desk');

    expect(container?.textContent).toContain('Import & review');
    expect(container?.querySelector('[role="region"][aria-label="Notifications"]')).toBeNull();
  });

  it('opens the profile menu with the active access boundary', async () => {
    await renderApp();

    clickButton('Open profile menu');

    expect(container?.querySelector('[role="region"][aria-label="Profile"]')).not.toBeNull();
    expect(container?.textContent).toContain('GitHub sign-in through Cloudflare Access');
  });

  it('changes the spending chart period from its menu', async () => {
    await renderApp();

    clickButton('Daily');
    expect(container?.querySelector('[role="region"][aria-label="Chart period options"]')).not.toBeNull();

    clickButton('Weekly');

    expect(container?.textContent).toContain('W1 — W2 OCT');
    expect(container?.querySelector('[role="region"][aria-label="Chart period options"]')).toBeNull();
  });

  it('responds to export and exposes additional transaction filters', async () => {
    await renderApp();
    openView('Transactions');

    clickButton('Export ledger');
    expect(container?.textContent).toContain('CSV export prepared for 12 ledger records.');

    clickButton('More filters');
    expect(container?.querySelector('[role="region"][aria-label="Additional transaction filters"]')).not.toBeNull();
    expect(container?.querySelector('select[aria-label="Source"]')).not.toBeNull();
  });

  it('responds to reporting rules and data policy controls', async () => {
    await renderApp();
    openView('Accounts & settings');

    clickButton('Reporting rules');
    expect(container?.textContent).toContain('Reporting rules are below.');

    clickButton('Read the data policy');
    expect(container?.querySelector('[role="region"][aria-label="Data policy"]')).not.toBeNull();
    expect(container?.textContent).toContain('This browser never receives bank passwords.');
  });

  it('persists the total spending currency and requests it as a reporting target', async () => {
    await renderApp();
    openView('Accounts & settings');

    expect(container?.textContent).toContain('Total spending currency');
    const select = container?.querySelector<HTMLSelectElement>('select[aria-label="Preferred reporting currency"]');
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = 'EUR';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(select?.value).toBe('EUR');
    expect(reportCalls.some((url) => url.searchParams.get('reportingCurrency') === 'EUR' && !url.searchParams.has('currency'))).toBe(true);
  });
});
