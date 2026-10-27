// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { demoAccounts, demoTransactions } from '../src/domain/demo-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('mobile navigation dismissal', () => {
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
    privateFetchSpy().mockImplementation(async (input) => {
      if (String(input).endsWith('/api/accounts')) return new Response(JSON.stringify({ accounts: demoAccounts.map((account) => ({ ...account, last_synced_at: account.lastSyncedAt, plaid_item_id: account.plaidItemId ?? null })) }));
      return new Response(JSON.stringify({ transactions: demoTransactions.map((transaction) => ({ ...transaction, account_id: transaction.accountId, amount_minor: transaction.amountMinor })) }));
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

  function openNavigation() {
    const openButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]');
    expect(openButton).not.toBeNull();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('closes when the outside surface is clicked', async () => {
    await renderApp();
    openNavigation();

    const navigation = container?.querySelector('aside.app-nav');
    expect(navigation?.className).toContain('is-open');

    const outsideSurface = container?.querySelector<HTMLButtonElement>('button[aria-label="Close navigation menu"]');
    expect(outsideSurface).not.toBeNull();

    act(() => {
      outsideSurface?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigation?.className).not.toContain('is-open');
  });

  it('closes when Escape is pressed', async () => {
    await renderApp();
    openNavigation();

    const navigation = container?.querySelector('aside.app-nav');
    expect(navigation?.className).toContain('is-open');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(navigation?.className).not.toContain('is-open');
  });
});
