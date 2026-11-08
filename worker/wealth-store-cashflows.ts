import { classifyWealthCashFlows } from '../src/domain/wealth';
import type { ClassifiedWealthCashFlow, WealthCashFlowRecord, WealthEvent } from '../src/domain/wealth-types';
import type { D1Database } from './db-types';
import { notSupersededAlertTransactionPredicate } from './ledger-reports';
import type { FinancialContext } from './financial-authority';

interface TransactionRow {
  id: string;
  account_id: string;
  account_name: string | null;
  wealth_account_id: string | null;
  wealth_account_name: string | null;
  merchant: string;
  date: string;
  amount_minor: number;
  currency: string;
  category: string | null;
  kind: 'expense' | 'income' | 'refund' | 'fee' | 'transfer';
  status: string;
  source: string | null;
}

export interface TransactionAliasRow {
  transaction_id: string;
  id: string;
  identity_key: string;
  provider_transaction_id: string | null;
  provider_pending_transaction_id: string | null;
  bank_source_id: string | null;
  bank_row_id: string | null;
  event_id: string | null;
  bank_reference: string | null;
}

export type StoredCashFlowRecord = WealthCashFlowRecord & {
  transactionId: string;
  accountName: string | null;
  merchant: string;
  category: string | null;
  bankKind: TransactionRow['kind'];
  source: string | null;
  status: string;
  linkConflict?: boolean;
};

type CashFlowSummaryRecord = WealthCashFlowRecord & {
  classification?: ClassifiedWealthCashFlow['classification'];
  bankKind?: TransactionRow['kind'];
  linkConflict?: boolean;
  confirmed?: boolean;
  reason?: string;
};

export interface CashFlowTotal {
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  refundMinor: number;
  feeMinor: number;
}

export type InvestmentEventKind = 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal';
export type InvestmentCashFlowRecord = ClassifiedWealthCashFlow & { eventKind?: InvestmentEventKind; bankKind?: TransactionRow['kind']; confirmed?: boolean };

type InvestmentCashEvent = Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' | 'contribution' | 'withdrawal' }>;
type InvestmentTradeEvent = Extract<WealthEvent, { kind: 'buy' | 'sell' }>;
type InvestmentCashFlowInput = WealthCashFlowRecord & { embeddedTradeFee?: true };
type ClassifiedInvestmentInput = ClassifiedWealthCashFlow & { embeddedTradeFee?: true };

function isInvestmentCashEvent(event: WealthEvent, investmentIds: ReadonlySet<string>): event is InvestmentCashEvent {
  return ['dividend', 'withholding', 'fee', 'contribution', 'withdrawal'].includes(event.kind) && 'accountId' in event && investmentIds.has(event.accountId);
}

function eventCashFlowRecord(event: InvestmentCashEvent): WealthCashFlowRecord {
  const inflow = event.kind === 'contribution' || event.kind === 'dividend';
  return {
    sourceId: event.sourceId,
    date: event.date,
    accountId: event.accountId,
    money: event.money,
    direction: inflow ? 'inflow' : 'outflow',
    kind: inflow ? 'contribution' : 'withdrawal',
    linkedWealthSourceId: event.sourceId,
  };
}

function embeddedTradeFeeRecord(event: InvestmentTradeEvent): InvestmentCashFlowInput | null {
  if (!event.fee || event.fee.amountMinor === 0) return null;
  return {
    sourceId: `${event.sourceId}:fee`,
    date: event.date,
    accountId: event.accountId,
    money: event.fee,
    direction: 'outflow',
    kind: 'withdrawal',
    embeddedTradeFee: true,
  };
}

function investmentEventInRange(event: WealthEvent, investmentIds: ReadonlySet<string>, from: string | null, to: string | null): boolean {
  return 'accountId' in event && investmentIds.has(event.accountId) && (!from || event.date >= from) && (!to || event.date <= to);
}

function investmentEventCashFlows(event: WealthEvent, investmentIds: ReadonlySet<string>): InvestmentCashFlowInput[] {
  const records: InvestmentCashFlowInput[] = [];
  if (isInvestmentCashEvent(event, investmentIds)) records.push(eventCashFlowRecord(event));
  if (event.kind === 'buy' || event.kind === 'sell') {
    const fee = embeddedTradeFeeRecord(event);
    if (fee) records.push(fee);
  }
  return records;
}

function eventCashFlowRecords(events: readonly WealthEvent[], investmentIds: ReadonlySet<string>, from: string | null, to: string | null): InvestmentCashFlowInput[] {
  return events.filter((event) => investmentEventInRange(event, investmentIds, from, to)).flatMap((event) => investmentEventCashFlows(event, investmentIds));
}

function portfolioBankRecords(records: readonly StoredCashFlowRecord[], eventSources: ReadonlySet<string>): StoredCashFlowRecord[] {
  return records.filter((record) => {
    const sourceId = record.linkedWealthSourceId;
    return typeof sourceId === 'string' && eventSources.has(sourceId);
  });
}

