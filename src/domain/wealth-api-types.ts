import type {
  CanonicalInstrument,
  ClassifiedWealthCashFlow,
  WealthAccount,
  WealthMoney,
  ModifiedDietzResult,
  WealthReport,
  WealthSnapshot,
} from './wealth-types';

export type WealthDataState = 'fresh' | 'stale' | 'missing';

export interface WealthAccountView extends WealthAccount {
  readonly amountMinor?: number | null;
  readonly valueMinor?: number | null;
  readonly valueState?: WealthDataState;
  readonly valueObservedAt?: string | null;
  readonly revision?: number;
}

export interface WealthBalanceStatus {
  readonly accountId: string;
  readonly state: WealthDataState;
  readonly observedAt: string | null;
}

export interface WealthFxStatus {
  readonly convertedCadMinor: number | null;
  readonly complete: boolean;
  readonly unavailable: readonly string[];
  /** The provider's actual rate date; it may precede the requested report date. */
  readonly effectiveDate: string | null;
  readonly provider: 'frankfurter' | null;
  readonly baseCurrency: 'EUR' | null;
  /** Only the quote currencies required by the conversion are exposed. */
  readonly rates: Readonly<Record<string, string>>;
}

export interface WealthHistoryPoint {
  readonly date: string;
  readonly totals: Readonly<Record<string, number>>;
  readonly convertedCadMinor: number | null;
  /** False when one or more accounts lacks a dated observation at this point. */
  readonly complete: boolean;
  readonly stale: boolean;
  readonly missingData: readonly string[];
}

export interface WealthAllocationRow {
  readonly currency: string;
  readonly accountId: string;
  readonly kind: 'aggregate' | 'holding' | 'cash';
  readonly instrument: CanonicalInstrument | null;
  readonly valueMinor: number | null;
  readonly share: number | null;
  readonly available: boolean;
}

/** Bank-source fields are kept alongside the performance classification so a
 * client can drill into the originating transaction without re-querying the
 * ledger or guessing which category was used. */
export interface WealthCashFlowMetadata {
  readonly transactionId?: string;
  readonly merchant?: string;
  readonly accountName?: string | null;
  readonly category?: string | null;
  readonly bankKind?: 'expense' | 'income' | 'refund' | 'fee';
  /** Investment event category when a dividend, withholding, or fee is
   * projected without requiring a duplicate bank record. */
  readonly eventKind?: 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal';
  readonly source?: string | null;
  readonly status?: string;
  readonly linkConflict?: boolean;
  readonly confirmed?: boolean;
}

export type WealthCashFlowResponse = ClassifiedWealthCashFlow & WealthCashFlowMetadata;

export interface WealthCashFlowTotals {
  readonly inflowMinor: number;
  readonly outflowMinor: number;
  readonly netMinor: number;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly refundMinor: number;
  readonly feeMinor: number;
}

export type WealthModifiedDietzByCurrency = Readonly<Record<string, ModifiedDietzResult>>;

export interface WealthModeTransitionResponse {
  readonly fromMode: 'aggregate' | 'holdings';
  readonly toMode: 'aggregate' | 'holdings';
  readonly effectiveDate: string;
}

/** Stored transition metadata used by imports and historical mode validation. */
export interface WealthModeTransitionRecord extends WealthModeTransitionResponse {
  readonly accountId: string;
  readonly revision: number;
  readonly payload: WealthModeTransitionRequest;
}

export interface WealthOpeningPositionRequest {
  readonly id?: string;
  readonly sourceId?: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: string;
  readonly basis?: WealthMoney | null;
  readonly priceMinor?: number | null;
}

export interface WealthModeTransitionRequest {
  readonly effectiveDate: string;
  readonly openingCashMinor?: number | null;
  readonly openingValueMinor?: number | null;
  readonly openingPositions?: readonly WealthOpeningPositionRequest[];
}

/** Request body for PUT /api/wealth/accounts. */
export interface WealthAccountMutationRequest {
  readonly id: string;
  readonly name: string;
  readonly kind: WealthAccount['kind'];
  readonly mode: WealthAccount['mode'];
  readonly currency: string;
  readonly amountMinor?: number | null;
  readonly linkedBankAccountId?: string | null;
  readonly modeTransition?: WealthModeTransitionRequest | null;
  readonly active?: boolean;
  readonly asOf?: string | null;
  readonly expectedRevision?: number;
}

export interface WealthAccountMutationResponse {
  readonly account: WealthAccountView;
  readonly initialValuation?: Readonly<Record<string, unknown>>;
  readonly transition?: WealthModeTransitionResponse;
  readonly revision: number;
}

export interface WealthSnapshotResponse extends Omit<WealthSnapshot, 'accounts'> {
  readonly accounts: readonly WealthAccountView[];
  readonly history: readonly WealthHistoryPoint[];
  readonly cashFlows: readonly WealthCashFlowResponse[];
  readonly cashFlowTotals: Readonly<Record<string, WealthCashFlowTotals>>;
  readonly modifiedDietz: WealthReport['modifiedDietz'];
  readonly revision: number;
  readonly balanceStatuses: readonly WealthBalanceStatus[];
  readonly stale: boolean;
  readonly missingData: readonly string[];
  readonly fx: WealthFxStatus;
  readonly allocations: readonly WealthAllocationRow[];
}

export interface WealthReportResponse extends Omit<WealthReport, 'accounts'> {
  readonly accounts: readonly WealthAccountView[];
  readonly revision: number;
  readonly history: readonly WealthHistoryPoint[];
  /** All confirmed household bank flows in the requested period. */
  readonly householdCashFlows: readonly WealthCashFlowResponse[];
  /** Only bank flows explicitly linked to the brokerage portfolio. */
  readonly investmentCashFlows: readonly WealthCashFlowResponse[];
  readonly cashFlowTotals: Readonly<Record<string, WealthCashFlowTotals>>;
  /** Investment income/expense lanes remain separate from household flows. */
  readonly investmentCashFlowTotals: Readonly<Record<string, WealthCashFlowTotals>>;
  /** Portfolio performance stays in each original currency; currencies are never summed. */
  readonly modifiedDietzByCurrency: WealthModifiedDietzByCurrency;
  readonly balanceStatuses: readonly WealthBalanceStatus[];
  readonly stale: boolean;
  readonly missingData: readonly string[];
  readonly fx: WealthFxStatus;
  readonly allocations: readonly WealthAllocationRow[];
}

export interface WealthMutationResponse<T> {
  readonly revision: number;
  readonly replayed?: boolean;
  readonly [key: string]: unknown;
  readonly value?: T;
}

export interface WealthImportPreviewResponse {
  readonly previewId: string;
  readonly revision: number;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly errors: readonly Readonly<Record<string, unknown>>[];
  readonly duplicates: readonly Readonly<Record<string, unknown>>[];
}

export interface WealthImportCommitResponse {
  readonly previewId: string;
  readonly committed: number;
  readonly revision: number;
  readonly replayed?: boolean;
}
