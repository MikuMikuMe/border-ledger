import { createContext, useContext, useState, type ChangeEvent, type FormEvent } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { WealthAccountMutationRequest, WealthAccountMutationResponse, WealthAccountView, WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../../domain/wealth-api-types';
import type { CanonicalInstrument, WealthAccount } from '../../domain/wealth-types';
import { parseMoneyMinor } from './wealth-utils';
import {
  accountFormError,
  accountIdForName,
  accountRequest,
  appendAggregateValuation,
  fieldError,
  type FormProps,
  type LinkedAccountOption,
  writeError,
} from './wealth-form-shared';
import type {
  AccountDraftInput,
  AccountFormChange,
  AccountFormActions,
  AccountFormContextValue,
  AccountFormIdentity,
  AccountFormRequest,
  AccountFormStateSetter,
  AccountFormUpdate,
  AccountFormValues,
  MoneyValidationInput,
  OpeningCashInput,
  OpeningPositionDraft,
  OpeningPositionResultInput,
} from './wealth-account-form-types';

const AccountFormContext = createContext<AccountFormContextValue | null>(null);

function useAccountFormContext(): AccountFormContextValue {
  const context = useContext(AccountFormContext);
  if (!context) throw new Error('Account form fields must be rendered inside the account form.');
  return context;
}

function emptyOpeningPosition(currency = 'CAD'): OpeningPositionDraft {
  return { exchange: 'TSX', ticker: '', instrumentType: 'stock', currency, quantity: '', basis: '', price: '' };
}

const supportedExchanges = ['TSX', 'TSXV', 'NEO', 'CSE', 'NYSE', 'NASDAQ', 'AMEX', 'ARCA', 'NYSE ARCA', 'BATS'];

function AccountKindField() {
  const { values, actions, linkedAccounts } = useAccountFormContext();
  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const kind = event.currentTarget.value as WealthAccount['kind'];
    actions.update({ kind, ...(kind === 'brokerage' ? {} : { mode: 'aggregate' }) });
  };
  return <label>Kind<select value={values.kind} onChange={onChange}><option value="manual_asset">Manual asset</option><option value="debt">Debt</option><option value="brokerage">Brokerage</option>{linkedAccounts.length ? <option value="linked_bank">Linked bank balance</option> : null}</select></label>;
}

function AccountRepresentationField() {
  const { values, actions } = useAccountFormContext();
  return <label>Representation<select value={values.mode} disabled={values.kind !== 'brokerage'} onChange={(event) => actions.update({ mode: event.currentTarget.value as WealthAccount['mode'] })}><option value="aggregate">Aggregate value</option><option value="holdings">Holdings + cash</option></select></label>;
}

function LinkedBankField() {
  const { values, actions, linkedAccounts } = useAccountFormContext();
  if (values.kind !== 'linked_bank') return null;
  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const linkedBankAccountId = event.currentTarget.value;
    const selected = linkedAccounts.find((account) => account.id === linkedBankAccountId);
    actions.update({ linkedBankAccountId, ...(selected?.currency ? { currency: selected.currency } : {}) });
  };
  return <label>Existing bank account<select value={values.linkedBankAccountId} onChange={onChange}><option value="">Choose account</option>{linkedAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.currency ? ` · ${account.currency}` : ''}</option>)}</select></label>;
}

function AggregateValueField() {
  const { values, actions } = useAccountFormContext();
  if (values.mode !== 'aggregate' || values.kind === 'linked_bank') return null;
  return <label>Opening value<input inputMode="decimal" value={values.value} onChange={(event) => actions.update({ value: event.currentTarget.value })} placeholder="0.00" /></label>;
}

