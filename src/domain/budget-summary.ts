import {suggestFunding} from './budget';
export interface BudgetViewInput {
  month:string;
  allocations:readonly {month:string;category:string;assignedMinor:number}[];
  targets:readonly {category:string;targetMinor:number}[];
  activity:readonly {id:string;date:string;category:string;activityMinor:number|null}[];
  balances:readonly {id:string;amountMinor:number|null}[];
}
export interface BudgetCategorySummary {
  category:string;openingMinor:number|null;assignedMinor:number;activityMinor:number|null;availableMinor:number|null;
  targetMinor:number|null;suggestedMinor:number|null;missingTransactionIds:string[];
}
function checkedSum(values:readonly number[]):number {
  const total=values.reduce((sum,value)=>sum+BigInt(value),0n);
  if(total>BigInt(Number.MAX_SAFE_INTEGER) || total<BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Budget amount exceeds safe range');
  return Number(total);
}
function targetSuggestion(target:number|null,available:number|null):number|null {
  if(target===null || available===null) return null;
  return suggestFunding(target,available);
}
function categorySummary(input:BudgetViewInput,category:string):BudgetCategorySummary {
  const allocations=input.allocations.filter(row=>row.category===category && row.month<=input.month);
  const activity=input.activity.filter(row=>row.category===category && row.date.slice(0,7)<=input.month);
  const previous=activity.filter(row=>row.date.slice(0,7)<input.month);
  const current=activity.filter(row=>row.date.slice(0,7)===input.month);
  const missing=activity.filter(row=>row.activityMinor===null).map(row=>row.id);
  const opening=previous.some(row=>row.activityMinor===null)?null:checkedSum([...allocations.filter(row=>row.month<input.month).map(row=>row.assignedMinor),...previous.map(row=>row.activityMinor!)]);
  const assigned=checkedSum(allocations.filter(row=>row.month===input.month).map(row=>row.assignedMinor));
  const currentActivity=current.some(row=>row.activityMinor===null)?null:checkedSum(current.map(row=>row.activityMinor!));
  const available=opening===null || currentActivity===null?null:checkedSum([opening,assigned,currentActivity]);
  const target=input.targets.find(row=>row.category===category)?.targetMinor??null;
  return {category,openingMinor:opening,assignedMinor:assigned,activityMinor:currentActivity,availableMinor:available,targetMinor:target,suggestedMinor:targetSuggestion(target,available),missingTransactionIds:missing};
}
export function summarizeBudget(input:BudgetViewInput) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new RangeError('Invalid budget month');
  const names=new Set([...input.allocations.filter(row=>row.month<=input.month).map(row=>row.category),...input.targets.map(row=>row.category),...input.activity.filter(row=>row.date.slice(0,7)<=input.month).map(row=>row.category)]);
  const categories=[...names].sort((a,b)=>a.localeCompare(b)).map(category=>categorySummary(input,category));
  const cashMinor=input.balances.some(row=>row.amountMinor===null)?null:checkedSum(input.balances.map(row=>row.amountMinor!));
  const unassignedMinor=cashMinor===null || categories.some(row=>row.availableMinor===null)?null:checkedSum([cashMinor,...categories.map(row=>-Math.max(0,row.availableMinor!))]);
  return {month:input.month,cashMinor,unassignedMinor,categories};
}
