import { describe, expect, it, vi } from 'vitest';
import { SessionCoordinator, type DisplaySnapshot, type SessionPort } from '../mobile/src/features/auth/SessionCoordinator';
import type { SafeSessionSnapshot } from '../mobile/src/features/auth/authModel';

const signedOut: SafeSessionSnapshot = {
  state: 'signed_out', expiresAt: null, pendingDestination: null, reason: null,
  pendingRevocations: 0, environment: 'sandbox',
};
const display: DisplaySnapshot = { appearanceMode: 'System', filter: 'All', reducedMotion: false };

function fixture() {
  let sessionListener: ((value: SafeSessionSnapshot) => void) | undefined;
  let displayListener: ((value: DisplaySnapshot) => void) | undefined;
  const removeSession = vi.fn();
  const removeDisplay = vi.fn();
  const session: SessionPort = {
    getSnapshot: vi.fn(async () => signedOut),
    refreshOnResume: vi.fn(async () => signedOut),
    beginLogin: vi.fn(async () => ({ ...signedOut, state: 'awaiting_browser' } as SafeSessionSnapshot)),
    signOut: vi.fn(async () => signedOut),
    consumePendingDestination: vi.fn(async () => '/capture'),
    onStateChanged: vi.fn((listener) => { sessionListener = listener; return { remove: removeSession }; }),
  };
  const preferences = {
    getSnapshot: vi.fn(async () => display),
    updateDisplay: vi.fn(async (value: DisplaySnapshot) => value),
    onChanged: vi.fn((listener: (value: DisplaySnapshot) => void) => { displayListener = listener; return { remove: removeDisplay }; }),
  };
  const coordinator = new SessionCoordinator(session, preferences);
  return { coordinator, session, preferences, removeSession, removeDisplay,
    emitSession: (value: SafeSessionSnapshot) => sessionListener?.(value),
    emitDisplay: (value: DisplaySnapshot) => displayListener?.(value) };
}

