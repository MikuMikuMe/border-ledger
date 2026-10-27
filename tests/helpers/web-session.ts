import { vi } from 'vitest';
/** Synthetic authenticated server responses for existing component fixtures. */
export class IdentityResponse extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set('X-Ledger-User', 'owner');
    headers.set('X-Ledger-Id', 'personal');
    headers.set('X-Ledger-Session', 'fixture-session');
    super(body, { ...init, headers });
  }
}
export function privateFetchSpy() {
  const spy = vi.spyOn(globalThis, 'fetch');
  const install = spy.mockImplementation.bind(spy);
  spy.mockImplementation = handler => install(async (input, init) => {
    if (String(input).endsWith('/api/session')) return new IdentityResponse(JSON.stringify({ userId: 'owner', ledgerId: 'personal' }));
    return handler!(input, init);
  });
  return spy;
}
