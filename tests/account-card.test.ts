// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { demoAccounts, demoTransactions } from '../src/domain/demo-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('account card options', () => {
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
    delete window.Plaid;
  });

  it('opens account options when the three-dot button is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/api/accounts')) return new Response(JSON.stringify({ accounts: demoAccounts.map((account) => ({ ...account, last_synced_at: account.lastSyncedAt, plaid_item_id: account.plaidItemId ?? null })) }));
      return new Response(JSON.stringify({ transactions: demoTransactions.map((transaction) => ({ ...transaction, account_id: transaction.accountId, amount_minor: transaction.amountMinor })) }));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(App));
      await Promise.resolve();
    });

    const accountsNavigation = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Accounts & settings'));
    expect(accountsNavigation).toBeDefined();

    act(() => {
      accountsNavigation?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const optionsButton = container.querySelector<HTMLButtonElement>('button[aria-label$=" options"]');
    expect(optionsButton).not.toBeNull();

    act(() => {
      optionsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(optionsButton?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="region"]')).not.toBeNull();
    expect(container.textContent).toContain('Account options');
  });

  it('waits for explicit account selection after Plaid Link succeeds', async () => {
    let plaidOptions: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/plaid/link-token')) return new Response(JSON.stringify({ link_token: 'link-token' }), { status: 200 });
      if (url.endsWith('/api/accounts')) return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      return new Response(JSON.stringify({ itemId: 'item-1', institution: 'RBC Royal Bank', queued: true }), { status: 201 });
    });
    window.Plaid = {
      create: (options) => {
        plaidOptions = options;
        return { open: () => undefined, exit: () => undefined, destroy: () => undefined };
      },
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
    });

    const accountsNavigation = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Accounts & settings'));
    act(() => accountsNavigation?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const connectButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Start bank connection'));
    expect(connectButton).toBeDefined();
    await act(async () => connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => plaidOptions?.onSuccess('public-sandbox-token', {
      institution: { name: 'RBC Royal Bank' },
      accounts: [{ id: 'plaid-acct-1', name: 'Everyday Chequing', mask: '1234', type: 'depository', subtype: 'checking' }],
    }));

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('Choose which accounts to connect');
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/plaid/exchange'))).toBe(false);
  });
});
