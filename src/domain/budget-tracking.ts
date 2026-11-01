export type BudgetMode='envelope'|'tracking';
export type TrackingDirection='income'|'expense';
export interface TrackingPlan {month:string;direction:TrackingDirection;category:string;plannedMinor:number}
export interface TrackingActivity {id:string;category:string;kind:'income'|'expense'|'fee'|'refund';activityMinor:number|null}
export function budgetSum(values:readonly number[]):number {
 const total=values.reduce((sum,value)=>sum+BigInt(value),0n);
 if(total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER))throw new RangeError('Budget amount exceeds safe range');
 return Number(total);
}
function actualTotal(activity:readonly TrackingActivity[],direction:TrackingDirection):number|null {
 const rows=activity.filter(row=>(row.kind==='income')===(direction==='income'));
 if(rows.some(row=>row.activityMinor===null))return null;
 return budgetSum(rows.map(row=>direction==='income'?row.activityMinor!:-row.activityMinor!));
}
function categoryKeys(plans:readonly TrackingPlan[],activity:readonly TrackingActivity[]) {
 const keys=new Map<string,{direction:TrackingDirection;category:string}>();
 for(const row of plans)keys.set(JSON.stringify([row.direction,row.category]),row);
 for(const row of activity){const direction=row.kind==='income'?'income':'expense';keys.set(JSON.stringify([direction,row.category]),{direction,category:row.category});}
 return [...keys.values()].sort((a,b)=>a.direction.localeCompare(b.direction)||a.category.localeCompare(b.category));
}
function categorySummary(plans:readonly TrackingPlan[],activity:readonly TrackingActivity[],key:{direction:TrackingDirection;category:string}) {
 const {direction,category}=key;
 const rows=activity.filter(row=>row.category===category && (row.kind==='income')===(direction==='income'));
 const plannedMinor=budgetSum(plans.filter(row=>row.direction===direction&&row.category===category).map(row=>row.plannedMinor));
 const actualMinor=actualTotal(rows,direction);
 const varianceMinor=actualMinor===null?null:budgetSum(direction==='income'?[actualMinor,-plannedMinor]:[plannedMinor,-actualMinor]);
 return {direction,category,plannedMinor,actualMinor,varianceMinor,missingTransactionIds:rows.filter(row=>row.activityMinor===null).map(row=>row.id)};
}
function savings(income:number|null,expenses:number|null) {return income===null||expenses===null?null:budgetSum([income,-expenses]);}
export function summarizeTracking(month:string,plans:readonly TrackingPlan[],activity:readonly TrackingActivity[]) {
 const selected=plans.filter(row=>row.month===month);
 const plannedIncomeMinor=budgetSum(selected.filter(row=>row.direction==='income').map(row=>row.plannedMinor));
 const plannedExpenseMinor=budgetSum(selected.filter(row=>row.direction==='expense').map(row=>row.plannedMinor));
 const actualIncomeMinor=actualTotal(activity,'income'),actualExpenseMinor=actualTotal(activity,'expense');
 const categories=categoryKeys(selected,activity).map(key=>categorySummary(selected,activity,key));
 return {month,plannedIncomeMinor,plannedExpenseMinor,plannedSavingsMinor:budgetSum([plannedIncomeMinor,-plannedExpenseMinor]),actualIncomeMinor,actualExpenseMinor,actualSavingsMinor:savings(actualIncomeMinor,actualExpenseMinor),categories};
}
