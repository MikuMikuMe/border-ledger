import {AnalysisContent} from '../features/budget/AnalysisContent';
import React from 'react';
import {TextInput,View} from 'react-native';
import {Action,Copy,MutationStatus} from '../features/finance/FinanceViews';
import {getCurrencyMeta} from '../../../src/domain/currencies';
import {BudgetContent} from '../features/budget/BudgetContent';
import {useMobileBudget} from '../features/budget/useMobileBudget';

type State=ReturnType<typeof useMobileBudget>;
function BudgetStatus({dark,state}:{dark:boolean;state:State}) {
  return <>{state.error?<View accessibilityRole="alert"><Copy dark={dark} error>{state.error}</Copy></View>:null}{state.loading?<Copy dark={dark}>Loading budget…</Copy>:null}<MutationStatus dark={dark} mutation={state.mutation}/>{state.mutation.blocked&&state.mutation.status!=='saving'?<Action dark={dark} label="Refresh submitted operation status" onPress={()=>void state.recover()}/>:null}</>;
}
function BudgetSetup({dark,state}:{dark:boolean;state:State}) {
  return <View style={{gap:8}}><Copy dark={dark} heading>Choose your budget currency</Copy><Copy dark={dark}>Transactions retain their original currency and use dated exchange rates.</Copy><TextInput accessibilityLabel="Budget currency" value={state.currency} autoCapitalize="characters" onChangeText={value=>state.setCurrency(value.toUpperCase())} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/><Action dark={dark} label="Create budget" disabled={state.mutation.blocked||!getCurrencyMeta(state.currency)} onPress={()=>state.write('settings',()=>({currency:state.currency,startMonth:state.month}))}/></View>;
}
function BudgetBody({dark,state}:{dark:boolean;state:State}) {
  if(state.loading) return null;
  if(state.configured===false) return <BudgetSetup dark={dark} state={state}/>;
  if(!state.view) return null;
  return <BudgetContent dark={dark} currency={state.view.settings.currency} view={state.view} busy={state.mutation.blocked} onWrite={state.write}/>;
}
export function BudgetScreen({dark}:{dark:boolean}) {
  const state=useMobileBudget();
  return <View style={{gap:12}}><Copy dark={dark}>Give your available money a job, then adjust as life changes.</Copy><Copy dark={dark}>Budget month (YYYY-MM)</Copy><TextInput accessibilityLabel="Budget month" value={state.draftMonth} onChangeText={state.setDraftMonth} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/><Action dark={dark} label="Show budget month" onPress={state.selectMonth}/><BudgetStatus dark={dark} state={state}/><BudgetBody dark={dark} state={state}/><AnalysisContent dark={dark} month={state.month}/></View>;
}
