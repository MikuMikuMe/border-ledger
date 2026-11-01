import type { D1Database } from './db-types';
import { financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import { getCurrencyMeta } from '../src/domain/currencies';

export interface BudgetAllocation {month:string; category:string; assignedMinor:number}

export async function readBudgetSettings(db:D1Database, context:FinancialContext) {
  return db.prepare('SELECT currency,start_month AS startMonth FROM budget_settings WHERE ledger_id=?').bind(context.ledgerId).first<{currency:string;startMonth:string}>();
}
export async function readBudgetAllocations(db:D1Database, context:FinancialContext) {
  const result = await db.prepare('SELECT month,category,assigned_minor AS assignedMinor FROM budget_allocations WHERE ledger_id=? ORDER BY month,category').bind(context.ledgerId).all<BudgetAllocation>();
  return result.results;
}
function budgetStart(requested:string|undefined,existing:string|undefined):string {
  return requested??existing??new Date().toISOString().slice(0,7);
}
function validateSettings(currency:string,startMonth:string):void {
  if (!getCurrencyMeta(currency)) throw new RangeError('Invalid budget currency');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new RangeError('Invalid budget start month');
}
export async function configureBudget(db:D1Database, context:FinancialContext, currency:string, requestedStart?:string) {
  const existing=await readBudgetSettings(db,context);
  const startMonth=budgetStart(requestedStart,existing?.startMonth);
  validateSettings(currency,startMonth);
  const authority = financialAuthorityPredicate(context, 'preferences:write');
  const result = await db.prepare(`INSERT INTO budget_settings(ledger_id,currency,start_month) SELECT ?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id) DO UPDATE SET currency=excluded.currency,start_month=excluded.start_month,revision=budget_settings.revision+1 WHERE ${authority.sql}`)
    .bind(context.ledgerId,currency,startMonth,...authority.bindings,...authority.bindings).run();
  if (result.meta?.changes !== 1) throw new Error('Budget authority invalid');
}
function validCategory(value:unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() !== value) return false;
  return value.length > 0 && value.length <= 120;
}
export function validateAllocation(input:BudgetAllocation) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new RangeError('Invalid budget month');
  if (!validCategory(input.category)) throw new RangeError('Invalid category');
  if (!Number.isSafeInteger(input.assignedMinor)) throw new RangeError('Invalid allocation');
}
export async function setBudgetAllocation(db:D1Database, context:FinancialContext, input:BudgetAllocation) {
  validateAllocation(input);
  const settings=await readBudgetSettings(db,context);
  if (!settings || input.month<settings.startMonth) throw new RangeError('Assignment precedes the budget start');
  const authority = financialAuthorityPredicate(context, 'preferences:write');
  const result = await db.prepare(`INSERT INTO budget_allocations(ledger_id,month,category,assigned_minor) SELECT ?,?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,month,category) DO UPDATE SET assigned_minor=excluded.assigned_minor WHERE ${authority.sql}`)
    .bind(context.ledgerId,input.month,input.category,input.assignedMinor,...authority.bindings,...authority.bindings).run();
  if (result.meta?.changes !== 1) throw new Error('Budget authority invalid');
}