function OpeningPositionFields() {
  const { values, actions } = useAccountFormContext();
  const update = (change: Partial<OpeningPositionDraft>) => actions.update((current) => ({ openingPosition: { ...current.openingPosition, ...change } }));
  return <fieldset className="wealth-form-wide"><legend>Opening position (optional)</legend><p className="wealth-empty-copy">Enter a security only when it is part of the dated transition. Leave all fields blank to use opening cash instead.</p><div className="wealth-form-grid"><label>Exchange<input list="wealth-opening-exchanges" value={values.openingPosition.exchange} onChange={(event) => update({ exchange: event.currentTarget.value })} /><datalist id="wealth-opening-exchanges">{supportedExchanges.map((exchange) => <option key={exchange} value={exchange} />)}</datalist></label><label>Ticker<input value={values.openingPosition.ticker} onChange={(event) => update({ ticker: event.currentTarget.value })} placeholder="SHOP" /></label><label>Instrument type<select value={values.openingPosition.instrumentType} onChange={(event) => update({ instrumentType: event.currentTarget.value as CanonicalInstrument['type'] })}><option value="stock">Stock</option><option value="etf">ETF</option></select></label><label>Position currency<select value={values.openingPosition.currency} onChange={(event) => update({ currency: event.currentTarget.value })}><option>CAD</option><option>USD</option><option>CNY</option></select></label><label>Opening quantity<input inputMode="decimal" value={values.openingPosition.quantity} onChange={(event) => update({ quantity: event.currentTarget.value })} placeholder="0" /></label><label>Opening basis (optional)<input inputMode="decimal" value={values.openingPosition.basis} onChange={(event) => update({ basis: event.currentTarget.value })} placeholder="0.00" /></label><label>Dated price (optional)<input inputMode="decimal" value={values.openingPosition.price} onChange={(event) => update({ price: event.currentTarget.value })} placeholder="0.00" /></label></div></fieldset>;
}

function TransitionFields() {
  const { showOpeningCash, showOpeningPosition } = useAccountFormContext();
  return <><OpeningCashField show={showOpeningCash} optional={showOpeningPosition} />{showOpeningPosition ? <OpeningPositionFields /> : null}</>;
}

function EffectiveDateField() {
  const { values, actions } = useAccountFormContext();
  const update = (event: FormEvent<HTMLInputElement>) => actions.update({ date: event.currentTarget.value });
  return <label>Effective date<input type="date" value={values.date} onChange={update} onInput={update} /></label>;
}

function OpeningCashField({ show, optional }: { show: boolean; optional: boolean }) {
  const { values, actions } = useAccountFormContext();
  if (!show) return null;
  return <label className="wealth-form-wide">Opening cash for holdings<input inputMode="decimal" value={values.openingCash} onChange={(event) => actions.update({ openingCash: event.currentTarget.value })} placeholder="0.00" /><small>{optional ? 'Optional when an opening position is entered; the server records the transition atomically.' : 'Seeds this brokerage with a dated opening cash event.'}</small></label>;
}

function AccountFields() {
  const { values, actions } = useAccountFormContext();
  return <div className="wealth-form-grid"><label>Account name<input name="account-name" value={values.name} onChange={(event) => actions.update({ name: event.currentTarget.value })} autoComplete="off" /></label><AccountKindField /><AccountRepresentationField /><label>Currency<select value={values.currency} onChange={(event) => actions.update({ currency: event.currentTarget.value })}><option>CAD</option><option>USD</option><option>CNY</option></select></label><LinkedBankField /><EffectiveDateField /><AggregateValueField /><TransitionFields /></div>;
}

interface SaveAccountInput {
  api: LedgerApi;
  request: WealthAccountMutationRequest;
  date: string;
  openingCash: number | null;
}

async function saveAccount({ api, request, date, openingCash }: SaveAccountInput): Promise<void> {
  const response = await api<WealthAccountMutationResponse>('/api/wealth/accounts', {
    method: 'PUT',
    body: JSON.stringify(accountRequest(request)),
  });
  if (request.modeTransition) return;
  if (response.initialValuation) return;
  const nextRevision = response.revision ?? (request.expectedRevision ?? 0) + 1;
  await saveAccountFollowUp({ api, id: request.id, kind: request.kind, mode: request.mode, currency: request.currency, amount: request.amountMinor ?? null, date, revision: nextRevision, openingCash });
}

interface AccountFollowUpInput {
  api: LedgerApi;
  id: string;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
  currency: string;
  amount: number | null;
  date: string;
  revision: number;
  openingCash: number | null;
}

