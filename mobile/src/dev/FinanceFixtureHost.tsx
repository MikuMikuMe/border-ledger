/** Loaded only from __DEV__. No native service imports or financial writes. */
import React,{useEffect,useState} from 'react';
import {ScrollView,StatusBar,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Action,ActivityView,OverviewView,RecurringView} from '../features/finance/FinanceViews';
import {report,transaction,stream} from './financeFixtures';
import type {ActivityQuery,Lens,Transaction,Stream} from '../features/finance/contracts';
import type {LoadState} from '../features/finance/model';
type Fixture={screen:'overview'|'activity'|'recurring';state:string;dark:boolean};
declare global {var __borderLedgerFinanceFixture: {show(value:Fixture):void;hide():void}|undefined;}
type FixtureDataProps={fixture:Fixture;lens:Lens;onLens(value:Lens):void;filters:Partial<ActivityQuery>;onFilter(value:Partial<ActivityQuery>):void;selected:Transaction|null;onSelect(value:Transaction|null):void;selectedStream:Stream|null;onSelectStream(value:Stream|null):void;draft:{category:string;note:string};onDraft(value:{category:string;note:string}):void;};
const selectedStates=['detail','conflict','saving','unresolved'];
const fixturePhases:Record<string,LoadState<unknown>['phase']>={loading:'loading',locked:'locked',error:'error',offline:'offline'};
const missingFixtureData=new Set(['loading','locked','error']);
const fixtureMessages:Record<string,string>={offline:'Unavailable offline. Showing cached fixture.',locked:'Renew your owner session to continue.',error:'Fixture service unavailable. Try again.'};
const recurringUnavailableStates=new Set(['waiting','incomplete','stale','unavailable','error','empty']);
const financeFixtureColors={light:{background:'#F3EFE6',text:'#18201F',status:'dark-content' as const},dark:{background:'#101715',text:'#EEF1E8',status:'light-content' as const}};
const activityMutationStatus:Record<string,string>={conflict:'revision_conflict',saving:'saving',unresolved:'reconciliation_required'};
function selectedFixtureTransaction(value:Fixture){return value.screen==='activity'&&selectedStates.includes(value.state)?transaction:null;}
function fixtureResource<T>(state:string,data:T):LoadState<T>{
  const phase=fixturePhases[state]??'ready';
  return {phase,data:missingFixtureData.has(state)?null:data,message:fixtureMessages[state]??null};
}
function fixturePage(state:string){
  const items=state==='empty'?[]:[stream];
  return {items,nextCursor:items.length?'fixture_page':null,limit:50,state:recurringUnavailableStates.has(state)?state:'ready',checkedAt:'2026-10-17T12:00:00Z',sourceUpdatedAt:'2026-10-16T12:00:00Z',lastError:null,coverageWarnings:['Synthetic limited coverage']};
}
function fixtureReport(state:string){return state==='empty'?{...report,currencyTotals:[],dailyTotals:[],reviewCount:0}:report;}
function fixtureTransactions(state:string){return state==='empty'?[]:[transaction];}
function fixtureActivityMutation(state:string){return {blocked:state==='saving'||state==='unresolved',status:activityMutationStatus[state]??'ready'};}
function fixtureRecurringData(state:string){
  const page=fixturePage(state),money=[{currency:'CAD',amountMinor:'1000'}];
  return {page,summary:{monthlyByCurrency:money,yearlyByCurrency:[{currency:'CAD',amountMinor:'12000'}],subscriptionByCurrency:money,actualCostByCurrency:[{currency:'CAD',amountMinor:'800'}],upcoming:[{stream,nextExpectedAmountMinor:'1000'}],latestPaymentChanges:[stream],streamCount:1,state:page.state,coverageWarnings:[],checkedAt:page.checkedAt,sourceUpdatedAt:page.sourceUpdatedAt,lastError:null}};
}
function renderFixtureScreen(props:FixtureDataProps){
  const {fixture,lens,onLens,filters,onFilter,selected,onSelect,selectedStream,onSelectStream,draft,onDraft}=props,{dark,state,screen}=fixture;
  switch(screen){
    case 'overview': return <OverviewView dark={dark} state={fixtureResource(state,fixtureReport(state))} snapshot={null} lens={lens} onLens={onLens} currencies={['CAD','CNY','JPY']} onRetry={()=>{}}/>;
    case 'activity': return <ActivityView dark={dark} state={fixtureResource(state,{items:fixtureTransactions(state),nextCursor:'fixture_page',limit:50})} filters={filters} onFilter={onFilter} onRetry={()=>{}} onOpen={()=>onSelect(transaction)} onLoadMore={()=>{}} selected={selected} draft={draft} onDraft={onDraft} mutation={fixtureActivityMutation(state)} onSave={()=>{}} onClose={()=>onSelect(null)}/>;
    case 'recurring': return <RecurringView dark={dark} state={fixtureResource(state,fixtureRecurringData(state))} filters={filters} onFilter={onFilter} currencies={['CAD','CNY','USD','HKD','JPY']} selected={selectedStream} mutation={{blocked:false,status:'ready'}} onClassify={()=>{}} onClose={()=>onSelectStream(null)} onRetry={()=>{}} onOpen={()=>onSelectStream(stream)} onLoadMore={()=>{}}/>;
  }
}
export function FinanceFixtureHost({children}:{children:React.ReactNode}) {
  const [fixture,setFixture]=useState<Fixture|null>(null),[selected,setSelected]=useState<Transaction|null>(null),[selectedStream,setSelectedStream]=useState<Stream|null>(null),[draft,setDraft]=useState({category:'Food',note:''}),[lens,setLens]=useState<Lens>({window:'Month',source:null,target:null,include:false});
  const [filters,setFilters]=useState<Partial<ActivityQuery>>({});
  useEffect(()=>{
    globalThis.__borderLedgerFinanceFixture={show:value=>{setSelected(selectedFixtureTransaction(value));setSelectedStream(null);setFixture(value);},hide:()=>setFixture(null)};
    return()=>{delete globalThis.__borderLedgerFinanceFixture;};
  },[]);
  if(!fixture)return children;
  const {dark,state,screen}=fixture;
  const colors=financeFixtureColors[dark?'dark':'light'];
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}><StatusBar barStyle={colors.status}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{color:colors.text,fontSize:24}}>Synthetic fixture · {screen} · {state}</Text>
    {renderFixtureScreen({fixture,lens,onLens:setLens,filters,onFilter:setFilters,selected,onSelect:setSelected,selectedStream,onSelectStream:setSelectedStream,draft,onDraft:setDraft})}
    <View style={{marginTop:20}}><Action dark={dark} label="Exit synthetic fixture" onPress={()=>setFixture(null)}/></View>
  </ScrollView></SafeAreaView>;
}
