import type { WealthAccount, WealthEvent } from '../../domain/wealth-types';
import { isRecord, parseMoneyMinor } from './wealth-utils';

export type OrdinaryEventKind = Exclude<WealthEvent['kind'], 'correction' | 'reversal'>;
export type EventKind = Exclude<WealthEvent['kind'], 'correction'> | 'correction';
export type CorrectionReplacementKind = OrdinaryEventKind;
type EventPayloadKind = Exclude<EventKind, 'correction'>;

export const eventKinds: EventKind[] = ['opening_position', 'opening_cash', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split', 'transfer', 'reversal', 'correction'];
export const correctionReplacementKinds: CorrectionReplacementKind[] = ['opening_position', 'opening_cash', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split', 'transfer'];
export const instrumentFieldKinds: EventPayloadKind[] = ['opening_position', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'split'];
export const instrumentRequiredKinds: EventPayloadKind[] = ['opening_position', 'buy', 'sell', 'split'];
export const moneyKinds: EventPayloadKind[] = ['opening_cash', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'buy', 'sell'];

export interface EventDraft {
  id: string;
  sourceId: string;
  kind: EventKind;
  replacementKind?: CorrectionReplacementKind;
  replacementDate?: string;
  accountId: string;
  date: string;
  ticker: string;
  exchange: string;
  instrumentType: 'stock' | 'etf';
  currency: string;
  quantity: string;
  amount: string;
  fee: string;
  memo: string;
  targetSourceId: string;
  linkedBankSourceId: string;
  transferKind: 'cash' | 'position';
  toAccountId: string;
  basisKnown: boolean;
}

export interface ReversibleEventOption {
  sourceId: string;
  label: string;
  event: Record<string, unknown>;
}

export function ordinaryKind(draft: EventDraft): EventPayloadKind {
  return draft.kind === 'correction' ? draft.replacementKind ?? 'buy' : draft.kind;
}

export function instrumentRequired(draft: EventDraft): boolean {
  const kind = ordinaryKind(draft);
  return instrumentRequiredKinds.includes(kind) || (kind === 'transfer' && draft.transferKind === 'position');
}

export function instrumentFieldsVisible(draft: EventDraft): boolean {
  const kind = ordinaryKind(draft);
  return instrumentFieldKinds.includes(kind) || (kind === 'transfer' && draft.transferKind === 'position');
}

export function amountRequired(draft: EventDraft): boolean {
  const kind = ordinaryKind(draft);
  return moneyKinds.includes(kind) || (kind === 'transfer' && draft.transferKind === 'cash') || (kind === 'opening_position' && draft.basisKnown);
}

function validDecimal(value: string): boolean {
  const normalized = value.trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized)) && Number(normalized) > 0;
}

function validPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validateTransferDestination(draft: EventDraft): string | null {
  if (ordinaryKind(draft) !== 'transfer') return null;
  if (!draft.toAccountId || draft.toAccountId === draft.accountId) return 'Choose a different destination account.';
  return null;
}

function validateAccountChoice(draft: EventDraft): string | null {
  return draft.accountId ? validateTransferDestination(draft) : 'Choose an account.';
}

const holdingsEventKinds: readonly EventPayloadKind[] = ['opening_position', 'buy', 'sell', 'dividend', 'withholding', 'fee', 'contribution', 'withdrawal', 'split'];

function holdingsModeError(draft: EventDraft, account: WealthAccount): string | null {
  return holdingsEventKinds.includes(ordinaryKind(draft)) && account.mode !== 'holdings' ? 'This event needs a holdings account. Edit the account representation first.' : null;
}

function transferModeError(draft: EventDraft, account: WealthAccount, accounts: readonly WealthAccount[]): string | null {
  if (ordinaryKind(draft) !== 'transfer') return null;
  const destination = accounts.find((item) => item.id === draft.toAccountId);
  if (!destination) return 'Choose a destination account.';
  if (destination.mode !== account.mode) return 'Transfers must stay within the same account representation.';
  return draft.transferKind === 'position' && account.mode !== 'holdings' ? 'Position transfers need holdings accounts.' : null;
}

