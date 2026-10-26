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
  userId?: string | null;
  ledgerId?: string | null;
  sessionEpoch?: string | null;
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

const STATUS_BY_STATE: Partial<Record<SafeSessionState, string>> = {
  restoring: 'Restoring a protected session…',
  signing_in: 'Opening secure browser approval…',
  awaiting_browser: 'Approve access in the verified browser, then return here.',
  exchanging: 'Completing the secure return…',
  refreshing: 'Refreshing the owner session…',
  signing_out: 'Signing out and hiding financial data…',
  expired: 'The owner session expired. Sign in again.',
  callback_rejected: 'The return link could not be verified. Start sign-in again.',
  storage_failure: 'Secure storage is unavailable. Financial data remains locked.',
};

export function initialAuthControls() {
  return { staySignedIn: false, pendingDestination: CAPTURE_DESTINATION } as const;
}

export function routeForSession(snapshot: SafeSessionSnapshot, previousRoute: 'login' | 'shell' = 'login'): 'login' | 'shell' {
  return (snapshot.state === 'signed_in' && !!snapshot.userId && !!snapshot.ledgerId && !!snapshot.sessionEpoch) || (snapshot.state === 'refreshing' && previousRoute === 'shell')
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
  const status = statusForSession(snapshot);

  return {
    busy: BUSY_STATES.has(snapshot.state),
    retryable: isRetryable(snapshot.state),
    status,
  };
}

function statusForSession(snapshot: SafeSessionSnapshot): string {
  if (snapshot.state !== 'signed_out') return STATUS_BY_STATE[snapshot.state] ?? '';
  return signedOutStatus(snapshot);
}

function signedOutStatus(snapshot: SafeSessionSnapshot): string {
  if (snapshot.reason === 'Canceled') return 'Sign-in was canceled. You can try again.';
  if (snapshot.reason === 'Offline' && snapshot.pendingRevocations > 0) {
    return 'Signed out locally. Remote revocation will continue when the network returns.';
  }
  if (snapshot.reason === 'StartFailed') return 'Sign-in could not start. Check your connection and try again.';
  return '';
}

function isRetryable(state: SafeSessionState): boolean {
  return state === 'expired' || state === 'callback_rejected' || state === 'storage_failure' || state === 'signed_out';
}
