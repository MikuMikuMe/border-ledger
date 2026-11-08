import { parseMoneyMinor } from '../src/domain/currencies';

const kinds = new Set(['expense', 'income', 'transfer', 'refund', 'fee']);
const positiveKinds = new Set(['income', 'refund']);
const requestIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new RangeError(`Invalid ${name}.`);
  return value;
}

function text(input: unknown, name: string, max: number): string {
  const value = requireString(input, name);
  if (!value.trim()) throw new RangeError(`Invalid ${name}.`);
  if (value.length > max || /[\u0000-\u001f]/.test(value)) throw new RangeError(`Invalid ${name}.`);
  return value.trim();
}

function record(value: unknown) {
  if (value === null || typeof value !== 'object') throw new RangeError('Invalid transaction.');
  if (Array.isArray(value)) throw new RangeError('Invalid transaction.');
  return value as Record<string, unknown>;
}

function optionalNote(value: unknown) {
  return value === null || value === undefined || value === '' ? null : text(value, 'note', 1000);
}

function calendarDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.valueOf())) throw new RangeError('Invalid date.');
  if (parsedDate.toISOString().slice(0, 10) !== date) throw new RangeError('Invalid date.');
}

function validDate(value: unknown) {
  const date = text(value, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Invalid date.');
  calendarDate(date);
  return date;
}

function signedAmount(kind: string, amount: number, direction: unknown) {
  if (kind !== 'transfer') return positiveKinds.has(kind) ? amount : -amount;
  if (![undefined, 'in', 'out'].includes(direction as string | undefined)) throw new RangeError('Invalid transfer direction.');
  return direction === 'in' ? amount : -amount;
}

function transactionKind(value: unknown) {
  const kind = text(value, 'type', 16);
  if (!kinds.has(kind)) throw new RangeError('Invalid transaction type.');
  return kind;
}

function moneyInput(body: Record<string, unknown>) {
  const currency = text(body.currency, 'currency', 3);
  const kind = transactionKind(body.kind);
  const amount = parseMoneyMinor(text(body.amount, 'amount', 32), currency);
  if (amount <= 0) throw new RangeError('Amount must be greater than zero.');
  const amountMinor = signedAmount(kind, amount, body.direction);
  return { currency, kind, amountMinor };
}

function validRequestId(value: unknown) {
  const requestId = text(value, 'request ID', 128);
  if (!requestIdPattern.test(requestId)) throw new RangeError('Invalid request ID.');
  return requestId;
}

export function validateInput(value: unknown) {
  const body = record(value);
  const requestId = validRequestId(body.requestId);
  const accountId = text(body.accountId, 'account', 128);
  const date = validDate(body.date);
  const merchant = text(body.merchant, 'description', 160);
  const category = text(body.category, 'category', 80);
  const note = optionalNote(body.note);
  return { requestId, accountId, date, merchant, category, ...moneyInput(body), note };
}

export function manualMatchOffset(params: URLSearchParams) {
  const value=params.get('offset');
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) throw new RangeError('Invalid match offset.');
  if (!Number.isSafeInteger(Number(value)) || Number(value)>1_000_000) throw new RangeError('Invalid match offset.');
  return Number(value);
}

function matchDecision(decision: unknown) {
  if (decision !== 'confirmed' && decision !== 'dismissed') throw new RangeError('Invalid match decision.');
  return decision;
}

function matchRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError('Invalid match revision.');
  return value as number;
}

export function matchInput(value: unknown) {
  const body = record(value);
  const manualId = text(body.manualId, 'manual transaction', 128);
  const bankId = text(body.bankId, 'bank transaction', 128);
  const decision = matchDecision(body.decision);
  const revision = matchRevision(body.expectedRevision);
  return {manualId,bankId,decision,revision};
}
