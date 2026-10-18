export const CAPTURE_DESTINATION = '/capture' as const;

export type SafeSessionState =
  | 'restoring'
  | 'signing_in'
  | 'awaiting_browser'
  | 'exchanging'
  | 'refreshing'
  | 'signing_out'
  | 'signed_in'
  | 'signed_out'
  | 'expired'
  | 'callback_rejected'
  | 'storage_failure';

export type SafeSessionSnapshot = {
  state: SafeSessionState;
  expiresAt: string | null;
  pendingDestination: string | null;
  reason: string | null;
  pendingRevocations: number;
  environment: string;
};

export type ShellDestination = 'overview' | 'activity' | 'recurring' | 'review' | 'accounts' | 'settings' | 'capture';

const BUSY_STATES = new Set<SafeSessionState>(['restoring', 'signing_in', 'exchanging', 'refreshing', 'signing_out']);
const DESTINATIONS = new Set<ShellDestination>(['overview', 'activity', 'recurring', 'review', 'accounts', 'settings', 'capture']);

export function initialAuthControls() {
  return { staySignedIn: false, pendingDestination: CAPTURE_DESTINATION } as const;
}

export function routeForSession(snapshot: SafeSessionSnapshot, previousRoute: 'login' | 'shell' = 'login'): 'login' | 'shell' {
  return snapshot.state === 'signed_in' || (snapshot.state === 'refreshing' && previousRoute === 'shell')
    ? 'shell'
    : 'login';
}

export function shellDestination(value: string | null): ShellDestination {
  const normalized = value === CAPTURE_DESTINATION ? 'capture' : value;
  return normalized && DESTINATIONS.has(normalized as ShellDestination)
    ? normalized as ShellDestination
    : 'overview';
}

export function presentationForSession(snapshot: SafeSessionSnapshot) {
  const status = (() => {
    switch (snapshot.state) {
      case 'restoring': return 'Restoring a protected session…';
      case 'signing_in': return 'Opening secure browser approval…';
      case 'awaiting_browser': return 'Approve access in the verified browser, then return here.';
      case 'exchanging': return 'Completing the secure return…';
      case 'refreshing': return 'Refreshing the owner session…';
      case 'signing_out': return 'Signing out and hiding financial data…';
      case 'expired': return 'The owner session expired. Sign in again.';
      case 'callback_rejected': return 'The return link could not be verified. Start sign-in again.';
      case 'storage_failure': return 'Secure storage is unavailable. Financial data remains locked.';
      case 'signed_out':
        if (snapshot.reason === 'Canceled') return 'Sign-in was canceled. You can try again.';
        if (snapshot.reason === 'Offline' && snapshot.pendingRevocations > 0) return 'Signed out locally. Remote revocation will continue when the network returns.';
        if (snapshot.reason === 'StartFailed') return 'Sign-in could not start. Check your connection and try again.';
        return '';
      case 'signed_in': return '';
    }
  })();

  return {
    busy: BUSY_STATES.has(snapshot.state),
    retryable: snapshot.state === 'expired' || snapshot.state === 'callback_rejected' ||
      snapshot.state === 'storage_failure' || snapshot.state === 'signed_out',
    status,
  };
}
