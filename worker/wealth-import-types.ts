import type { CanonicalInstrument, HoldingValuation, WealthAccount, WealthEvent } from '../src/domain/wealth-types';
import type { WealthModeTransitionRequest, WealthOpeningPositionRequest } from '../src/domain/wealth-api-types';

/** Stable instrument-key sentinel for aggregate account valuations. */
export const WEALTH_ACCOUNT_VALUE_KEY = '__account__';

export const CANONICAL_CSV_HEADERS = [
  'record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'amount_minor', 'active',
  'linked_bank_account_id', 'exchange', 'ticker', 'type', 'quantity', 'numerator', 'denominator', 'basis_minor', 'consideration_minor', 'proceeds_minor', 'fee_minor',
  'from_account_id', 'to_account_id', 'transfer_kind', 'transfer_id', 'target_source_id', 'linked_bank_source_id', 'memo', 'as_of', 'price_minor',
  'source', 'provider', 'sequence', 'event_json', 'effective_date', 'from_mode', 'to_mode', 'opening_cash_minor', 'opening_value_minor', 'opening_positions_json', 'transition_json',
] as const;

export interface CsvMappingMetadata {
  readonly sourceHeaders: readonly string[];
  readonly canonicalHeaders: readonly string[];
  readonly mapping: Readonly<Record<string, string | null>>;
}

export interface ImportAccount {
  readonly id: string;
  readonly name: string;
  readonly kind: WealthAccount['kind'];
  readonly mode: WealthAccount['mode'];
  readonly currency: string | null;
  readonly linkedBankAccountId: string | null;
  readonly amountMinor: number | null;
  readonly active: boolean;
}

export interface ImportInstrument {
  readonly id: string;
  readonly exchange: string;
  readonly ticker: string;
  readonly type: 'stock' | 'etf';
  readonly currency: string;
}

export interface ImportValuation {
  readonly id: string;
  readonly accountId: string;
  readonly instrument: CanonicalInstrument | null;
  readonly asOf: string;
  readonly priceMinor: number;
  readonly source: 'manual' | 'provider';
  readonly provider: string | null;
}

export interface ImportModeTransition extends WealthModeTransitionRequest {
  readonly id: string;
  readonly accountId: string;
  readonly fromMode: WealthAccount['mode'];
  readonly toMode: WealthAccount['mode'];
  readonly effectiveDate: string;
  readonly openingPositions: readonly WealthOpeningPositionRequest[];
  /** Needed only to materialize opening cash events; it is not part of the stored transition payload. */
  readonly accountCurrency: string | null;
}

export type WealthImportRecord =
  | { readonly recordType: 'account'; readonly account: ImportAccount }
  | { readonly recordType: 'instrument'; readonly instrument: ImportInstrument }
  | { readonly recordType: 'mode_transition'; readonly transition: ImportModeTransition }
  | { readonly recordType: 'valuation'; readonly valuation: ImportValuation }
  | { readonly recordType: 'event'; readonly event: WealthEvent };

export interface CsvPreviewRow {
  readonly rowId: string;
  readonly rowIndex: number;
  readonly recordType: WealthImportRecord['recordType'] | null;
  readonly record: WealthImportRecord | null;
  readonly event: WealthEvent | null;
  readonly error: string | null;
  readonly duplicateOf: string | null;
}

export interface CsvScanState {
  readonly rows: string[][];
  row: string[];
  value: string;
  quoted: boolean;
}

export interface CsvEventContext {
  readonly record: Readonly<Record<string, string>>;
  readonly kind: WealthEvent['kind'];
  readonly code: string;
  readonly money: { readonly currency: string; readonly amountMinor: number };
  readonly instrument: CanonicalInstrument | undefined;
  readonly base: Readonly<Record<string, unknown>>;
  readonly tools: CsvParserTools;
}

export type CsvEventBuilder = (context: CsvEventContext) => WealthEvent;

export interface CsvParserTools {
  readonly bounded: (value: unknown, label: string, max: number) => string;
  readonly currency: (value: unknown, label: string, allowNull?: boolean) => string | null;
  readonly date: (value: unknown, label: string) => string;
  readonly normalizeEvent: (value: unknown) => WealthEvent;
  readonly invalidCsv: (message: string) => Error;
}

export interface PreviewClassificationContext {
  readonly rowId: string;
  readonly rowIndex: number;
  readonly record: WealthImportRecord;
  readonly seen: ReadonlyMap<string, CsvPreviewRow>;
  readonly existingRecords: ReadonlyMap<string, WealthImportRecord>;
}

export interface ImportReadRow {
  readonly row_id: string;
  readonly row_index: number;
  readonly payload_json: string;
  readonly error_json: string | null;
  readonly duplicate_of: string | null;
  readonly state: string;
}

export interface ImportValidationServices {
  readonly readAccounts: (db: import('./db-types').D1Database, context: import('./financial-authority').FinancialContext) => Promise<readonly (WealthAccount & Record<string, unknown>)[]>;
  readonly readStoredEvents: (db: import('./db-types').D1Database, context: import('./financial-authority').FinancialContext) => Promise<readonly WealthEvent[]>;
  readonly readStoredValuations: (db: import('./db-types').D1Database, context: import('./financial-authority').FinancialContext) => Promise<readonly StoredHoldingValuation[]>;
  readonly readModeTransitions: (db: import('./db-types').D1Database, context: import('./financial-authority').FinancialContext, accounts?: readonly WealthAccount[]) => Promise<readonly ImportModeTransition[]>;
  readonly assertBankLinkAvailable: (db: import('./db-types').D1Database, context: import('./financial-authority').FinancialContext, event: WealthEvent, proposed?: readonly WealthEvent[]) => Promise<void>;
  readonly mixedTransferMode: (accounts: readonly WealthAccount[], event: WealthEvent) => boolean;
  readonly isBankLinkConflict: (error: unknown) => boolean;
}

export interface ImportCommitServices {
  readonly accountValueKey: string;
  readonly instrumentKey: (instrument: CanonicalInstrument) => string;
  readonly eventAccountFields: (event: WealthEvent) => { accountId: string | null; fromAccountId: string | null; toAccountId: string | null };
}

export type StoredHoldingValuation = HoldingValuation & { readonly id: string; readonly instrumentKey?: string };
