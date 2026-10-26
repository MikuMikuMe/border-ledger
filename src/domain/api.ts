const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class LedgerApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'request_failed', public readonly retryable = false) { super(message); }
}
export type LedgerIdentity = Readonly<{ userId: string; ledgerId: string; session: string }>;
export type LedgerApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type SessionView = Readonly<{ epoch: number; identity: LedgerIdentity | null; error: string | null; checking: boolean }>;

function responseIdentity(response: Response): LedgerIdentity | null {
  const userId = response.headers.get('X-Ledger-User');
  const ledgerId = response.headers.get('X-Ledger-Id');
  const session = response.headers.get('X-Ledger-Session');
  return userId && ledgerId && session ? Object.freeze({ userId, ledgerId, session }) : null;
}
function requiredIdentity(response: Response): LedgerIdentity {
  const identity = responseIdentity(response);
  if (!identity) throw new Error('Update Border Ledger and sign in again.');
  return identity;
}
function sameIdentity(first: LedgerIdentity | null, second: LedgerIdentity | null): boolean {
  return !!first && !!second && first.userId === second.userId && first.ledgerId === second.ledgerId && first.session === second.session;
}
async function payload(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }
function apiFailure(response: Response, value: unknown): LedgerApiError {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return new LedgerApiError(response.status, typeof body.error === 'string' ? body.error : 'The ledger could not complete that request.', typeof body.code === 'string' ? body.code : undefined, body.retryable === true);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Sign in again.'; }
function setBodyContentType(headers: Headers, init: RequestInit): void {
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
}

/** An API closure belongs to one mounted session, including work resumed after file IO. */
export class LedgerSession {
  private view: SessionView = { epoch: 0, identity: null, error: null, checking: false };
  private verification: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  snapshot = (): SessionView => this.view;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  invalidate(message: string | null = null): void {
    this.verification = null;
    this.view = { epoch: this.view.epoch + 1, identity: null, error: message, checking: false };
    this.publish();
  }
  private publish(): void { this.listeners.forEach(listener => listener()); }
  bootstrap(): Promise<void> {
    if (this.verification) return this.verification;
    const captured = this.view;
    this.view = { ...captured, checking: true, error: null };
    this.publish();
    const verification = this.revalidate(captured).finally(() => {
      if (this.verification === verification) this.verification = null;
    });
    this.verification = verification;
    return verification;
  }
  private async revalidate(captured: SessionView): Promise<void> {
    try {
      const response = await fetch(`${apiBaseUrl}/api/session`, { credentials: 'include', cache: 'no-store' });
      const value = await payload(response);
      if (captured.epoch !== this.view.epoch) return;
      if (!response.ok) throw apiFailure(response, value);
      const identity = requiredIdentity(response);
      const epoch = sameIdentity(captured.identity, identity) ? captured.epoch : captured.epoch + 1;
      this.view = { epoch, identity, error: null, checking: false };
      this.publish();
    } catch (error) {
      if (captured.epoch === this.view.epoch) this.invalidate(errorMessage(error));
    }
  }
  bind(): LedgerApi {
    const captured = this.view;
    return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      if (this.verification) await this.verification;
      this.assertCurrent(captured);
      const headers = new Headers(init.headers);
      headers.set('X-Ledger-Expected-Session', captured.identity!.session);
      setBodyContentType(headers, init);
      const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
      const value = await payload(response);
      if (this.verification) await this.verification;
      this.assertCurrent(captured);
      if (!sameIdentity(captured.identity, responseIdentity(response))) {
        this.invalidate('Your session changed. Sign in again.');
        throw new LedgerApiError(409, 'Your session changed. Sign in again.', 'session_changed');
      }
      this.assertSuccessful(response, value);
      return value as T;
    };
  }
  private assertSuccessful(response: Response, value: unknown): void {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) this.invalidate('Access is not enabled. Sign in again.');
    throw apiFailure(response, value);
  }
  private assertCurrent(captured: SessionView): void {
    if (captured.epoch !== this.view.epoch || !sameIdentity(captured.identity, this.view.identity)) throw new LedgerApiError(409, 'Your session changed. Sign in again.', 'session_changed');
  }
}
export const ledgerSession = new LedgerSession();
export const ledgerApi: LedgerApi = (path, init) => ledgerSession.bind()(path, init);
