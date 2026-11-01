import type {D1Database,D1Statement} from './db-types';
import type {FinancialContext} from './financial-authority';
import {assertFinancialAuthority,financialAuthorityGuard} from './financial-authority';
import {readBudgetSettings,validateAllocation} from './budget-store';
import type {BudgetMode,TrackingPlan} from '../src/domain/budget-tracking';
import type {BudgetRolloverPolicy,RolloverPolicy} from '../src/domain/budget-rollover';
export interface BudgetWrite {expectedRevision:number;operationId:string}
export class BudgetConflictError extends Error {constructor(){super('Budget conflict: reload and try again');}}
export function validateBudgetMonth(month:string) {validateAllocation({month,category:'Budget',assignedMinor:0});if(Number(month.slice(0,4))<1900||Number(month.slice(0,4))>2199)throw new RangeError('Invalid budget month');}
export function validateMode(mode:unknown):asserts mode is BudgetMode {if(mode!=='envelope'&&mode!=='tracking')throw new RangeError('Invalid budget mode');}
export function validatePolicy(policy:unknown):asserts policy is RolloverPolicy {if(!['carry_all','carry_positive','reset'].includes(policy as string))throw new RangeError('Invalid rollover policy');}
export async function readBudgetState(db:D1Database,context:FinancialContext) {
 return await db.prepare('SELECT preferred_mode AS preferredMode,revision FROM budget_planning_state WHERE ledger_id=?').bind(context.ledgerId).first<{preferredMode:BudgetMode;revision:number}>()??{preferredMode:'envelope' as BudgetMode,revision:0};
}
export async function readTrackingPlans(db:D1Database,context:FinancialContext,month:string) {
 return (await db.prepare('SELECT month,direction,category,planned_minor AS plannedMinor FROM budget_tracking_plans WHERE ledger_id=? AND month=? ORDER BY direction,category').bind(context.ledgerId,month).all<TrackingPlan>()).results;
}
export async function readRolloverPolicies(db:D1Database,context:FinancialContext) {
 return (await db.prepare('SELECT category,effective_month AS effectiveMonth,policy FROM budget_rollover_policies WHERE ledger_id=? ORDER BY category,effective_month').bind(context.ledgerId).all<BudgetRolloverPolicy>()).results;
}
function validateWrite(input:BudgetWrite) {
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new RangeError('Invalid budget revision');
 if(typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId))throw new RangeError('Invalid operation id');
}
function pending(context:FinancialContext,input:BudgetWrite) {return {sql:"EXISTS(SELECT 1 FROM budget_planning_operations WHERE ledger_id=? AND operation_id=? AND state='pending')",bindings:[context.ledgerId,input.operationId]};}
async function writeOperation(db:D1Database,context:FinancialContext,input:BudgetWrite,operation:{payload:unknown;statements:D1Statement[]}) {
 const {payload,statements}=operation;
 validateWrite(input);
 const serialized=JSON.stringify(payload),gate=pending(context,input);
 const create=db.prepare(`INSERT INTO budget_planning_operations(ledger_id,operation_id,payload,result_revision,state) SELECT ?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM budget_planning_state WHERE ledger_id=? AND revision=?) ON CONFLICT(ledger_id,operation_id) DO NOTHING`).bind(context.ledgerId,input.operationId,serialized,input.expectedRevision+1,context.ledgerId,input.expectedRevision);
 const guard=db.prepare(`INSERT INTO ledger_preferences(ledger_id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM budget_planning_operations WHERE ledger_id=? AND operation_id=? AND payload=?) THEN ? ELSE NULL END) ON CONFLICT(ledger_id) DO NOTHING`).bind(context.ledgerId,input.operationId,serialized,context.ledgerId);
 const advance=db.prepare(`UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=? AND ${gate.sql}`).bind(context.ledgerId,...gate.bindings);
 const complete=db.prepare("UPDATE budget_planning_operations SET state='completed' WHERE ledger_id=? AND operation_id=? AND state='pending'").bind(context.ledgerId,input.operationId);
 try {await db.batch([financialAuthorityGuard(db,context,'preferences:write'),create,guard,...statements,advance,complete]);}
 catch(error) {await assertFinancialAuthority(db,context,'preferences:write');if(String(error).includes('ledger_preferences'))throw new BudgetConflictError();throw error;}
 const result=await db.prepare('SELECT result_revision AS revision FROM budget_planning_operations WHERE ledger_id=? AND operation_id=?').bind(context.ledgerId,input.operationId).first<{revision:number}>();
 if(!result)throw new BudgetConflictError();
 return {ok:true as const,revision:result.revision};
}
async function requireSettings(db:D1Database,context:FinancialContext) {if(!await readBudgetSettings(db,context))throw new RangeError('Set a budget currency first');}
export async function saveBudgetMode(db:D1Database,context:FinancialContext,input:BudgetWrite&{mode:BudgetMode}) {
 validateMode(input.mode);await requireSettings(db,context);
 const gate=pending(context,input);
 const statement=db.prepare(`UPDATE budget_planning_state SET preferred_mode=? WHERE ledger_id=? AND ${gate.sql}`).bind(input.mode,context.ledgerId,...gate.bindings);
 return writeOperation(db,context,input,{payload:['mode',input.mode,input.expectedRevision],statements:[statement]});
}
export async function saveTrackingPlan(db:D1Database,context:FinancialContext,input:BudgetWrite&TrackingPlan) {
 validateAllocation({month:input.month,category:input.category,assignedMinor:input.plannedMinor});validateBudgetMonth(input.month);
 if(!['income','expense'].includes(input.direction)||input.plannedMinor<0)throw new RangeError('Invalid tracking plan');
 await requireSettings(db,context);const gate=pending(context,input);
 const statement=db.prepare(`INSERT INTO budget_tracking_plans(ledger_id,month,direction,category,planned_minor) SELECT ?,?,?,?,? WHERE ${gate.sql} ON CONFLICT(ledger_id,month,direction,category) DO UPDATE SET planned_minor=excluded.planned_minor`).bind(context.ledgerId,input.month,input.direction,input.category,input.plannedMinor,...gate.bindings);
 return writeOperation(db,context,input,{payload:['plan',input.month,input.direction,input.category,input.plannedMinor,input.expectedRevision],statements:[statement]});
}
export function previousBudgetMonth(month:string) {validateBudgetMonth(month);return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-2,1)).toISOString().slice(0,7);}
export async function readTrackingCopy(db:D1Database,context:FinancialContext,month:string) {
 const sourceMonth=previousBudgetMonth(month),before=await readBudgetState(db,context),plans=await readTrackingPlans(db,context,sourceMonth),after=await readBudgetState(db,context);
 if(before.revision!==after.revision)throw new BudgetConflictError();
 return {month,sourceMonth,revision:after.revision,sourceRevision:after.revision,plans};
}
export async function copyTrackingPlans(db:D1Database,context:FinancialContext,input:BudgetWrite&{month:string;sourceMonth:string;expectedSourceRevision:number}) {
 if(previousBudgetMonth(input.month)!==input.sourceMonth)throw new RangeError('Copy must use the previous month');
 if(input.expectedSourceRevision!==input.expectedRevision)throw new BudgetConflictError();
 await requireSettings(db,context);const gate=pending(context,input);
 const remove=db.prepare(`DELETE FROM budget_tracking_plans WHERE ledger_id=? AND month=? AND ${gate.sql}`).bind(context.ledgerId,input.month,...gate.bindings);
 const copy=db.prepare(`INSERT INTO budget_tracking_plans(ledger_id,month,direction,category,planned_minor) SELECT ledger_id,?,direction,category,planned_minor FROM budget_tracking_plans WHERE ledger_id=? AND month=? AND ${gate.sql}`).bind(input.month,context.ledgerId,input.sourceMonth,...gate.bindings);
 return writeOperation(db,context,input,{payload:['copy',input.month,input.sourceMonth,input.expectedRevision,input.expectedSourceRevision],statements:[remove,copy]});
}
export async function saveRolloverPolicy(db:D1Database,context:FinancialContext,input:BudgetWrite&BudgetRolloverPolicy) {
 validatePolicy(input.policy);validateBudgetMonth(input.effectiveMonth);validateAllocation({month:input.effectiveMonth,category:input.category,assignedMinor:0});
 const settings=await readBudgetSettings(db,context);if(!settings||input.effectiveMonth<settings.startMonth)throw new RangeError('Rollover precedes budget start');
 const gate=pending(context,input);
 const statement=db.prepare(`INSERT INTO budget_rollover_policies(ledger_id,category,effective_month,policy) SELECT ?,?,?,? WHERE ${gate.sql} ON CONFLICT(ledger_id,category,effective_month) DO UPDATE SET policy=excluded.policy`).bind(context.ledgerId,input.category,input.effectiveMonth,input.policy,...gate.bindings);
 return writeOperation(db,context,input,{payload:['rollover',input.category,input.effectiveMonth,input.policy,input.expectedRevision],statements:[statement]});
}
