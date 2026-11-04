import { createContext, useContext, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { WealthAccountView, WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../../domain/wealth-api-types';
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

interface AccountFormValues {
  name: string;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
  currency: string;
  value: string;
  date: string;
  linkedBankAccountId: string;
  openingCash: string;
  openingPosition: OpeningPositionDraft;
}

interface AccountFormActions {
  setName: (value: string) => void;
  setKind: (value: WealthAccount['kind']) => void;
  setMode: (value: WealthAccount['mode']) => void;
  setCurrency: (value: string) => void;
  setValue: (value: string) => void;
  setDate: (value: string) => void;
  setLinkedBankAccountId: (value: string) => void;
  setOpeningCash: (value: string) => void;
  setOpeningPosition: Dispatch<SetStateAction<OpeningPositionDraft>>;
}

interface AccountFormContextValue {
  values: AccountFormValues;
  actions: AccountFormActions;
  linkedAccounts: readonly LinkedAccountOption[];
  showOpeningCash: boolean;
  showOpeningPosition: boolean;
}

const AccountFormContext = createContext<AccountFormContextValue | null>(null);

function useAccountFormContext(): AccountFormContextValue {
  const context = useContext(AccountFormContext);
  if (!context) throw new Error('Account form fields must be rendered inside the account form.');
  return context;
}

interface OpeningPositionDraft {
  exchange: string;
  ticker: string;
  instrumentType: CanonicalInstrument['type'];
  currency: string;
  quantity: string;
  basis: string;
  price: string;
}

function emptyOpeningPosition(currency = 'CAD'): OpeningPositionDraft {
  return { exchange: 'TSX', ticker: '', instrumentType: 'stock', currency, quantity: '', basis: '', price: '' };
}

const supportedExchanges = ['TSX', 'TSXV', 'NEO', 'CSE', 'NYSE', 'NASDAQ', 'AMEX', 'ARCA', 'NYSE ARCA', 'BATS'];

function AccountKindField() {
  const { values, actions, linkedAccounts } = useAccountFormContext();
  const onChange = (value: string) => {
    const next = value as WealthAccount['kind'];
    actions.setKind(next);
    if (next !== 'brokerage') actions.setMode('aggregate');
  };
  return <label>Kind<select value={values.kind} onChange={(event) => onChange(event.target.value)}><option value="manual_asset">Manual asset</option><option value="debt">Debt</option><option value="brokerage">Brokerage</option>{linkedAccounts.length ? <option value="linked_bank">Linked bank balance</option> : null}</select></label>;
}

function AccountRepresentationField() {
  const { values, actions } = useAccountFormContext();
  return <label>Representation<select value={values.mode} disabled={values.kind !== 'brokerage'} onChange={(event) => actions.setMode(event.target.value as WealthAccount['mode'])}><option value="aggregate">Aggregate value</option><option value="holdings">Holdings + cash</option></select></label>;
}

function LinkedBankField() {
  const { values, actions, linkedAccounts } = useAccountFormContext();
  if (values.kind !== 'linked_bank') return null;
  const onChange = (value: string) => {
    const selected = linkedAccounts.find((account) => account.id === value);
    actions.setLinkedBankAccountId(value);
    if (selected?.currency) actions.setCurrency(selected.currency);
  };
  return <label>Existing bank account<select value={values.linkedBankAccountId} onChange={(event) => onChange(event.target.value)}><option value="">Choose account</option>{linkedAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.currency ? ` · ${account.currency}` : ''}</option>)}</select></label>;
}

function AggregateValueField() {
  const { values, actions } = useAccountFormContext();
  if (values.mode !== 'aggregate' || values.kind === 'linked_bank') return null;
  return <label>Opening value<input inputMode="decimal" value={values.value} onChange={(event) => actions.setValue(event.target.value)} placeholder="0.00" /></label>;
}