describe('SessionCoordinator', () => {
  it('loads safe native snapshots and subscribes to typed changes', async () => {
    const f = fixture();
    await f.coordinator.start();
    expect(f.coordinator.current()).toMatchObject({ session: signedOut, display, destination: 'overview' });

    f.emitDisplay({ ...display, reducedMotion: true });
    expect(f.coordinator.current().display.reducedMotion).toBe(true);
  });

  it('does not let late initial snapshots overwrite newer native events', async () => {
    const f = fixture();
    let resolveSession!: (value: SafeSessionSnapshot) => void;
    let resolveDisplay!: (value: DisplaySnapshot) => void;
    f.session.getSnapshot = vi.fn(() => new Promise<SafeSessionSnapshot>((resolve) => { resolveSession = resolve; }));
    f.preferences.getSnapshot = vi.fn(() => new Promise<DisplaySnapshot>((resolve) => { resolveDisplay = resolve; }));

    const starting = f.coordinator.start();
    const signedIn = { ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session' } as SafeSessionSnapshot;
    f.emitSession(signedIn);
    f.emitDisplay({ ...display, reducedMotion: true });
    resolveSession(signedOut);
    resolveDisplay(display);
    await starting;

    expect(f.coordinator.current().session.state).toBe('signed_in');
    expect(f.coordinator.current().display.reducedMotion).toBe(true);
  });

  it('maps native restore and resume failures to a locked storage-failure state', async () => {
    const f = fixture();
    f.session.getSnapshot = vi.fn(async () => { throw new Error('native restore failed'); });
    f.session.refreshOnResume = vi.fn(async () => { throw new Error('native resume failed'); });

    await expect(f.coordinator.start()).resolves.toBeUndefined();
    expect(f.coordinator.current().session).toMatchObject({ state: 'storage_failure' });
    await expect(f.coordinator.resume()).resolves.toBeUndefined();
    expect(f.coordinator.current().session).toMatchObject({ state: 'storage_failure' });
  });

  it('starts browser sign-in with the explicit capture destination and selected duration', async () => {
    const f = fixture();
    await f.coordinator.start();
    await f.coordinator.beginLogin(false);
    expect(f.session.beginLogin).toHaveBeenCalledWith(false, '/capture');
    expect(f.coordinator.current().session.state).toBe('awaiting_browser');
  });

  it('keeps a callback event that arrives before the browser-launch promise resolves', async () => {
    const f = fixture();
    let resolveLaunch!: (value: SafeSessionSnapshot) => void;
    f.session.beginLogin = vi.fn(() => new Promise<SafeSessionSnapshot>((resolve) => { resolveLaunch = resolve; }));
    await f.coordinator.start();

    const launching = f.coordinator.beginLogin(false);
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    resolveLaunch({ ...signedOut, state: 'awaiting_browser' });
    await launching;

    expect(f.coordinator.current().session.state).toBe('signed_in');
    await vi.waitFor(() => expect(f.coordinator.current().destination).toBe('capture'));
  });

  it('refreshes on resume and consumes a signed-in destination once per sign-in transition', async () => {
    const f = fixture();
    await f.coordinator.start();
    await f.coordinator.resume();
    expect(f.session.refreshOnResume).toHaveBeenCalledTimes(1);

    const signedIn = { ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' } as SafeSessionSnapshot;
    f.emitSession(signedIn);
    await vi.waitFor(() => expect(f.coordinator.current().destination).toBe('capture'));
    f.emitSession(signedIn);
    await Promise.resolve();
    expect(f.session.consumePendingDestination).toHaveBeenCalledTimes(1);
  });

  it('signs out natively and releases event subscriptions', async () => {
    const f = fixture();
    await f.coordinator.start();
    await f.coordinator.signOut();
    expect(f.session.signOut).toHaveBeenCalledTimes(1);
    f.coordinator.dispose();
    expect(f.removeSession).toHaveBeenCalledTimes(1);
    expect(f.removeDisplay).toHaveBeenCalledTimes(1);
  });

  it('keeps the non-Overview destination across token refresh instead of consuming it again', async () => {
    const f = fixture();
    f.session.consumePendingDestination = vi.fn()
      .mockResolvedValueOnce('/capture')
      .mockResolvedValue(null);
    await f.coordinator.start();
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    await vi.waitFor(() => expect(f.coordinator.current().destination).toBe('capture'));

    f.emitSession({ ...signedOut, state: 'refreshing' });
    expect(f.coordinator.current().route).toBe('shell');
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session' });
    await Promise.resolve();

    expect(f.coordinator.current().destination).toBe('capture');
    expect(f.coordinator.current().route).toBe('shell');
    expect(f.session.consumePendingDestination).toHaveBeenCalledTimes(1);
  });

  it('resets navigation when signed-in identity changes without a signed-out event', async () => {
    const f = fixture();
    await f.coordinator.start();
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'a', ledgerId: 'a-ledger', sessionEpoch: 'a-session', pendingDestination: '/capture' });
    await vi.waitFor(() => expect(f.coordinator.current().destination).toBe('capture'));
    f.session.consumePendingDestination = vi.fn(async () => null);
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'b', ledgerId: 'b-ledger', sessionEpoch: 'b-session' });
    expect(f.coordinator.current().destination).toBe('overview');
    expect(f.coordinator.current().session.userId).toBe('b');
  });

  it('leaves the durable destination for a replacement when disposed before the initial snapshot resolves', async () => {
    const f = fixture();
    let resolveSnapshot!: (value: SafeSessionSnapshot) => void;
    let pendingDestination: string | null = '/capture';
    f.session.getSnapshot = vi.fn(() => new Promise<SafeSessionSnapshot>((resolve) => { resolveSnapshot = resolve; }));
    f.session.consumePendingDestination = vi.fn(async () => {
      const value = pendingDestination;
      pendingDestination = null;
      return value;
    });
    const starting = f.coordinator.start();
    f.coordinator.dispose();
    resolveSnapshot({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    await starting;

    expect(f.session.consumePendingDestination).not.toHaveBeenCalled();
    expect(pendingDestination).toBe('/capture');
    f.session.getSnapshot = vi.fn(async (): Promise<SafeSessionSnapshot> => ({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination }));
    const replacement = new SessionCoordinator(f.session, f.preferences);
    await replacement.start();
    await vi.waitFor(() => expect(replacement.current().destination).toBe('capture'));
    replacement.dispose();
  });

  it('ignores an earlier lifecycle snapshot after the same coordinator restarts', async () => {
    const f = fixture();
    let resolveSnapshot!: (value: SafeSessionSnapshot) => void;
    f.session.getSnapshot = vi.fn(() => new Promise<SafeSessionSnapshot>((resolve) => { resolveSnapshot = resolve; }));
    const firstStart = f.coordinator.start();
    f.coordinator.dispose();
    f.session.getSnapshot = vi.fn(async () => signedOut);
    await f.coordinator.start();
    resolveSnapshot({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    await firstStart;

    expect(f.coordinator.current().session.state).toBe('signed_out');
    expect(f.session.consumePendingDestination).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores a stale destination %s after a later login transition', async (outcome) => {
    const f = fixture();
    let resolveDestination!: (value: string | null) => void;
    let rejectDestination!: (reason: Error) => void;
    f.session.consumePendingDestination = vi.fn()
      .mockImplementationOnce(() => new Promise<string | null>((resolve, reject) => {
        resolveDestination = resolve;
        rejectDestination = reject;
      }))
      .mockResolvedValue('activity');
    await f.coordinator.start();
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    f.emitSession(signedOut);
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: 'activity' });
    await vi.waitFor(() => expect(f.coordinator.current().destination).toBe('activity'));

    if (outcome === 'resolve') resolveDestination('/capture');
    else rejectDestination(new Error('earlier consume failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.coordinator.current().destination).toBe('activity');
    expect(f.coordinator.current().session.state).toBe('signed_in');
  });

  it('ignores an in-flight destination completion after disposal', async () => {
    const f = fixture();
    let resolveDestination!: (value: string | null) => void;
    f.session.consumePendingDestination = vi.fn(() => new Promise<string | null>((resolve) => { resolveDestination = resolve; }));
    await f.coordinator.start();
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    f.coordinator.dispose();
    resolveDestination('/capture');
    await Promise.resolve();
    expect(f.coordinator.current().destination).toBe('overview');
  });

  it('does not consume a destination when a state listener disposes the coordinator', async () => {
    const f = fixture();
    await f.coordinator.start();
    f.coordinator.listen((value) => {
      if (value.session.state === 'signed_in') f.coordinator.dispose();
    });
    f.emitSession({ ...signedOut, state: 'signed_in', userId: 'fixture-owner', ledgerId: 'fixture-ledger', sessionEpoch: 'fixture-session', pendingDestination: '/capture' });
    await Promise.resolve();
    expect(f.session.consumePendingDestination).not.toHaveBeenCalled();
  });
});
