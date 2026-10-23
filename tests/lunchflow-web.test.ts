// @vitest-environment jsdom

import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LunchFlowSection } from '../src/lunchflow';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const configuredAccounts = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  accounts: [
    {
      providerAccountId: 'rbc-chequing',
      name: 'Everyday Chequing',
      institution: 'RBC Royal Bank',
      currencies: ['CAD'],
      selected: false,
      accountId: null,
      kind: null,
      currency: null,
      lastSyncedAt: null,
      lastAttemptAt: null,
      lastError: null,
      ...overrides,
    },
    {
      providerAccountId: 'rbc-visa',
      name: 'RBC Visa',
      institution: 'RBC Royal Bank',
      currencies: ['CAD'],
      selected: true,
      accountId: 'ledger-rbc-visa',
      kind: 'credit',
      currency: 'CAD',
      lastSyncedAt: '2026-10-22T14:00:00.000Z',
      lastAttemptAt: '2026-10-22T14:00:00.000Z',
      lastError: 'Provider timed out on the last attempt.',
    },
  ],
});

interface MockResponse {
  body: unknown;
  status?: number;
}

type MockRoute = MockResponse | ((init: RequestInit | undefined) => MockResponse);

function mockApi(routes: Record<string, MockRoute>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'https://ledger.example.test');
    const path = `${url.pathname}${url.search}`;
    const route = routes[path] ?? routes[url.pathname];
    if (!route) throw new Error(`Unexpected request: ${path}`);
    const response = typeof route === 'function' ? route(init) : route;
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  });
}

function findButton(container: HTMLDivElement | null, text: string) {
  return Array.from(container?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes(text));
}

function setSelectValue(container: HTMLDivElement | null, label: string, value: string) {
  const select = container?.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!select) throw new Error(`Missing select: ${label}`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function requiredButton(container: HTMLDivElement | null, text: string) {
  const button = findButton(container, text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

function containerText(container: HTMLDivElement | null) {
  if (!container) throw new Error('Missing test container.');
  return container.textContent ?? '';
}

function requestWasMade(fetchMock: { mock: { calls: Array<Array<unknown>> } }, suffix: string) {
  return fetchMock.mock.calls.some((call) => String(call[0]).endsWith(suffix));
}

function expectPost(init: RequestInit | undefined) {
  expect(init?.method).toBe('POST');
}

function requestBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body));
}

async function clickAndSettle(button: HTMLButtonElement, milliseconds = 0) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  });
}

