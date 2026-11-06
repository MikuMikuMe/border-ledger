import { useState } from 'react';
import type { LedgerApi } from '../../domain/api';
import { formatWealthMoney, isRecord, type WealthCashFlowView } from './wealth-utils';

interface TransactionDetails {
  merchant: string;
  category: string;
  source: string;
  status: string;
  note: string | null;
  amountMinor: number;
  currency: string;
}

interface WealthEventDetails {
  kind: string;
  date: string;
  amountMinor: number;
  currency: string;
  reason: string;
}

function requiredTransactionText(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key] ? value[key] as string : null;
}

function transactionAmount(value: Record<string, unknown>): number | null {
  const amount = value.amountMinor ?? value.amount_minor;
  return typeof amount === 'number' ? amount : null;
}

interface RequiredTransactionFields {
  merchant: string;
  category: string;
  source: string;
  status: string;
  currency: string;
}

function requiredTransactionFields(value: Record<string, unknown>): RequiredTransactionFields | null {
  const merchant = requiredTransactionText(value, 'merchant');
  const category = requiredTransactionText(value, 'category');
  const source = requiredTransactionText(value, 'source');
  const status = requiredTransactionText(value, 'status');
  const currency = requiredTransactionText(value, 'currency');
  if (!merchant) return null;
  if (!category) return null;
  if (!source) return null;
  if (!status) return null;
  if (!currency) return null;
  return { merchant, category, source, status, currency };
}

function readTransaction(value: unknown): TransactionDetails | null {
  if (!isRecord(value)) return null;
  const required = requiredTransactionFields(value);
  const amountMinor = transactionAmount(value);
  if (!required || amountMinor === null) return null;
  return { ...required, note: typeof value.note === 'string' ? value.note : null, amountMinor };
}

function transactionDetails(value: unknown, transactionId: string): TransactionDetails | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.transactions)) return null;
  const entry = value.transactions.find((candidate) => isRecord(candidate) && candidate.id === transactionId);
  return readTransaction(entry);
}

async function loadTransaction(api: LedgerApi, row: WealthCashFlowView): Promise<TransactionDetails | null> {
  if (!row.transactionId) return null;
  const query = `from=${encodeURIComponent(row.date)}&to=${encodeURIComponent(row.date)}&currency=${encodeURIComponent(row.money.currency)}`;
  return transactionDetails(await api(`/api/transactions?${query}`), row.transactionId);
}

function eventKind(row: WealthCashFlowView): string | null {
  if (row.eventKind) return row.eventKind;
  return row.kind === 'contribution' || row.kind === 'withdrawal' ? row.kind : null;
}

function wealthEventDetails(row: WealthCashFlowView): WealthEventDetails | null {
  const kind = eventKind(row);
  return kind ? { kind, date: row.date, amountMinor: row.money.amountMinor, currency: row.money.currency, reason: row.reason } : null;
}

export function WealthCashFlowDetails({ api, row }: { api: LedgerApi; row: WealthCashFlowView }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [eventDetails, setEventDetails] = useState<WealthEventDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const investmentEvent = wealthEventDetails(row);

  const showDetails = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const next = await loadTransaction(api, row);
      setDetails(next);
      if (!next) setError('The original bank record is no longer available.');
    } catch {
      setError('The original bank record could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const showEventDetails = () => {
    setOpen(true);
    setError(null);
    setEventDetails(investmentEvent);
  };

  return <div className="wealth-record-details">
    {row.transactionId ? <button type="button" className="wealth-record-link" onClick={() => { void showDetails(); }} aria-expanded={open}>View Activity record</button> : investmentEvent ? <button type="button" className="wealth-record-link" onClick={showEventDetails} aria-expanded={open}>View wealth event</button> : <span className="wealth-record-unavailable">Record unavailable</span>}
    {open ? <div className="wealth-record-popover" role="region" aria-label={`Record details for ${row.date}`}>
      {loading ? <span>Loading record…</span> : details ? <><strong>{details.merchant}</strong><small>{details.category} · {details.source} · {details.status}</small><span>{formatWealthMoney(details.amountMinor, details.currency)}</span>{details.note ? <small>{details.note}</small> : null}</> : eventDetails ? <><strong>{eventDetails.kind.replaceAll('_', ' ')}</strong><small>{eventDetails.date} · Wealth ledger event</small><span>{formatWealthMoney(eventDetails.amountMinor, eventDetails.currency)} {eventDetails.currency}</span><small>{eventDetails.reason}</small></> : <span>{error}</span>}
      <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close record details">×</button>
    </div> : null}
  </div>;
}