export function eventModeError(draft: EventDraft, accounts: readonly WealthAccount[]): string | null {
  const account = accounts.find((item) => item.id === draft.accountId);
  if (!account) return 'Choose an account.';
  return holdingsModeError(draft, account) ?? transferModeError(draft, account, accounts);
}

function validateEventReference(draft: EventDraft): string | null {
  if (draft.kind === 'reversal' && !draft.targetSourceId.trim()) return 'Choose the original record to reverse.';
  return draft.kind === 'correction' && !draft.targetSourceId.trim() ? 'Choose the original record to correct.' : null;
}

function validateEventValue(draft: EventDraft, amountMinor: number | null): string | null {
  if (amountRequired(draft) && amountMinor === null) return 'Enter a valid amount.';
  if (instrumentRequired(draft) && !draft.ticker.trim()) return 'Ticker is required for this event.';
  return null;
}

function validateEventQuantities(draft: EventDraft): string | null {
  const kind = ordinaryKind(draft);
  const quantityRequired = ['opening_position', 'buy', 'sell'].includes(kind) || (kind === 'transfer' && draft.transferKind === 'position');
  if (quantityRequired && !validDecimal(draft.quantity)) return 'Enter a positive quantity.';
  const splitValuesValid = validPositiveInteger(draft.quantity) && validPositiveInteger(draft.amount);
  if (kind === 'split' && !splitValuesValid) return 'Enter positive whole-number split values.';
  return null;
}

function validateEventFee(draft: EventDraft): string | null {
  const kind = ordinaryKind(draft);
  const hasInvalidFee = (kind === 'buy' || kind === 'sell') && draft.fee.trim() && parseMoneyMinor(draft.fee, draft.currency) === null;
  return hasInvalidFee ? 'Enter a valid fee.' : null;
}

function validateEventDate(draft: EventDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return 'Choose a valid event date.';
  if (draft.kind === 'correction' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.replacementDate ?? '')) return 'Choose a valid replacement date.';
  if (draft.kind === 'correction' && (draft.replacementDate ?? '') > draft.date) return 'Replacement date cannot be after the correction date.';
  return null;
}

function validateEventDraft(draft: EventDraft, amountMinor: number | null): string | null {
  return validateEventDate(draft) ?? validateAccountChoice(draft) ?? validateEventReference(draft) ?? validateEventValue(draft, amountMinor) ?? validateEventQuantities(draft) ?? validateEventFee(draft);
}

function eventBase(draft: EventDraft, revision: number): Record<string, unknown> {
  return {
    id: draft.id,
    sourceId: draft.sourceId,
    date: draft.date,
    ...(draft.kind === 'transfer' || draft.kind === 'reversal' || draft.kind === 'correction' ? {} : { accountId: draft.accountId }),
    ...(draft.kind !== 'reversal' && draft.kind !== 'correction' && draft.linkedBankSourceId.trim() ? { linkedBankSourceId: draft.linkedBankSourceId.trim() } : {}),
    memo: draft.memo.trim() || undefined,
    kind: draft.kind,
    expectedRevision: revision,
  };
}

function addInstrument(body: Record<string, unknown>, draft: EventDraft): void {
  if (!draft.ticker.trim()) return;
  body.instrument = { exchange: draft.exchange.trim().toUpperCase(), ticker: draft.ticker.trim().toUpperCase(), type: draft.instrumentType, currency: draft.currency };
}

function addTrade(body: Record<string, unknown>, draft: EventDraft, amountMinor: number): void {
  body.quantity = draft.quantity.trim();
  body[ordinaryKind(draft) === 'sell' ? 'proceeds' : 'consideration'] = { currency: draft.currency, amountMinor };
  const feeMinor = draft.fee.trim() ? parseMoneyMinor(draft.fee, draft.currency) : null;
  if (feeMinor !== null) body.fee = { currency: draft.currency, amountMinor: feeMinor };
}