async function saveAccountFollowUp({ api, id, kind, mode, currency, amount, date, revision, openingCash }: AccountFollowUpInput): Promise<void> {
  const aggregateAmount = aggregateFollowUp({ kind, mode, amount });
  if (aggregateAmount !== null) {
    await appendAggregateValuation({ api, accountId: id, date, amountMinor: aggregateAmount, revision });
    return;
  }
  const openingCashAmount = openingCashFollowUp({ mode, openingCash });
  if (openingCashAmount === null) return;
  await api('/api/wealth/events', {
    method: 'POST',
    body: JSON.stringify({ event: { id: `opening-cash:${id}:${date}`, sourceId: `opening-cash:${id}:${date}`, kind: 'opening_cash', accountId: id, date, money: { currency, amountMinor: openingCashAmount }, memo: 'Opening cash for holdings tracking' }, expectedRevision: revision }),
  });
}

function aggregateFollowUp({ kind, mode, amount }: Pick<AccountFollowUpInput, 'kind' | 'mode' | 'amount'>): number | null {
  return mode === 'aggregate' && kind !== 'linked_bank' ? amount : null;
}

function openingCashFollowUp(input: Pick<AccountFollowUpInput, 'mode' | 'openingCash'>): number | null {
  return input.mode === 'holdings' ? input.openingCash : null;
}

function initialMoney(account: WealthAccountView | undefined): string {
  const amount = account?.valueMinor ?? account?.amountMinor;
  return typeof amount === 'number' ? (amount / 100).toFixed(2) : '';
}

interface AccountValidationInput {
  request: AccountFormRequest;
  needsOpeningCash: boolean;
  openingCash: number | null;
  openingPosition: WealthOpeningPositionRequest | null;
}

function accountValidationError(input: AccountValidationInput): string | null {
  const { request } = input;
  if (request.kind !== 'brokerage' && request.mode !== 'aggregate') return 'Only brokerage accounts can use Holdings + cash.';
  const fieldValidation = accountFormError(request.name, request.kind, request.mode, request.linkedBankAccountId, request.amountMinor);
  if (fieldValidation) return fieldError(request.name, 'Account name') ?? fieldValidation;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date)) return 'Choose a valid effective date.';
  return input.needsOpeningCash && input.openingCash === null && input.openingPosition === null ? 'Enter opening cash or an opening position to set up this brokerage for holdings tracking.' : null;
}

function AccountFormHeading({ account, onCancel }: { account?: WealthAccountView; onCancel: () => void }) {
  return <div className="wealth-form-heading"><div><h3 id="wealth-account-form-title">{account ? 'Edit account' : 'Add account'}</h3><p>Use aggregate mode for a single dated value, or holdings mode when events and cash will be tracked separately.</p>{account?.mode === 'aggregate' ? <small>Changing to holdings creates one dated transition with opening cash or an opening position. Choose a date after the existing history.</small> : null}{account?.mode === 'holdings' ? <small>Changing to aggregate creates one dated transition with an opening value. Choose a date after the existing history.</small> : null}</div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close account form"><X size={16} /></button></div>;
}

