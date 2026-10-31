import {describeActivity,type BudgetActivity,type TransactionRow} from './budget-activity-convert';
export type {BudgetActivity} from './budget-activity-convert';
import type {D1Database} from './db-types';
import type {LedgerContext} from './tenant-context';
import {notSupersededAlertTransactionPredicate,warmFxSnapshot} from './ledger-reports';
import {isFxProviderError,isSupportedFxDate,type ValidatedFxRates} from './fx-rates';
import {getCurrencyMeta} from '../src/domain/currencies';

interface ActivityQuery {from:string;to:string;currency:string}
interface ActivityDependencies {fetcher?:typeof fetch;now?:()=>Date}
function validDate(value:string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function validateDates(query:ActivityQuery) {
  if (!validDate(query.from)) throw new RangeError('Invalid date range');
  if (!validDate(query.to)) throw new RangeError('Invalid date range');
  if (query.from>query.to) throw new RangeError('Invalid date range');
}
function validateQuery(query:ActivityQuery) {
  validateDates(query);
  if (!getCurrencyMeta(query.currency)) throw new RangeError('Invalid budget currency');
}
async function getRate(db:D1Database,date:string,dependencies:ActivityDependencies):Promise<ValidatedFxRates|null> {
  if (!isSupportedFxDate(date)) return null;
  try { return await warmFxSnapshot(db,date,dependencies); }
  catch(error) { if (isFxProviderError(error)) return null; throw error; }
}
async function activityRates(db:D1Database,rows:TransactionRow[],currency:string,dependencies:ActivityDependencies) {
  const rates=new Map<string,ValidatedFxRates|null>();
  for(const row of rows) if(row.currency!==currency && !rates.has(row.lock_date)) rates.set(row.lock_date,await getRate(db,row.lock_date,dependencies));
  return rates;
}
export async function readBudgetActivity(db:D1Database,context:LedgerContext,query:ActivityQuery,dependencies:ActivityDependencies={}):Promise<BudgetActivity[]> {
  validateQuery(query);
  const result=await db.prepare(`SELECT t.id,t.date,t.category,t.currency,t.amount_minor,t.kind,COALESCE(t.fx_lock_date,t.date) AS lock_date
    FROM transactions t WHERE t.ledger_id=? AND t.date>=? AND t.date<=? AND t.status='confirmed'
    AND t.kind IN ('expense','refund','fee') AND ${notSupersededAlertTransactionPredicate('t')} ORDER BY t.date,t.id LIMIT 10001`)
    .bind(context.ledgerId,query.from,query.to).all<TransactionRow>();
  if (result.results.length>10000) throw new RangeError('Too many budget transactions');
  const rates=await activityRates(db,result.results,query.currency,dependencies);
  return result.results.map(row=>describeActivity(row,query.currency,rates));
}