function addOpeningPosition(body: Record<string, unknown>, draft: EventDraft, amount: number): void {
  body.quantity = draft.quantity.trim();
  body.basis = draft.basisKnown ? { currency: draft.currency, amountMinor: amount } : null;
}

function addMoneyEvent(body: Record<string, unknown>, draft: EventDraft, amount: number): void {
  body.money = { currency: draft.currency, amountMinor: amount };
}

function addTransfer(body: Record<string, unknown>, draft: EventDraft, amount: number): void {
  body.transferKind = draft.transferKind;
  body.fromAccountId = draft.accountId;
  body.toAccountId = draft.toAccountId;
  if (draft.transferKind === 'cash') addMoneyEvent(body, draft, amount);
  else body.quantity = draft.quantity.trim();
}

function addEventPayload(body: Record<string, unknown>, draft: EventDraft, amountMinor: number | null): void {
  if (draft.kind === 'correction') return addCorrectionPayload(body, draft, amountMinor);
  addOrdinaryEventPayload(body, draft, amountMinor);
}

function addOrdinaryEventPayload(body: Record<string, unknown>, draft: EventDraft, amountMinor: number | null): void {
  const amount = amountMinor ?? 0;
  const kind = ordinaryKind(draft);
  if (kind === 'opening_position') return addOpeningPosition(body, draft, amount);
  if (kind === 'buy' || kind === 'sell') return addTrade(body, draft, amount);
  if (moneyKinds.includes(kind)) return addMoneyEvent(body, draft, amount);
  if (kind === 'split') {
    body.numerator = Number(draft.quantity);
    body.denominator = Number(draft.amount);
    return;
  }
  if (kind === 'transfer') return addTransfer(body, draft, amount);
  body.targetSourceId = draft.targetSourceId.trim();
}

function correctionReplacement(draft: EventDraft): Record<string, unknown> {
  const kind = draft.replacementKind ?? 'buy';
  const replacement: Record<string, unknown> = {
    date: draft.replacementDate ?? draft.date,
    kind,
    ...(kind === 'transfer' ? {} : { accountId: draft.accountId }),
    ...(draft.linkedBankSourceId.trim() ? { linkedBankSourceId: draft.linkedBankSourceId.trim() } : {}),
    memo: draft.memo.trim() || undefined,
  };
  addInstrument(replacement, { ...draft, kind });
  addOrdinaryEventPayload(replacement, { ...draft, kind }, parseMoneyMinor(draft.amount, draft.currency));
  return replacement;
}

function addCorrectionPayload(body: Record<string, unknown>, draft: EventDraft, amountMinor: number | null): void {
  void amountMinor;
  body.targetSourceId = draft.targetSourceId.trim();
  body.replacement = correctionReplacement(draft);
}

export function buildEventBody(draft: EventDraft, revision: number): { body: Record<string, unknown> | null; error: string | null } {
  const amountMinor = parseMoneyMinor(draft.amount, draft.currency);
  const error = validateEventDraft(draft, amountMinor);
  if (error) return { body: null, error };
  const body = eventBase(draft, revision);
  if (draft.kind !== 'correction') addInstrument(body, draft);
  addEventPayload(body, draft, amountMinor);
  return { body, error: null };
}

function stringProperty(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null;
}

function isReversibleEvent(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const sourceId = stringProperty(value, 'sourceId');
  const date = stringProperty(value, 'date');
  const kind = stringProperty(value, 'kind');
  return Boolean(sourceId && date && kind && kind !== 'reversal' && kind !== 'correction');
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] as string : '';
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null;
}

function minorInput(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '';
  return (value / 100).toFixed(2);
}

function moneyInput(value: Record<string, unknown>, keys: readonly string[]): { amount: string; currency: string } {
  for (const key of keys) {
    const money = recordField(value, key);
    if (!money) continue;
    const amount = minorInput(money.amountMinor ?? money.amount_minor);
    const currency = stringField(money, 'currency').toUpperCase();
    if (amount && currency) return { amount, currency };
  }
  return { amount: '', currency: '' };
}