function OpeningPositionFields() {
  const { values, actions } = useAccountFormContext();
  const update = <K extends keyof OpeningPositionDraft>(key: K, value: OpeningPositionDraft[K]) => actions.setOpeningPosition((current) => ({ ...current, [key]: value }));
  return <fieldset className="wealth-form-wide"><legend>Opening position (optional)</legend><p className="wealth-empty-copy">Enter a security only when it is part of the dated transition. Leave all fields blank to use opening cash instead.</p><div className="wealth-form-grid"><label>Exchange<input list="wealth-opening-exchanges" value={values.openingPosition.exchange} onChange={(event) => update('exchange', event.target.value)} /><datalist id="wealth-opening-exchanges">{supportedExchanges.map((exchange) => <option key={exchange} value={exchange} />)}</datalist></label><label>Ticker<input value={values.openingPosition.ticker} onChange={(event) => update('ticker', event.target.value)} placeholder="SHOP" /></label><label>Instrument type<select value={values.openingPosition.instrumentType} onChange={(event) => update('instrumentType', event.target.value as CanonicalInstrument['type'])}><option value="stock">Stock</option><option value="etf">ETF</option></select></label><label>Position currency<select value={values.openingPosition.currency} onChange={(event) => update('currency', event.target.value)}><option>CAD</option><option>USD</option><option>CNY</option></select></label><label>Opening quantity<input inputMode="decimal" value={values.openingPosition.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="0" /></label><label>Opening basis (optional)<input inputMode="decimal" value={values.openingPosition.basis} onChange={(event) => update('basis', event.target.value)} placeholder="0.00" /></label><label>Dated price (optional)<input inputMode="decimal" value={values.openingPosition.price} onChange={(event) => update('price', event.target.value)} placeholder="0.00" /></label></div></fieldset>;
}

function TransitionFields() {
  const { values, actions, showOpeningCash, showOpeningPosition } = useAccountFormContext();
  return <><OpeningCashField show={showOpeningCash} value={values.openingCash} setValue={actions.setOpeningCash} optional={showOpeningPosition} />{showOpeningPosition ? <OpeningPositionFields /> : null}</>;
}

function EffectiveDateField() {
  const { values, actions } = useAccountFormContext();
  const update = (event: FormEvent<HTMLInputElement>) => actions.setDate(event.currentTarget.value);
  return <label>Effective date<input type="date" value={values.date} onChange={update} onInput={update} /></label>;
}

function OpeningCashField({ show, value, setValue, optional }: { show: boolean; value: string; setValue: (value: string) => void; optional: boolean }) {
  if (!show) return null;
  return <label className="wealth-form-wide">Opening cash for holdings<input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0.00" /><small>{optional ? 'Optional when an opening position is entered; the server records the transition atomically.' : 'Seeds this brokerage with a dated opening cash event.'}</small></label>;
}

function AccountFields() {
  const { values, actions } = useAccountFormContext();
  return <div className="wealth-form-grid"><label>Account name<input name="account-name" value={values.name} onChange={(event) => actions.setName(event.target.value)} autoComplete="off" /></label><AccountKindField /><AccountRepresentationField /><label>Currency<select value={values.currency} onChange={(event) => actions.setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>CNY</option></select></label><LinkedBankField /><EffectiveDateField /><AggregateValueField /><TransitionFields /></div>;
}

interface AccountMutationResponse {
  revision?: number;
  initialValuation?: unknown;
}

interface SaveAccountInput {
  api: LedgerApi;
  name: string;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
  currency: string;
  amount: number | null;
  linkedBankAccountId: string;
  date: string;
  revision: number;
  accountId?: string;
  openingCash: number | null;
  modeTransition: WealthModeTransitionRequest | null;
  active?: boolean;
}

async function saveAccount({ api, name, kind, mode, currency, amount, linkedBankAccountId, date, revision, accountId, openingCash, modeTransition, active }: SaveAccountInput): Promise<void> {
  const id = accountId ?? accountIdForName(name);
  const response = await api('/api/wealth/accounts', {
    method: 'PUT',
    body: JSON.stringify(accountRequest(name, kind, mode, currency, amount, linkedBankAccountId, revision, id, modeTransition, active, date)),
  }) as AccountMutationResponse;
  if (modeTransition) return;
  if (response.initialValuation) return;
  const nextRevision = response.revision ?? revision + 1;
  await saveAccountFollowUp({ api, id, kind, mode, currency, amount, date, revision: nextRevision, openingCash });
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
  const openingCashAmount = openingCashFollowUp(mode, openingCash);
  if (openingCashAmount === null) return;
  await api('/api/wealth/events', {
    method: 'POST',
    body: JSON.stringify({ event: { id: `opening-cash:${id}:${date}`, sourceId: `opening-cash:${id}:${date}`, kind: 'opening_cash', accountId: id, date, money: { currency, amountMinor: openingCashAmount }, memo: 'Opening cash for holdings tracking' }, expectedRevision: revision }),
  });
}

function aggregateFollowUp({ kind, mode, amount }: Pick<AccountFollowUpInput, 'kind' | 'mode' | 'amount'>): number | null {
  return mode === 'aggregate' && kind !== 'linked_bank' ? amount : null;
}

function openingCashFollowUp(mode: WealthAccount['mode'], openingCash: number | null): number | null {
  return mode === 'holdings' ? openingCash : null;
}

function initialMoney(account: WealthAccountView | undefined): string {
  const amount = account?.valueMinor ?? account?.amountMinor;
  return typeof amount === 'number' ? (amount / 100).toFixed(2) : '';
}

interface AccountValidationInput {
  name: string;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
  linkedBankAccountId: string;
  amount: number | null;
  date: string;
  needsOpeningCash: boolean;
  openingCash: number | null;
  openingPosition: WealthOpeningPositionRequest | null;
}

function accountValidationError(input: AccountValidationInput): string | null {
  if (input.kind !== 'brokerage' && input.mode !== 'aggregate') return 'Only brokerage accounts can use Holdings + cash.';
  const fieldValidation = accountFormError(input.name, input.kind, input.mode, input.linkedBankAccountId, input.amount);
  if (fieldValidation) return fieldError(input.name, 'Account name') ?? fieldValidation;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Choose a valid effective date.';
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
  name: string;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
  currency: string;
  amount: number | null;
  linkedBankAccountId: string;
  date: string;
  revision: number;
  accountId: string;
  openingCash: number | null;
  needsOpeningCash: boolean;
  openingPosition: WealthOpeningPositionRequest | null;
  modeTransition: WealthModeTransitionRequest | null;
  active?: boolean;
  onSaved: () => Promise<void>;
}

async function submitAccount(input: AccountSubmitInput): Promise<string | null> {
  const validationError = accountValidationError(input);
  if (validationError) return validationError;
  try {
    await saveAccount(input);
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

function shouldSeedOpeningCash(account: WealthAccountView | undefined, kind: WealthAccount['kind'], mode: WealthAccount['mode']): boolean {
  if (kind !== 'brokerage' || mode !== 'holdings') return false;
  return account?.mode !== 'holdings';
}

function openingCashAmount(needsOpeningCash: boolean, value: string, currency: string): number | null {
  return needsOpeningCash ? parseMoneyMinor(value, currency) : null;
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

function optionalMoneyError(value: string, currency: string, label: string): string | null {
  return value.trim() && parseMoneyMinor(value, currency) === null ? `Enter a valid ${label}.` : null;
}

function openingPositionError(position: OpeningPositionDraft): string | null {
  const currency = position.currency.trim().toUpperCase();
  const identityError = openingPositionIdentityError(position);
  if (identityError) return identityError;
  if (!validOpeningQuantity(position.quantity)) return 'Enter a positive opening quantity.';
  return optionalMoneyError(position.basis, currency, 'opening basis') ?? optionalMoneyError(position.price, currency, 'dated price');
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

function openingPositionResult(position: OpeningPositionDraft, enabled: boolean): OpeningPositionResult {
  if (!enabled || !openingPositionHasInput(position)) return { request: null, error: null };
  const error = openingPositionError(position);
  if (error) return { request: null, error };
  return { request: openingPositionPayload(position), error: null };
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

function initialLinkedBankAccount(account: WealthAccountView | undefined, linkedAccounts: readonly LinkedAccountOption[]): string {
  return account?.linkedBankAccountId ?? linkedAccounts[0]?.id ?? '';
}

function useAccountDraft(account: WealthAccountView | undefined, linkedAccounts: readonly LinkedAccountOption[]): AccountDraftState {
  const [accountId] = useState(() => account?.id ?? accountIdForName('wealth-account'));
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<WealthAccount['kind']>(account?.kind ?? 'manual_asset');
  const [mode, setMode] = useState<WealthAccount['mode']>(() => initialAccountMode(account));
  const [currency, setCurrency] = useState(account?.currency ?? 'CAD');
  const [value, setValue] = useState(initialMoney(account));
  const [date, setDate] = useState(() => initialAccountDate(account));
  const [openingCash, setOpeningCash] = useState('');
  const [openingPosition, setOpeningPosition] = useState<OpeningPositionDraft>(() => emptyOpeningPosition(account?.currency ?? 'CAD'));
  const [linkedBankAccountId, setLinkedBankAccountId] = useState(() => initialLinkedBankAccount(account, linkedAccounts));
  const needsOpeningCash = shouldSeedOpeningCash(account, kind, mode);
  const showOpeningPosition = account?.mode === 'aggregate' && kind === 'brokerage' && mode === 'holdings';
  const values = { name, kind, mode, currency, value, date, linkedBankAccountId, openingCash, openingPosition };
  const actions = { setName, setKind, setMode, setCurrency, setValue, setDate, setLinkedBankAccountId, setOpeningCash, setOpeningPosition };
  const form = { values, actions, linkedAccounts, showOpeningCash: needsOpeningCash, showOpeningPosition };
  return { accountId, values, actions, form, needsOpeningCash };
}

export function WealthAccountForm({ api, revision = 0, onSaved, onCancel, linkedAccounts = [], account }: FormProps & { linkedAccounts?: readonly LinkedAccountOption[]; account?: WealthAccountView; hasHoldingsData?: boolean }) {
  const draft = useAccountDraft(account, linkedAccounts);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { values } = draft;
    const amount = parseMoneyMinor(values.value, values.currency);
    const openingCashMinor = openingCashAmount(draft.needsOpeningCash, values.openingCash, values.currency);
    const openingPosition = openingPositionResult(values.openingPosition, draft.form.showOpeningPosition);
    const transition = modeTransition({ account, mode: values.mode, date: values.date, amount, openingCash: openingCashMinor, openingPosition: openingPosition.request });
    setBusy(true);
    setError(null);
    const submitError = openingPosition.error ?? await submitAccount({ api, name: values.name, kind: values.kind, mode: values.mode, currency: values.currency, amount, linkedBankAccountId: values.linkedBankAccountId, date: values.date, revision, accountId: draft.accountId, openingCash: openingCashMinor, needsOpeningCash: draft.needsOpeningCash, openingPosition: openingPosition.request, modeTransition: transition, active: account?.active, onSaved });
    setError(submitError);
    setBusy(false);
  };

  return <AccountFormView account={account} error={error} busy={busy} onCancel={onCancel} onSubmit={(event) => { void save(event); }} form={draft.form} />;
}
