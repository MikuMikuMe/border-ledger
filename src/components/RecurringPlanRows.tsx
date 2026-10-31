import {formatMoney} from '../domain/format';
import type {PlanOccurrence,RecurringPlan} from '../domain/recurring-plans';
const labels: Record<PlanOccurrence['status'], string> = { expected: 'Expected', matched: 'Matched', pending: 'Pending', ambiguous: 'Review matches', potentially_missing: 'Possibly missing', not_assessable: 'Unable to assess' };
function Occurrence({item}:{item:PlanOccurrence}) {
  return <p>{item.date} · {labels[item.status]}{item.status==='ambiguous'?` (${item.candidateCount} candidates)`:''}{item.status==='not_assessable'?' — sync or statement coverage is insufficient.':''}{item.status==='potentially_missing'?' — a provider update may still be pending.':''}{item.candidateDetails?.map(candidate=><span key={candidate.id}> · {candidate.date}: {candidate.merchant}, {formatMoney(candidate.amountMinor,candidate.currency)} ({candidate.status})</span>)}{item.candidateCount>2?' · Showing two; search Activity for the payee to review the rest.':''}</p>;
}
export function RecurringPlanRows({plans,occurrences,busy,onEdit,onToggle}:{plans:RecurringPlan[];occurrences:PlanOccurrence[];busy:boolean;onEdit(plan:RecurringPlan):void;onToggle(plan:RecurringPlan):void}) {
  if(!plans.length)return <p>No plans yet. Add a bill or income to see its expected dates.</p>;
  return <div className="recurring-stream-list">{plans.map(plan=><div key={plan.id} className="recurring-plan-row"><div><strong>{plan.merchant}</strong><p>{formatMoney(plan.amountMinor,plan.currency)} · {plan.currency} · {plan.frequency} · {plan.enabled?'Active':'Paused'}</p>{occurrences.filter(item=>item.planId===plan.id).map(item=><Occurrence key={item.date} item={item}/>)}</div><div><button type="button" className="quiet-button" onClick={()=>onEdit(plan)}>Edit</button><button type="button" className="quiet-button" disabled={busy} onClick={()=>onToggle(plan)}>{plan.enabled?'Pause':'Resume'}</button></div></div>)}</div>;
}
