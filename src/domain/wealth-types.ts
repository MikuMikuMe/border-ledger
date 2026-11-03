/** Shared wire contracts for long-only investment accounting.
 *
 * Quantities are decimal strings at the boundary. Money values are integer
 * minor units and deliberately never expose bigint; replay uses scaled bigint
 * internally so fractional trades remain deterministic.
 */

export type WealthCurrency = string;
export type DecimalString = string;
export type WealthAccountKind = 'linked_bank' | 'manual_asset' | 'debt' | 'brokerage';
export type WealthAccountMode = 'aggregate' | 'holdings';
export type InstrumentType = 'stock' | 'etf';

export interface WealthMoney {
  readonly currency: WealthCurrency;
  readonly amountMinor: number;
}

export interface CanonicalInstrument {
  readonly exchange: string;
  readonly ticker: string;
  readonly type: InstrumentType;
  readonly currency: WealthCurrency;
}

export interface WealthAccount {
  readonly id: string;
  readonly name: string;
  readonly kind: WealthAccountKind;
  /** Aggregate accounts are already valued totals; holdings accounts expose
   * positions and cash separately and must not be counted twice. */
  readonly mode: WealthAccountMode;
  readonly currency?: WealthCurrency;
  readonly linkedBankAccountId?: string | null;
  readonly active?: boolean;
}

export interface WealthAccountRegistry {
  readonly accounts: readonly WealthAccount[];
  readonly byId: Readonly<Record<string, WealthAccount>>;
}

export interface WealthEventBase {
  readonly id: string;
  /** Stable source identity. Retried events with the same sourceId are no-ops
   * when their content is identical and conflicts when it differs. */
  readonly sourceId: string;
  /** Server-assigned order within a ledger. Optional only for legacy/pure
   * domain callers, where same-day input order is preserved. */
  readonly sequence?: number;
  readonly date: string;
  readonly memo?: string | null;
  /** Explicit linkage to a bank record is the only basis for deduplication. */
  readonly linkedBankSourceId?: string | null;
}

export interface OpeningPositionEvent extends WealthEventBase {
  readonly kind: 'opening_position';
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: DecimalString;
  /** Null means the opening basis is unknown; no gains are fabricated. */
  readonly basis: WealthMoney | null;
}

export interface OpeningCashEvent extends WealthEventBase {
  readonly kind: 'opening_cash';
  readonly accountId: string;
  readonly money: WealthMoney;
}

export interface BuyEvent extends WealthEventBase {
  readonly kind: 'buy';
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: DecimalString;
  /** Total consideration excluding fee. Currency must equal instrument.currency. */
  readonly consideration: WealthMoney;
  readonly fee?: WealthMoney | null;
}

export interface SellEvent extends WealthEventBase {
  readonly kind: 'sell';
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: DecimalString;
  /** Gross sale proceeds. Currency must equal instrument.currency. */
  readonly proceeds: WealthMoney;
  readonly fee?: WealthMoney | null;
}

export interface DividendEvent extends WealthEventBase {
  readonly kind: 'dividend';
  readonly accountId: string;
  readonly instrument?: CanonicalInstrument | null;
  readonly money: WealthMoney;
}

export interface WithholdingEvent extends WealthEventBase {
  readonly kind: 'withholding';
  readonly accountId: string;
  readonly instrument?: CanonicalInstrument | null;
  readonly money: WealthMoney;
}

export interface FeeEvent extends WealthEventBase {
  readonly kind: 'fee';
  readonly accountId: string;
  readonly money: WealthMoney;
  readonly instrument?: CanonicalInstrument | null;
}

export interface ContributionEvent extends WealthEventBase {
  readonly kind: 'contribution';
  readonly accountId: string;
  readonly money: WealthMoney;
}

export interface WithdrawalEvent extends WealthEventBase {
  readonly kind: 'withdrawal';
  readonly accountId: string;
  readonly money: WealthMoney;
}

export interface SplitEvent extends WealthEventBase {
  readonly kind: 'split';
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly numerator: number;
  readonly denominator: number;
}

export interface CashTransferEvent extends WealthEventBase {
  readonly kind: 'transfer';
  readonly transferKind: 'cash';
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly money: WealthMoney;
  readonly transferId?: string | null;
}

export interface PositionTransferEvent extends WealthEventBase {
  readonly kind: 'transfer';
  readonly transferKind: 'position';
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: DecimalString;
  readonly transferId?: string | null;
}

export type TransferEvent = CashTransferEvent | PositionTransferEvent;

