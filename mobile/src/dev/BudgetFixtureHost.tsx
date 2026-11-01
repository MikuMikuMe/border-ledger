/** Debug-only synthetic budgeting scenes; no user data or provider calls. */
import React,{useEffect,useRef,useState} from 'react';
import {ScrollView,StatusBar,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {BudgetContent,type BudgetData} from '../features/budget/BudgetContent';
import {AnalysisContent} from '../features/budget/AnalysisContent';
import {Copy} from '../features/finance/FinanceViews';
import {fixtureAnalysis,fixtureWrite} from './BudgetFixtureActions';
import {BudgetScreen} from '../screens/BudgetScreen';
import {localBudgetService} from './LocalBudgetService';
import {ShellNavigation} from '../screens/ShellNavigation';
type Scene={dark:boolean;screen:'budget'|'analysis'|'budget-api'|'budget-shell-api'};
declare global {var __borderLedgerBudgetFixture:{show(value:Scene):void;hide():void}|undefined;}
const data:BudgetData={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:150000,unassignedMinor:35000,categories:[{category:'Food',openingMinor:5000,assignedMinor:25000,activityMinor:-13000,availableMinor:17000,targetMinor:30000,suggestedMinor:5000,suggestionBasis:'target',missingTransactionIds:[]},{category:'Rent',openingMinor:0,assignedMinor:40000,activityMinor:0,availableMinor:40000,targetMinor:null,suggestedMinor:null,suggestionBasis:null,missingTransactionIds:[]}]},balances:[{id:'account',accountId:'account',name:'Everyday account',source:'lunchflow',sourceCurrency:'CAD',sourceMinor:150000,amountMinor:150000,rateDate:null,observedAt:'2026-10-30T12:00:00Z'}],activity:[],currentMonth:'2026-10',asOf:'2026-10-30T12:00:00Z',startMonth:'2026-10'};
function LocalBudgetPreview({scene}:{scene:Scene}) {
  if(scene.screen==='budget-shell-api')return <ShellNavigation dark={scene.dark} initialDestination="overview" onAbout={()=>{}} onSignOut={async()=>globalThis.__borderLedgerBudgetFixture?.hide()} renderPage={page=>page==='budget'?<BudgetScreen dark={scene.dark} service={localBudgetService} showAnalysis={false}/>:<Copy dark={scene.dark}>Synthetic local budget API. Open More, then Budget.</Copy>}/>;
  return <SafeAreaView style={{flex:1,backgroundColor:scene.dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={scene.dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Copy dark={scene.dark} heading>Synthetic local budget API</Copy><BudgetScreen dark={scene.dark} service={localBudgetService} showAnalysis={false}/></ScrollView></SafeAreaView>;
}
export function BudgetFixtureHost({children}:{children:React.ReactNode}) {
  const [scene,setScene]=useState<Scene|null>(null),[view,setView]=useState(data),sharing=useRef(false);
  const execute=(action:string,body:string)=>fixtureAnalysis(sharing,action,body);
  const write=(action:string,build:(id:string)=>unknown)=>{
    const input=build('synthetic-operation') as Parameters<typeof fixtureWrite>[2];
    setView(current=>fixtureWrite(current,action,input));
  };
  useEffect(()=>{globalThis.__borderLedgerBudgetFixture={show:setScene,hide:()=>setScene(null)};return()=>{delete globalThis.__borderLedgerBudgetFixture;};},[]);
  if(!scene||!__DEV__)return children;
  if(scene.screen.endsWith('-api'))return <LocalBudgetPreview scene={scene}/>;
  return <SafeAreaView style={{flex:1,backgroundColor:scene.dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={scene.dark?'light-content':'dark-content'}/><ScrollView contentContainerStyle={{padding:22,paddingBottom:40}}><View style={{gap:12}}><Copy dark={scene.dark} heading>Synthetic {scene.screen} preview</Copy>{scene.screen==='budget'?<BudgetContent dark={scene.dark} currency="CAD" view={view} busy={false} onWrite={write}/>:<AnalysisContent dark={scene.dark} month="2026-10" execute={execute}/>}</View></ScrollView></SafeAreaView>;
}
