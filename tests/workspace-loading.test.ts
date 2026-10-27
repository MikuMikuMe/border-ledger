// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('private workspace data states', () => {
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

  function renderApp() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(App)));
  }

  function jsonResponse(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }

  it('does not show demo transactions while private data is still loading', () => {
    let resolveAccounts: ((response: Response) => void) | undefined;
    const accountsResponse = new Promise<Response>((resolve) => { resolveAccounts = resolve; });
    const fetchMock = privateFetchSpy().mockImplementation((input) => {
      if (String(input).endsWith('/api/accounts')) return accountsResponse;
      return Promise.resolve(jsonResponse({ transactions: [] }));
    });

    renderApp();

    expect(container?.textContent).toContain('Loading your private ledger');
    expect(container?.textContent).not.toContain('Union Station Market');
    expect(fetchMock).toHaveBeenCalled();
    resolveAccounts?.(jsonResponse({ accounts: [] }));
  });

  it('shows an actionable error when private reads fail', async () => {
    privateFetchSpy().mockRejectedValue(new Error('network unavailable'));
    renderApp();

    await act(async () => { await Promise.resolve(); });

    expect(container?.textContent).toContain('Could not load your private ledger');
    expect(Array.from(container?.querySelectorAll('button') ?? []).some((button) => button.textContent?.includes('Retry loading data'))).toBe(true);
  });

  it('shows a valid empty result as zero activity instead of demo data', async () => {
    privateFetchSpy().mockImplementation(async (input) => {
      if (String(input).endsWith('/api/accounts')) return jsonResponse({ accounts: [] });
      return jsonResponse({ transactions: [] });
    });
    renderApp();

    await act(async () => { await Promise.resolve(); });

    expect(container?.textContent).toContain('No confirmed activity yet');
    expect(container?.textContent).not.toContain('Union Station Market');
  });
});
