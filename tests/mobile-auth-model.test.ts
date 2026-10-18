import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DESTINATION,
  initialAuthControls,
  presentationForSession,
  routeForSession,
  shellDestination,
  type SafeSessionSnapshot,
} from '../mobile/src/features/auth/authModel';

const snapshot = (state: SafeSessionSnapshot['state'], overrides: Partial<SafeSessionSnapshot> = {}): SafeSessionSnapshot => ({
  state,
  expiresAt: null,
  pendingDestination: null,
  reason: null,
  pendingRevocations: 0,
  environment: 'sandbox',
  ...overrides,
});

describe('mobile authentication model', () => {
  it('starts with the long-session control unchecked and capture as the browser return destination', () => {
    expect(initialAuthControls()).toEqual({ staySignedIn: false, pendingDestination: CAPTURE_DESTINATION });
  });

  it.each([
    ['restoring', 'login', true, false, 'Restoring a protected session…'],
    ['awaiting_browser', 'login', false, false, 'Approve access in the verified browser, then return here.'],
    ['signed_in', 'shell', false, false, ''],
    ['expired', 'login', false, true, 'The owner session expired. Sign in again.'],
    ['callback_rejected', 'login', false, true, 'The return link could not be verified. Start sign-in again.'],
    ['storage_failure', 'login', false, true, 'Secure storage is unavailable. Financial data remains locked.'],
  ] as const)('maps %s to a safe route and status', (state, route, busy, retryable, status) => {
    const value = snapshot(state);
    expect(routeForSession(value)).toBe(route);
    expect(presentationForSession(value)).toMatchObject({ busy, retryable, status });
  });

  it('turns cancellation and start failure into retryable generic statuses', () => {
    expect(presentationForSession(snapshot('signed_out', { reason: 'Canceled' }))).toMatchObject({
      retryable: true,
      status: 'Sign-in was canceled. You can try again.',
    });
    expect(presentationForSession(snapshot('signed_out', { reason: 'StartFailed' }))).toMatchObject({
      retryable: true,
      status: 'Sign-in could not start. Check your connection and try again.',
    });
  });

  it('does not claim remote revocation is pending when the revocation queue is empty', () => {
    expect(presentationForSession(snapshot('signed_out', { reason: 'Offline', pendingRevocations: 0 }))).toMatchObject({
      retryable: true,
      status: '',
    });
    expect(presentationForSession(snapshot('signed_out', { reason: 'Offline', pendingRevocations: 1 })).status)
      .toContain('Remote revocation will continue');
  });

  it('accepts only known native destinations and normalizes capture to the shell route', () => {
    expect(shellDestination('/capture')).toBe('capture');
    expect(shellDestination('activity')).toBe('activity');
    expect(shellDestination('untrusted-route')).toBe('overview');
    expect(shellDestination(null)).toBe('overview');
  });

  it('retains an established shell during refresh but locks terminal auth states', () => {
    expect(routeForSession(snapshot('refreshing'), 'shell')).toBe('shell');
    expect(routeForSession(snapshot('refreshing'), 'login')).toBe('login');
    expect(routeForSession(snapshot('expired'), 'shell')).toBe('login');
    expect(routeForSession(snapshot('signed_out'), 'shell')).toBe('login');
    expect(routeForSession(snapshot('storage_failure'), 'shell')).toBe('login');
  });
});
