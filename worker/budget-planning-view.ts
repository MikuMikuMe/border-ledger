import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {readBudgetSettings,readBudgetAllocations} from './budget-store';
import {readBudgetState,readTrackingPlans,readRolloverPolicies,BudgetConflictError,validateBudgetMonth,validatePolicy} from './budget-planning-store';
import {readTrackingActivity,readBudgetActivity} from './budget-activity';
import {summarizeTracking} from '../src/domain/budget-tracking';

import {categoryHistory,type BudgetRolloverPolicy} from '../src/domain/budget-rollover';
import type {ViewDependencies} from './budget-funding';
export function budgetMonthEnd(month:string) {validateBudgetMonth(month);return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);}
export async function currentBudgetMonth(db:D1Database,context:FinancialContext,now:Date) {
 const row=await db.prepare('SELECT reporting_timezone FROM ledger_preferences WHERE ledger_id=?').bind(context.ledgerId).first<{reporting_timezone:string}>();
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:row?.reporting_timezone??'America/Toronto',year:'numeric',month:'2-digit'}).formatToParts(now);
 return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;
}
export async function readTrackingView(db:D1Database,context:FinancialContext,month:string,deps:ViewDependencies={}) {
 try {return await readTrackingViewOnce(db,context,month,deps);}
 catch(error) {if(error instanceof BudgetConflictError)return readTrackingViewOnce(db,context,month,deps);throw error;}
}
async function readTrackingViewOnce(db:D1Database,context:FinancialContext,month:string,deps:ViewDependencies) {
 const end=budgetMonthEnd(month),before=await readBudgetState(db,context),settings=await readBudgetSettings(db,context),now=deps.now?.()??new Date();
 if(!settings)throw new RangeError('Set a budget currency first');
 const [plans,activity,currentMonth]=await Promise.all([readTrackingPlans(db,context,month),readTrackingActivity(db,context,{from:month+'-01',to:end,currency:settings.currency},deps),currentBudgetMonth(db,context,now)]);
 const state=await readBudgetState(db,context);
 // A dated FX cache fill can advance the revision; retry once for a coherent snapshot.
 if(before.revision!==state.revision)throw new BudgetConflictError();
 return {mode:'tracking' as const,settings:{...settings,...state},summary:summarizeTracking(month,plans,activity),plans,activity,asOf:now.toISOString(),currentMonth};
}
function rolloverChanges(input:Parameters<typeof categoryHistory>[0],policy:BudgetRolloverPolicy,policies:BudgetRolloverPolicy[]) {
 const previous=categoryHistory({...input,rolloverPolicies:policies});
 const updated=categoryHistory({...input,rolloverPolicies:[...policies.filter(row=>row.category!==policy.category||row.effectiveMonth!==policy.effectiveMonth),policy]});
 return previous.flatMap((before,index)=>{
  const after=updated[index];
  if(before.month<policy.effectiveMonth)return [];
  if(before.openingMinor===after.openingMinor&&before.availableMinor===after.availableMinor)return [];
  return [{month:before.month,category:policy.category,beforeOpeningMinor:before.openingMinor,afterOpeningMinor:after.openingMinor,beforeClosingMinor:before.availableMinor,afterClosingMinor:after.availableMinor}];
 });
}
async function readRolloverPreviewOnce(db:D1Database,context:FinancialContext,policy:BudgetRolloverPolicy,deps:ViewDependencies={}) {
 validateBudgetMonth(policy.effectiveMonth);validatePolicy(policy.policy);
 if(typeof policy.category!=='string'||policy.category.trim()!==policy.category||!policy.category.length||policy.category.length>120)throw new RangeError('Invalid category');
 const before=await readBudgetState(db,context),settings=await readBudgetSettings(db,context);if(!settings||policy.effectiveMonth<settings.startMonth)throw new RangeError('Rollover precedes budget start');
 const allocations=await readBudgetAllocations(db,context),policies=await readRolloverPolicies(db,context),currentMonth=await currentBudgetMonth(db,context,deps.now?.()??new Date());
 const horizon=[currentMonth,policy.effectiveMonth,...allocations.map(row=>row.month)].sort().at(-1)!;
 const activity=await readBudgetActivity(db,context,{from:settings.startMonth+'-01',to:budgetMonthEnd(horizon),currency:settings.currency},deps);
 const state=await readBudgetState(db,context);if(before.revision!==state.revision)throw new BudgetConflictError();
 const changes=rolloverChanges({month:horizon,category:policy.category,allocations,activity},policy,policies);
 return {...policy,revision:state.revision,changes};
}



export async function readRolloverPreview(db:D1Database,context:FinancialContext,policy:BudgetRolloverPolicy,deps:ViewDependencies={}) {
 try {return await readRolloverPreviewOnce(db,context,policy,deps);}
 catch(error) {if(error instanceof BudgetConflictError)return readRolloverPreviewOnce(db,context,policy,deps);throw error;}
}
