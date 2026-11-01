import {readTrackingView,readRolloverPreview} from './budget-planning-view';
import {readBudgetState,readTrackingCopy,validateMode} from './budget-planning-store';
import type {BudgetRolloverPolicy} from '../src/domain/budget-rollover';
import {readBudgetView} from './budget-view';
import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {readBudgetSettings,readBudgetAllocations} from './budget-store';
import {listBudgetTargets,listManualCash} from './budget-inputs';
import {readLunchFlowBalances} from './lunchflow-balance-store';
import {readBudgetActivity} from './budget-activity';
import {budgetJson as json} from './budget-http-common';
async function budgetSnapshot(db:D1Database,context:FinancialContext) {
 const [settings,allocations,targets,cash,balances,state]=await Promise.all([readBudgetSettings(db,context),readBudgetAllocations(db,context),listBudgetTargets(db,context),listManualCash(db,context),readLunchFlowBalances(db,context),readBudgetState(db,context)]);
 return json({settings:settings?{...settings,...state}:null,allocations,targets,cash,balances});
}
async function activityResponse(db:D1Database,context:FinancialContext,url:URL) {
 const settings=await readBudgetSettings(db,context);
 if(!settings)throw new RangeError('Set a budget currency first');
 const from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';
 return json({activity:await readBudgetActivity(db,context,{from,to,currency:settings.currency})});
}
async function modeView(db:D1Database,context:FinancialContext,url:URL) {
 const mode=url.searchParams.get('mode')??'envelope',month=url.searchParams.get('month')??'';validateMode(mode);
 if(mode==='tracking')return json(await readTrackingView(db,context,month));
 const view=await readBudgetView(db,context,month);
 return json(url.searchParams.has('mode')?{...view,mode}:view);
}
export async function readBudget(db:D1Database,context:FinancialContext,root:string,url:URL) {
 if(url.pathname===root)return budgetSnapshot(db,context);
 if(url.pathname===root+'/view')return modeView(db,context,url);
 if(url.pathname===root+'/activity')return activityResponse(db,context,url);
 if(url.pathname===root+'/tracking-copy')return json(await readTrackingCopy(db,context,url.searchParams.get('month')??''));
 if(url.pathname===root+'/rollover-preview')return json(await readRolloverPreview(db,context,Object.fromEntries(['category','effectiveMonth','policy'].map(key=>[key,url.searchParams.get(key)??''])) as unknown as BudgetRolloverPolicy));
 return json({code:'not_found',message:'Not found'},404);
}
