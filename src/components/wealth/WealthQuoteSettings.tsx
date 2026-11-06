import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { CanonicalInstrument } from '../../domain/wealth-types';
import { isRecord } from './wealth-utils';
import { writeError } from './wealth-form-shared';

export interface WealthQuoteInstrumentOption {
  accountId: string;
  accountName: string;
  instrument: CanonicalInstrument;
}

function quoteInstrumentKey(option: WealthQuoteInstrumentOption): string {
  const { instrument } = option;
  return `${option.accountId}:${instrument.exchange}:${instrument.ticker}:${instrument.type}:${instrument.currency}`;
}

function quoteInstrumentLabel(option: WealthQuoteInstrumentOption): string {
  const { instrument } = option;
  return `${option.accountName} · ${instrument.exchange}:${instrument.ticker} · ${instrument.type.toUpperCase()} · ${instrument.currency}`;
}

function quoteConfigured(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.configured === true) return true;
  return Array.isArray(value.providers) && value.providers.some((provider) => isRecord(provider) && provider.provider === 'alpha_vantage');
}

async function saveQuoteCredential(api: LedgerApi, secret: string): Promise<void> {
  await api('/api/wealth/quotes/settings', { method: 'PUT', body: JSON.stringify({ provider: 'alpha_vantage', credential: secret }) });
}

async function removeQuoteCredential(api: LedgerApi): Promise<void> {
  await api('/api/wealth/quotes/settings?provider=alpha_vantage', { method: 'DELETE' });
}

interface QuoteRefreshResponse {
  status?: string;
  reason?: string;
}

async function refreshQuote(api: LedgerApi, selected: WealthQuoteInstrumentOption): Promise<QuoteRefreshResponse> {
  return await api('/api/wealth/quotes/refresh', {
    method: 'POST',
    body: JSON.stringify({ accountId: selected.accountId, instrument: selected.instrument }),
  }) as QuoteRefreshResponse;
}

export function WealthQuoteSettings({ api, instruments = [], onNotice, onRefresh }: { api: LedgerApi; instruments?: readonly WealthQuoteInstrumentOption[]; onNotice(message: string): void; onRefresh?: () => Promise<void> }) {
  const [secret, setSecret] = useState('');
  const [configured, setConfigured] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('No quote refresh requested yet.');
  const selected = instruments.find((option) => quoteInstrumentKey(option) === selectedKey) ?? instruments[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    void api('/api/wealth/quotes/settings')
      .then((value) => { if (!cancelled) setConfigured(quoteConfigured(value)); })
      .catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, [api]);

  const saveSecret = async () => {
    const credential = secret.trim();
    if (!credential) {
      onNotice('Enter a provider credential before saving.');
      return;
    }
    setBusy(true);
    try {
      await saveQuoteCredential(api, credential);
      setSecret('');
      setConfigured(true);
      onNotice('Quote credential saved without echoing it.');
    } catch (cause) {
      onNotice(writeError(cause, 'The quote service could not save this credential.'));
    } finally {
      setBusy(false);
    }
  };

  const removeSecret = async () => {
    setBusy(true);
    try {
      await removeQuoteCredential(api);
      setConfigured(false);
      onNotice('Saved quote credential removed.');
    } catch (cause) {
      onNotice(writeError(cause, 'The quote credential could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  const refreshSelectedQuote = async () => {
    if (!selected) {
      onNotice('Add a brokerage holding before requesting a quote refresh.');
      return;
    }
    setBusy(true);
    try {
      const result = await refreshQuote(api, selected);
      await onRefresh?.();
      const status = result.status?.replaceAll('_', ' ') || 'requested';
      setRefreshStatus(result.reason ? `${status}: ${result.reason}` : `Refresh ${status}.`);
      onNotice(result.reason ? `Quote refresh ${status}: ${result.reason}` : `Quote refresh ${status}; dated coverage will remain visible.`);
    } catch (cause) {
      const message = writeError(cause, 'The quote service could not refresh this instrument.');
      setRefreshStatus(`Refresh failed: ${message}`);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="wealth-quote-panel" aria-labelledby="wealth-quotes-title">
    <div className="wealth-section-heading"><div><h3 id="wealth-quotes-title">Optional price refresh</h3><p>Alpha Vantage is optional. The credential is saved per ledger and is never displayed back here.</p></div><KeyRound size={18} aria-hidden="true" /></div>
    <div className="wealth-quote-form">
      <label>Provider credential<input name="quote-secret" type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Enter only when changing it" /></label>
      <label>Instrument to refresh<select value={selected ? quoteInstrumentKey(selected) : ''} onChange={(event) => setSelectedKey(event.target.value)} disabled={!instruments.length}><option value="">{instruments.length ? 'Choose a holding' : 'No brokerage holdings yet'}</option>{instruments.map((option) => <option key={quoteInstrumentKey(option)} value={quoteInstrumentKey(option)}>{quoteInstrumentLabel(option)}</option>)}</select></label>
      <div className="wealth-quote-status" role="status">{configured ? 'Credential configured' : 'No quote credential configured'} · manual dated prices remain available. <span>{refreshStatus}</span></div>
      <div className="wealth-form-actions"><button type="button" className="quiet-button" onClick={() => { void removeSecret(); }} disabled={busy || !configured}>Remove credential</button><button type="button" className="outline-button" onClick={() => { void refreshSelectedQuote(); }} disabled={busy || !selected}><RefreshCw size={15} /> Refresh dated quote</button><button type="button" className="primary-button" onClick={() => { void saveSecret(); }} disabled={busy}><ShieldCheck size={15} /> Save credential</button></div>
    </div>
  </section>;
}
