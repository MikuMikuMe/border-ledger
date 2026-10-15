import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleCheck, Clock3, RefreshCw, X } from 'lucide-react';
import { formatDate, formatMoney } from '../domain/format';
import type { CurrencyCode } from '../domain/currencies';
import { ledgerApi, LedgerApiError } from '../domain/api';
import type { RecurringClassification, RecurringDetailPage } from '../domain/recurring';

interface RecurringDetailsProps {
  streamId: string;
  onClose: () => void;
  onSaved: () => void;
}

const classifications: Array<{ value: RecurringClassification; label: string }> = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'bill', label: 'Bill' },
  { value: 'other', label: 'Other' },
  { value: 'excluded', label: 'Exclude from totals' },
];

function displayAmount(amountMinor: number, currency: CurrencyCode) {
  return formatMoney(Math.abs(amountMinor), currency, { signDisplay: 'never' });
}

function detailError(error: unknown) {
  if (error instanceof LedgerApiError && error.status === 404) return 'This recurring stream is no longer in the latest source snapshot.';
  if (error instanceof Error) return error.message;
  return 'The recurring detail could not be loaded.';
}

export function RecurringDetails({ streamId, onClose, onSaved }: RecurringDetailsProps) {
  const [detail, setDetail] = useState<RecurringDetailPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    void ledgerApi<RecurringDetailPage>(`/api/recurring/${encodeURIComponent(streamId)}`)
      .then((value) => {
        if (cancelled) return;
        setDetail(value);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(detailError(reason));
      });
    return () => { cancelled = true; };
  }, [streamId]);

  const saveClassification = async (classification: RecurringClassification) => {
    setSaving(true);
    setSaveError(null);
    try {
      await ledgerApi(`/api/recurring/${encodeURIComponent(streamId)}/classification`, {
        method: 'PATCH',
        body: JSON.stringify({ classification }),
      });
      setDetail((current) => current ? { ...current, classification, stream: { ...current.stream, classification } } : current);
      onSaved();
    } catch (reason) {
      setSaveError(detailError(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="panel recurring-details-panel" aria-label="Recurring payment details">
      <div className="section-heading">
        <div><p className="eyebrow">STREAM DETAIL</p><h2>{detail?.stream.merchantName ?? 'Recurring payment'}</h2></div>
        <button type="button" className="icon-button" aria-label="Close recurring details" onClick={onClose}><X size={17} /></button>
      </div>
      {status === 'loading' ? <div className="recurring-detail-state" role="status"><RefreshCw size={17} className="is-spinning" /><span>Reading payment history…</span></div> : null}
      {status === 'error' ? <div className="recurring-detail-state is-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div> : null}
      {status === 'ready' && detail ? (
        <>
          <div className="recurring-detail-summary">
            <div><span>Typical amount</span><strong>{displayAmount(detail.stream.lastAmountMinor ?? detail.stream.averageAmountMinor ?? 0, detail.stream.currency)}</strong></div>
            <div><span>Frequency</span><strong>{detail.stream.frequency === 'UNKNOWN' ? detail.stream.sourceFrequency : detail.stream.frequency.replace('_', ' ')}</strong></div>
            <div><span>Next expected</span><strong>{detail.stream.predictedNextDate ? formatDate(detail.stream.predictedNextDate) : 'Not predicted'}</strong></div>
          </div>
          <div className="recurring-detail-controls">
            <label><span>Classification</span><select aria-label={`Classification for ${detail.stream.merchantName ?? 'recurring payment'}`} value={detail.classification} disabled={saving} onChange={(event) => void saveClassification(event.target.value as RecurringClassification)}>{classifications.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <span className={`recurring-source-status ${detail.stream.sourceStatus.toLowerCase()}`}><CircleCheck size={13} /> {detail.stream.sourceStatus.replace('_', ' ')}</span>
          </div>
          {saveError ? <p className="recurring-inline-error" role="alert">{saveError}</p> : null}
          <div className="recurring-history-heading"><div><p className="eyebrow">POSTED MEMBERS</p><h3>Payment history</h3></div><span>{detail.history.length} shown</span></div>
          {detail.history.length > 0 ? <div className="recurring-history-list">{detail.history.map((payment) => <div className="recurring-history-row" key={`${payment.providerTransactionId}-${payment.date}`}><span className={`recurring-history-icon ${payment.status === 'pending' ? 'is-pending' : ''}`}>{payment.status === 'pending' ? <Clock3 size={13} /> : payment.amountMinor < 0 ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}</span><span><strong>{formatDate(payment.date)}</strong><small>{payment.status === 'pending' ? 'Pending source member' : 'Posted source member'}</small></span><b className={payment.amountMinor > 0 ? 'is-credit' : undefined}>{displayAmount(payment.amountMinor, payment.currency)}</b></div>)}</div> : <div className="recurring-empty-history"><Clock3 size={17} /><strong>No linked posted members yet.</strong><span>The provider has identified the stream, but the ledger has not linked a confirmed payment.</span></div>}
          <p className="recurring-detail-note"><ArrowDownLeft size={14} /> Estimates come from the provider stream. Only linked, confirmed ledger members affect actual posted cost.</p>
        </>
      ) : null}
    </aside>
  );
}

export default RecurringDetails;
