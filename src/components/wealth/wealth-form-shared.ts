import type { LedgerApi } from '../../domain/api';
import type { WealthAccount } from '../../domain/wealth-types';
import type { WealthAccountMutationRequest } from '../../domain/wealth-api-types';
import { parseMoneyMinor } from './wealth-utils';

export interface FormProps {
  api: LedgerApi;
  revision?: number;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}

export interface LinkedAccountOption {
  id: string;
  name: string;
  currency?: string;
}

export function fieldError(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required.`;
}

export function writeError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : '';
  return /revision|changed|conflict|409/i.test(message)
    ? 'This wealth data changed while the form was open. Your entries are still here; refresh the ledger and try saving again.'
    : message || fallback;
}

export function accountIdForName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96) || 'account';
  const suffix = crypto.randomUUID();
  const prefix = slug.slice(0, Math.max(1, 128 - suffix.length - 1)).replace(/-+$/g, '') || 'account';
  return `${prefix}-${suffix}`;
}

interface AggregateValuationInput {
  api: LedgerApi;
  accountId: string;
  date: string;
  amountMinor: number;
  revision: number;
}

export async function appendAggregateValuation({ api, accountId, date, amountMinor, revision }: AggregateValuationInput): Promise<void> {
  await api('/api/wealth/valuations', {
    method: 'PUT',
    body: JSON.stringify({ id: `${accountId}:${date}`, accountId, instrument: null, asOf: date, priceMinor: amountMinor, source: 'manual', provider: null, expectedRevision: revision }),
  });
}

export function accountFormError(name: string, kind: WealthAccount['kind'], mode: WealthAccount['mode'], linkedBankAccountId: string, amount: number | null): string | null {
  return fieldError(name, 'Account name')
    ?? (kind === 'linked_bank' && !linkedBankAccountId ? 'Choose an existing bank account.' : null)
    ?? (mode === 'aggregate' && kind !== 'linked_bank' && amount === null ? 'Enter a valid aggregate value.' : null);
}

export function accountRequest(input: WealthAccountMutationRequest): WealthAccountMutationRequest {
  const { kind, mode, amountMinor } = input;
  return {
    ...input,
    name: input.name.trim(),
    amountMinor: mode === 'aggregate' && amountMinor !== null ? amountMinor : undefined,
    linkedBankAccountId: kind === 'linked_bank' ? input.linkedBankAccountId : undefined,
    modeTransition: input.modeTransition ?? undefined,
    asOf: mode === 'aggregate' && amountMinor !== null ? input.asOf : undefined,
  };
}

export function parseAmount(value: string, currency: string): number | null {
  return parseMoneyMinor(value, currency);
}
