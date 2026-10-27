import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerSession } from '../src/domain/api';
afterEach(() => vi.restoreAllMocks());
describe('web authenticated response identity', () => {
  it('fails closed on financial JSON without a server identity binding', async () => {
    const { session, fetcher, api } = await signedIn();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ accounts: [{ id: 'private-a' }] })));
    await expect(api('/api/accounts')).rejects.toThrow('session changed');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(session.snapshot().identity).toBeNull();
  });
});

function identified(user: string, body: unknown = {}) {
  return new Response(JSON.stringify(body), { headers: { 'X-Ledger-User': user, 'X-Ledger-Id': `${user}-ledger`, 'X-Ledger-Session': `${user}-session` } });
}
async function signedIn() {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(identified('a'));
  const session = new LedgerSession();
  await session.bootstrap();
  return { session, fetcher, api: session.bind() };
}
describe('immutable web action scopes', () => {
  it('preserves a file action scope and epoch after exact same-session revalidation', async () => {
    const { session, fetcher, api } = await signedIn();
    const epoch = session.snapshot().epoch;
    fetcher.mockImplementation(async () => identified('a'));
    await session.bootstrap();
    expect(session.snapshot().epoch).toBe(epoch);
    await expect(api('/api/imports/commit', { method: 'POST', body: '{}' })).resolves.toEqual({});
  });
  it('invalidates old actions when the same user returns with a different verified session', async () => {
    const { session, fetcher, api } = await signedIn();
    const previous = session.snapshot().epoch;
    const replacement = identified('a'); replacement.headers.set('X-Ledger-Session', 'replacement-session');
    fetcher.mockResolvedValue(replacement);
    await session.bootstrap();
    expect(session.snapshot().epoch).toBe(previous + 1);
    const calls = fetcher.mock.calls.length;
    await expect(api('/api/imports/commit', { method: 'POST', body: '{}' })).rejects.toThrow('session changed');
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('rejects mixed parallel identities without adopting the mismatched response', async () => {
    const { session, fetcher, api } = await signedIn();
    fetcher.mockResolvedValueOnce(identified('a', { accounts: [] })).mockResolvedValueOnce(identified('b', { transactions: [] }));
    await expect(Promise.all([api('/api/accounts'), api('/api/transactions')])).rejects.toThrow('session changed');
    expect(session.snapshot().identity).toBeNull();
  });
  it('does not send a delayed file commit with the next browser session', async () => {
    const { session, fetcher, api: importedUnderA } = await signedIn();
    fetcher.mockResolvedValue(identified('b'));
    await session.bootstrap();
    const calls = fetcher.mock.calls.length;
    await expect(importedUnderA('/api/imports/commit', { method: 'POST', body: '{}' })).rejects.toThrow('session changed');
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('drops delayed A responses without invalidating the later B session', async () => {
    const { session, fetcher, api } = await signedIn();
    let finish!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = api('/api/accounts');
    fetcher.mockResolvedValue(identified('b'));
    await session.bootstrap();
    finish(identified('a', { accounts: ['secret-a'] }));
    await expect(pending).rejects.toThrow('session changed');
    expect(session.snapshot().identity?.userId).toBe('b');
  });
  it('pins the expected session on mutations so a cookie swap fails server-side', async () => {
    const { fetcher, api } = await signedIn();
    fetcher.mockResolvedValue(identified('a', { accepted: 1 }));
    await api('/api/imports/commit', { method: 'POST', body: '{}' });
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get('X-Ledger-Expected-Session')).toBe('a-session');
  });
});
