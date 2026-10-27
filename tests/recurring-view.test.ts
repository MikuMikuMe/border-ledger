// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stream = {
  id: 'item-1:stream-1',
  itemId: 'item-1',
  streamId: 'stream-1',
  accountId: 'account-cad',
  merchantName: 'Transit pass',
  merchantEntityId: null,
  currency: 'CAD' as const,
  sourceStatus: 'MATURE',
  sourceFrequency: 'MONTHLY',
  frequency: 'MONTHLY' as const,
  isOutflow: true,
  firstDate: '2026-01-01',
  lastDate: '2026-10-01',
  predictedNextDate: '2026-10-20',
  averageAmountMinor: -1234,
  lastAmountMinor: -1234,
  predictedAmountMinor: -1234,
  memberships: [],
  sourceUpdatedAt: '2026-10-13T14:00:00.000Z',
  classification: 'unclassified' as const,
};

const page = {
  streams: [stream],
  nextCursor: null,
  state: 'ready' as const,
  checkedAt: '2026-10-13T15:00:00.000Z',
  sourceUpdatedAt: '2026-10-13T14:00:00.000Z',
  lastError: null,
  coverageWarnings: [],
};

const summary = {
  monthlyByCurrency: { CAD: -1234, CNY: 0 },
  yearlyByCurrency: { CAD: -14808, CNY: 0 },
  subscriptionByCurrency: { CAD: 0, CNY: 0 },
  upcoming: [{ ...stream, nextExpectedAmountMinor: -1234 }],
  latestPaymentChanges: [],
  actualCostByCurrency: { CAD: 1234, CNY: 0 },
  streamCount: 1,
  coverageWarnings: [],
  checkedAt: page.checkedAt,
  sourceUpdatedAt: page.sourceUpdatedAt,
  lastError: null,
  state: 'ready' as const,
};

describe('recurring workspace view', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  function jsonResponse(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }

  async function renderApp(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    privateFetchSpy().mockImplementation(fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const navButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Recurring'));
    expect(navButton).toBeDefined();
    act(() => navButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('loads the private recurring feed, exposes filters, and opens detail history', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    await renderApp(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/api/accounts')) return jsonResponse({ accounts: [] });
      if (url.endsWith('/api/transactions')) return jsonResponse({ transactions: [] });
      if (url.includes('/api/recurring/summary')) return jsonResponse(summary);
      if (url.includes('/api/recurring/item-1%3Astream-1')) return jsonResponse({ stream: { ...stream, memberships: [{ providerTransactionId: 'posted-1', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1234, currency: 'CAD', status: 'posted', kind: 'expense' }] }, history: [{ providerTransactionId: 'posted-1', pendingProviderTransactionId: null, date: '2026-10-01', amountMinor: -1234, currency: 'CAD', status: 'posted', kind: 'expense' }], nextCursor: null, classification: 'unclassified' });
      if (url.includes('/api/recurring?')) return jsonResponse(page);
      return jsonResponse({ error: 'not found' }, 404);
    });

    expect(container?.textContent).toContain('Recurring payments');
    expect(container?.textContent).toContain('Monthly run-rate');
    expect(container?.textContent).toContain('Transit pass');
    expect(container?.querySelector('select[aria-label="Recurring currency"]')).not.toBeNull();

    const streamButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Transit pass'));
    expect(streamButton).toBeDefined();
    act(() => streamButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container?.textContent).toContain('Payment history');
    expect(calls.some((call) => call.url.includes('/api/recurring/item-1%3Astream-1'))).toBe(true);
  });

  it('renders a private waiting state without inventing recurring data', async () => {
    await renderApp(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/accounts')) return jsonResponse({ accounts: [] });
      if (url.endsWith('/api/transactions')) return jsonResponse({ transactions: [] });
      if (url.includes('/api/recurring/summary')) return jsonResponse({ ...summary, streams: undefined, streamCount: 0, state: 'waiting', monthlyByCurrency: { CAD: 0, CNY: 0 }, yearlyByCurrency: { CAD: 0, CNY: 0 }, actualCostByCurrency: { CAD: 0, CNY: 0 }, upcoming: [] });
      if (url.includes('/api/recurring?')) return jsonResponse({ ...page, streams: [], state: 'waiting' });
      return jsonResponse({ error: 'not found' }, 404);
    });

    expect(container?.textContent).toContain('Waiting for the first recurring snapshot');
    expect(container?.textContent).not.toContain('Transit pass');
  });

  it('loads the next bounded page without replacing the first page', async () => {
    const calls: string[] = [];
    await renderApp(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/accounts')) return jsonResponse({ accounts: [] });
      if (url.endsWith('/api/transactions')) return jsonResponse({ transactions: [] });
      if (url.includes('/api/recurring/summary')) return jsonResponse(summary);
      if (url.includes('cursor=cursor-1')) {
        return jsonResponse({ ...page, streams: [{ ...stream, id: 'item-1:stream-2', streamId: 'stream-2', merchantName: 'Gym membership' }], nextCursor: null });
      }
      if (url.includes('/api/recurring?')) return jsonResponse({ ...page, nextCursor: 'cursor-1' });
      return jsonResponse({ error: 'not found' }, 404);
    });

    const loadMore = Array.from(container?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Load more streams'));
    expect(loadMore).toBeDefined();
    act(() => loadMore?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container?.textContent).toContain('Transit pass');
    expect(container?.textContent).toContain('Gym membership');
    expect(calls.some((url) => url.includes('cursor=cursor-1'))).toBe(true);
  });
});
