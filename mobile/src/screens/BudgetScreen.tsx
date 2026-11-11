import {useAccessibilityReturnFocus} from '../features/finance/accessibilityFocus';
import {AnalysisContent} from '../features/budget/AnalysisContent';
import React,{useEffect,useState} from 'react';
import {BackHandler,TextInput,View} from 'react-native';
import {Action,Copy,DetailModal,MutationStatus} from '../features/finance/FinanceViews';
import {getCurrencyMeta} from '../../../src/domain/currencies';
import {BudgetContent} from '../features/budget/BudgetContent';
import {useMobileBudget} from '../features/budget/useMobileBudget';
import {TrackingContent} from '../features/budget/TrackingContent';
import {CopyPlanPreview,RolloverChangePreview} from '../features/budget/BudgetPreviews';
import type {BudgetService} from '../features/budget/budgetService';

type State=ReturnType<typeof useMobileBudget>;
const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
function BudgetMonthPicker({dark,month,onChoose,onClose}:{dark:boolean;month:string;onChoose(value:string):void;onClose():void}) {
 const [year,setYear]=useState(Number(month.slice(0,4)));
 return <DetailModal dark={dark} title="Choose budget month" onClose={onClose} dismissOutside compactClose><View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}><Action dark={dark} label="Previous year" text="Previous" disabled={year<=1} onPress={()=>setYear(year-1)}/><Copy dark={dark} heading>{year}</Copy><Action dark={dark} label="Next year" text="Next" disabled={year>=9999} onPress={()=>setYear(year+1)}/></View><View accessibilityRole="radiogroup" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{monthNames.map((name,index)=>{const value=`${String(year).padStart(4,'0')}-${String(index+1).padStart(2,'0')}`;return <Action key={name} dark={dark} label={`${name} ${year}`} text={name} radio selected={value===month} onPress={()=>{onChoose(value);onClose();}}/>;})}</View></DetailModal>;
}
function BudgetStatus({dark,state}:{dark:boolean;state:State}) {
  return <>{state.error?<View accessibilityRole="alert"><Copy dark={dark} error>{state.error}</Copy></View>:null}{state.loading?<Copy dark={dark}>Loading budget…</Copy>:null}<MutationStatus dark={dark} mutation={state.mutation}/>{state.mutation.blocked&&state.mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>void state.recover()}/>:null}</>;
}
function BudgetSetup({dark,state}:{dark:boolean;state:State}) {
  return <View style={{gap:8}}><Copy dark={dark} heading>Choose your budget currency</Copy><Copy dark={dark}>Transactions retain their original currency and use dated exchange rates.</Copy><TextInput accessibilityLabel="Budget currency" value={state.currency} autoCapitalize="characters" onChangeText={value=>state.setCurrency(value.toUpperCase())} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/><Action dark={dark} label="Create budget" disabled={state.mutation.blocked||!getCurrencyMeta(state.currency)} onPress={()=>state.write('settings',()=>({currency:state.currency,startMonth:state.month}))}/></View>;
}
function BudgetBody({dark,state}:{dark:boolean;state:State}) {
  if(state.configured===false) return <BudgetSetup dark={dark} state={state}/>;
  if(!state.view || state.view.summary.month!==state.month) return null;
  const view=state.view,busy=state.loading||state.mutation.blocked||state.previewLoading;
  if(view.mode==='tracking')return <TrackingContent key={`${state.month}:tracking`} dark={dark} view={view} busy={busy} onWrite={state.write} onCopy={state.previewCopy} status={<BudgetStatus dark={dark} state={state}/>}/>;
  return <BudgetContent key={`${state.month}:envelope`} dark={dark} currency={view.settings.currency} view={view} busy={busy} onWrite={state.write} onRollover={state.previewRollover} onPreviewChange={state.cancelPreview} status={<BudgetStatus dark={dark} state={state}/>}/>;
}
function BudgetPreviews({dark,state}:{dark:boolean;state:State}) {
 const [submitted,setSubmitted]=useState<'copy'|'rollover'|null>(null);
 const hasPreview=Boolean(state.copyPreview||state.rolloverPreview);
 const close=()=>{setSubmitted(null);state.cancelPreview();};
 useEffect(()=>{if(!hasPreview&&!submitted)return;const subscription=BackHandler?.addEventListener('hardwareBackPress',()=>{close();return true;});return()=>subscription?.remove();},[hasPreview,state.cancelPreview,submitted]);
 const currency=state.view?.settings.currency??state.currency;
 const write=(kind:'copy'|'rollover'):State['write']=>(action,build)=>{setSubmitted(kind);state.write(action,build);};
 return <>{state.previewLoading?<Copy dark={dark}>Preparing change preview…</Copy>:null}{state.copyPreview?<DetailModal dark={dark} title="Review plan copy" onClose={close}><BudgetStatus dark={dark} state={state}/><CopyPlanPreview dark={dark} currency={currency} preview={state.copyPreview} busy={state.mutation.blocked} onWrite={write('copy')} onCancel={close}/></DetailModal>:null}{state.rolloverPreview?<DetailModal dark={dark} title="Review rollover change" onClose={close}><BudgetStatus dark={dark} state={state}/><RolloverChangePreview dark={dark} currency={currency} preview={state.rolloverPreview} busy={state.mutation.blocked} onWrite={write('rollover')} onCancel={close}/></DetailModal>:null}{submitted&&!hasPreview?<DetailModal dark={dark} title={submitted==='copy'?'Plan copy':'Rollover change'} onClose={close}><BudgetStatus dark={dark} state={state}/>{state.mutation.status==='ready'?<Copy dark={dark}>Status checked. Refresh the budget to see the current result.</Copy>:null}<Action dark={dark} label="Close budget result" onPress={close}/></DetailModal>:null}</>;
}
export function BudgetScreen({dark,service,showAnalysis=true}:{dark:boolean;service?:BudgetService;showAnalysis?:boolean}) {
  const state=useMobileBudget(service),busy=state.loading||state.mutation.blocked||state.previewLoading;
  const [pickingMonth,setPickingMonth]=useState(false);
  const {remember:rememberMonth}=useAccessibilityReturnFocus(pickingMonth);
  return <View style={{gap:12}}><Copy dark={dark}>Plan each month and compare it with your confirmed activity.</Copy>{state.configured?<View accessibilityRole="radiogroup" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['envelope','tracking'] as const).map(mode=><Action key={mode} dark={dark} label={mode==='envelope'?'Envelope':'Tracking'} radio selected={state.mode===mode} disabled={busy} onPress={()=>state.selectMode(mode)}/>)}</View>:null}<Copy dark={dark}>Budget month</Copy><Action dark={dark} label="Choose budget month" onActivate={rememberMonth} text={state.month} value={state.month} disabled={busy} onPress={()=>setPickingMonth(true)}/>{pickingMonth?<BudgetMonthPicker dark={dark} month={state.month} onChoose={state.chooseMonth} onClose={()=>setPickingMonth(false)}/>:null}<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action dark={dark} label="Previous budget month" disabled={busy} onPress={()=>state.shiftMonth(-1)}/><Action dark={dark} label="Next budget month" disabled={busy} onPress={()=>state.shiftMonth(1)}/></View><Action dark={dark} label="Refresh budget" disabled={state.loading||state.mutation.blocked} onPress={()=>void state.load()}/><BudgetStatus dark={dark} state={state}/><BudgetPreviews dark={dark} state={state}/><BudgetBody dark={dark} state={state}/>{showAnalysis?<AnalysisContent dark={dark} month={state.month}/>:null}</View>;
}