describe('Lunch Flow web section', () => {
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

  async function renderSection(onWorkspaceRefresh?: () => Promise<void> | void, strict = false) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      const section = createElement(LunchFlowSection, { onWorkspaceRefresh });
      root?.render(strict ? createElement(StrictMode, null, section) : section);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('shows explicit account state and keeps a queued refresh separate from last-known data', async () => {
    let discoveryCalls = 0;
    const fetchMock = mockApi({
      '/api/lunchflow/accounts': () => {
        discoveryCalls += 1;
        return { body: configuredAccounts() };
      },
      '/api/lunchflow/sync': (init) => {
        expectPost(init);
        return { body: { queued: true, accounts: 2 } };
      },
    });

    await renderSection();

    expect(containerText(container)).toContain('Everyday Chequing');
    expect(containerText(container)).toContain('Not selected');
    expect(containerText(container)).toContain('Selected for sync');
    expect(containerText(container)).toContain('Last provider error: Provider timed out on the last attempt.');
    expect(containerText(container)).toContain('Last successful sync: Oct 22');

    const refreshButton = requiredButton(container, 'Refresh');
    await clickAndSettle(refreshButton);

    expect(discoveryCalls).toBe(2);
    expect(containerText(container)).toContain('refresh queued for 2 accounts');
    expect(containerText(container)).toContain('last known data until the queued sync completes');
    expect(requestWasMade(fetchMock, '/api/lunchflow/sync')).toBe(true);
  });

  it('requires explicit currency and kind, then sends the whole selected list', async () => {
    let selectionBody: unknown = null;
    const response = configuredAccounts({ selected: true, currency: null, kind: null });
    response.accounts[1].selected = false;
    const fetchMock = mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/account-selection': (init) => {
        selectionBody = requestBody(init);
        return { body: { selected: 1, queued: false } };
      },
    });

    await renderSection();
    const saveButton = requiredButton(container, 'Save selection');

    await clickAndSettle(saveButton);
    expect(containerText(container)).toContain('Choose a returned currency and account kind for Everyday Chequing before saving.');
    expect(requestWasMade(fetchMock, '/api/lunchflow/account-selection')).toBe(false);

    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="Everyday Chequing currency"]')).not.toBeNull();
    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="Everyday Chequing kind"]')).not.toBeNull();
    await act(async () => {
      setSelectValue(container, 'Everyday Chequing currency', 'CAD');
      setSelectValue(container, 'Everyday Chequing kind', 'chequing');
      await Promise.resolve();
    });

    await clickAndSettle(saveButton);
    expect(selectionBody).toEqual({ accounts: [{ providerAccountId: 'rbc-chequing', currency: 'CAD', kind: 'chequing' }] });
    expect(containerText(container)).toContain('Lunch Flow selection saved for 1 account.');
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('did not queue a sync');
  });

  it('refreshes the parent after saving and again when a queued sync advances lastSyncedAt', async () => {
    const response = configuredAccounts();
    response.accounts[0].selected = true;
    response.accounts[0].currency = 'CAD';
    response.accounts[0].kind = 'chequing';
    response.accounts[1].selected = false;
    response.accounts[1].lastError = null;
    let discoveryCalls = 0;
    const refreshWorkspace = vi.fn(async () => undefined);
    mockApi({
      '/api/lunchflow/accounts': () => {
        discoveryCalls += 1;
        if (discoveryCalls >= 3) {
          return { body: { ...response, accounts: [{ ...response.accounts[0], lastSyncedAt: '2026-10-22T15:00:00.000Z' }, response.accounts[1]] } };
        }
        return { body: response };
      },
      '/api/lunchflow/account-selection': { body: { selected: 1, queued: true } },
    });

    await renderSection(refreshWorkspace);
    const saveButton = findButton(container, 'Save selection');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 650));
    });

    expect(refreshWorkspace).toHaveBeenCalledTimes(3);
    expect(container?.textContent).toContain('Lunch Flow sync completed and the ledger was refreshed.');
  });

  it('treats an empty selection with queued false as a successful history-preserving save', async () => {
    const response = configuredAccounts();
    response.accounts.forEach((account) => {
      account.selected = false;
      account.lastError = null;
    });
    const refreshWorkspace = vi.fn(async () => undefined);
    mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/account-selection': (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ accounts: [] });
        return { body: { selected: 0, queued: false } };
      },
    });

    await renderSection(refreshWorkspace);
    const saveButton = findButton(container, 'Save selection');
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(refreshWorkspace).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain('Lunch Flow selection saved for 0 accounts.');
    expect(container?.textContent).toContain('Existing Lunch Flow history stays in the ledger');
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the full discovery list while local polling stops on a changed provider error', async () => {
    const response = configuredAccounts();
    response.accounts[0].selected = true;
    response.accounts[0].currency = 'CAD';
    response.accounts[0].kind = 'chequing';
    response.accounts[1].lastError = null;
    let localCalls = 0;
    const refreshWorkspace = vi.fn(async () => undefined);
    const fetchMock = mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/account-selection': { body: { selected: 2, queued: true } },
      '/api/lunchflow/accounts?status=local': () => {
        localCalls += 1;
        return { body: { configured: true, accounts: [{ ...response.accounts[0], lastError: 'Lunch Flow account is temporarily unavailable.' }] } };
      },
    });

    await renderSection(refreshWorkspace);
    await clickAndSettle(requiredButton(container, 'Save selection'), 650);

    expect(localCalls).toBe(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/lunchflow/accounts?status=local'))).toBe(true);
    expect(containerText(container)).toContain('RBC Visa');
    expect(containerText(container)).toContain('Lunch Flow sync failed for Everyday Chequing');
    expect(containerText(container)).toContain('temporarily unavailable');
    expect(containerText(container)).not.toContain('sync completed and the ledger was refreshed');
  });

  it('stops when a repeated provider error records a newer attempt', async () => {
    const response = configuredAccounts();
    response.accounts[0].selected = true;
    response.accounts[0].currency = 'CAD';
    response.accounts[0].kind = 'chequing';
    response.accounts[0].lastError = 'Lunch Flow provider is unavailable.';
    response.accounts[0].lastAttemptAt = '2026-10-22T14:00:00.000Z';
    response.accounts[1].selected = false;
    response.accounts[1].lastError = null;
    let localCalls = 0;
    mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/account-selection': { body: { selected: 1, queued: true } },
      '/api/lunchflow/accounts?status=local': () => {
        localCalls += 1;
        return { body: { configured: true, accounts: [{ ...response.accounts[0], lastAttemptAt: '2026-10-22T15:00:00.000Z' }] } };
      },
    });

    await renderSection();
    await clickAndSettle(requiredButton(container, 'Save selection'), 650);

    expect(localCalls).toBe(1);
    expect(containerText(container)).toContain('Lunch Flow sync failed for Everyday Chequing');
    expect(containerText(container)).not.toContain('still pending');
  });

  it('waits for every selected account before showing sync completion', async () => {
    const response = configuredAccounts();
    response.accounts[0].selected = true;
    response.accounts[0].currency = 'CAD';
    response.accounts[0].kind = 'chequing';
    response.accounts[0].lastSyncedAt = '2026-10-22T14:00:00.000Z';
    response.accounts[1].lastError = null;
    let localCalls = 0;
    mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/account-selection': { body: { selected: 2, queued: true } },
      '/api/lunchflow/accounts?status=local': () => {
        localCalls += 1;
        const first = { ...response.accounts[0], lastSyncedAt: '2026-10-22T15:00:00.000Z' };
        const second = { ...response.accounts[1], lastSyncedAt: localCalls > 1 ? '2026-10-22T15:00:00.000Z' : response.accounts[1].lastSyncedAt };
        return { body: { configured: true, accounts: [first, second] } };
      },
    });

    await renderSection();
    await clickAndSettle(requiredButton(container, 'Save selection'), 650);
    expect(localCalls).toBe(1);
    expect(containerText(container)).toContain('until the queued sync completes');
    expect(containerText(container)).not.toContain('sync completed and the ledger was refreshed');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(localCalls).toBe(2);
    expect(containerText(container)).toContain('Lunch Flow sync completed and the ledger was refreshed.');
  });

  it('keeps a workspace refresh failure visible after queued sync completion', async () => {
    const response = configuredAccounts();
    response.accounts[1].lastError = null;
    const refreshWorkspace = vi.fn(async () => {
      throw new Error('workspace offline');
    });
    mockApi({
      '/api/lunchflow/accounts': { body: response },
      '/api/lunchflow/sync': { body: { queued: true, accounts: 1 } },
      '/api/lunchflow/accounts?status=local': { body: { configured: true, accounts: [{ ...response.accounts[1], lastSyncedAt: '2026-10-22T15:00:00.000Z' }] } },
    });

    await renderSection(refreshWorkspace);
    await clickAndSettle(requiredButton(container, 'Refresh'), 650);

    expect(containerText(container)).toContain('ledger could not refresh: workspace offline');
    expect(containerText(container)).not.toContain('sync completed and the ledger was refreshed');
  });

  it('refreshes the parent workspace on mount and window focus', async () => {
    const refreshWorkspace = vi.fn(async () => undefined);
    mockApi({ '/api/lunchflow/accounts': { body: configuredAccounts() } });

    await renderSection(refreshWorkspace);
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(refreshWorkspace).toHaveBeenCalledTimes(2);
  });

  it('remains usable under React StrictMode effect replay', async () => {
    mockApi({ '/api/lunchflow/accounts': { body: configuredAccounts() } });

    await renderSection(undefined, true);

    expect(containerText(container)).toContain('Everyday Chequing');
    expect(containerText(container)).not.toContain('Reading Lunch Flow accounts');
  });

  it('filters unsupported currencies and keeps stale deselected accounts disabled while showing history', async () => {
    const response = configuredAccounts();
    response.accounts[0].currencies = ['CAD', 'BTC'];
    response.accounts[0].lastError = 'Provider account is no longer available.';
    response.accounts[0].selected = false;
    mockApi({ '/api/lunchflow/accounts': { body: response } });

    await renderSection();
    const checkbox = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const currency = container?.querySelector<HTMLSelectElement>('select[aria-label="Everyday Chequing currency"]');
    expect(checkbox?.disabled).toBe(true);
    expect(currency?.querySelector('option[value="BTC"]')).toBeNull();
    expect(container?.textContent).toContain('Existing ledger history stays in the ledger');
  });

  it('shows discovery failures and the missing Worker key state without asking for a browser secret', async () => {
    let fail = true;
    mockApi({
      '/api/lunchflow/accounts': () => {
        if (fail) return { body: { error: 'Lunch Flow provider unavailable.' }, status: 502 };
        return { body: { configured: false, accounts: [] } };
      },
    });

    await renderSection();
    expect(container?.textContent).toContain('Lunch Flow account discovery failed.');
    expect(container?.textContent).toContain('Lunch Flow provider unavailable.');

    fail = false;
    const retryButton = findButton(container, 'Try again');
    expect(retryButton).toBeDefined();
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container?.textContent).toContain('Lunch Flow is not configured on this Worker.');
    expect(container?.textContent).toContain('No key belongs in the browser.');
  });
});
