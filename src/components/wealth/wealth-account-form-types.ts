import type { Dispatch, SetStateAction } from 'react';
import type { LinkedAccountOption } from './wealth-form-shared';
import type { WealthAccountView, WealthAccountMutationRequest, WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../../domain/wealth-api-types';
import type { CanonicalInstrument, WealthAccount } from '../../domain/wealth-types';

export interface OpeningPositionDraft {
  exchange: string;
  ticker: string;
  instrumentType: CanonicalInstrument['type'];
  currency: string;
  quantity: string;
  basis: string;
  price: string;
}

export interface AccountFormValues {
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

export type AccountFormUpdate = Partial<AccountFormValues>;
export type AccountFormChange = AccountFormUpdate | ((current: AccountFormValues) => AccountFormUpdate);

export interface AccountFormActions {
  update: (change: AccountFormChange) => void;
}

export type AccountFormStateSetter = Dispatch<SetStateAction<AccountFormValues>>;

export interface AccountFormContextValue {
  values: AccountFormValues;
  actions: AccountFormActions;
  linkedAccounts: readonly LinkedAccountOption[];
  showOpeningCash: boolean;
  showOpeningPosition: boolean;
}

export interface AccountFormIdentity {
  account?: WealthAccountView;
  kind: WealthAccount['kind'];
  mode: WealthAccount['mode'];
}

export interface OpeningCashInput {
  enabled: boolean;
  value: string;
  currency: string;
}

export interface MoneyValidationInput {
  value: string;
  currency: string;
  label: string;
}

export interface OpeningPositionResultInput {
  position: OpeningPositionDraft;
  enabled: boolean;
}

export interface AccountDraftInput {
  account?: WealthAccountView;
  linkedAccounts: readonly LinkedAccountOption[];
}

export type AccountFormRequest = Pick<WealthAccountMutationRequest, 'id' | 'name' | 'kind' | 'mode'> & {
  currency: string;
  amountMinor: number | null;
  linkedBankAccountId: string;
  date: string;
  expectedRevision: number;
  modeTransition: WealthModeTransitionRequest | null;
  active?: boolean;
};
