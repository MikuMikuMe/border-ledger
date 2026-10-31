import {readBudgetView} from './budget-view';
import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {readBudgetSettings,readBudgetAllocations} from './budget-store';
import {listBudgetTargets,listManualCash} from './budget-inputs';
import {readLunchFlowBalances} from './lunchflow-balance-store';
import {readBudgetActivity} from './budget-activity';
import {budgetJson as json} from './budget-http-common';
async function budgetSnapshot(db:D1Database,context:FinancialContext) {
  const [settings,allocations,targets,cash,balances]=await Promise.all([readBudgetSettings(db,context),readBudgetAllocations(db,context),listBudgetTargets(db,context),listManualCash(db,context),readLunchFlowBalances(db,context)]);
  return json({settings,allocations,targets,cash,balances});
}
async function activityResponse(db:D1Database,context:FinancialContext,url:URL) {
  const settings=await readBudgetSettings(db,context);
  if(!settings) throw new RangeError('Set a budget currency first');
  const from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';
  return json({activity:await readBudgetActivity(db,context,{from,to,currency:settings.currency})});
}
export async function readBudget(db:D1Database,context:FinancialContext,root:string,url:URL) {
  if(url.pathname===root) return budgetSnapshot(db,context);
  if(url.pathname===root+'/view') return json(await readBudgetView(db,context,url.searchParams.get('month')??''));
  if(url.pathname===root+'/activity') return activityResponse(db,context,url);
  return json({code:'not_found',message:'Not found'},404);
}
