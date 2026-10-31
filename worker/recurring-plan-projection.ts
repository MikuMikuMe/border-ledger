import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';
import { assessOccurrences } from '../src/domain/recurring-plan-matching';
import type { PlanTransaction, AccountFreshness } from '../src/domain/recurring-plans';
import { listPlans } from './recurring-plans';
import { validDate } from './recurring-plan-validation';

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function localDate(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => parts.find(entry => entry.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
type ProjectionQuery = { from: string; to: string; today: string; now?: Date };
function validateProjection({from, to, today}: ProjectionQuery) {
  if (![from, to, today].every(validDate)) throw new RangeError('Invalid projection dates');
  const range = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (range < 0 || range > 120) throw new RangeError('Invalid projection range');
}
async function projectionTransactions(db: D1Database, context: LedgerContext, query: ProjectionQuery) {
  const rows = await db.prepare(`SELECT id,account_id AS accountId,currency,merchant,kind,amount_minor AS amountMinor,status,date FROM transactions
    WHERE ledger_id=? AND date>=? AND date<=? AND status IN ('confirmed','provisional') AND kind IN ('expense','income') LIMIT 10001`).bind(context.ledgerId,shiftDate(query.from,-21),shiftDate(query.to,21)).all<PlanTransaction>();
  if (rows.results.length > 10000) throw new Error('Too many transactions for this range');
  return rows.results;
}
function syncIsRecent(value: string | null, now: Date): boolean {
  if (!value) return false;
  const age = now.getTime() - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= 86400000;
}
type LunchFlowSource = {account_id:string;enabled:number;last_synced_at:string|null;last_error:string|null;connection_error:string|null;lifecycle:string;operation_id:string|null;pending:number;tracked:number};
function lunchFlowIsAssessable(source: LunchFlowSource, now: Date): boolean {
  if (source.enabled !== 1) return false;
  if (source.lifecycle !== 'connected') return false;
  if (source.operation_id) return false;
  if (!source.tracked) return false;
  if (source.pending) return false;
  if (source.last_error) return false;
  if (source.connection_error) return false;
  return syncIsRecent(source.last_synced_at, now);
}
async function lunchFlowFreshness(db: D1Database, context: LedgerContext, now: Date, timeZone: string): Promise<Record<string, AccountFreshness>> {
  const sources = await db.prepare(`SELECT a.account_id,a.enabled,a.last_synced_at,a.last_error,c.last_error AS connection_error,c.lifecycle,c.operation_id,EXISTS (SELECT 1 FROM recurring_lunchflow_sync_jobs j WHERE j.ledger_id=a.ledger_id AND j.connection_id=a.connection_id AND j.connection_generation=c.generation AND j.provider_account_id=a.provider_account_id AND j.account_revision=a.revision AND j.state='pending') AS pending,EXISTS (SELECT 1 FROM recurring_lunchflow_sync_jobs j WHERE j.ledger_id=a.ledger_id AND j.connection_id=a.connection_id AND j.connection_generation=c.generation AND j.provider_account_id=a.provider_account_id AND j.account_revision=a.revision AND j.state='completed') AS tracked FROM lunchflow_accounts a
    JOIN lunchflow_connections c ON c.id=a.connection_id AND c.ledger_id=a.ledger_id WHERE a.ledger_id=?`).bind(context.ledgerId).all<LunchFlowSource>();
  const freshness: Record<string, AccountFreshness> = {};
  for (const source of sources.results) if (source.account_id) freshness[source.account_id] = {
    assessable: lunchFlowIsAssessable(source, now),
    lastSuccessfulDate: source.last_synced_at ? localDate(source.last_synced_at, timeZone) : null,
  };
  return freshness;
}
async function addPlaidFreshness(db: D1Database, context: LedgerContext, details: {now:Date;timeZone:string;freshness:Record<string, AccountFreshness>}): Promise<void> {
  const {now,timeZone,freshness} = details;
  const plaid = await db.prepare(`SELECT p.account_id,s.lifecycle,s.last_success_at,s.last_error,s.requested_generation,s.completed_generation,a.status FROM plaid_accounts p
    JOIN sync_state s ON s.connection_id='plaid:'||p.item_id AND s.ledger_id=p.ledger_id
    JOIN accounts a ON a.id=p.account_id AND a.ledger_id=p.ledger_id WHERE p.ledger_id=?`).bind(context.ledgerId).all<{account_id:string;lifecycle:string;last_success_at:string|null;last_error:string|null;requested_generation:number;completed_generation:number;status:string}>();
  for (const source of plaid.results) {
    if (freshness[source.account_id]) { freshness[source.account_id] = {assessable:false,lastSuccessfulDate:null}; continue; }
    freshness[source.account_id] = {
      assessable: source.lifecycle === 'active' && source.status === 'connected' && !source.last_error && source.requested_generation === source.completed_generation && syncIsRecent(source.last_success_at, now),
      lastSuccessfulDate: source.last_success_at ? localDate(source.last_success_at,timeZone) : null,
    };
  }
}
async function projectionFreshness(db: D1Database, context: LedgerContext, now: Date): Promise<Record<string, AccountFreshness>> {
  const preference = await db.prepare('SELECT reporting_timezone FROM ledger_preferences WHERE ledger_id=?').bind(context.ledgerId).first<{reporting_timezone:string}>();
  const timeZone = preference?.reporting_timezone ?? 'America/Toronto';
  const freshness = await lunchFlowFreshness(db, context, now, timeZone);
  await addPlaidFreshness(db, context, {now, timeZone, freshness});
  return freshness;
}
export async function readPlanOccurrences(db: D1Database, context: LedgerContext, query: ProjectionQuery) {
  validateProjection(query);
  const [plans, transactions, freshness] = await Promise.all([listPlans(db, context), projectionTransactions(db, context, query), projectionFreshness(db, context, query.now ?? new Date())]);
  return assessOccurrences({plans, transactions, freshness, today:query.today, from:query.from, to:query.to});
}
