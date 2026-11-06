import { useEffect, useState } from 'react';
import type { LedgerApi } from '../../domain/api';
import { formatWealthMoney, isRecord } from './wealth-utils';

export interface WealthLinkedAccountOption {
  id: string;
  name: string;
  currency?: string;
}

interface BankTransactionOption {
  id: string;
  date: string;
  merchant: string;
  accountName: string;
  currency: string;
  amountMinor: number;
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] as string : '';
}

function firstStringField(value: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const result = stringField(value, key);
    if (result) return result;
  }
  return '';
}

function numberField(value: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    if (typeof value[key] === 'number') return value[key] as number;
  }
  return null;
}

interface TransactionIdentity {
  id: string;
  date: string;
  merchant: string;
  accountName: string;
}

function transactionIdentity(value: Record<string, unknown>, linkedAccounts: readonly WealthLinkedAccountOption[]): TransactionIdentity | null {
  const id = stringField(value, 'id');
  const date = stringField(value, 'date');
  if (!id || !date) return null;
  const merchant = firstStringField(value, ['merchant', 'payee', 'description']) || 'Activity record';
  const accountId = firstStringField(value, ['accountId', 'account_id']);
  const accountName = firstStringField(value, ['accountName', 'account_name']) || linkedAccounts.find((account) => account.id === accountId)?.name || 'Activity account';
  return { id, date, merchant, accountName };
}

interface ConfirmedTransactionData {
  identity: TransactionIdentity;
  currency: string;
  amountMinor: number;
}

function confirmedTransactionData(value: Record<string, unknown>, linkedAccounts: readonly WealthLinkedAccountOption[]): ConfirmedTransactionData | null {
  const identity = transactionIdentity(value, linkedAccounts);
  const currency = stringField(value, 'currency').toUpperCase();
  const amountMinor = numberField(value, ['amountMinor', 'amount_minor']);
  if (!identity) return null;
  if (!currency) return null;
  if (amountMinor === null) return null;
  if (value.status !== 'confirmed') return null;
  return { identity, currency, amountMinor };
}

function confirmedTransactionOption(value: Record<string, unknown>, linkedAccounts: readonly WealthLinkedAccountOption[]): BankTransactionOption | null {
  const data = confirmedTransactionData(value, linkedAccounts);
  return data ? { ...data.identity, currency: data.currency, amountMinor: data.amountMinor } : null;
}

function transactionOption(value: unknown, linkedAccounts: readonly WealthLinkedAccountOption[]): BankTransactionOption | null {
  if (!isRecord(value)) return null;
  return confirmedTransactionOption(value, linkedAccounts);
}

function transactionOptions(value: unknown, linkedAccounts: readonly WealthLinkedAccountOption[]): BankTransactionOption[] {
  if (!isRecord(value) || !Array.isArray(value.transactions)) return [];
  return value.transactions.flatMap((entry) => { const option = transactionOption(entry, linkedAccounts); return option ? [option] : []; });
}

function optionLabel(option: BankTransactionOption): string {
  return `${option.date} · ${option.merchant} · ${option.accountName} · ${formatWealthMoney(option.amountMinor, option.currency)}`;
}

export function WealthBankLinkField({ api, linkedAccounts, value, onChange }: { api: LedgerApi; linkedAccounts: readonly WealthLinkedAccountOption[]; value: string; onChange(value: string): void }) {
  const [options, setOptions] = useState<BankTransactionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api('/api/transactions?currency=all')
      .then((response) => { if (!cancelled) setOptions(transactionOptions(response, linkedAccounts)); })
      .catch(() => { if (!cancelled) { setOptions([]); setError('Activity records could not be loaded.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, linkedAccounts]);

  return <label className="wealth-form-wide">Already recorded in Activity?
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={loading}>
      <option value="">No linked Activity record</option>
      {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
    </select>
    <small>{error ?? (loading ? 'Loading confirmed Activity records…' : 'Choose a confirmed record only when this event is the same money movement.')}</small>
  </label>;
}