interface PortfolioFlowQuery {
  readonly records: readonly StoredCashFlowRecord[];
  readonly events: readonly WealthEvent[];
  readonly investmentIds: ReadonlySet<string>;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly isPortfolioEvent: (event: WealthEvent, investmentIds: ReadonlySet<string>) => boolean;
}

export function portfolioFlowRecords(query: PortfolioFlowQuery): InvestmentCashFlowInput[] {
  const portfolioEvents = query.events.filter((event) => query.isPortfolioEvent(event, query.investmentIds));
  const eventSources = new Set(portfolioEvents.map((event) => event.sourceId));
  const bankRecords = portfolioBankRecords(query.records, eventSources);
  const linkedSources = new Set(bankRecords.map((record) => record.linkedWealthSourceId).filter((source): source is string => Boolean(source)));
  const manualRecords = eventCashFlowRecords(portfolioEvents, query.investmentIds, query.from ?? null, query.to ?? null).filter((record) => !linkedSources.has(record.linkedWealthSourceId ?? ''));
  return [...bankRecords, ...manualRecords];
}

function isInvestmentIncomeEvent(event: WealthEvent | undefined): event is Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' }> {
  return event?.kind === 'dividend' || event?.kind === 'withholding' || event?.kind === 'fee';
}

function investmentFlowBankKind(kind: InvestmentEventKind): TransactionRow['kind'] {
  return kind === 'dividend' ? 'income' : kind === 'contribution' || kind === 'withdrawal' ? 'income' : 'fee';
}

function classifyEmbeddedTradeFee(flow: ClassifiedInvestmentInput): InvestmentCashFlowRecord | null {
  if (!flow.embeddedTradeFee) return null;
  const { embeddedTradeFee: _embeddedTradeFee, ...record } = flow;
  return { ...record, eventKind: 'fee', bankKind: 'fee', confirmed: true, includedInPerformance: false, reason: 'Embedded trade fee; trade principal remains excluded from cash-flow totals.' };
}

function sameMoney(left: WealthCashFlowRecord['money'], right: WealthCashFlowRecord['money']): boolean {
  return left.currency.toUpperCase() === right.currency.toUpperCase() && left.amountMinor === right.amountMinor;
}

function classifyInvestmentIncomeFlow(flow: ClassifiedWealthCashFlow, event: Extract<WealthEvent, { kind: 'dividend' | 'withholding' | 'fee' }>): InvestmentCashFlowRecord {
  const eventKind = event.kind;
  const expectedDirection = eventKind === 'dividend' ? 'inflow' : 'outflow';
  const bankMatch = flow.kind !== 'bank' || (flow.direction === expectedDirection && sameMoney(flow.money, event.money));
  return { ...flow, eventKind, bankKind: investmentFlowBankKind(eventKind), confirmed: bankMatch, includedInPerformance: false, reason: bankMatch ? 'Recorded investment income or expense; excluded from external capital flows.' : 'Linked bank amount does not agree with the recorded investment income or expense.' };
}

function classifyInvestmentFlow(flow: ClassifiedInvestmentInput, eventsBySource: ReadonlyMap<string, WealthEvent>): InvestmentCashFlowRecord {
  const embeddedFee = classifyEmbeddedTradeFee(flow);
  if (embeddedFee) return embeddedFee;
  const event = flow.linkedWealthSourceId ? eventsBySource.get(flow.linkedWealthSourceId) : undefined;
  return isInvestmentIncomeEvent(event) ? classifyInvestmentIncomeFlow(flow, event) : flow;
}

export function classifyInvestmentCashFlows(records: readonly WealthCashFlowRecord[], events: readonly WealthEvent[]): InvestmentCashFlowRecord[] {
  const classified = classifyWealthCashFlows(records, events) as ClassifiedInvestmentInput[];
  const eventsBySource = new Map(events.map((event) => [event.sourceId, event]));
  return classified.map((flow) => classifyInvestmentFlow(flow, eventsBySource));
}

function emptyCashFlowTotal(): CashFlowTotal {
  return { inflowMinor: 0, outflowMinor: 0, netMinor: 0, incomeMinor: 0, expenseMinor: 0, refundMinor: 0, feeMinor: 0 };
}

function addFlowDirection(total: CashFlowTotal, flow: WealthCashFlowRecord): void {
  if (flow.direction === 'inflow') { total.inflowMinor += flow.money.amountMinor; total.netMinor += flow.money.amountMinor; }
  if (flow.direction === 'outflow') { total.outflowMinor += flow.money.amountMinor; total.netMinor -= flow.money.amountMinor; }
}

function addBankCategory(total: CashFlowTotal, kind: TransactionRow['kind'] | undefined, amount: number): void {
  if (kind === 'income') total.incomeMinor += amount;
  if (kind === 'expense') total.expenseMinor += amount;
  if (kind === 'refund') total.refundMinor += amount;
  if (kind === 'fee') total.feeMinor += amount;
}

function addInvestmentCategory(total: CashFlowTotal, kind: InvestmentEventKind | undefined, amount: number): void {
  if (kind === 'dividend') total.incomeMinor += amount;
  if (kind === 'withholding') total.expenseMinor += amount;
  if (kind === 'fee') { total.expenseMinor += amount; total.feeMinor += amount; }
}

