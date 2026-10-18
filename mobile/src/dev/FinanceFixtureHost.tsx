/** Loaded only from __DEV__. No native service imports or financial writes. */
import React,{useEffect,useState} from 'react';
import {ScrollView,StatusBar,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Action,ActivityView,OverviewView,RecurringView} from '../features/finance/FinanceViews';
import {report,transaction,stream} from './financeFixtures';
import type {Lens,Transaction,Stream} from '../features/finance/contracts';
import type {LoadState} from '../features/finance/model';
type Fixture={screen:'overview'|'activity'|'recurring';state:string;dark:boolean};
declare global {var __borderLedgerFinanceFixture: {show(value:Fixture):void;hide():void}|undefined;}
export function FinanceFixtureHost({children}:{children:React.ReactNode}) {
  const [fixture,setFixture]=useState<Fixture|null>(null),[selected,setSelected]=useState<Transaction|null>(null),[selectedStream,setSelectedStream]=useState<Stream|null>(null),[draft,setDraft]=useState({category:'Food',note:''}),[lens,setLens]=useState<Lens>({window:'Month',source:null,target:null,include:false});
  const [filters,setFilters]=useState({});
  useEffect(()=>{
    globalThis.__borderLedgerFinanceFixture={show:value=>{setSelected(value.screen==='activity'&&['detail','conflict','saving','unresolved'].includes(value.state)?transaction:null);setSelectedStream(null);setFixture(value);},hide:()=>setFixture(null)};
    return()=>{delete globalThis.__borderLedgerFinanceFixture;};
  },[]);
  if(!fixture)return children;
  const {dark,state,screen}=fixture;
  const resource=<T,>(data:T):LoadState<T>=>({phase:['loading','offline','error','locked'].includes(state)?state as LoadState<T>['phase']:'ready',data:['loading','locked','error'].includes(state)?null:data,message:state==='offline'?'Unavailable offline. Showing cached fixture.':state==='locked'?'Renew your owner session to continue.':state==='error'?'Fixture service unavailable. Try again.':null});
  const money=[{currency:'CAD',amountMinor:'1000'}];
  const page={items:state==='empty'?[]:[stream],nextCursor:state==='empty'?null:'fixture_page',limit:50,state:['waiting','incomplete','stale','unavailable','error','empty'].includes(state)?state:'ready',checkedAt:'2026-10-17T12:00:00Z',sourceUpdatedAt:'2026-10-16T12:00:00Z',lastError:null,coverageWarnings:['Synthetic limited coverage']};
  return <SafeAreaView style={{flex:1,backgroundColor:dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{color:dark?'#EEF1E8':'#18201F',fontSize:24}}>Synthetic fixture · {screen} · {state}</Text>
    {screen==='overview'?<OverviewView dark={dark} state={resource(state==='empty'?{...report,currencyTotals:[],dailyTotals:[],reviewCount:0}:report)} snapshot={null} lens={lens} onLens={setLens} currencies={['CAD','CNY','JPY']} onRetry={()=>{}}/>:null}
    {screen==='activity'?<ActivityView dark={dark} state={resource({items:state==='empty'?[]:[transaction],nextCursor:'fixture_page',limit:50})} filters={filters} onFilter={setFilters} onRetry={()=>{}} onOpen={()=>setSelected(transaction)} onLoadMore={()=>{}} selected={selected} draft={draft} onDraft={setDraft} mutation={{blocked:state==='saving'||state==='unresolved',status:state==='conflict'?'revision_conflict':state==='saving'?'saving':state==='unresolved'?'reconciliation_required':'ready'}} onSave={()=>{}} onClose={()=>setSelected(null)}/>:null}
    {screen==='recurring'?<RecurringView dark={dark} state={resource({page,summary:{monthlyByCurrency:money,yearlyByCurrency:[{currency:'CAD',amountMinor:'12000'}],subscriptionByCurrency:money,actualCostByCurrency:[{currency:'CAD',amountMinor:'800'}],upcoming:[{stream,nextExpectedAmountMinor:'1000'}],latestPaymentChanges:[stream],streamCount:1,state:page.state,coverageWarnings:[],checkedAt:page.checkedAt,sourceUpdatedAt:page.sourceUpdatedAt,lastError:null}})} filters={filters} onFilter={setFilters} currencies={['CAD','CNY','USD','HKD','JPY']} selected={selectedStream} mutation={{blocked:false,status:'ready'}} onClassify={()=>{}} onClose={()=>setSelectedStream(null)} onRetry={()=>{}} onOpen={()=>setSelectedStream(stream)} onLoadMore={()=>{}}/>:null}
    <View style={{marginTop:20}}><Action dark={dark} label="Exit synthetic fixture" onPress={()=>setFixture(null)}/></View>
  </ScrollView></SafeAreaView>;
}
