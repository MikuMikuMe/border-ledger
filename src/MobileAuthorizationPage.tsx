import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const CALLBACK_PATH = '/android/auth/callback';

type ApprovalStatus = 'idle' | 'loading' | 'success' | 'error';

export type MobileAuthorizationFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MobileAuthorizationPageProps {
  requestId?: string | null;
  state?: string | null;
  fetchImpl?: MobileAuthorizationFetch;
  navigate?: (url: string) => void;
  origin?: string;
}

function defaultNavigate(url: string) {
  window.location.assign(url);
}

function currentOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function isRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

function isState(value: string | null | undefined): value is string {
  return typeof value === 'string' && STATE_PATTERN.test(value);
}

function isCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

function isExpiry(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function buildMobileCallbackUrl(callbackUrl: string, state: string, code: string, expectedOrigin = currentOrigin()) {
  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new Error('The app callback is not valid.');
  }
  if (
    callback.protocol !== 'https:'
    || callback.origin !== expectedOrigin
    || callback.pathname !== CALLBACK_PATH
    || callback.username
    || callback.password
    || callback.search
    || callback.hash
    || callbackUrl.includes('#')
    || !isState(state)
    || !isCode(code)
  ) {
    throw new Error('The app callback is not valid.');
  }
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', code);
  return callback.toString();
}

function buildMobileCancellationUrl(state: string, expectedOrigin: string) {
  const callback = new URL(CALLBACK_PATH, expectedOrigin);
  if (callback.protocol !== 'https:' || callback.origin !== expectedOrigin) throw new Error('The app callback is not valid.');
  callback.searchParams.set('state', state);
  callback.searchParams.set('error', 'access_denied');
  callback.searchParams.set('error_description', 'Owner approval was cancelled.');
  return callback.toString();
}

async function readApprovalResponse(response: Response) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new Error('This authorization request could not be completed. Confirm your approved Access account and try again.');
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await response.json() as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // The endpoint may be hidden behind an HTML Access error page. Do not surface
    // that page to the user or treat it as an approval response.
  }
  if (!response.ok) {
    throw new Error('This authorization request could not be completed. Confirm your approved Access account and try again.');
  }
  if (!body || body.approved !== true || !isCode(body.code) || typeof body.callbackUrl !== 'string' || !isExpiry(body.expiresAt)) {
    throw new Error('The authorization response was invalid. Try again from the Android app.');
  }
  return { code: body.code, callbackUrl: body.callbackUrl };
}

function initialError(requestId: string | null | undefined, state: string | null | undefined) {
  if (!requestId || !state) return 'This authorization link is incomplete. Start sign-in again from the Android app.';
  if (!isRequestId(requestId) || !isState(state)) return 'This authorization link is not valid. Start sign-in again from the Android app.';
  return null;
}

export default function MobileAuthorizationPage({
  requestId = null,
  state = null,
  fetchImpl = fetch,
  navigate = defaultNavigate,
  origin = currentOrigin(),
}: MobileAuthorizationPageProps) {
  const linkError = useMemo(() => initialError(requestId, state), [requestId, state]);
  const [status, setStatus] = useState<ApprovalStatus>(linkError ? 'error' : 'idle');
  const [error, setError] = useState<string | null>(linkError);
  const approvalStarted = useRef(false);

  const approve = async () => {
    if (approvalStarted.current || status === 'loading' || status === 'success' || linkError || !requestId || !state) return;
    approvalStarted.current = true;
    setStatus('loading');
    setError(null);
    try {
      const response = await fetchImpl(`/api/mobile-auth/requests/${encodeURIComponent(requestId)}/approval`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const result = await readApprovalResponse(response);
      const callbackUrl = buildMobileCallbackUrl(result.callbackUrl, state, result.code, origin);
      setStatus('success');
      navigate(callbackUrl);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'This authorization request could not be completed. Try again.');
    }
  };

  const cancel = () => {
    if (status === 'loading' || status === 'success' || !isState(state)) return;
    try {
      setStatus('success');
      navigate(buildMobileCancellationUrl(state, origin));
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'The app callback is not valid.');
    }
  };

  const retry = () => {
    if (!linkError) {
      approvalStarted.current = false;
      setError(null);
      setStatus('idle');
    }
  };

  const busy = status === 'loading';
  const complete = status === 'success';

  return (
    <main className="mobile-authorization-page">
      <div className="mobile-authorization-orbit mobile-authorization-orbit-one" aria-hidden="true" />
      <div className="mobile-authorization-orbit mobile-authorization-orbit-two" aria-hidden="true" />
      <div className="mobile-authorization-wrap">
        <header className="mobile-authorization-header">
          <a className="mobile-authorization-brand" href="/" aria-label="Border Ledger home">
            <span className="brand-mark" aria-hidden="true"><span>↗</span><span>↙</span></span>
            <span>
              <strong>Border Ledger</strong>
              <small>Private finance, clearly kept</small>
            </span>
          </a>
          <span className="mobile-authorization-header-note">SECURE MOBILE HANDOFF</span>
        </header>

        <section className="mobile-authorization-card" aria-labelledby="mobile-authorization-title">
          <div className="mobile-authorization-icon" aria-hidden="true"><ShieldCheck size={22} strokeWidth={1.8} /></div>
          <p className="eyebrow">Cloudflare Access approval</p>
          <h1 id="mobile-authorization-title">Continue to Border Ledger</h1>
          <p className="mobile-authorization-intro">
            Your Android app is waiting for this browser session. Approve the handoff to finish signing in; no bank credentials are entered here.
          </p>

          {status === 'loading' && (
            <div className="mobile-authorization-status" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" size={17} aria-hidden="true" />
              <span>Checking your Access approval…</span>
            </div>
          )}
          {complete && (
            <div className="mobile-authorization-status is-success" role="status" aria-live="polite">
              <ShieldCheck size={17} aria-hidden="true" />
              <span>Returning you to the app…</span>
            </div>
          )}
          {error && (
            <div className="mobile-authorization-error" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="mobile-authorization-actions">
            {!linkError && !complete && (
              <button className="primary-button mobile-authorization-primary" type="button" onClick={approve} disabled={busy} aria-busy={busy}>
                {busy ? 'Approving…' : 'Continue to app'}
                {!busy && <ArrowUpRight size={16} aria-hidden="true" />}
              </button>
            )}
            {error && !linkError && !complete && (
              <button className="outline-button mobile-authorization-retry" type="button" onClick={retry}>Try again</button>
            )}
            {!linkError && !complete && (
              <button className="text-button mobile-authorization-cancel" type="button" onClick={cancel} disabled={busy}>Cancel sign-in</button>
            )}
          </div>

          <p className="mobile-authorization-footnote">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>Only an approved Border Ledger Access identity can authorize this request.</span>
          </p>
        </section>

        <footer className="mobile-authorization-footer">
          <span>Border Ledger / Android sign-in</span>
          <span>Requests expire automatically</span>
        </footer>
      </div>
    </main>
  );
}
