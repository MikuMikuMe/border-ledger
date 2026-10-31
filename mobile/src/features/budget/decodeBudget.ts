import {getCurrencyMeta} from '../../../../src/domain/currencies';
import type {BudgetData} from './BudgetContent';
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
export function decodeBudgetView(value:string):BudgetData {
  const root=record(JSON.parse(value)),settings=record(root.settings),summary=record(root.summary);
  currency(settings.currency);text(summary.month);text(root.currentMonth);text(root.startMonth);text(root.asOf);
  amount(summary.cashMinor,true);amount(summary.unassignedMinor,true);
  list(summary.categories).forEach(category);list(root.balances).forEach(balance);list(root.activity).forEach(transaction);
  return root as unknown as BudgetData;
}
