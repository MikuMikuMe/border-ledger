import {transferBudgetAllocation,type BudgetTransfer} from './budget-transfer-store';
import {readBudget} from './budget-http-read';
import {budgetJson as json} from './budget-http-common';
import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {readJsonBody} from './security';
import {configureBudget,setBudgetAllocation,type BudgetAllocation} from './budget-store';
import {saveBudgetTarget,saveManualCash,deleteManualCash,type BudgetTarget,type ManualCash} from './budget-inputs';

function object(value:unknown):Record<string,unknown> {
  if (!value) throw new RangeError('Invalid request body');
  if (typeof value!=='object') throw new RangeError('Invalid request body');
  if (Array.isArray(value)) throw new RangeError('Invalid request body');
  return value as Record<string,unknown>;
}
async function writeBudget(request:Request,db:D1Database,context:FinancialContext,path:string) {
  const data=object(await readJsonBody(request,16384));
  if(path==='settings') await configureBudget(db,context,data.currency as string,data.startMonth as string | undefined);
  else if(path==='allocations') await setBudgetAllocation(db,context,data as unknown as BudgetAllocation);
  else if(path==='targets') await saveBudgetTarget(db,context,data as unknown as BudgetTarget);
  else if(path==='cash') await saveManualCash(db,context,data as unknown as ManualCash);
  else if(path==='transfers') await transferBudgetAllocation(db,context,data as unknown as BudgetTransfer);
  else return json({code:'not_found',message:'Not found'},404);
  return json({ok:true});
}
async function dispatchBudget(request:Request,db:D1Database,context:FinancialContext,root:string) {
  const url=new URL(request.url);
  if(request.method==='GET') return readBudget(db,context,root,url);
  if(request.method==='PUT' && url.pathname.startsWith(root+'/')) return writeBudget(request,db,context,url.pathname.slice(root.length+1));
  if(request.method==='DELETE' && url.pathname.startsWith(root+'/cash/')) { await deleteManualCash(db,context,decodeURIComponent(url.pathname.slice(root.length+6))); return json({ok:true}); }
  return json({code:'not_found',message:'Not found'},404);
}
export async function handleBudgetApi(request:Request,db:D1Database,context:FinancialContext,root:string):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if (path!==root && !path.startsWith(`${root}/`)) return null;
  try { return await dispatchBudget(request,db,context,root); }
  catch(error) {
    if(error instanceof RangeError) return json({code:'invalid_request',message:error.message},400);
    throw error;
  }
}
