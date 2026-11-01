import {getCurrencyMeta} from '../../../../src/domain/currencies';
import type {BudgetData} from './BudgetContent';
import type {CopyPreview,RolloverPreview,TrackingData} from './budgetTracking';
function invalid():never {throw new Error('Invalid budget response');}
function record(value:unknown):Record<string,unknown> {
  if(!value) return invalid();
  if(typeof value!=='object') return invalid();
  if(Array.isArray(value)) return invalid();
  return value as Record<string,unknown>;
}
function text(value:unknown):string {
  if(typeof value!=='string') return invalid();
  if(value.length===0) return invalid();
  if(value.length>1024) return invalid();
  return value;
}
function currency(value:unknown) {if(!getCurrencyMeta(text(value))) invalid();}
function amount(value:unknown,nullable=false) {
  if(nullable && value===null) return;
  if(typeof value!=='number' || !Number.isSafeInteger(value)) invalid();
}
function list(value:unknown):unknown[] {
  if(!Array.isArray(value) || value.length>10000) return invalid();
  return value;
}
function category(value:unknown) {
  const row=record(value);text(row.category);
  for(const key of ['assignedMinor']) amount(row[key]);
  for(const key of ['openingMinor','activityMinor','availableMinor','targetMinor','suggestedMinor']) amount(row[key],true);
  for(const id of list(row.missingTransactionIds)) text(id);
  if(![null,'target','history'].includes(row.suggestionBasis as string|null)) invalid();
}
function balance(value:unknown) {
  const row=record(value);text(row.id);text(row.name);currency(row.sourceCurrency);
  if(row.accountId!==undefined) text(row.accountId);
  if(!['manual','lunchflow','unavailable','excluded'].includes(String(row.source))) invalid();
  amount(row.sourceMinor,true);amount(row.amountMinor,true);
  if(row.rateDate!==null) text(row.rateDate);
  if(row.observedAt!==null) text(row.observedAt);
  if(row.rate!==undefined && row.rate!==null) text(row.rate);
}
function transaction(value:unknown) {
  const row=record(value);text(row.id);text(row.date);text(row.category);currency(row.sourceCurrency);
  amount(row.sourceMinor);amount(row.activityMinor,true);
  if(row.rateDate!==null) text(row.rateDate);
  if(row.rate!==null) text(row.rate);
}
function nonnegative(value:unknown) {amount(value);if((value as number)<0) invalid();}
function direction(value:unknown) {if(value!=='income'&&value!=='expense') invalid();}
function plan(value:unknown) {const row=record(value);text(row.month);direction(row.direction);text(row.category);nonnegative(row.plannedMinor);}
function trackingCategory(value:unknown) {const row=record(value);direction(row.direction);text(row.category);nonnegative(row.plannedMinor);amount(row.actualMinor,true);amount(row.varianceMinor,true);list(row.missingTransactionIds).forEach(text);}
function tracking(root:Record<string,unknown>,summary:Record<string,unknown>) {
  for(const key of ['plannedIncomeMinor','plannedExpenseMinor','plannedSavingsMinor']) amount(summary[key]);
  for(const key of ['actualIncomeMinor','actualExpenseMinor','actualSavingsMinor']) amount(summary[key],true);
  list(summary.categories).forEach(trackingCategory);list(root.plans).forEach(plan);
  list(root.activity).forEach(value=>{transaction(value);if(!['income','expense','fee','refund'].includes(String(record(value).kind))) invalid();});
}
export function decodeBudgetView(value:string):BudgetData|TrackingData {
  const root=record(JSON.parse(value)),settings=record(root.settings),summary=record(root.summary);
  currency(settings.currency);text(summary.month);text(root.currentMonth);text(root.asOf);
  if(settings.revision!==undefined) nonnegative(settings.revision);
  if(settings.preferredMode!==undefined&&!['tracking','envelope'].includes(String(settings.preferredMode))) invalid();
  if(root.mode==='tracking') {text(settings.startMonth);nonnegative(settings.revision);tracking(root,summary);return root as unknown as TrackingData;}
  if(root.mode!==undefined&&root.mode!=='envelope') invalid();
  text(root.startMonth);
  amount(summary.cashMinor,true);amount(summary.unassignedMinor,true);
  list(summary.categories).forEach(category);list(root.balances).forEach(balance);list(root.activity).forEach(transaction);
  return root as unknown as BudgetData;
}
export function decodeCopyPreview(value:string):CopyPreview {
  const root=record(JSON.parse(value));text(root.month);text(root.sourceMonth);nonnegative(root.revision);nonnegative(root.sourceRevision);list(root.plans).forEach(plan);return root as unknown as CopyPreview;
}
export function decodeRolloverPreview(value:string):RolloverPreview {
  const root=record(JSON.parse(value));text(root.category);text(root.effectiveMonth);nonnegative(root.revision);
  if(!['carry_all','carry_positive','reset'].includes(String(root.policy))) invalid();
  list(root.changes).forEach(value=>{const row=record(value);text(row.month);text(row.category);for(const key of ['beforeOpeningMinor','afterOpeningMinor','beforeClosingMinor','afterClosingMinor']) amount(row[key],true);});
  return root as unknown as RolloverPreview;
}
