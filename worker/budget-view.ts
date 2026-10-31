import {addBudgetSuggestions,budgetHistoryStart} from './budget-history';
import {fundingInputs,fundingRates,convertFunding,type ViewDependencies,type Account} from './budget-funding';
import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {readBudgetSettings,readBudgetAllocations} from './budget-store';
import {listBudgetTargets,listManualCash} from './budget-inputs';
import {readLunchFlowBalances} from './lunchflow-balance-store';
import {readBudgetActivity} from './budget-activity';
import {summarizeBudget} from '../src/domain/budget-summary';
import {warmFxSnapshot} from './ledger-reports';
import {convertMinorUnits,isFxProviderError,type ValidatedFxRates} from './fx-rates';

function monthEnd(month:string) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Invalid budget month');
  const year=Number(month.slice(0,4));
  if(year<1900 || year>2199) throw new RangeError('Invalid budget month');
  return new Date(Date.UTC(year,Number(month.slice(5)),0)).toISOString().slice(0,10);
}
async function ledgerMonth(db:D1Database,context:FinancialContext,now:Date):Promise<string> {
  const row=await db.prepare('SELECT reporting_timezone FROM ledger_preferences WHERE ledger_id=?').bind(context.ledgerId).first<{reporting_timezone:string}>();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:row?.reporting_timezone??'America/Toronto',year:'numeric',month:'2-digit'}).formatToParts(now);
  return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;
}
function reserveFutureAllocations(value:number|null,allocations:{month:string;assignedMinor:number}[],month:string,currentMonth:string):number|null {
  if(value===null || month!==currentMonth) return null;
  const future=allocations.filter(row=>row.month>month).reduce((sum,row)=>sum+BigInt(row.assignedMinor),0n);
  const result=BigInt(value)-(future>0n?future:0n);
  if(result>BigInt(Number.MAX_SAFE_INTEGER) || result<BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Budget amount exceeds safe range');
  return Number(result);
}
export async function readBudgetView(db:D1Database,context:FinancialContext,month:string,deps:ViewDependencies={}) {
  const end=monthEnd(month),now=deps.now?.()??new Date();
  const [settings,allocations,targets,cash,synced,accountRows]=await Promise.all([readBudgetSettings(db,context),readBudgetAllocations(db,context),listBudgetTargets(db,context),listManualCash(db,context),readLunchFlowBalances(db,context),db.prepare("SELECT id,name,currency FROM accounts WHERE ledger_id=? AND kind IN ('chequing','savings') ORDER BY name,id").bind(context.ledgerId).all<Account>()]);
  if(!settings) throw new RangeError('Set a budget currency first');
  const start=settings.startMonth;
  const budgetStart=start+'-01',historyStart=budgetHistoryStart(month);
  const allActivity=await readBudgetActivity(db,context,{from:historyStart<budgetStart?historyStart:budgetStart,to:end,currency:settings.currency},deps);
  const activity=allActivity.filter(row=>row.date>=budgetStart);
  const raw=fundingInputs(accountRows.results,cash,synced,now);
  const rates=await fundingRates(db,raw,settings.currency,{now,deps});
  const balances=raw.map(item=>convertFunding(item,settings.currency,rates));
  const rawSummary=summarizeBudget({month,allocations,targets,activity,balances});
  const summary={...rawSummary,categories:addBudgetSuggestions(rawSummary.categories,allActivity,month)};
  const currentMonth=await ledgerMonth(db,context,now);
  summary.unassignedMinor=reserveFutureAllocations(summary.unassignedMinor,allocations,month,currentMonth);
  return {settings,summary,balances,activity,asOf:now.toISOString(),startMonth:start,currentMonth};
}
