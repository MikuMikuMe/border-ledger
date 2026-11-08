export function manualMatchPredicate(manual='m', bank='b') {
  return `${manual}.ledger_id=${bank}.ledger_id AND ${manual}.account_id=${bank}.account_id AND ${manual}.currency=${bank}.currency
    AND ${manual}.kind=${bank}.kind AND ${manual}.amount_minor=${bank}.amount_minor AND ABS(julianday(${manual}.date)-julianday(${bank}.date))<=3
    AND ${manual}.source='manual' AND ${bank}.source IN ('statement','plaid','lunchflow') AND ${bank}.status='confirmed'`;
}