export type WealthCorrectionPayload =
  | Omit<OpeningPositionEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'opening_position' }
  | Omit<OpeningCashEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'opening_cash' }
  | Omit<BuyEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'buy' }
  | Omit<SellEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'sell' }
  | Omit<DividendEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'dividend' }
  | Omit<WithholdingEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'withholding' }
  | Omit<FeeEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'fee' }
  | Omit<ContributionEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'contribution' }
  | Omit<WithdrawalEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'withdrawal' }
  | Omit<SplitEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'split' }
  | Omit<CashTransferEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'transfer'; readonly transferKind: 'cash' }
  | Omit<PositionTransferEvent, 'id' | 'sourceId' | 'kind'> & { readonly kind: 'transfer'; readonly transferKind: 'position' };

export interface ReversalEvent extends WealthEventBase {
  readonly kind: 'reversal';
  readonly targetSourceId: string;
}

export interface CorrectionEvent extends WealthEventBase {
  readonly kind: 'correction';
  readonly targetSourceId: string;
  /** The replacement keeps its own original date and account identity. */
  readonly replacement: WealthCorrectionPayload;
}

export type WealthEvent =
  | OpeningPositionEvent
  | OpeningCashEvent
  | BuyEvent
  | SellEvent
  | DividendEvent
  | WithholdingEvent
  | FeeEvent
  | ContributionEvent
  | WithdrawalEvent
  | SplitEvent
  | TransferEvent
  | ReversalEvent
  | CorrectionEvent;

export interface WealthPositionState {
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly quantity: DecimalString;
  readonly costBasisMinor: number | null;
  readonly basisKnown: boolean;
  readonly realizedGainMinor: number | null;
}

export interface WealthCashBalance {
  readonly accountId: string;
  readonly currency: WealthCurrency;
  readonly amountMinor: number;
}

export type WealthValuationSource = 'manual' | 'provider';

/** Closing/end-of-day observation for the stated calendar date. */
export interface HoldingValuation {
  readonly accountId: string;
  readonly instrument: CanonicalInstrument;
  readonly asOf: string;
  readonly priceMinor: number;
  readonly source: WealthValuationSource;
  readonly provider?: string | null;
}

export interface WealthValuedPosition extends WealthPositionState {
  readonly valuation: HoldingValuation | null;
  readonly marketValueMinor: number | null;
  readonly unrealizedGainMinor: number | null;
}

export type WealthValueAvailability = 'complete' | 'incomplete';

export interface WealthSnapshot {
  readonly asOf: string;
  readonly accounts: readonly WealthAccount[];
  readonly positions: readonly WealthValuedPosition[];
  readonly cash: readonly WealthCashBalance[];
  /** Aggregate accounts are included here; holdings account cash and positions
   * are included exactly once. Values remain separated by original currency. */
  readonly totalByCurrency: Readonly<Record<WealthCurrency, number>>;
  /** A numeric total may be partial when one or more holdings lack a dated
   * valuation. Consumers must show this status instead of treating absence as
   * zero or presenting a partial total as complete. */
  readonly totalStatusByCurrency: Readonly<Record<WealthCurrency, WealthValueAvailability>>;
}

export type WealthCashFlowClassification = 'external_contribution' | 'external_withdrawal' | 'trade' | 'internal_transfer' | 'ambiguous';

export interface WealthCashFlowRecord {
  readonly sourceId: string;
  readonly date: string;
  readonly accountId: string;
  readonly money: WealthMoney;
  readonly direction?: 'inflow' | 'outflow' | null;
  readonly kind?: 'bank' | 'trade' | 'internal_transfer' | 'contribution' | 'withdrawal' | null;
  /** Set only when a bank record is explicitly linked to a wealth event. */
  readonly linkedWealthSourceId?: string | null;
}

export interface ClassifiedWealthCashFlow extends WealthCashFlowRecord {
  readonly classification: WealthCashFlowClassification;
  readonly includedInPerformance: boolean;
  readonly reason: string;
}

export interface ModifiedDietzResult {
  readonly value: number | null;
  readonly available: boolean;
  readonly reason?: 'missing_start_valuation' | 'missing_end_valuation' | 'incomplete_flows' | 'invalid_period' | null;
}

export interface WealthReport extends WealthSnapshot {
  readonly cashFlows: readonly ClassifiedWealthCashFlow[];
  readonly modifiedDietz: ModifiedDietzResult;
}

export interface WealthReplayResult {
  readonly positions: readonly WealthPositionState[];
  readonly cash: readonly WealthCashBalance[];
  readonly appliedSourceIds: readonly string[];
  readonly duplicateSourceIds: readonly string[];
  readonly reversedSourceIds: readonly string[];
}

export interface WealthReportOptions {
  readonly asOf: string;
  readonly accounts: WealthAccountRegistry | readonly WealthAccount[];
  /** Only set when the caller explicitly accepts incomplete cash history. */
  readonly allowNegativeCash?: boolean;
  readonly valuations?: readonly HoldingValuation[];
  readonly startValuation?: Readonly<Record<WealthCurrency, number>> | null;
  readonly endValuation?: Readonly<Record<WealthCurrency, number>> | null;
  readonly periodStart?: string;
  readonly periodEnd?: string;
}
