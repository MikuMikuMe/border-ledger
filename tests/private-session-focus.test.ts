// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PrivateSession, useLedgerApi } from '../src/components/PrivateSession';
import { ledgerSession } from '../src/domain/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); ledgerSession.invalidate(); vi.restoreAllMocks(); });
function response(user = 'a') { return new Response('{}', { headers: { 'X-Ledger-User': user, 'X-Ledger-Id': user + '-ledger', 'X-Ledger-Session': user + '-session' } }); }

it.each(['a', 'b'])('focus verification retains a pending file only for the exact session (%s)', async user => {
  let verify!: (response: Response) => void;
  let finishFile!: () => void;
  const file = new Promise<void>(resolve => { finishFile = resolve; });
  let continuation: Promise<unknown> | undefined;
  let mounts = 0;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());
  function Draft() {
    const api = useLedgerApi();
    useEffect(() => { mounts++; }, []);
    return createElement('div', {}, createElement('input', { defaultValue: 'draft' }), createElement('button', {
      onClick: () => { continuation = file.then(() => api('/api/imports/commit', { method: 'POST', body: '{}' })).catch(error => error); },
    }, 'Read file'));
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(PrivateSession, { children: createElement(Draft) })); });
  const input = host.querySelector('input')!; input.value = 'unsaved choice';
  act(() => host!.querySelector('button')!.click());
  const epoch = ledgerSession.snapshot().epoch;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
  await act(async () => { window.dispatchEvent(new Event('focus')); finishFile(); await Promise.resolve(); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(host.querySelector('input')).toBe(input);
  expect(input.closest('[hidden]')).not.toBeNull();
  await act(async () => { verify(response(user)); await continuation; });
  if (user === 'a') {
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('unsaved choice'); expect(mounts).toBe(1);
    expect(ledgerSession.snapshot().epoch).toBe(epoch);
    expect(fetcher).toHaveBeenCalledTimes(3);
  } else {
    expect(host.querySelector('input')).not.toBe(input); expect(mounts).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});
