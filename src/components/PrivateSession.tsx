import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ledgerSession, type LedgerApi } from '../domain/api';

const ApiContext = createContext<LedgerApi | null>(null);
export function useLedgerApi(): LedgerApi {
  const context = useContext(ApiContext);
  // Standalone component tests/embeds still get an immutable binding, never a mutable global client.
  return useMemo(() => context ?? ledgerSession.bind(), [context]);
}
export function PrivateSession({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(ledgerSession.subscribe, ledgerSession.snapshot);
  const api = useMemo(() => ledgerSession.bind(), [session.epoch]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState !== 'hidden') void ledgerSession.bootstrap(); };
    void ledgerSession.bootstrap();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      ledgerSession.invalidate();
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, []);
  if (!session.identity) return <main role="status"><p>{session.error ? 'Could not load your private ledger' : 'Loading your private ledger'}</p>{session.error && <><p>{session.error}</p><button type="button" onClick={() => { void ledgerSession.bootstrap(); }}>Retry loading data</button></>}</main>;
  return <>
    {session.checking && <p role="status">Verifying your private session…</p>}
    <div hidden={session.checking} inert={session.checking} aria-hidden={session.checking}>
      <ApiContext.Provider key={session.epoch} value={api}>{children}</ApiContext.Provider>
    </div>
  </>;
}