export function summarizeInvestmentCashFlows(flows: readonly InvestmentCashFlowRecord[]): Readonly<Record<string, CashFlowTotal>> {
  return summarizeFlowTotals(flows, (total, flow) => addInvestmentCategory(total, flow.eventKind, flow.money.amountMinor));
}

export function summarizeCashFlows(flows: readonly CashFlowSummaryRecord[]): Readonly<Record<string, CashFlowTotal>> {
  return summarizeFlowTotals(flows, (total, flow) => addBankCategory(total, flow.bankKind, flow.money.amountMinor));
}

function summarizeFlowTotals<T extends CashFlowSummaryRecord>(flows: readonly T[], addCategory: (total: CashFlowTotal, flow: T) => void): Readonly<Record<string, CashFlowTotal>> {
  const totals: Record<string, CashFlowTotal> = {};
  for (const flow of flows) {
    if (!summaryEligible(flow)) continue;
    const code = flow.money.currency.toUpperCase();
    const current = totals[code] ?? emptyCashFlowTotal();
    addFlowDirection(current, flow);
    addCategory(current, flow);
    totals[code] = current;
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)));
}

function summaryEligible(flow: CashFlowSummaryRecord): boolean {
  if (flow.classification === 'trade' || flow.classification === 'internal_transfer') return false;
  if (flow.linkConflict || flow.confirmed === false) return false;
  return flow.reason !== 'Conflicting bank records share one explicit wealth link.';
}

export async function cashFlowRecords(db: D1Database, context: FinancialContext, events: readonly WealthEvent[], options: { includeTransfers?: boolean } = {}): Promise<StoredCashFlowRecord[]> {
  const [rows, aliases] = await Promise.all([
    db.prepare(`SELECT t.id,t.account_id,t.merchant,t.date,t.amount_minor,t.currency,t.category,t.kind,t.status,t.source,
      (SELECT a.name FROM accounts a WHERE a.ledger_id=t.ledger_id AND a.id=t.account_id LIMIT 1) AS account_name,
      (SELECT wa.id FROM wealth_accounts wa WHERE wa.ledger_id=t.ledger_id AND wa.linked_bank_account_id=t.account_id ORDER BY wa.id LIMIT 1) AS wealth_account_id,
      (SELECT wa.name FROM wealth_accounts wa WHERE wa.ledger_id=t.ledger_id AND wa.linked_bank_account_id=t.account_id ORDER BY wa.id LIMIT 1) AS wealth_account_name
      FROM transactions t WHERE t.ledger_id=? AND t.status='confirmed' AND ${notSupersededAlertTransactionPredicate('t')} AND (t.kind IN ('income','expense','refund','fee') OR (?=1 AND t.kind='transfer')) ORDER BY t.date,t.id`).bind(context.ledgerId, options.includeTransfers ? 1 : 0).all<TransactionRow>(),
    db.prepare(`SELECT transaction_id,id,identity_key,provider_transaction_id,provider_pending_transaction_id,bank_source_id,bank_row_id,event_id,bank_reference
      FROM transaction_source_records WHERE ledger_id=? ORDER BY transaction_id,id`).bind(context.ledgerId).all<TransactionAliasRow>(),
  ]);
  const aliasesByTransaction = new Map<string, Set<string>>();
  const sourceRecordByTransaction = new Map<string, string>();
  for (const alias of aliases.results) {
    const values = [alias.id, alias.identity_key, alias.provider_transaction_id, alias.provider_pending_transaction_id, alias.bank_source_id, alias.bank_row_id, alias.event_id, alias.bank_reference].filter((value): value is string => Boolean(value));
    const set = aliasesByTransaction.get(alias.transaction_id) ?? new Set<string>();
    values.forEach((value) => set.add(value));
    aliasesByTransaction.set(alias.transaction_id, set);
    sourceRecordByTransaction.set(alias.transaction_id, sourceRecordByTransaction.get(alias.transaction_id) ?? alias.id);
  }
  return rows.results.map((row) => {
    const candidates = new Set([row.id, ...(aliasesByTransaction.get(row.id) ?? [])]);
    const linked = events.filter((event) => event.linkedBankSourceId && candidates.has(event.linkedBankSourceId));
    const linkedSources = [...new Set(linked.map((event) => event.sourceId))];
    const linkConflict = linkedSources.length > 1;
    return { sourceId: sourceRecordByTransaction.get(row.id) ?? row.id, transactionId: row.id, merchant: row.merchant, accountName: row.wealth_account_name ?? row.account_name, date: row.date, accountId: row.wealth_account_id ?? row.account_id, category: row.category, bankKind: row.kind, source: row.source, status: row.status, money: { currency: row.currency, amountMinor: Math.abs(row.amount_minor) }, direction: row.kind === 'income' || row.kind === 'refund' ? 'inflow' : 'outflow', kind: 'bank', linkedWealthSourceId: linkConflict ? null : linkedSources[0] ?? null, ...(linkConflict ? { linkConflict: true } : {}) };
  });
}
