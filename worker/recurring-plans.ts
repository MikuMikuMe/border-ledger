import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';
import type { RecurringPlan, PlanFrequency } from '../src/domain/recurring-plans';
import { normalizePlan } from './recurring-plan-validation';

export class PlanConflictError extends Error { constructor(message: string, readonly currentRevision?: number) { super(message); } }
export type PlanInput = Omit<RecurringPlan, 'id' | 'revision' | 'enabled'>;
interface PlanRow { id: string; account_id: string; currency: string; merchant: string; direction: 'expense'|'income'; amount_minor: number; frequency: PlanFrequency; start_date: string; end_date: string|null; enabled: number; revision: number; initial_payload: string }
function map(row: PlanRow): RecurringPlan {
  return { id: row.id, accountId: row.account_id, currency: row.currency, merchant: row.merchant, direction: row.direction, amountMinor: row.amount_minor, frequency: row.frequency, startDate: row.start_date, endDate: row.end_date, enabled: row.enabled === 1, revision: row.revision };
}
async function validateAccount(db: D1Database, context: LedgerContext, input: PlanInput) {
  const account = await db.prepare(`SELECT 1 AS valid FROM accounts a WHERE a.id=? AND a.ledger_id=? AND
    (a.currency=? OR EXISTS (SELECT 1 FROM account_currencies c WHERE c.ledger_id=a.ledger_id AND c.account_id=a.id AND c.currency=?))`)
    .bind(input.accountId,context.ledgerId,input.currency,input.currency).first();
  if (!account) throw new RangeError('Invalid account or currency');
}
export async function listPlans(db: D1Database, context: LedgerContext): Promise<RecurringPlan[]> {
  const rows = await db.prepare('SELECT * FROM recurring_plans WHERE ledger_id=? ORDER BY id LIMIT 201').bind(context.ledgerId).all<PlanRow>();
  if (rows.results.length > 200) throw new Error('Too many recurring plans');
  return rows.results.map(map);
}
export async function createPlan(db: D1Database, context: LedgerContext, operationId: string, value: PlanInput): Promise<RecurringPlan> {
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) throw new RangeError('Invalid operation id');
  const input = normalizePlan(value), payload = JSON.stringify(input), id = crypto.randomUUID();
  await validateAccount(db, context, input);
  await db.prepare(`INSERT INTO recurring_plans(id,ledger_id,account_id,currency,merchant,direction,amount_minor,frequency,start_date,end_date,operation_id,initial_payload)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM recurring_plans WHERE ledger_id=?) < 200 OR EXISTS (SELECT 1 FROM recurring_plans WHERE ledger_id=? AND operation_id=?) ON CONFLICT(ledger_id,operation_id) DO NOTHING`).bind(id, context.ledgerId, input.accountId, input.currency, input.merchant, input.direction, input.amountMinor, input.frequency, input.startDate, input.endDate, operationId, payload, context.ledgerId, context.ledgerId, operationId).run();
  const row = await db.prepare('SELECT * FROM recurring_plans WHERE ledger_id=? AND operation_id=?').bind(context.ledgerId, operationId).first<PlanRow>();
  if (!row) throw new RangeError('Recurring plan limit reached');
  if (row.initial_payload !== payload) throw new PlanConflictError('Operation id conflict');
  return map(row);
}
async function throwPlanConflict(db: D1Database, context: LedgerContext, id: string): Promise<never> {
  const current = await db.prepare('SELECT revision FROM recurring_plans WHERE ledger_id=? AND id=?').bind(context.ledgerId,id).first<{revision:number}>();
  throw new PlanConflictError('Plan not found or revision conflict', current?.revision);
}
function validateUpdate(request: {revision:number;value:PlanInput & {enabled:boolean}}) {
  if (!Number.isSafeInteger(request.revision) || request.revision < 0) throw new RangeError('Invalid revision');
  if (typeof request.value.enabled !== 'boolean') throw new RangeError('Invalid enabled state');
}
async function requirePlan(db: D1Database, context: LedgerContext, id: string): Promise<RecurringPlan> {
  const row = await db.prepare('SELECT * FROM recurring_plans WHERE ledger_id=? AND id=?').bind(context.ledgerId,id).first<PlanRow>();
  if (!row) throw new Error('Plan not found');
  return map(row);
}
export async function updatePlan(db: D1Database, context: LedgerContext, request: {id:string;revision:number;value:PlanInput & {enabled:boolean}}): Promise<RecurringPlan> {
  const {id,revision,value} = request;
  validateUpdate(request);
  const input = normalizePlan(value);
  await validateAccount(db, context, input);
  const result = await db.prepare(`UPDATE recurring_plans SET account_id=?,currency=?,merchant=?,direction=?,amount_minor=?,frequency=?,start_date=?,end_date=?,enabled=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE ledger_id=? AND id=? AND revision=?`).bind(input.accountId,input.currency,input.merchant,input.direction,input.amountMinor,input.frequency,input.startDate,input.endDate,value.enabled ? 1 : 0,context.ledgerId,id,revision).run();
  if (result.meta?.changes !== 1) await throwPlanConflict(db,context,id);
  return requirePlan(db, context, id);
}
