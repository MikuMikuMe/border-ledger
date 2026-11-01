import type { D1Database } from './db-types';
import { financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import { getCurrencyMeta } from '../src/domain/currencies';

export interface BudgetTarget { category:string; targetMinor:number }
export interface ManualCash { id:string; name:string; currency:string; amountMinor:number; accountId?:string }
function validText(value:string, max:number): boolean {
  return value === value.trim() && value.length > 0 && value.length <= max;
}
function validateText(value:unknown, max:number) {
  if (typeof value !== 'string') throw new RangeError('Invalid text');
  if (!validText(value,max)) throw new RangeError('Invalid text');
}
function validateAmount(value:number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid amount');
}
export async function listBudgetTargets(db:D1Database, context:FinancialContext) {
  return (await db.prepare('SELECT category,target_minor AS targetMinor FROM budget_targets WHERE ledger_id=? ORDER BY category').bind(context.ledgerId).all<BudgetTarget>()).results;
}
export async function listManualCash(db:D1Database, context:FinancialContext) {
  const rows=(await db.prepare('SELECT id,name,currency,amount_minor AS amountMinor,account_id AS accountId FROM budget_manual_cash WHERE ledger_id=? ORDER BY id').bind(context.ledgerId).all<ManualCash & {accountId:string|null}>()).results;
  return rows.map(row=>row.accountId ? row : {id:row.id,name:row.name,currency:row.currency,amountMinor:row.amountMinor});
}
export async function saveBudgetTarget(db:D1Database, context:FinancialContext, target:BudgetTarget) {
  validateText(target.category,120); validateAmount(target.targetMinor);
  const a=financialAuthorityPredicate(context,'preferences:write');
  const result=await db.prepare(`INSERT INTO budget_targets(ledger_id,category,target_minor) SELECT ?,?,? WHERE ${a.sql}
    ON CONFLICT(ledger_id,category) DO UPDATE SET target_minor=excluded.target_minor WHERE ${a.sql}`).bind(context.ledgerId,target.category,target.targetMinor,...a.bindings,...a.bindings).run();
  if(result.meta?.changes!==1) throw new Error('Budget authority invalid');
}
export async function saveManualCash(db:D1Database, context:FinancialContext, cash:ManualCash) {
  validateText(cash.id,128); validateText(cash.name,120); validateAmount(cash.amountMinor);
  if(cash.accountId!==undefined) validateText(cash.accountId,256);
  if (!getCurrencyMeta(cash.currency)) throw new RangeError('Invalid currency');
  const a=financialAuthorityPredicate(context,'preferences:write');
  const result=await db.prepare(`INSERT INTO budget_manual_cash(ledger_id,id,name,currency,amount_minor,account_id) SELECT ?,?,?,?,?,? WHERE ${a.sql}
    ON CONFLICT(ledger_id,id) DO UPDATE SET name=excluded.name,currency=excluded.currency,amount_minor=excluded.amount_minor,account_id=excluded.account_id WHERE ${a.sql}`)
    .bind(context.ledgerId,cash.id,cash.name,cash.currency,cash.amountMinor,cash.accountId??null,...a.bindings,...a.bindings).run();
  if(result.meta?.changes!==1) throw new Error('Budget authority invalid');
}



export async function deleteManualCash(db:D1Database,context:FinancialContext,id:string) {
  validateText(id,128);
  const authority=financialAuthorityPredicate(context,'preferences:write');
  await db.prepare(`DELETE FROM budget_manual_cash WHERE ledger_id=? AND id=? AND ${authority.sql}`).bind(context.ledgerId,id,...authority.bindings).run();
}
