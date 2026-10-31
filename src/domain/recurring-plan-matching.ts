import { addPlanDays, occurrences, parsePlanDate, type RecurringPlan, type PlanTransaction, type AccountFreshness, type OccurrenceStatus, type PlanOccurrence } from './recurring-plans';

function normalizeMerchant(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function matchKey({accountId,currency,direction,amount,merchant}: {accountId:string;currency:string;direction:string;amount:number;merchant:string}): string {
  return JSON.stringify([accountId,currency,direction,amount,normalizeMerchant(merchant)]);
}
function indexTransactions(transactions: readonly PlanTransaction[]): Map<string, PlanTransaction[]> {
  const groups = new Map<string, PlanTransaction[]>();
  for (const transaction of transactions) {
    if (!['confirmed','provisional'].includes(transaction.status)) continue;
    const key = matchKey({accountId:transaction.accountId,currency:transaction.currency,direction:transaction.kind,amount:transaction.amountMinor,merchant:transaction.merchant});
    const group = groups.get(key) ?? []; group.push(transaction); groups.set(key,group);
  }
  for (const group of groups.values()) group.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return groups;
}
function firstAtOrAfter(group: readonly PlanTransaction[], date: string): number {
  let low=0, high=group.length;
  while (low<high) { const middle=Math.floor((low+high)/2); if(group[middle].date<date)low=middle+1;else high=middle; }
  return low;
}
function statusForCandidates(candidates: PlanTransaction[], count: number, usage: Map<string, number>): OccurrenceStatus | null {
  if (count > 1 || candidates.some(candidate => (usage.get(candidate.id) ?? 0) > 1)) return 'ambiguous';
  if (candidates.length === 1) return candidates[0].status === 'confirmed' ? 'matched' : 'pending';
  return null;
}
function unmatchedStatus(date: string, today: string, source: AccountFreshness | undefined): OccurrenceStatus {
  const windowEnd = addPlanDays(date, 7);
  if (today <= windowEnd) return 'expected';
  if (!source?.assessable || !source.lastSuccessfulDate) return 'not_assessable';
  return source.lastSuccessfulDate > windowEnd ? 'potentially_missing' : 'not_assessable';
}
function occurrenceResult({plan,date,candidates,count,status}:{plan:RecurringPlan;date:string;candidates:PlanTransaction[];count:number;status:OccurrenceStatus}): PlanOccurrence {
  return { planId: plan.id, date, status, candidateIds: candidates.map(candidate => candidate.id).sort(), candidateCount: count, candidateDetails: candidates.map(({id,date,merchant,amountMinor,currency,status}) => ({id,date,merchant,amountMinor,currency,status})) };
}
export function assessOccurrences({plans,transactions,freshness,today,from,to}: {plans:readonly RecurringPlan[];transactions:readonly PlanTransaction[];freshness:Readonly<Record<string, AccountFreshness>>;today:string;from:string;to:string}): PlanOccurrence[] {
  parsePlanDate(today);
  const expandedFrom = addPlanDays(from, -14), expandedTo = addPlanDays(to, 14);
  const usage = new Map<string, number>(), groups = indexTransactions(transactions);
  let work = 0;
  const rows = plans.flatMap(plan => occurrences(plan, expandedFrom, expandedTo).map(date => {
    const candidates: PlanTransaction[] = [];
    let count = 0;
    const amount = plan.direction === 'expense' ? -plan.amountMinor : plan.amountMinor;
    const group = groups.get(matchKey({accountId:plan.accountId,currency:plan.currency,direction:plan.direction,amount,merchant:plan.merchant})) ?? [];
    const fromDate = addPlanDays(date,-7), toDate = addPlanDays(date,7);
    for (let i=firstAtOrAfter(group,fromDate); i<group.length && group[i].date<=toDate; i++) {
      const transaction = group[i];
      if (++work > 100000) throw new RangeError('Too many recurring matches; narrow the date range.');
      count++;
      if (candidates.length < 2) candidates.push(transaction);
      usage.set(transaction.id, (usage.get(transaction.id) ?? 0) + 1);
    }
    return { plan, date, candidates, count };
  }));
  return rows.filter(row => row.date >= from && row.date <= to).map(({ plan, date, candidates, count }) => {
    const status = statusForCandidates(candidates, count, usage) ?? unmatchedStatus(date, today, freshness[plan.accountId]);
    return occurrenceResult({plan, date, candidates, count, status});
  });
}
