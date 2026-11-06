import { useState, type FormEvent } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { WealthAccount } from '../../domain/wealth-types';
import type { InstrumentType } from '../../domain/wealth-types';
import { parseMoneyMinor } from './wealth-utils';
import { type FormProps, writeError } from './wealth-form-shared';

export interface WealthValuationInstrumentOption {
  accountId: string;
  accountName: string;
  exchange: string;
  ticker: string;
  type: InstrumentType;
  currency: string;
}

interface ValuationDraft {
  id: string;
  accountId: string;
  ticker: string;
  exchange: string;
  instrumentType: InstrumentType;
  currency: string;
  price: string;
  value: string;
  date: string;
  instrumentKey: string;
}

interface ValuationRequest extends ValuationDraft {
  valueMinor: number;
}

function valuationDateError(draft: ValuationDraft): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? null : 'Choose a valid observation date.';
}

function manualInstrumentError(draft: ValuationDraft): string | null {
  const hasInstrument = Boolean(draft.ticker.trim());
  return hasInstrument && !draft.exchange.trim() ? 'Enter an exchange for this security.' : null;
}

function valuationModeError(draft: ValuationDraft, account: WealthAccount): string | null {
  const hasInstrument = Boolean(draft.ticker.trim());
  if (account.mode === 'aggregate' && hasInstrument) return 'Aggregate accounts accept dated account values only. Choose no security.';
  return account.mode === 'holdings' && !hasInstrument ? 'Holdings accounts need a dated price for a selected security.' : null;
}

function valuationRequestError(draft: ValuationDraft, account: WealthAccount): string | null {
  return valuationDateError(draft) ?? manualInstrumentError(draft) ?? valuationModeError(draft, account);
}

function valuationRequest(draft: ValuationDraft, accounts: readonly WealthAccount[]): { request: ValuationRequest | null; error: string | null } {
  const account = accounts.find((item) => item.id === draft.accountId);
  if (!account) return { request: null, error: 'Choose an account and enter a valid dated value.' };
  const validationError = valuationRequestError(draft, account);
  if (validationError) return { request: null, error: validationError };
  const hasInstrument = Boolean(draft.ticker.trim());
  const amountText = hasInstrument ? draft.price : draft.value;
  const valueMinor = parseMoneyMinor(amountText, draft.currency);
  if (valueMinor === null) return { request: null, error: 'Enter a valid dated value.' };
  return { request: { ...draft, valueMinor }, error: null };
}

function valuationBody(request: ValuationRequest, revision: number): Record<string, unknown> {
  const isInstrument = Boolean(request.ticker.trim());
  return {
    id: request.id,
    accountId: request.accountId,
    instrument: isInstrument ? { currency: request.currency, type: request.instrumentType, exchange: request.exchange.trim().toUpperCase(), ticker: request.ticker.trim().toUpperCase() } : null,
    asOf: request.date,
    priceMinor: request.valueMinor,
    source: 'manual',
    provider: null,
    expectedRevision: revision,
  };
}

async function saveValuation(api: FormProps['api'], request: ValuationRequest, revision: number): Promise<void> {
  await api('/api/wealth/valuations', { method: 'PUT', body: JSON.stringify(valuationBody(request, revision)) });
}

function optionKey(option: WealthValuationInstrumentOption): string {
  return `${option.accountId}:${option.exchange}:${option.ticker}:${option.type}:${option.currency}`;
}

function optionsFromPositions(positions: readonly WealthValuationInstrumentOption[]): WealthValuationInstrumentOption[] {
  const unique = new Map<string, WealthValuationInstrumentOption>();
  for (const position of positions) unique.set(optionKey(position), position);
  return [...unique.values()];
}

function initialDraft(accounts: readonly WealthAccount[], instruments: readonly WealthValuationInstrumentOption[]): ValuationDraft {
  const first = instruments[0];
  return { id: crypto.randomUUID(), accountId: first?.accountId ?? accounts[0]?.id ?? '', ticker: first?.ticker ?? '', exchange: first?.exchange ?? 'TSX', instrumentType: first?.type ?? 'stock', currency: first?.currency ?? accounts[0]?.currency ?? 'CAD', price: '', value: '', date: new Date().toISOString().slice(0, 10), instrumentKey: first ? optionKey(first) : '' };
}

