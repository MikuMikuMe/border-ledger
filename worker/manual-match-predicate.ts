import type { D1Database } from './db-types';

export function manualMatchPredicate(manual='m', bank='b') {
  return `${manual}.ledger_id=${bank}.ledger_id AND ${manual}.account_id=${bank}.account_id AND ${manual}.currency=${bank}.currency
    AND ${manual}.kind=${bank}.kind AND ${manual}.amount_minor=${bank}.amount_minor AND ABS(julianday(${manual}.date)-julianday(${bank}.date))<=3
    AND ${manual}.source='manual' AND ${bank}.source IN ('statement','plaid','lunchflow') AND ${bank}.status='confirmed'`;
}

export async function readConfirmedManualMatches(db:D1Database,ledgerId:string,ids?:readonly string[]) {
  if(ids && ids.length===0)return [];
  const placeholders=ids?.map(()=>'?').join(',');
  const filter=ids ? `AND (m.id IN (${placeholders}) OR b.id IN (${placeholders}))` : '';
  const result=await db.prepare(`SELECT m.id AS manual_id,b.id AS bank_id FROM manual_transaction_matches d
    JOIN transactions m ON m.ledger_id=d.ledger_id AND m.id=d.manual_id
    JOIN transactions b ON b.ledger_id=d.ledger_id AND b.id=d.bank_id
    WHERE d.ledger_id=? AND d.decision='confirmed' AND ${manualMatchPredicate('m','b')} ${filter}`)
    .bind(ledgerId,...(ids??[]),...(ids??[])).all<{manual_id:string;bank_id:string}>();
  return result.results;
}
