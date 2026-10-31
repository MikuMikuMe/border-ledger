import {describeFxRate} from './budget-fx';
import {convertMinorUnits,type ValidatedFxRates} from './fx-rates';
export interface BudgetActivity {id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null}
export interface TransactionRow {id:string;date:string;category:string;currency:string;amount_minor:number;kind:'expense'|'refund'|'fee';lock_date:string}
function signedActivity(row:TransactionRow) {
  const amount=Math.abs(row.amount_minor);
  if (!Number.isSafeInteger(amount)) throw new RangeError('Invalid transaction amount');
  return row.kind==='refund' ? amount : -amount;
}
export function describeActivity(row:TransactionRow,currency:string,rates:Map<string,ValidatedFxRates|null>):BudgetActivity {
  const snapshot=rates.get(row.lock_date)??null;
  const activityMinor=row.currency===currency || snapshot ? convertMinorUnits({amountMinorUnits:signedActivity(row),sourceCurrency:row.currency,targetCurrency:currency,...(snapshot?{rates:snapshot}:{})}) : null;
  return {id:row.id,date:row.date,category:row.category,sourceCurrency:row.currency,sourceMinor:row.amount_minor,activityMinor,rateDate:row.currency===currency?null:snapshot?.effectiveDate??null,rate:snapshot?describeFxRate(row.currency,currency,snapshot):null};
}
