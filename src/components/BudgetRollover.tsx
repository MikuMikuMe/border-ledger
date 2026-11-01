import {useEffect,useRef,useState} from 'react';
import type {RolloverPolicy,RolloverPreview} from './BudgetTypes';
import type {useBudget} from './useBudget';
import {useBudgetDraft} from './useBudgetDraft';
import {money} from './budget-display';
type State=ReturnType<typeof useBudget>;
export const rolloverLabel:Record<RolloverPolicy,string>={carry_all:'Carry all balances',carry_positive:'Carry positive balances',reset:'Reset to zero'};
function RolloverCell({label,value,currency}:{label:string;value:number|null;currency:string}) {
 return <td role="cell"><span className="budget-rollover-cell-label" aria-hidden="true">{label}</span><span>{money(value,currency)}</span></td>;
}
function RolloverChanges({preview,currency}:{preview:RolloverPreview;currency:string}) {
 if(!preview.changes.length)return <p>No projected category balances change. The policy will apply from this outgoing month.</p>;
 return <div className="budget-rollover-changes" role="region" aria-label="Projected rollover changes"><table className="budget-totals-table budget-rollover-table" role="table"><caption>Before and after projected balances</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Month</th><th role="columnheader" scope="col">Before opening</th><th role="columnheader" scope="col">After opening</th><th role="columnheader" scope="col">Before closing</th><th role="columnheader" scope="col">After closing</th></tr></thead><tbody role="rowgroup">{preview.changes.map(row=><tr role="row" key={row.month}><th role="rowheader" scope="row">{row.month}</th><RolloverCell label="Before opening" value={row.beforeOpeningMinor} currency={currency}/><RolloverCell label="After opening" value={row.afterOpeningMinor} currency={currency}/><RolloverCell label="Before closing" value={row.beforeClosingMinor} currency={currency}/><RolloverCell label="After closing" value={row.afterClosingMinor} currency={currency}/></tr>)}</tbody></table></div>;
}
export function BudgetRollover({category,month,currency,currentPolicy,state}:{category:string;month:string;currency:string;currentPolicy:RolloverPolicy;state:State}) {
 const selectedPolicy=useRef(currentPolicy);
 const [policy,setPolicy]=useBudgetDraft(currentPolicy);
 selectedPolicy.current=policy;
 const [preview,setPreview]=useState<RolloverPreview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 useEffect(()=>{setPreview(null);},[policy]);
 async function load(){
  setLoading(true);setError(null);
  try{const result=await state.preview<RolloverPreview>(`rollover-preview?category=${encodeURIComponent(category)}&effectiveMonth=${month}&policy=${policy}`);if(policy===selectedPolicy.current)setPreview(result);}
  catch{setPreview(null);setError('Could not preview rollover. Check your connection and try again.');}
  finally{setLoading(false);}
 }
 async function confirm(){if(!preview)return;try{await state.guardedSave('rollover',{category,effectiveMonth:preview.effectiveMonth,policy:preview.policy},preview.revision);setPreview(null);}catch{setPreview(null);}}
 return <div className="budget-rollover"><form className="budget-inline-form" onSubmit={e=>{e.preventDefault();void load();}}><label>Rollover<select aria-label={`Rollover for ${category}`} value={policy} onChange={e=>{selectedPolicy.current=e.target.value as RolloverPolicy;setPolicy(selectedPolicy.current);setPreview(null);}}>{Object.entries(rolloverLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="budget-secondary" disabled={loading||state.busy}>{loading?'Loading preview…':'Preview rollover'}</button></form><p>Applies when {month} closes, and to following months until changed. Cash funding is based on actual balances.</p>{error?<p role="alert">{error}</p>:null}{preview?<section className="budget-preview" aria-label={`Rollover preview for ${category}`}><h4>{category}: {rolloverLabel[preview.policy]}</h4><p>Review changes from {preview.effectiveMonth} onward before saving.</p><RolloverChanges preview={preview} currency={currency}/><div className="budget-confirm-actions"><button type="button" disabled={state.busy} onClick={()=>void confirm()}>Save rollover policy</button><button type="button" className="budget-secondary" disabled={state.busy} onClick={()=>setPreview(null)}>Cancel</button></div></section>:null}</div>;
}
