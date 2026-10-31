import type {D1Database} from './db-types';
import {assertFinancialAuthority,type FinancialContext} from './financial-authority';
import {notSupersededAlertTransactionPredicate} from './ledger-reports';
interface SummaryPeriod {from:string;to:string;detail:boolean;includeTransfers?:boolean}
interface SummaryTransaction {date:string;merchant:string;category:string;currency:string;kind:string;amountMinor:number;account:string;note:string|null;source:string}
interface SummaryGroup {category:string;currency:string;kind:string;amountMinor:number;count:number}
function validateDate(value:string):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Invalid analysis period');
  const date=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new RangeError('Invalid analysis period');
  return date.getTime();
}
function validatePeriod(period:SummaryPeriod) {
  const from=validateDate(period.from),to=validateDate(period.to);
  if(to<from || to-from>366*86400000) throw new RangeError('Analysis period must be no longer than one year');
  if(typeof period.detail!=='boolean') throw new RangeError('Invalid detail level');
}
function groupTransactions(rows:SummaryTransaction[]):SummaryGroup[] {
  const groups=new Map<string,SummaryGroup>();
  for(const row of rows) {
    const key=JSON.stringify([row.category,row.currency,row.kind]);
    const current=groups.get(key)??{category:row.category,currency:row.currency,kind:row.kind,amountMinor:0,count:0};
    current.amountMinor+=row.amountMinor;current.count++;
    if(!Number.isSafeInteger(current.amountMinor)) throw new RangeError('Analysis amount exceeds safe range');
    groups.set(key,current);
  }
  return [...groups.values()];
}
export async function readAiLedgerSummary(db:D1Database,context:FinancialContext,period:SummaryPeriod) {
  validatePeriod(period);
  await assertFinancialAuthority(db,context,'ledger:read');
  const rows=await db.prepare(`SELECT t.date,t.merchant,t.category,t.currency,t.kind,t.amount_minor AS amountMinor,a.name AS account,t.note,t.source FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.ledger_id=t.ledger_id
    WHERE t.ledger_id=? AND t.date>=? AND t.date<=? AND t.status='confirmed' AND (?=1 OR t.kind<>'transfer')
    AND ${notSupersededAlertTransactionPredicate('t')} ORDER BY t.date,t.id LIMIT 3001`)
    .bind(context.ledgerId,period.from,period.to,period.includeTransfers?1:0).all<SummaryTransaction>();
  if(rows.results.length>3000) throw new RangeError('Too many transactions for analysis');
  return {from:period.from,to:period.to,groups:groupTransactions(rows.results),...(period.detail?{transactions:rows.results}:{})};
}
