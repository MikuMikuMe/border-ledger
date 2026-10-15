// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileAuthorizationPage from '../src/MobileAuthorizationPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const STATE = 'eW91LXN0YXRlLXRva2VuXzEyMzQ1Njc4OTA';
const CODE = 'Y29kZS1vbmNlLXRva2VuXzEyMzQ1Njc4OTA';
const ORIGIN = 'https://pf.example.test';
const EXPIRES_AT = '2026-10-15T12:02:00.000Z';

describe('mobile Access authorization page', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  function renderPage(props: Partial<React.ComponentProps<typeof MobileAuthorizationPage>> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(MobileAuthorizationPage, {
        requestId: REQUEST_ID,
        state: STATE,
        origin: ORIGIN,
        ...props,
      }));
    });
  }

  function button(label: string) {
    const found = Array.from(container?.querySelectorAll('button') ?? []).find((item) => item.textContent?.trim() === label);
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }

  it('fails closed when the authorization link is incomplete', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    renderPage({ requestId: null, state: null, fetchImpl });

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('authorization link is incomplete');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('approves the request once and returns to the exact callback with the original state', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      approved: true,
      code: CODE,
      callbackUrl: `${ORIGIN}/android/auth/callback`,
      expiresAt: EXPIRES_AT,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const navigate = vi.fn();
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/mobile-auth/requests/${REQUEST_ID}/approval`, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/android/auth/callback?state=${STATE}&code=${CODE}`);
    expect(container?.textContent).toContain('Returning you to the app');
    expect(container?.textContent).not.toContain(STATE);
    expect(container?.textContent).not.toContain(CODE);
  });

  it('does not submit twice while the Access approval is pending', async () => {
    let resolveApproval!: (response: Response) => void;
    const pendingApproval = new Promise<Response>((resolve) => {
      resolveApproval = resolve;
    });
    const fetchImpl = vi.fn(async () => pendingApproval) as unknown as typeof fetch;
    renderPage({ fetchImpl, navigate: vi.fn() });
    const continueButton = button('Continue to app');

    await act(async () => {
      continueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      continueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(continueButton.disabled).toBe(true);
    expect(continueButton.getAttribute('aria-busy')).toBe('true');

    resolveApproval(new Response(JSON.stringify({ approved: true, code: CODE, callbackUrl: `${ORIGIN}/android/auth/callback`, expiresAt: EXPIRES_AT }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await act(async () => {
      await pendingApproval;
    });
  });

  it('can retry after a transient approval response failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        approved: true,
        code: CODE,
        callbackUrl: `${ORIGIN}/android/auth/callback`,
        expiresAt: EXPIRES_AT,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const navigate = vi.fn();
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('temporary network failure');

    await act(async () => {
      button('Try again').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/android/auth/callback?state=${STATE}&code=${CODE}`);
  });

  it('returns a cancellation result to the app without contacting the Worker', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const navigate = vi.fn();
    renderPage({ fetchImpl, navigate });

    button('Cancel sign-in').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    const callback = new URL(navigate.mock.calls[0][0]);
    expect(callback.origin).toBe(ORIGIN);
    expect(callback.pathname).toBe('/android/auth/callback');
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('error')).toBe('access_denied');
  });

  it('rejects a callback that is not the configured HTTPS app callback', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      approved: true,
      code: CODE,
      callbackUrl: 'https://evil.example/android/auth/callback',
      expiresAt: EXPIRES_AT,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const navigate = vi.fn();
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('callback is not valid');
  });

  it('rejects explicit empty fragments before redirecting', async () => {
    const navigate = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      approved: true,
      code: CODE,
      callbackUrl: `${ORIGIN}/android/auth/callback#`,
      expiresAt: EXPIRES_AT,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('callback is not valid');
  });

  it('rejects an incomplete success schema before redirecting', async () => {
    const navigate = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      approved: true,
      code: CODE,
      callbackUrl: `${ORIGIN}/android/auth/callback`,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('response was invalid');
  });

  it('rejects a successful response served with a non-JSON content type', async () => {
    const navigate = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      approved: true,
      code: CODE,
      callbackUrl: `${ORIGIN}/android/auth/callback`,
      expiresAt: EXPIRES_AT,
    }), { status: 200, headers: { 'content-type': 'text/html' } }));
    renderPage({ fetchImpl, navigate });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('could not be completed');
  });

  it('shows a useful error when the approval endpoint returns non-JSON failure content', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Access denied</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    renderPage({ fetchImpl });

    await act(async () => {
      button('Continue to app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('could not be completed');
    expect(container?.textContent).not.toContain('Access denied');
  });
});
