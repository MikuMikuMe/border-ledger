import {describeFxRate} from './budget-fx';
import type {D1Database} from './db-types';
import type {LedgerContext} from './tenant-context';
import {notSupersededAlertTransactionPredicate,warmFxSnapshot} from './ledger-reports';
import {convertMinorUnits,isFxProviderError,isSupportedFxDate,type ValidatedFxRates} from './fx-rates';
import {getCurrencyMeta} from '../src/domain/currencies';

export interface BudgetActivity {id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null}
interface TransactionRow {id:string;date:string;category:string;currency:string;amount_minor:number;kind:'expense'|'refund'|'fee';lock_date:string}
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
function signedActivity(row:TransactionRow) {
  const amount=Math.abs(row.amount_minor);
  if (!Number.isSafeInteger(amount)) throw new RangeError('Invalid transaction amount');
  return row.kind==='refund' ? amount : -amount;
}
export async function readBudgetActivity(db:D1Database,context:LedgerContext,query:ActivityQuery,dependencies:ActivityDependencies={}):Promise<BudgetActivity[]> {
  validateQuery(query);
  const result=await db.prepare(`SELECT t.id,t.date,t.category,t.currency,t.amount_minor,t.kind,COALESCE(t.fx_lock_date,t.date) AS lock_date
    FROM transactions t WHERE t.ledger_id=? AND t.date>=? AND t.date<=? AND t.status='confirmed'
    AND t.kind IN ('expense','refund','fee') AND ${notSupersededAlertTransactionPredicate('t')} ORDER BY t.date,t.id LIMIT 10001`)
    .bind(context.ledgerId,query.from,query.to).all<TransactionRow>();
  if (result.results.length>10000) throw new RangeError('Too many budget transactions');
  const rates=new Map<string,ValidatedFxRates|null>();
  for(const row of result.results) if(row.currency!==query.currency && !rates.has(row.lock_date)) rates.set(row.lock_date,await getRate(db,row.lock_date,dependencies));
  return result.results.map(row=>{
    const snapshot=rates.get(row.lock_date)??null;
    const activityMinor=row.currency===query.currency || snapshot ? convertMinorUnits({amountMinorUnits:signedActivity(row),sourceCurrency:row.currency,targetCurrency:query.currency,...(snapshot?{rates:snapshot}:{})}) : null;
    return {id:row.id,date:row.date,category:row.category,sourceCurrency:row.currency,sourceMinor:row.amount_minor,activityMinor,rateDate:row.currency===query.currency?null:snapshot?.effectiveDate??null,rate:snapshot?describeFxRate(row.currency,query.currency,snapshot):null};
  });
}