function replacementKind(value: unknown): CorrectionReplacementKind | null {
  return typeof value === 'string' && correctionReplacementKinds.includes(value as CorrectionReplacementKind) ? value as CorrectionReplacementKind : null;
}

function correctionInstrumentFields(event: Record<string, unknown>, draft: EventDraft, money: { amount: string; currency: string }): Pick<EventDraft, 'ticker' | 'exchange' | 'instrumentType' | 'currency'> {
  const instrument = recordField(event, 'instrument');
  if (!instrument) return { ticker: '', exchange: draft.exchange, instrumentType: 'stock', currency: money.currency || draft.currency };
  return {
    ticker: stringField(instrument, 'ticker'),
    exchange: stringField(instrument, 'exchange') || draft.exchange,
    instrumentType: instrument.type === 'etf' ? 'etf' : 'stock',
    currency: stringField(instrument, 'currency').toUpperCase() || money.currency || draft.currency,
  };
}

function targetAccountId(event: Record<string, unknown>, draft: EventDraft): string {
  return stringField(event, 'accountId') || stringField(event, 'fromAccountId') || draft.accountId;
}

function targetReplacementDate(event: Record<string, unknown>, draft: EventDraft): string {
  return stringField(event, 'date') || draft.replacementDate || draft.date;
}

function targetTransferKind(event: Record<string, unknown>): 'cash' | 'position' {
  return event.transferKind === 'position' ? 'position' : 'cash';
}

function targetBasisKnown(event: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(event, 'basis') && event.basis !== null;
}

function correctionTargetFields(event: Record<string, unknown>, draft: EventDraft): Pick<EventDraft, 'replacementKind' | 'replacementDate' | 'accountId' | 'quantity' | 'amount' | 'fee' | 'memo' | 'linkedBankSourceId' | 'transferKind' | 'toAccountId' | 'basisKnown'> {
  const kind = replacementKind(event.kind) ?? draft.replacementKind ?? 'buy';
  const money = moneyInput(event, ['money', 'consideration', 'proceeds', 'basis']);
  return {
    replacementKind: kind,
    replacementDate: targetReplacementDate(event, draft),
    accountId: targetAccountId(event, draft),
    quantity: stringField(event, 'quantity'),
    amount: money.amount,
    fee: moneyInput(event, ['fee']).amount,
    memo: stringField(event, 'memo'),
    linkedBankSourceId: stringField(event, 'linkedBankSourceId') || stringField(event, 'linked_bank_source_id'),
    transferKind: targetTransferKind(event),
    toAccountId: stringField(event, 'toAccountId') || draft.toAccountId,
    basisKnown: targetBasisKnown(event),
  };
}

export function applyCorrectionTarget(draft: EventDraft, option: ReversibleEventOption): EventDraft {
  const targetFields = correctionTargetFields(option.event, draft);
  return {
    ...draft,
    targetSourceId: option.sourceId,
    ...targetFields,
    ...correctionInstrumentFields(option.event, draft, moneyInput(option.event, ['money', 'consideration', 'proceeds', 'basis'])),
  };
}

export function reversibleEventFromResponseEntry(value: unknown, accounts: readonly WealthAccount[]): ReversibleEventOption[] {
  if (!isReversibleEvent(value)) return [];
  const sourceId = String(value.sourceId);
  const kind = String(value.kind);
  const accountId = typeof value.accountId === 'string' ? value.accountId : typeof value.fromAccountId === 'string' ? value.fromAccountId : '';
  const accountName = accounts.find((account) => account.id === accountId)?.name ?? 'Wealth account';
  const instrument = isRecord(value.instrument) && typeof value.instrument.ticker === 'string' ? ` · ${String(value.instrument.exchange ?? '')}:${value.instrument.ticker}` : '';
  return [{ sourceId, label: `${String(value.date)} · ${kind.replaceAll('_', ' ')} · ${accountName}${instrument}`, event: value }];
}

export function reversibleEventsFromResponse(value: unknown, accounts: readonly WealthAccount[]): ReversibleEventOption[] {
  if (!isRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((entry) => reversibleEventFromResponseEntry(entry, accounts));
}
