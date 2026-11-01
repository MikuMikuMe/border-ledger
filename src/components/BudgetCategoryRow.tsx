import {useState} from 'react';
import type {BudgetViewData,SuggestedCategory} from './BudgetTypes';
import {money,decimalAmount} from './budget-display';
import {BudgetRollover,rolloverLabel} from './BudgetRollover';
import type {useBudget} from './useBudget';
type Props={row:SuggestedCategory;currency:string;onAllocate(category:string,amount:string):void;onTarget(category:string,amount:string):void;busy:boolean;data:BudgetViewData;state:ReturnType<typeof useBudget>};
function rolloverPolicy(data:BudgetViewData,category:string) {
 const policies=data.rolloverPolicies??[];
 return policies.filter(p=>p.category===category && p.effectiveMonth<=data.summary.month).sort((a,b)=>b.effectiveMonth.localeCompare(a.effectiveMonth))[0]?.policy??'carry_all';
}
function CategorySuggestion({row,currency,busy,onUse}:{row:SuggestedCategory;currency:string;busy:boolean;onUse(value:string):void}) {
 if(row.suggestedMinor===null)return null;
 const assignedMinor=row.assignedMinor+row.suggestedMinor;
 return <button className="budget-suggestion" type="button" disabled={busy||!Number.isSafeInteger(assignedMinor)} onClick={()=>onUse(decimalAmount(assignedMinor,currency))}>Use {row.suggestionBasis==='history'?'spending':'target'} suggestion</button>;
}
function CategoryAmounts({row,currency,onAllocate,onTarget,busy}:Omit<Props,'data'|'state'>) {
 const [allocation,setAllocation]=useState(''),[target,setTarget]=useState('');
 return <div className="budget-actions">
  <CategorySuggestion row={row} currency={currency} busy={busy} onUse={setAllocation}/>
  <label>Set this month’s assignment<input aria-label={`Assignment for ${row.category}`} inputMode="decimal" value={allocation} onChange={e=>setAllocation(e.target.value)}/></label>
  <button type="button" disabled={busy} onClick={()=>onAllocate(row.category,allocation)}>Save assignment</button>
  <label>Monthly target<input aria-label={`Target for ${row.category}`} inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)}/></label>
  <button type="button" disabled={busy} onClick={()=>onTarget(row.category,target)}>Save target</button>
 </div>;
}
function CategoryContext({row,currency}:{row:SuggestedCategory;currency:string}) {
 return <><p>Carried {money(row.openingMinor,currency)} · Target {row.targetMinor===null?'Not set':money(row.targetMinor,currency)}</p>{row.suggestedMinor!==null?<p>Suggested {money(row.suggestedMinor,currency)}</p>:null}{row.missingTransactionIds.length?<p>Some dated exchange rates are unavailable.</p>:null}</>;
}
export function BudgetCategoryRow(props:Props) {
 const {row,currency,data,state}=props,policy=rolloverPolicy(data,row.category);
 return <details className="budget-ledger-row">
  <summary><span className="budget-row-name">{row.category}<small>{rolloverLabel[policy]}</small></span><span><span className="budget-cell-label">Assigned </span>{money(row.assignedMinor,currency)}</span><span><span className="budget-cell-label">Activity </span>{money(row.activityMinor,currency)}</span><strong><span className="budget-cell-label">Available </span>{money(row.availableMinor,currency)}</strong></summary>
  <div className="budget-row-editor"><CategoryContext row={row} currency={currency}/><CategoryAmounts {...props}/><BudgetRollover category={row.category} month={data.summary.month} currency={currency} currentPolicy={policy} state={state}/></div>
 </details>;
}
