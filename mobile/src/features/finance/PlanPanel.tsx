import React,{useCallback,useEffect,useState} from 'react';
import {View} from 'react-native';
import NativeRecurring,{type Plan,type PlanDraft,type PlanOccurrence} from '../../native/specs/NativeRecurring';
import NativeSession from '../../native/specs/NativeSession';
import {getCurrencyMeta,parseMoneyMinor} from '../../../../src/domain/currencies';
import {Copy,MutationStatus} from './FinanceViews';
import {PlanEditor, type PlanAccount, type PlanEditorDraft} from './PlanEditor';
import {PlanView} from './PlanView';
import type {MutationGate} from './model';

type Account=PlanAccount;
type Draft=PlanEditorDraft;
function shift(date:string,days:number) {const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
function todayIn(timeZone:string) {const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(name:string)=>p.find(x=>x.type===name)?.value;return `${get('year')}-${get('month')}-${get('day')}`;}
function amountText(minor:string,currency:string) {const digits=getCurrencyMeta(currency)?.minorUnitDigits??2, value=BigInt(minor),scale=10n**BigInt(digits);return digits?`${value/scale}.${(value%scale).toString().padStart(digits,'0')}`:value.toString();}
function newDraft(accounts:Account[],today:string):Draft{return {accountId:accounts[0]?.id??'',currency:accounts[0]?.currencies[0]??'CAD',merchant:'',direction:'expense',amount:'',frequency:'monthly',startDate:today,endDate:null,enabled:true};}
function fromPlan(plan:Plan):Draft{return {...plan,amount:amountText(plan.amountMinor,plan.currency)};}
function PlanFeedback({dark,error,gate}:{dark:boolean;error:string|null;gate:MutationGate}) {
  return <>
    {error?<View accessibilityRole="alert"><Copy dark={dark} error>{error}</Copy></View>:null}
    <MutationStatus dark={dark} mutation={gate.current()}/>
    {gate.current().status==='rejected'?<Copy dark={dark}>Check the plan details. If you signed in before this feature was added, sign in again to enable plan management.</Copy>:null}
  </>;
}
export function PlanPanel({dark,accounts,timeZone,gate,operationId}:{dark:boolean;accounts:Account[];timeZone:string;gate:MutationGate;operationId():string}) {
  const [plans,setPlans]=useState<Plan[]>([]),[occurrences,setOccurrences]=useState<PlanOccurrence[]>([]),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
  const [draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState<Plan|null>(null);
  const today=todayIn(timeZone),load=useCallback(async()=>{setLoading(true);setError(null);try{const [p,o]=await Promise.all([NativeRecurring.readPlans(),NativeRecurring.readPlanOccurrences({startDate:shift(today,-30),endDate:shift(today,30)})]);setPlans(p);setOccurrences(o);}catch{setError('Could not load recurring plans. Refresh to try again.');}finally{setLoading(false);}},[today]);
  useEffect(()=>{void load();},[load]);
  async function save(value:Draft,existing:Plan|null) {
    if(gate.current().blocked)return;
    let amount:number;try{amount=parseMoneyMinor(value.amount,value.currency);if(amount<=0)throw new Error();}catch{setError('Enter a valid amount greater than zero.');return;}
    const plan:PlanDraft={accountId:value.accountId,currency:value.currency,merchant:value.merchant,direction:value.direction,amountMinor:String(amount),frequency:value.frequency,startDate:value.startDate,endDate:value.endDate||null,enabled:value.enabled};
    const id=operationId();await gate.submit(id,()=>NativeRecurring.startSavePlan({operationId:id,id:existing?.id??null,expectedRevision:existing?.revision??0,plan}),key=>NativeSession.queryOperation({operationId:key}));
    if(gate.current().status==='completed'){setDraft(null);setEditing(null);await load();}
  }
  const toggle=(plan:Plan)=>{void save({...fromPlan(plan),enabled:!plan.enabled},plan);};
  return <>
    <PlanFeedback dark={dark} error={error} gate={gate}/>
    <PlanView dark={dark} plans={plans} occurrences={occurrences} busy={loading||gate.current().blocked} onAdd={()=>{setEditing(null);setDraft(newDraft(accounts,today));}} onEdit={plan=>{setEditing(plan);setDraft(fromPlan(plan));}} onToggle={toggle} onRefresh={()=>void load()}/>
    {draft?<PlanEditor dark={dark} draft={draft} accounts={accounts} editing={Boolean(editing)} busy={gate.current().blocked} onChange={setDraft} onSave={()=>void save(draft,editing)} onClose={()=>setDraft(null)}/>:null}
  </>;
}
