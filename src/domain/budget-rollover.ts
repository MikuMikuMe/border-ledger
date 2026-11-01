import {budgetSum} from './budget-tracking';
export type RolloverPolicy='carry_all'|'carry_positive'|'reset';
export interface BudgetRolloverPolicy {category:string;effectiveMonth:string;policy:RolloverPolicy}
export function nextBudgetMonth(month:string):string {
 const year=Number(month.slice(0,4)),index=Number(month.slice(5));
 return new Date(Date.UTC(year,index,1)).toISOString().slice(0,7);
}
export function rolloverOpening(closing:number|null,policy:RolloverPolicy):number|null {
 if(policy==='reset') return 0;
 if(closing===null) return null;
 return policy==='carry_positive'?Math.max(0,closing):closing;
}
export function categoryHistory(input:{month:string;category:string;allocations:readonly {month:string;category:string;assignedMinor:number}[];activity:readonly {id:string;date:string;category:string;activityMinor:number|null}[];rolloverPolicies?:readonly BudgetRolloverPolicy[]}) {
 const allocations=input.allocations.filter(row=>row.category===input.category && row.month<=input.month);
 const activity=input.activity.filter(row=>row.category===input.category && row.date.slice(0,7)<=input.month);
 const policies=(input.rolloverPolicies??[]).filter(row=>row.category===input.category).sort((a,b)=>a.effectiveMonth.localeCompare(b.effectiveMonth));
 const months=[input.month,...allocations.map(row=>row.month),...activity.map(row=>row.date.slice(0,7))].sort();
 let opening:number|null=0,missing:string[]=[];
 const history:Array<{month:string;openingMinor:number|null;assignedMinor:number;activityMinor:number|null;availableMinor:number|null;missingTransactionIds:string[]}>=[];
 for(let month=months[0];month<=input.month;month=nextBudgetMonth(month)) {
  const rows=activity.filter(row=>row.date.startsWith(month));
  missing.push(...rows.filter(row=>row.activityMinor===null).map(row=>row.id));
  const assigned=budgetSum(allocations.filter(row=>row.month===month).map(row=>row.assignedMinor));
  const current=rows.some(row=>row.activityMinor===null)?null:budgetSum(rows.map(row=>row.activityMinor!));
  const closing=opening===null||current===null?null:budgetSum([opening,assigned,current]);
  history.push({month,openingMinor:opening,assignedMinor:assigned,activityMinor:current,availableMinor:closing,missingTransactionIds:[...missing]});
  if(month===input.month)break;
  const policy=policies.filter(row=>row.effectiveMonth<=month).at(-1)?.policy??'carry_all';
  opening=rolloverOpening(closing,policy);
  if(policy==='reset') missing=[];
 }
 return history;
}

export function categoryProjection(input:Parameters<typeof categoryHistory>[0]) {
 const final=categoryHistory(input).at(-1);
 if(!final)throw new RangeError('Invalid budget month');
 const {month,...projection}=final;
 return projection;
}
