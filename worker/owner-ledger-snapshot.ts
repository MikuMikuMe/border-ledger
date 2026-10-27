import type { LedgerContext } from './tenant-context';
import type { D1Database } from './db-types';
import { notSupersededAlertTransactionPredicate, readLedgerReport, type LedgerReport } from './ledger-reports';

export interface OwnerLedgerSnapshot {
  schemaVersion: 1;
  snapshotAt: string;
  timeZone: string;
  accounts: Array<{
    id: string;
    displayName: string;
    institution: string | null;
    instrument: string | null;
    currencies: string[];
    lastSuccessfulSyncAt: string | null;
  }>;
  transactions: Array<{
    id: string;
    occurredAt: string;
    currency: string;
    signedMinorUnits: number;
    merchant: string | null;
    accountLabel: string | null;
    status: string;
    sourceLabel: string | null;
    category: string | null;
    note: string | null;
  }>;
  recurring: Array<{
    id: string;
    label: string;
    currency: string;
    monthlyMinorUnits: number | null;
    classification: string | null;
    nextDueAt: string | null;
  }>;
  reviews: Array<{
    id: string;
    reason: string;
    currency: string | null;
    affectedMinorUnits: number | null;
    candidateLabel: string | null;
    status: string;
  }>;
  report: LedgerReport;
}

interface PreferenceRow {
  reporting_timezone: string;
}

interface AccountRow {
  id: string;
  name: string;
  institution: string;
  kind: string;
  currency: string;
  status: string;
  last_synced_at: string | null;
  account_currency: string | null;
}

interface TransactionRow {
  id: string;
  date: string;
  amount_minor: number;
  currency: string;
  merchant: string;
  account_name: string | null;
  status: string;
  source: string;
  category: string | null;
  note: string | null;
  kind: string;
}

interface RecurringRow {
  id: string;
  merchant_name: string | null;
  currency: string;
  predicted_amount_minor: number | null;
  average_amount_minor: number | null;
  predicted_next_date: string | null;
  classification: string | null;
}

interface ReviewRow {
  id: string;
  reason: string;
  currency: string | null;
  amount_minor: number | null;
  merchant: string | null;
  status: string;
}

const MAX_SNAPSHOT_ACCOUNTS = 500;
const MAX_ACCOUNT_CURRENCIES = 16;

function signedAmount(amount: number, kind: string) {
  return kind === 'refund' ? -Math.abs(amount) : Math.abs(amount);
}

/** Owner-only, bounded render snapshot. Reports are aggregated separately so
 * a five-thousand-row Activity payload cannot truncate Overview totals. */
export async function readOwnerLedgerSnapshot(db: D1Database, context: LedgerContext): Promise<OwnerLedgerSnapshot> {
  const preference = await db.prepare("SELECT reporting_timezone FROM ledger_preferences WHERE ledger_id = ?").bind(context.ledgerId).first<PreferenceRow>();
  const timeZone = preference?.reporting_timezone || 'America/Toronto';
  const visibleTransactionPredicate = notSupersededAlertTransactionPredicate('t');
  const [accountRows, transactionRows, recurringRows, reviewRows, report] = await Promise.all([
    db.prepare(`WITH bounded_accounts AS (
        SELECT id, ledger_id, name, institution, kind, currency, status, last_synced_at
        FROM accounts WHERE ledger_id = ?
        ORDER BY institution, name, id
        LIMIT ${MAX_SNAPSHOT_ACCOUNTS}
      )
      SELECT a.id, a.name, a.institution, a.kind, a.currency, a.status, a.last_synced_at, ac.currency AS account_currency
      FROM bounded_accounts a LEFT JOIN account_currencies ac ON ac.account_id = a.id AND ac.ledger_id = a.ledger_id
      ORDER BY a.institution, a.name, a.id, ac.currency`).bind(context.ledgerId).all<AccountRow>(),
    db.prepare(`SELECT t.id, t.date, t.amount_minor, t.currency, t.merchant, a.name AS account_name, t.status, t.source, t.category, t.note, t.kind
      FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.ledger_id = t.ledger_id
      WHERE t.ledger_id = ? AND ${visibleTransactionPredicate}
      ORDER BY t.date DESC, t.created_at DESC LIMIT 5000`).bind(context.ledgerId).all<TransactionRow>(),
    db.prepare(`SELECT rs.id, rs.merchant_name, rs.currency, rs.predicted_amount_minor, rs.average_amount_minor,
        rs.predicted_next_date, rc.classification
      FROM recurring_streams rs LEFT JOIN recurring_classifications rc ON rc.recurring_stream_id = rs.id AND rc.ledger_id = rs.ledger_id
      WHERE rs.ledger_id = ? AND rs.present_in_latest_snapshot = 1 ORDER BY rs.predicted_next_date, rs.id LIMIT 1000`).bind(context.ledgerId).all<RecurringRow>(),
    db.prepare(`SELECT id, 'needs_review' AS reason, currency, amount_minor, merchant, status
      FROM transactions t WHERE t.ledger_id = ? AND ${visibleTransactionPredicate} AND t.status = 'needs_review'
      ORDER BY t.date DESC, t.created_at DESC LIMIT 1000`).bind(context.ledgerId).all<ReviewRow>(),
    readLedgerReport(db, context, { timeZone }),
  ]);

  const accountMap = new Map<string, OwnerLedgerSnapshot['accounts'][number]>();
  for (const row of accountRows.results ?? []) {
    const account = accountMap.get(row.id) ?? {
      id: row.id,
      displayName: row.name,
      institution: row.institution,
      instrument: row.kind,
      currencies: [],
      lastSuccessfulSyncAt: row.last_synced_at,
    };
    const currency = row.account_currency ?? row.currency;
    if (currency && !account.currencies.includes(currency) && account.currencies.length < MAX_ACCOUNT_CURRENCIES) account.currencies.push(currency);
    accountMap.set(row.id, account);
  }

  return {
    schemaVersion: 1,
    snapshotAt: report.asOf,
    timeZone,
    accounts: [...accountMap.values()],
    transactions: (transactionRows.results ?? []).map((row) => ({
      id: row.id,
      occurredAt: row.date,
      currency: row.currency,
      signedMinorUnits: signedAmount(row.amount_minor, row.kind),
      merchant: row.merchant,
      accountLabel: row.account_name,
      status: row.status,
      sourceLabel: row.source,
      category: row.category,
      note: row.note,
    })),
    recurring: (recurringRows.results ?? []).map((row) => ({
      id: row.id,
      label: row.merchant_name ?? 'Merchant unavailable',
      currency: row.currency,
      monthlyMinorUnits: row.predicted_amount_minor ?? row.average_amount_minor,
      classification: row.classification,
      nextDueAt: row.predicted_next_date,
    })),
    reviews: (reviewRows.results ?? []).map((row) => ({
      id: row.id,
      reason: row.reason,
      currency: row.currency,
      affectedMinorUnits: row.amount_minor === null ? null : Math.abs(row.amount_minor),
      candidateLabel: row.merchant,
      status: row.status,
    })),
    report,
  };
}
