// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { demoAccounts, demoTransactions } from '../src/domain/demo-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('button interactions', () => {
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

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/api/accounts')) {
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
});
