import { useState, type FormEvent } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { WealthAccount } from '../../domain/wealth-types';
import { WealthBankLinkField, type WealthLinkedAccountOption } from './WealthBankLinkField';
import { WealthCorrectionFields } from './WealthCorrectionFields';
import {
  applyCorrectionTarget,
  amountRequired,
  buildEventBody,
  correctionReplacementKinds,
  eventKinds,
  eventModeError,
  instrumentFieldsVisible,
  instrumentRequired,
  moneyKinds,
  ordinaryKind,
  type EventDraft,
  type EventKind,
  type ReversibleEventOption,
} from './wealth-event-utils';
import { type FormProps, writeError } from './wealth-form-shared';

interface EventFieldProps {
  draft: EventDraft;
  setField: <K extends keyof EventDraft>(field: K, value: EventDraft[K]) => void;
}

function accountOptionLabel(account: WealthAccount): string {
  return `${account.name}${account.currency ? ` · ${account.currency}` : ''}`;
}

function selectEventAccount(setField: EventFieldProps['setField'], accounts: readonly WealthAccount[], accountId: string): void {
  setField('accountId', accountId);
  const account = accounts.find((item) => item.id === accountId);
  if (account?.currency) setField('currency', account.currency);
}

function InstrumentFields({ draft, setField, optional }: EventFieldProps & { optional?: boolean }) {
  return <>
    <label>{optional ? 'Ticker (optional)' : 'Ticker'}<input value={draft.ticker} onChange={(event) => setField('ticker', event.target.value)} placeholder="SHOP" /></label>
    <label>Exchange<select value={draft.exchange} onChange={(event) => setField('exchange', event.target.value)}><option>TSX</option><option>TSXV</option><option>NEO</option><option>CSE</option><option>NYSE</option><option>NASDAQ</option><option>AMEX</option><option>ARCA</option><option>NYSE ARCA</option><option>BATS</option></select></label>
    <label>Security type<select value={draft.instrumentType} onChange={(event) => setField('instrumentType', event.target.value as EventDraft['instrumentType'])}><option value="stock">Stock</option><option value="etf">ETF</option></select></label>
    <label>Quote currency<select value={draft.currency} onChange={(event) => setField('currency', event.target.value)}><option>CAD</option><option>USD</option></select></label>
  </>;
}

function TransferFields({ draft, accounts, setField }: EventFieldProps & { accounts: readonly WealthAccount[] }) {
  return <>
    <label>Transfer type<select value={draft.transferKind} onChange={(event) => setField('transferKind', event.target.value as EventDraft['transferKind'])}><option value="cash">Cash</option><option value="position">Position</option></select></label>
    <label>Destination account<select value={draft.toAccountId} onChange={(event) => setField('toAccountId', event.target.value)}><option value="">Choose account</option>{accounts.filter((account) => account.id !== draft.accountId).map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>)}</select></label>
  </>;
}

function EventIdentityFields({ draft, accounts, setField }: EventFieldProps & { accounts: readonly WealthAccount[] }) {
  return <>
    <label>Event<select value={draft.kind} onChange={(event) => setField('kind', event.target.value as EventKind)}>{eventKinds.map((eventKind) => <option key={eventKind} value={eventKind}>{eventKind.replaceAll('_', ' ')}</option>)}</select></label>
    <label>Account<select value={draft.accountId} disabled={draft.kind === 'correction'} onChange={(event) => selectEventAccount(setField, accounts, event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>)}</select></label>
    <label>{draft.kind === 'correction' ? 'Correction date' : 'Date'}<input type="date" value={draft.date} onChange={(event) => setField('date', event.currentTarget.value)} onInput={(event) => setField('date', event.currentTarget.value)} /></label>
    <TransferFieldsWhenNeeded draft={draft} accounts={accounts} setField={setField} />
    <InstrumentFieldsWhenNeeded draft={draft} setField={setField} />
  </>;
}

function TransferFieldsWhenNeeded({ draft, accounts, setField }: EventFieldProps & { accounts: readonly WealthAccount[] }) {
  if (ordinaryKind(draft) !== 'transfer') return null;
  return <TransferFields draft={draft} accounts={accounts} setField={setField} />;
}

function InstrumentFieldsWhenNeeded({ draft, setField }: EventFieldProps) {
  if (!instrumentFieldsVisible(draft)) return null;
  return <InstrumentFields draft={draft} setField={setField} optional={!instrumentRequired(draft)} />;
}