export function WealthValuationForm({ api, revision = 0, accounts, positions = [], onSaved, onCancel }: FormProps & { accounts: readonly WealthAccount[]; positions?: readonly WealthValuationInstrumentOption[] }) {
  const instruments = optionsFromPositions(positions);
  const [draft, setDraft] = useState<ValuationDraft>(() => initialDraft(accounts, instruments));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setField = <K extends keyof ValuationDraft>(field: K, value: ValuationDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));

  const selectInstrument = (key: string) => {
    const selected = instruments.find((option) => optionKey(option) === key);
    if (!selected) {
      setDraft((current) => ({ ...current, instrumentKey: '', ticker: '', exchange: 'TSX', instrumentType: 'stock', currency: accounts.find((account) => account.id === current.accountId)?.currency ?? current.currency }));
      return;
    }
    setDraft((current) => ({ ...current, instrumentKey: key, accountId: selected.accountId, ticker: selected.ticker, exchange: selected.exchange, instrumentType: selected.type, currency: selected.currency }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = valuationRequest(draft, accounts);
    if (result.error || !result.request) {
      setError(result.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveValuation(api, result.request, revision);
      await onSaved();
    } catch (cause) {
      setError(writeError(cause, 'The value could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return <form className="wealth-form" onSubmit={(event) => { void save(event); }} aria-labelledby="wealth-valuation-form-title">
    <div className="wealth-form-heading"><div><h3 id="wealth-valuation-form-title">Add dated value</h3><p>Manual prices and aggregate values stay tied to their observation date.</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close valuation form"><X size={16} /></button></div>
    {error ? <p className="wealth-form-error" role="alert"><CircleAlert size={15} />{error}</p> : null}
    <div className="wealth-form-grid">
      <label>Account<select value={draft.accountId} disabled={Boolean(draft.instrumentKey)} onChange={(event) => { const accountId = event.target.value; setDraft((current) => ({ ...current, accountId, instrumentKey: '', ticker: '', currency: accounts.find((account) => account.id === accountId)?.currency ?? current.currency })); }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.currency ? ` · ${account.currency}` : ''}</option>)}</select></label>
      <label>Observation date<input type="date" value={draft.date} onChange={(event) => setField('date', event.currentTarget.value)} onInput={(event) => setField('date', event.currentTarget.value)} /></label>
      <label className="wealth-form-wide">Existing holding/security<select value={draft.instrumentKey} onChange={(event) => selectInstrument(event.target.value)}><option value="">Manual instrument or account total</option>{instruments.map((instrument) => <option key={optionKey(instrument)} value={optionKey(instrument)}>{instrument.accountName} · {instrument.exchange}:{instrument.ticker} · {instrument.type.toUpperCase()} · {instrument.currency}</option>)}</select></label>
      <label>Instrument ticker (optional)<input value={draft.ticker} onChange={(event) => setField('ticker', event.target.value)} placeholder="SHOP" /></label>
      <label>Exchange<input list="wealth-supported-exchanges" value={draft.exchange} readOnly={Boolean(draft.instrumentKey)} onChange={(event) => setField('exchange', event.target.value)} placeholder="TSX or NYSE ARCA" /><datalist id="wealth-supported-exchanges"><option value="TSX" /><option value="TSXV" /><option value="NEO" /><option value="CSE" /><option value="NYSE" /><option value="NASDAQ" /><option value="AMEX" /><option value="ARCA" /><option value="NYSE ARCA" /><option value="BATS" /></datalist></label>
      <label>Security type<select value={draft.instrumentType} disabled={Boolean(draft.instrumentKey)} onChange={(event) => setField('instrumentType', event.target.value as InstrumentType)}><option value="stock">Stock</option><option value="etf">ETF</option></select></label>
      <label>Currency<select value={draft.currency} disabled={Boolean(draft.instrumentKey)} onChange={(event) => setField('currency', event.target.value)}><option>CAD</option><option>USD</option><option>CNY</option></select></label>
      <label>{draft.ticker.trim() ? 'Price' : 'Aggregate value'}<input inputMode="decimal" value={draft.ticker.trim() ? draft.price : draft.value} onChange={(event) => setField(draft.ticker.trim() ? 'price' : 'value', event.target.value)} placeholder="0.00" /></label>
    </div>
    <div className="wealth-form-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save dated value'}</button></div>
  </form>;
}