function AccountFormActions({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return <div className="wealth-form-actions"><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button></div>;
}

function AccountFormError({ message }: { message: string | null }) {
  return message ? <p className="wealth-form-error" role="alert"><CircleAlert size={15} />{message}</p> : null;
}

interface AccountSubmitInput {
  api: LedgerApi;
  request: AccountFormRequest;
  openingCash: number | null;
  needsOpeningCash: boolean;
  openingPosition: WealthOpeningPositionRequest | null;
  onSaved: () => Promise<void>;
}

function mutationRequest(input: AccountFormRequest): WealthAccountMutationRequest {
  const { date, ...request } = input;
  return { ...request, asOf: date };
}

async function submitAccount(input: AccountSubmitInput): Promise<string | null> {
  const validationError = accountValidationError(input);
  if (validationError) return validationError;
  try {
    await saveAccount({ api: input.api, request: mutationRequest(input.request), date: input.request.date, openingCash: input.openingCash });
    await input.onSaved();
    return null;
  } catch (cause) {
    return writeError(cause, 'The account could not be saved.');
  }
}

interface AccountFormViewProps {
  account?: WealthAccountView;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  form: AccountFormContextValue;
}

function AccountFormView({ account, error, busy, onCancel, onSubmit, form }: AccountFormViewProps) {
  return <AccountFormContext.Provider value={form}><form className="wealth-form" onSubmit={onSubmit} aria-labelledby="wealth-account-form-title">
    <AccountFormHeading account={account} onCancel={onCancel} />
    <AccountFormError message={error} />
    <AccountFields />
    <AccountFormActions busy={busy} onCancel={onCancel} />
  </form></AccountFormContext.Provider>;
}

function shouldSeedOpeningCash(input: AccountFormIdentity): boolean {
  if (input.kind !== 'brokerage' || input.mode !== 'holdings') return false;
  return input.account?.mode !== 'holdings';
}

function openingCashAmount(input: OpeningCashInput): number | null {
  return input.enabled ? parseMoneyMinor(input.value, input.currency) : null;
}

function openingPositionHasInput(position: OpeningPositionDraft): boolean {
  return position.ticker.trim() !== '' || position.quantity.trim() !== '' || position.basis.trim() !== '' || position.price.trim() !== '';
}

function validOpeningQuantity(value: string): boolean {
  const normalized = value.trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized)) && Number(normalized) > 0;
}

interface OpeningPositionResult {
  request: WealthOpeningPositionRequest | null;
  error: string | null;
}

function openingPositionIdentityError(position: OpeningPositionDraft): string | null {
  return [position.exchange, position.ticker, position.currency].some((value) => !value.trim()) ? 'Enter an exchange, ticker, and position currency for the opening position.' : null;
}

function optionalMoneyError(input: MoneyValidationInput): string | null {
  return input.value.trim() && parseMoneyMinor(input.value, input.currency) === null ? `Enter a valid ${input.label}.` : null;
}

function openingPositionError(position: OpeningPositionDraft): string | null {
  const currency = position.currency.trim().toUpperCase();
  const identityError = openingPositionIdentityError(position);
  if (identityError) return identityError;
  if (!validOpeningQuantity(position.quantity)) return 'Enter a positive opening quantity.';
  return optionalMoneyError({ value: position.basis, currency, label: 'opening basis' }) ?? optionalMoneyError({ value: position.price, currency, label: 'dated price' });
}

function openingPositionPayload(position: OpeningPositionDraft): WealthOpeningPositionRequest {
  const exchange = position.exchange.trim().toUpperCase();
  const ticker = position.ticker.trim().toUpperCase();
  const currency = position.currency.trim().toUpperCase();
  const basisMinor = position.basis.trim() ? parseMoneyMinor(position.basis, currency) : null;
  const priceMinor = position.price.trim() ? parseMoneyMinor(position.price, currency) : null;
  const instrument: CanonicalInstrument = { exchange, ticker, type: position.instrumentType, currency };
  return { instrument, quantity: position.quantity.trim(), ...(basisMinor === null ? {} : { basis: { currency, amountMinor: basisMinor } }), ...(priceMinor === null ? {} : { priceMinor }) };
}

function openingPositionResult(input: OpeningPositionResultInput): OpeningPositionResult {
  if (!input.enabled || !openingPositionHasInput(input.position)) return { request: null, error: null };
  const error = openingPositionError(input.position);
  if (error) return { request: null, error };
  return { request: openingPositionPayload(input.position), error: null };
}

interface ModeTransitionInput {
  account?: WealthAccountView;
  mode: WealthAccount['mode'];
  date: string;
  amount: number | null;
  openingCash: number | null;
  openingPosition: WealthOpeningPositionRequest | null;
}

function modeTransition(input: ModeTransitionInput): WealthModeTransitionRequest | null {
  if (!input.account || input.account.mode === input.mode) return null;
  return input.mode === 'holdings'
    ? { effectiveDate: input.date, ...(input.openingCash === null ? {} : { openingCashMinor: input.openingCash }), ...(input.openingPosition ? { openingPositions: [input.openingPosition] } : {}) }
    : { effectiveDate: input.date, openingValueMinor: input.amount };
}

