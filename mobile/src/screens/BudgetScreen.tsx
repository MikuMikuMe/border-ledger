import {AnalysisContent} from '../features/budget/AnalysisContent';
import React,{useEffect} from 'react';
import {BackHandler,TextInput,View} from 'react-native';
import {Action,Copy,MutationStatus} from '../features/finance/FinanceViews';
import {getCurrencyMeta} from '../../../src/domain/currencies';
import {BudgetContent} from '../features/budget/BudgetContent';
import {useMobileBudget} from '../features/budget/useMobileBudget';
import {TrackingContent} from '../features/budget/TrackingContent';
import {CopyPlanPreview,RolloverChangePreview} from '../features/budget/BudgetPreviews';
import type {BudgetService} from '../features/budget/budgetService';

type State=ReturnType<typeof useMobileBudget>;
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
  if(view.mode==='tracking')return <TrackingContent key={`${state.month}:tracking`} dark={dark} view={view} busy={busy} onWrite={state.write} onCopy={state.previewCopy}/>;
  return <BudgetContent key={`${state.month}:envelope`} dark={dark} currency={view.settings.currency} view={view} busy={busy} onWrite={state.write} onRollover={state.previewRollover} onPreviewChange={state.cancelPreview}/>;
}
function BudgetPreviews({dark,state}:{dark:boolean;state:State}) {
 useEffect(()=>{if(!state.copyPreview&&!state.rolloverPreview)return;const subscription=BackHandler?.addEventListener('hardwareBackPress',()=>{state.cancelPreview();return true;});return()=>subscription?.remove();},[state.copyPreview,state.rolloverPreview,state.cancelPreview]);
 const currency=state.view?.settings.currency??state.currency;
 return <>{state.previewLoading?<Copy dark={dark}>Preparing change preview…</Copy>:null}{state.copyPreview?<CopyPlanPreview dark={dark} currency={currency} preview={state.copyPreview} busy={state.mutation.blocked} onWrite={state.write} onCancel={state.cancelPreview}/>:null}{state.rolloverPreview?<RolloverChangePreview dark={dark} currency={currency} preview={state.rolloverPreview} busy={state.mutation.blocked} onWrite={state.write} onCancel={state.cancelPreview}/>:null}</>;
}
export function BudgetScreen({dark,service,showAnalysis=true}:{dark:boolean;service?:BudgetService;showAnalysis?:boolean}) {
  const state=useMobileBudget(service),busy=state.loading||state.mutation.blocked||state.previewLoading;
  return <View style={{gap:12}}><Copy dark={dark}>Plan each month and compare it with your confirmed activity.</Copy>{state.configured?<View accessibilityRole="radiogroup" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['envelope','tracking'] as const).map(mode=><Action key={mode} dark={dark} label={mode==='envelope'?'Envelope':'Tracking'} radio selected={state.mode===mode} disabled={busy} onPress={()=>state.selectMode(mode)}/>)}</View>:null}<Copy dark={dark}>Budget month (YYYY-MM)</Copy><TextInput accessibilityLabel="Budget month" value={state.draftMonth} onChangeText={state.setDraftMonth} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#718679':'#687D70',color:dark?'#EEF1E8':'#18201F'}}/><Action dark={dark} label="Show budget month" disabled={busy} onPress={state.selectMonth}/><Action dark={dark} label="Refresh budget" disabled={state.loading||state.mutation.blocked} onPress={()=>void state.load()}/><BudgetStatus dark={dark} state={state}/><BudgetPreviews dark={dark} state={state}/><BudgetBody dark={dark} state={state}/>{showAnalysis?<AnalysisContent dark={dark} month={state.month}/>:null}</View>;
}
