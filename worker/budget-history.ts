import {suggestFundingFromHistory} from '../src/domain/budget-suggestions';
import type {BudgetCategorySummary} from '../src/domain/budget-summary';
import type {BudgetActivity} from './budget-activity';
function previousMonths(month:string):string[] {
  const year=Number(month.slice(0,4)),index=Number(month.slice(5))-1;
  return [3,2,1].map(offset=>new Date(Date.UTC(year,index-offset,1)).toISOString().slice(0,7));
}
function hasCompleteHistory(entries:BudgetActivity[]):boolean {
  return entries.length>0 && entries.every(row=>row.activityMinor!==null);
}
function monthlySpending(entries:BudgetActivity[],month:string):number {
  const total=entries.filter(row=>row.date.startsWith(month)).reduce((sum,row)=>sum+BigInt(row.activityMinor!),0n);
  const spending=total<0n?-total:0n;
  if(spending>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Budget amount exceeds safe range');
  return Number(spending);
}
function historySuggestion(category:BudgetCategorySummary,activity:BudgetActivity[],months:string[]) {
  const entries=activity.filter(row=>row.category===category.category && months.includes(row.date.slice(0,7)));
  if(category.availableMinor===null) return null;
  if(!hasCompleteHistory(entries)) return null;
  const totals=months.map(month=>monthlySpending(entries,month));
  return suggestFundingFromHistory(totals,category.availableMinor);
}
export function addBudgetSuggestions(categories:BudgetCategorySummary[],activity:BudgetActivity[],month:string) {
  const months=previousMonths(month);
  return categories.map(category=>{
    if(category.suggestedMinor!==null) return {...category,suggestionBasis:'target' as const};
    const suggestedMinor=historySuggestion(category,activity,months);
    return {...category,suggestedMinor,suggestionBasis:suggestedMinor===null?null:'history' as const};
  });
}
export function budgetHistoryStart(month:string) { return `${previousMonths(month)[0]}-01`; }
