import React from 'react';
import {View} from 'react-native';
import type {Plan, PlanOccurrence} from '../../native/specs/NativeRecurring';
import {Action,Card,Copy} from './FinanceViews';
import {formatMoney} from './model';
const labels:Record<string,string>={expected:'Expected',matched:'Matched',pending:'Pending',ambiguous:'Review matches',potentially_missing:'Possibly missing',not_assessable:'Unable to assess'};
export function PlanView({dark,plans,occurrences,onAdd,onEdit,onToggle,onRefresh,busy}:{dark:boolean;plans:Plan[];occurrences:PlanOccurrence[];onAdd():void;onEdit(plan:Plan):void;onToggle(plan:Plan):void;onRefresh():void;busy:boolean}) {
  return <View style={{gap:12,marginTop:20}}>
    <Copy dark={dark} heading>Your recurring plans</Copy><Copy dark={dark}>Dates are estimates. Transactions match the same account, currency, payee and amount within seven days.</Copy>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action dark={dark} label="Add recurring plan" disabled={busy} onPress={onAdd}/><Action dark={dark} label="Refresh recurring plans" disabled={busy} onPress={onRefresh}/></View>
    {!plans.length?<Copy dark={dark}>No plans yet. Add a bill or income to see expected dates.</Copy>:null}
    {plans.map(plan=><Card dark={dark} key={plan.id}><Copy dark={dark} heading>{plan.merchant}</Copy><Copy dark={dark}>{formatMoney(plan.amountMinor,plan.currency)} · {plan.currency} · {plan.frequency} · {plan.enabled?'Active':'Paused'}</Copy>
      {occurrences.filter(item=>item.planId===plan.id).map(item=><Copy dark={dark} key={item.date}>{item.date} · {labels[item.status]??'Unavailable'}{item.status==='ambiguous'?` (${item.candidateCount} candidates)`:''}{item.status==='not_assessable'?' — sync or statement coverage is insufficient.':''}{item.status==='potentially_missing'?' — a provider update may still be pending.':''}{item.candidateDetails?.map(candidate=>` · ${candidate.date}: ${candidate.merchant}, ${formatMoney(candidate.amountMinor,candidate.currency)} (${candidate.status})`).join('')}{item.candidateCount>2?' · Showing two; search Activity for the payee to review the rest.':''}</Copy>)}
      <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}><Action dark={dark} label={`Edit ${plan.merchant}`} disabled={busy} onPress={()=>onEdit(plan)}/><Action dark={dark} label={`${plan.enabled?'Pause':'Resume'} ${plan.merchant}`} disabled={busy} onPress={()=>onToggle(plan)}/></View></Card>)}
  </View>;
}