function CorrectionReplacementFields({ draft, setField }: EventFieldProps) {
  if (draft.kind !== 'correction') return null;
  return <>
    <div className="wealth-form-wide"><strong>Replacement record</strong><small>Enter the ordinary event that should replace the selected record. Corrections cannot contain another correction or reversal.</small></div>
    <label>Replacement event<select aria-label="Replacement event type" value={draft.replacementKind ?? 'buy'} onChange={(event) => setField('replacementKind', event.target.value as EventDraft['replacementKind'])}>{correctionReplacementKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
    <label>Replacement date<input type="date" value={draft.replacementDate ?? draft.date} onChange={(event) => setField('replacementDate', event.currentTarget.value)} onInput={(event) => setField('replacementDate', event.currentTarget.value)} /></label>
  </>;
}

function EventPositionFields({ draft, setField }: EventFieldProps) {
  return <>
    <PositionQuantityField draft={draft} setField={setField} />
    <OpeningBasisField draft={draft} setField={setField} />
    <SplitFieldsWhenNeeded draft={draft} setField={setField} />
  </>;
}

function positionQuantityVisible(draft: EventDraft): boolean {
  const kind = ordinaryKind(draft);
  return ['opening_position', 'buy', 'sell'].includes(kind) || (kind === 'transfer' && draft.transferKind === 'position');
}

function PositionQuantityField({ draft, setField }: EventFieldProps) {
  if (!positionQuantityVisible(draft)) return null;
  return <label>Quantity<input inputMode="decimal" value={draft.quantity} onChange={(event) => setField('quantity', event.target.value)} placeholder="0.0001" /></label>;
}

function OpeningBasisField({ draft, setField }: EventFieldProps) {
  if (ordinaryKind(draft) !== 'opening_position') return null;
  return <label className="wealth-checkbox"><input type="checkbox" checked={draft.basisKnown} onChange={(event) => setField('basisKnown', event.target.checked)} /> Basis known</label>;
}

function SplitFieldsWhenNeeded({ draft, setField }: EventFieldProps) {
  if (ordinaryKind(draft) !== 'split') return null;
  return <><label>Numerator<input inputMode="numeric" value={draft.quantity} onChange={(event) => setField('quantity', event.target.value)} /></label><label>Denominator<input inputMode="numeric" value={draft.amount} onChange={(event) => setField('amount', event.target.value)} /></label></>;
}

function EventMoneyFields({ draft, setField }: EventFieldProps) {
  return <>
    <EventAmountField draft={draft} setField={setField} />
    <EventFeeField draft={draft} setField={setField} />
  </>;
}

function isCashTransfer(draft: EventDraft): boolean {
  return ordinaryKind(draft) === 'transfer' && draft.transferKind === 'cash';
}

function EventAmountField({ draft, setField }: EventFieldProps) {
  if (!amountRequired(draft) && !isCashTransfer(draft)) return null;
  const kind = ordinaryKind(draft);
  const label = kind === 'opening_position' ? 'Opening basis' : 'Amount';
  const disabled = kind === 'opening_position' && !draft.basisKnown;
  return <label>{label}<input inputMode="decimal" value={draft.amount} onChange={(event) => setField('amount', event.target.value)} placeholder="0.00" disabled={disabled} /></label>;
}

function EventFeeField({ draft, setField }: EventFieldProps) {
  const kind = ordinaryKind(draft);
  if (kind !== 'buy' && kind !== 'sell') return null;
  return <label>Fee<input inputMode="decimal" value={draft.fee} onChange={(event) => setField('fee', event.target.value)} placeholder="0.00" /></label>;
}

function EventReviewFields({ draft, accounts, api, linkedAccounts, setField, onTargetChange }: EventFieldProps & { accounts: readonly WealthAccount[]; api: LedgerApi; linkedAccounts: readonly WealthLinkedAccountOption[]; onTargetChange: (value: string, selected?: ReversibleEventOption) => void }) {
  return <>
    <CorrectionFieldsWhenNeeded draft={draft} accounts={accounts} api={api} onTargetChange={onTargetChange} />
    <BankLinkFieldWhenNeeded draft={draft} api={api} linkedAccounts={linkedAccounts} setField={setField} />
    <label className="wealth-form-wide">Memo<input value={draft.memo} onChange={(event) => setField('memo', event.target.value)} /></label>
  </>;
}

function CorrectionFieldsWhenNeeded({ draft, accounts, api, onTargetChange }: Pick<EventFieldProps, 'draft'> & { accounts: readonly WealthAccount[]; api: LedgerApi; onTargetChange: (value: string, selected?: ReversibleEventOption) => void }) {
  if (draft.kind !== 'reversal' && draft.kind !== 'correction') return null;
  return <WealthCorrectionFields api={api} accounts={accounts} targetSourceId={draft.targetSourceId} controlKind={draft.kind} onTargetSourceChange={onTargetChange} />;
}

function BankLinkFieldWhenNeeded({ draft, api, linkedAccounts, setField }: EventFieldProps & { api: LedgerApi; linkedAccounts: readonly WealthLinkedAccountOption[] }) {
  if (!bankLinkNeeded(draft)) return null;
  return <WealthBankLinkField api={api} linkedAccounts={linkedAccounts} value={draft.linkedBankSourceId} onChange={(value) => setField('linkedBankSourceId', value)} />;
}

function bankLinkNeeded(draft: EventDraft): boolean {
  const kind = ordinaryKind(draft);
  if (moneyKinds.includes(kind)) return true;
  if (kind !== 'transfer') return false;
  return draft.transferKind === 'cash';
}

function EventFields({ draft, accounts, api, linkedAccounts, setField, onTargetChange }: { draft: EventDraft; accounts: readonly WealthAccount[]; api: LedgerApi; linkedAccounts: readonly WealthLinkedAccountOption[]; setField: EventFieldProps['setField']; onTargetChange: (value: string, selected?: ReversibleEventOption) => void }) {
  return <div className="wealth-form-grid">
    <EventIdentityFields draft={draft} accounts={accounts} setField={setField} />
    <CorrectionReplacementFields draft={draft} setField={setField} />
    <EventPositionFields draft={draft} setField={setField} />
    <EventMoneyFields draft={draft} setField={setField} />
    <EventReviewFields draft={draft} accounts={accounts} api={api} linkedAccounts={linkedAccounts} setField={setField} onTargetChange={onTargetChange} />
  </div>;
}

function initialEventDraft(accounts: readonly WealthAccount[]): EventDraft {
  const today = new Date().toISOString().slice(0, 10);
  return { id: crypto.randomUUID(), sourceId: crypto.randomUUID(), kind: 'buy', replacementKind: 'buy', replacementDate: today, accountId: accounts[0]?.id ?? '', date: today, ticker: '', exchange: 'TSX', instrumentType: 'stock', currency: accounts[0]?.currency ?? 'CAD', quantity: '', amount: '', fee: '', memo: '', targetSourceId: '', linkedBankSourceId: '', transferKind: 'cash', toAccountId: accounts[1]?.id ?? '', basisKnown: true };
}

function correctionTargetDraft(draft: EventDraft, value: string, selected?: ReversibleEventOption): EventDraft {
  return draft.kind === 'correction' && selected ? applyCorrectionTarget(draft, selected) : { ...draft, targetSourceId: value };
}

interface EventSaveInput {
  api: LedgerApi;
  draft: EventDraft;
  accounts: readonly WealthAccount[];
  revision: number;
  onSaved: () => Promise<void>;
}

function useEventSave({ api, draft, accounts, revision, onSaved }: EventSaveInput): { error: string | null; busy: boolean; save: (event: FormEvent) => Promise<void> } {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const modeError = eventModeError(draft, accounts);
    if (modeError) { setError(modeError); return; }
    const result = buildEventBody(draft, revision);
    if (result.error || !result.body) { setError(result.error); return; }
    const { expectedRevision, ...eventBody } = result.body;
    setBusy(true);
    setError(null);
    try {
      await api('/api/wealth/events', { method: 'POST', body: JSON.stringify({ event: eventBody, expectedRevision }) });
      await onSaved();
    } catch (cause) {
      setError(writeError(cause, 'The event could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, save };
}

function EventFormHeading({ correcting, onCancel }: { correcting: boolean; onCancel: () => void }) {
  return <div className="wealth-form-heading"><div><h3 id="wealth-event-form-title">Record wealth event</h3><p>{correcting ? 'Replace a recorded event with a dated, typed replacement. The original remains in the audit history.' : 'Events are append-only. Use a reversal when an existing record needs to be cancelled.'}</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close event form"><X size={16} /></button></div>;
}

function EventFormActions({ busy, accounts, onCancel }: { busy: boolean; accounts: readonly WealthAccount[]; onCancel: () => void }) {
  return <div className="wealth-form-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy || accounts.length === 0}>{busy ? 'Saving…' : 'Save event'}</button></div>;
}

export function WealthEventForm({ api, revision = 0, accounts, linkedAccounts = [], onSaved, onCancel }: FormProps & { accounts: readonly WealthAccount[]; linkedAccounts?: readonly WealthLinkedAccountOption[] }) {
  const [draft, setDraft] = useState<EventDraft>(() => initialEventDraft(accounts));
  const setField = <K extends keyof EventDraft>(field: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const onTargetChange = (value: string, selected?: ReversibleEventOption) => setDraft((current) => correctionTargetDraft(current, value, selected));
  const state = useEventSave({ api, draft, accounts, revision, onSaved });

  return <form className="wealth-form" onSubmit={(event) => { void state.save(event); }} aria-labelledby="wealth-event-form-title">
    <EventFormHeading correcting={draft.kind === 'correction'} onCancel={onCancel} />
    {state.error ? <p className="wealth-form-error" role="alert"><CircleAlert size={15} />{state.error}</p> : null}
    <EventFields draft={draft} accounts={accounts} api={api} linkedAccounts={linkedAccounts} setField={setField} onTargetChange={onTargetChange} />
    <EventFormActions busy={state.busy} accounts={accounts} onCancel={onCancel} />
  </form>;
}
