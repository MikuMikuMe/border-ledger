import type {D1Database} from './db-types';
import {financialAuthorityGuard,type FinancialContext} from './financial-authority';
import {validateAllocation,readBudgetSettings} from './budget-store';
export interface BudgetTransfer {id:string;month:string;from:string;to:string;amountMinor:number}
function validateOperationId(id:string):void {
  if(typeof id!=='string') throw new RangeError('Invalid operation id');
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new RangeError('Invalid operation id');
}
function validateTransferValues(input:BudgetTransfer) {
  validateOperationId(input.id);
  if(!Number.isSafeInteger(input.amountMinor) || input.amountMinor<=0) throw new RangeError('Invalid transfer amount');
  if(input.from===input.to) throw new RangeError('Choose different categories');
}
function validateTransfer(input:BudgetTransfer) {
  validateTransferValues(input);
  validateAllocation({month:input.month,category:input.from,assignedMinor:0});
  validateAllocation({month:input.month,category:input.to,assignedMinor:0});
}
function transferEntry(db:D1Database,context:FinancialContext,input:BudgetTransfer,entry:{category:string;amount:number}) {
  return db.prepare(`INSERT INTO budget_allocations(ledger_id,month,category,assigned_minor)
    SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_transfer_operations WHERE ledger_id=? AND operation_id=? AND state='pending')
    ON CONFLICT(ledger_id,month,category) DO UPDATE SET assigned_minor=assigned_minor+excluded.assigned_minor`)
    .bind(context.ledgerId,input.month,entry.category,entry.amount,context.ledgerId,input.id);
}
export async function transferBudgetAllocation(db:D1Database,context:FinancialContext,input:BudgetTransfer) {
  validateTransfer(input);
  const settings=await readBudgetSettings(db,context);
  if (!settings || input.month<settings.startMonth) throw new RangeError('Transfer precedes the budget start');
  const payload=JSON.stringify([input.month,input.from,input.to,input.amountMinor]);
  const create=db.prepare(`INSERT INTO budget_transfer_operations(ledger_id,operation_id,payload,state) VALUES(?,?,?,'pending') ON CONFLICT(ledger_id,operation_id) DO NOTHING`).bind(context.ledgerId,input.id,payload);
  const guard=db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN EXISTS (SELECT 1 FROM budget_transfer_operations WHERE ledger_id=? AND operation_id=? AND payload=?) THEN ? ELSE NULL END ON CONFLICT(ledger_id) DO NOTHING`).bind(context.ledgerId,input.id,payload,context.ledgerId);
  const complete=db.prepare("UPDATE budget_transfer_operations SET state='completed' WHERE ledger_id=? AND operation_id=? AND state='pending'").bind(context.ledgerId,input.id);
  await db.batch([financialAuthorityGuard(db,context,'preferences:write'),create,guard,transferEntry(db,context,input,{category:input.from,amount:-input.amountMinor}),transferEntry(db,context,input,{category:input.to,amount:input.amountMinor}),complete]);
}