interface AccountDraftState {
  accountId: string;
  values: AccountFormValues;
  actions: AccountFormActions;
  form: AccountFormContextValue;
  needsOpeningCash: boolean;
}

function initialAccountMode(account: WealthAccountView | undefined): WealthAccount['mode'] {
  return account?.kind === 'brokerage' ? account.mode : 'aggregate';
}

function initialAccountDate(account: WealthAccountView | undefined): string {
  return account ? account.valueObservedAt ?? '' : new Date().toISOString().slice(0, 10);
}

function initialLinkedBankAccount(input: AccountDraftInput): string {
  return input.account?.linkedBankAccountId ?? input.linkedAccounts[0]?.id ?? '';
}

function initialAccountValues({ account, linkedAccounts }: AccountDraftInput): AccountFormValues {
  return {
    name: account?.name ?? '',
    kind: account?.kind ?? 'manual_asset',
    mode: initialAccountMode(account),
    currency: account?.currency ?? 'CAD',
    value: initialMoney(account),
    date: initialAccountDate(account),
    linkedBankAccountId: initialLinkedBankAccount({ account, linkedAccounts }),
    openingCash: '',
    openingPosition: emptyOpeningPosition(account?.currency ?? 'CAD'),
  };
}

function accountFormVisibility({ account, kind, mode }: AccountFormIdentity) {
  return {
    showOpeningCash: shouldSeedOpeningCash({ account, kind, mode }),
    showOpeningPosition: account?.mode === 'aggregate' && kind === 'brokerage' && mode === 'holdings',
  };
}

function resolveAccountFormChange(change: AccountFormChange, current: AccountFormValues): AccountFormUpdate {
  return typeof change === 'function' ? change(current) : change;
}

function accountFormActions(setValues: AccountFormStateSetter): AccountFormActions {
  return { update: (change) => setValues((current) => ({ ...current, ...resolveAccountFormChange(change, current) })) };
}

function useAccountDraft({ account, linkedAccounts }: AccountDraftInput): AccountDraftState {
  const [accountId] = useState(() => account?.id ?? accountIdForName('wealth-account'));
  const [values, setValues] = useState<AccountFormValues>(() => initialAccountValues({ account, linkedAccounts }));
  const visibility = accountFormVisibility({ account, kind: values.kind, mode: values.mode });
  const actions = accountFormActions(setValues);
  const form = { values, actions, linkedAccounts, ...visibility };
  return { accountId, values, actions, form, needsOpeningCash: visibility.showOpeningCash };
}

export function WealthAccountForm({ api, revision = 0, onSaved, onCancel, linkedAccounts = [], account }: FormProps & { linkedAccounts?: readonly LinkedAccountOption[]; account?: WealthAccountView; hasHoldingsData?: boolean }) {
  const draft = useAccountDraft({ account, linkedAccounts });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { values } = draft;
    const amount = parseMoneyMinor(values.value, values.currency);
    const openingCashMinor = openingCashAmount({ enabled: draft.needsOpeningCash, value: values.openingCash, currency: values.currency });
    const openingPosition = openingPositionResult({ position: values.openingPosition, enabled: draft.form.showOpeningPosition });
    const transition = modeTransition({ account, mode: values.mode, date: values.date, amount, openingCash: openingCashMinor, openingPosition: openingPosition.request });
    const request: AccountFormRequest = {
      id: draft.accountId,
      name: values.name,
      kind: values.kind,
      mode: values.mode,
      currency: values.currency,
      amountMinor: amount,
      linkedBankAccountId: values.linkedBankAccountId,
      date: values.date,
      expectedRevision: revision,
      modeTransition: transition,
      active: account?.active,
    };
    setBusy(true);
    setError(null);
    const submitError = openingPosition.error ?? await submitAccount({ api, request, openingCash: openingCashMinor, needsOpeningCash: draft.needsOpeningCash, openingPosition: openingPosition.request, onSaved });
    setError(submitError);
    setBusy(false);
  };

  return <AccountFormView account={account} error={error} busy={busy} onCancel={onCancel} onSubmit={(event) => { void save(event); }} form={draft.form} />;
}
