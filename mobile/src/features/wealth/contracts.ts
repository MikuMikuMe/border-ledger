import type {
  ClassifiedWealthCashFlow,
  HoldingValuation,
  ModifiedDietzResult,
  WealthAccount,
  WealthCashBalance,
  WealthValuedPosition,
} from '../../../../src/domain/wealth-types';
import type { WealthAllocationRow, WealthCashFlowTotals, WealthFxStatus } from '../../../../src/domain/wealth-api-types';
import type { Operation } from '../finance/contracts';

export type WealthView = 'overview' | 'investments' | 'cash-flow';

export type WealthHistoryPoint = {
  date: string;
  totals: Record<string, number | null>;
  /** False when the server could not observe every account on this date. */
  complete: boolean;
};

export type WealthQuoteState = {
  configured: boolean;
  provider: string | null;
  lastRefreshedAt: string | null;
  error?: string | null;
};

export type WealthCsvMapping = Readonly<Record<string, string | null>>;

export type WealthCsvState = {
  template: string | null;
  previewId: string | null;
  revision?: number | null;
  /** Headers supplied by the selected source file, kept separate from the
   * canonical import fields so mapping never becomes a raw JSON workflow. */
  sourceHeaders?: string[];
  canonicalHeaders?: string[];
  mapping?: WealthCsvMapping;
  validRowIds?: string[];
  rowCount: number;
  previewRows?: { rowId: string; rowIndex: number; recordType: string | null; record?: Record<string, unknown> | null; event?: Record<string, unknown> | null; date?: string | null; kind?: string | null; accountId?: string | null; details?: string | null; error: string | null; duplicateOf: string | null }[];
  errors: string[];
  duplicates: { id: string; sourceId: string | null; status: string; reason: string | null }[];
};

export type WealthEventRow = { id: string; sourceId: string; date: string; kind: string; label: string | null; accountId?: string | null; linkedBankSourceId?: string | null; instrumentKey?: string | null };

/** Human-readable bank activity used to select an internal wealth link.
 * The stable id is retained only in the submitted event payload; it is never
 * rendered as a source-id input or label. */
export type WealthBankTransaction = {
  id: string;
  occurredAt: string;
  currency: string;
  signedMinorUnits: string;
  merchant: string | null;
  accountLabel: string | null;
  status: string;
  sourceLabel: string | null;
  category: string | null;
  note: string | null;
  kind: string;
  revision: number;
  accountId: string | null;
};

export type WealthBankAccount = {
  id: string;
  name: string;
  institution: string | null;
  currencies: string[];
};

export type WealthValuationRow = {
  id: string;
  accountId: string;
  instrument: WealthValuedPosition['instrument'] | null;
  asOf: string;
  priceMinor: number | null;
  source: 'manual' | 'provider';
  provider: string | null;
};

export type WealthInvestmentDetail = {
  accountId: string;
  instrumentKey: string | null;
  events: WealthEventRow[];
  valuations: WealthValuationRow[];
};

/**
 * The report API keeps household and investment cash flows in separate lanes.
 * The mobile decoder permits nullable presentation metadata because older
 * server snapshots omitted those fields and bank providers may return null.
 */
export type WealthCashFlowRow = ClassifiedWealthCashFlow & {
  transactionId?: string | null;
  merchant?: string | null;
  accountName?: string | null;
  category?: string | null;
  bankKind?: 'expense' | 'income' | 'refund' | 'fee';
  eventKind?: 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal';
  source?: string | null;
  status?: string | null;
  linkConflict?: boolean;
  confirmed?: boolean;
};

/** The native boundary keeps the server response as JSON until this checked shape. */
export type WealthWireSnapshot = {
  /** Monotonic server revision used to fence mobile writes. */
  revision?: number | null;
  asOf: string | null;
  stale: boolean;
  missingData?: string[];
  accounts: WealthAccount[];
  positions: WealthValuedPosition[];
  cash: WealthCashBalance[];
  totalByCurrency: Record<string, number | null>;
  history: WealthHistoryPoint[];
  /** Backward-compatible alias for the household cash-flow lane. */
  cashFlows: WealthCashFlowRow[];
  /** Explicit household lane returned by report responses. */
  householdCashFlows?: WealthCashFlowRow[];
  /** Explicit investment income/expense lane returned by report responses. */
  investmentCashFlows?: WealthCashFlowRow[];
  cashFlowTotals?: Readonly<Record<string, WealthCashFlowTotals>>;
  investmentCashFlowTotals?: Readonly<Record<string, WealthCashFlowTotals>>;
  /** Event summaries are optional on snapshot/report responses; the server
   * may omit them when the selected view does not need correction controls. */
  events?: WealthEventRow[];
  /** Dated account and instrument observations used by the investment detail panel. */
  valuations?: WealthValuationRow[];
  modifiedDietz: ModifiedDietzResult;
  modifiedDietzByCurrency?: Readonly<Record<string, ModifiedDietzResult>>;
  allocations?: WealthAllocationRow[];
  /** Server-authoritative CAD estimate and the dated provider snapshot used to derive it. */
  fx?: WealthFxStatus;
  quote: WealthQuoteState;
  csv: WealthCsvState;
  selectedAccount?: WealthAccount | null;
  selectedInstrument?: {
    accountId: string;
    instrument: WealthValuedPosition['instrument'];
    valuation: HoldingValuation | null;
    position: WealthValuedPosition | null;
  } | null;
};

export type WealthReadQuery = {
  view?: WealthView;
  accountId?: string | null;
  exchange?: string | null;
  ticker?: string | null;
  asOf?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type WealthService = {
  read(query?: WealthReadQuery): Promise<string>;
  onChanged?(listener: (value: unknown) => void): { remove(): void };
  readBankAccounts?(): Promise<WealthBankAccount[]>;
  readBankTransactions?(): Promise<WealthBankTransaction[]>;
  readQuoteSettings?(): Promise<string>;
  readEvents?(accountId?: string | null): Promise<string>;
  readValuations?(accountId?: string | null): Promise<string>;
  readTemplate(): Promise<string>;
  startCsvImport?(operationId: string): Promise<Operation>;
  startCsvTemplate?(operationId: string): Promise<Operation>;
  startCsvRemap?(sourceOperationId: string, operationId: string, mapping: WealthCsvMapping): Promise<Operation>;
  readCsvPreview?(operationId: string): Promise<string | null>;
  startWrite(operationId: string, action: string, body: string): Promise<Operation>;
};

type Event<T> = (listener: (value: T) => void) => { remove(): void };

export type WealthPorts = {
  read(query?: WealthReadQuery): Promise<string>;
  startCsvImport?(operationId: string): Promise<Operation>;
  startCsvTemplate?(operationId: string): Promise<Operation>;
  startCsvRemap?(sourceOperationId: string, operationId: string, mapping: WealthCsvMapping): Promise<Operation>;
  readCsvPreview?(operationId: string): Promise<string | null>;
  startWrite(operationId: string, action: string, body: string): Promise<Operation>;
  readOperations(offset: number, limit: number): Promise<Operation[]>;
  queryOperation(operationId: string): Promise<Operation | null>;
  onChanged: Event<unknown>;
};
