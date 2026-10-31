import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { LedgerApi } from '../domain/api';
import type { RecurringPlan, PlanOccurrence } from '../domain/recurring-plans';
import { getCurrencyMeta, parseMoneyMinor } from '../domain/currencies';
import { RecurringPlanRows } from './RecurringPlanRows';
import { RecurringPlanForm } from './RecurringPlanForm';

export type AccountOption = {id:string;name:string;currency:string};
export type Draft = {accountId:string;currency:string;merchant:string;direction:'expense'|'income';amount:string;frequency:'weekly'|'biweekly'|'monthly'|'yearly';startDate:string;endDate:string};
function offset(date:string, days:number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate()+days); return value.toISOString().slice(0,10); }
function emptyDraft(accounts:AccountOption[],today:string):Draft { return {accountId:accounts[0]?.id ?? '', currency:accounts[0]?.currency ?? 'CAD', merchant:'',direction:'expense',amount:'',frequency:'monthly',startDate:today,endDate:''}; }
function editDraft(plan:RecurringPlan):Draft { const digits=getCurrencyMeta(plan.currency)?.minorUnitDigits ?? 2, minor=BigInt(plan.amountMinor), scale=10n**BigInt(digits); const amount=digits ? `${minor/scale}.${(minor%scale).toString().padStart(digits,'0')}` : minor.toString(); return { ...plan, amount, endDate:plan.endDate ?? '' }; }
async function persistDraft({api,draft,editing,operationId}:{api:LedgerApi;draft:Draft;editing:RecurringPlan|null;operationId:{current:string|null}}) {
  const plan={accountId:draft.accountId,currency:draft.currency,merchant:draft.merchant,direction:draft.direction,amountMinor:parseMoneyMinor(draft.amount,draft.currency),frequency:draft.frequency,startDate:draft.startDate,endDate:draft.endDate || null};
  if(plan.amountMinor<=0)throw new Error('Enter an amount greater than zero.');
  if(editing) return api(`/api/recurring-plans/${editing.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:editing.revision,plan:{...plan,enabled:editing.enabled}})});
  operationId.current ??= crypto.randomUUID();
  return api('/api/recurring-plans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:operationId.current,plan})});
}
export function RecurringPlans({api,accounts,today}:{api:LedgerApi;accounts:AccountOption[];today:string}) {
  const [plans,setPlans]=useState<RecurringPlan[]>([]),[occurrences,setOccurrences]=useState<PlanOccurrence[]>([]);
  const [accountCurrencies,setAccountCurrencies]=useState<{accountId:string;currency:string}[]>([]);
  const operationId=useRef<string|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState<RecurringPlan|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    const [p,o]=await Promise.all([api<{plans:RecurringPlan[];accountCurrencies?:{accountId:string;currency:string}[]}>('/api/recurring-plans'),api<{occurrences:PlanOccurrence[]}>(`/api/recurring-plans/occurrences?from=${offset(today,-30)}&to=${offset(today,30)}`)]);
    setPlans(p.plans);setAccountCurrencies(p.accountCurrencies??[]);setOccurrences(o.occurrences);
  },[api,today]);
  useEffect(()=>{let active=true;void load().catch(()=>{if(active)setError('Could not load recurring plans. Try refreshing.');});return()=>{active=false;};},[load]);
  async function submit(event:FormEvent) {
    event.preventDefault();if(!draft || busy)return;setBusy(true);setError(null);
    try {
      await persistDraft({api,draft,editing,operationId});
      operationId.current=null;setDraft(null);setEditing(null);await load();
    } catch(e) {setError(e instanceof Error ? e.message : 'Could not save this plan.');} finally {setBusy(false);}
  }
  async function toggle(plan:RecurringPlan) {setBusy(true);setError(null);try {await api(`/api/recurring-plans/${plan.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:plan.revision,plan:{...plan,enabled:!plan.enabled}})});await load();}catch{setError('Could not update the plan. Refresh and try again.');}finally{setBusy(false);}}
  return <section className="panel recurring-stream-panel" aria-labelledby="plans-title">
    <div className="section-heading recurring-plan-heading"><div><h2 id="plans-title">Your recurring plans</h2><p>Dates are estimates. Transactions match the same account, currency, payee and amount within seven days.</p></div><button type="button" className="outline-button" onClick={()=>{operationId.current=null;setEditing(null);setDraft(emptyDraft(accounts,today));}} disabled={!accounts.length || busy}>Add plan</button><button type="button" className="quiet-button" disabled={busy} onClick={()=>void load().catch(()=>setError('Could not refresh plans.'))}>Refresh plans</button></div>
    {error?<p role="alert">{error}</p>:null}
    {draft?<RecurringPlanForm draft={draft} setDraft={setDraft} accounts={accounts} accountCurrencies={accountCurrencies} busy={busy} onSubmit={event=>void submit(event)}/>:null}
    <RecurringPlanRows plans={plans} occurrences={occurrences} busy={busy} onEdit={plan=>{setEditing(plan);setDraft(editDraft(plan));}} onToggle={plan=>void toggle(plan)}/>
  </section>;
}
