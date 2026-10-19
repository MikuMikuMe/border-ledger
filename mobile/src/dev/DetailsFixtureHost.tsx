/** Debug-only synthetic renderer. No native service imports or financial writes. */
import React,{useEffect,useState} from 'react';
import {ScrollView,StatusBar,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AccountsView,RecurringDetailView,ReviewView} from '../features/details/DetailsViews';
import {Action} from '../features/finance/FinanceViews';
import type {AccountsData,Alert} from '../features/details/contracts';
import type {LoadState} from '../features/finance/model';
import {account,alert,connection,detail,link} from './detailsFixtures';
type Fixture={screen:'recurring-detail'|'review'|'accounts';state:string;dark:boolean};
declare global {var __borderLedgerDetailsFixture:{show(value:Fixture):void;hide():void}|undefined;}
const nonReadyStates=new Set(['loading','offline','error','locked']);
const hiddenStates=new Set(['loading','error','locked']);
const reviewSelectionStates=new Set(['detail','conflict','saving','unresolved']);
const accountLinkStates=new Set(['pending','canceled','failed','unsupported','linking','connected']);
const accountOutcomeStates=new Set(['canceled','failed','unsupported']);
const fixtureMessages:Record<string,string>={offline:'Unavailable offline. Showing cached fixture.',locked:'Renew your owner session to continue.',error:'Fixture native service unavailable. Refresh to retry.'};

function fixtureResource<T>(state:string,data:T):LoadState<T>{
  const phase=nonReadyStates.has(state)?state as LoadState<T>['phase']:'ready';
  const hidden=hiddenStates.has(state);
  const message=fixtureMessages[state]??null;
  return {phase,data:hidden?null:data,message};
}

function fixtureMutation(state:string){
  return {blocked:state==='saving'||state==='unresolved',status:state==='conflict'?'revision_conflict':state==='saving'?'saving':state==='unresolved'?'reconciliation_required':'ready'} as const;
}

const noop=()=>{};

type FixtureContentProps={fixture:Fixture;selected:Alert|null;draft:{category:string;note:string};setFixture:()=>void;setSelected:React.Dispatch<React.SetStateAction<Alert|null>>;setDraft:React.Dispatch<React.SetStateAction<{category:string;note:string}>>};

function fixtureDetailState(state:string){return fixtureResource(state,{...detail,history:state==='empty'?[]:detail.history});}
function fixtureReviewState(state:string){return fixtureResource(state,{items:state==='empty'?[]:[alert],nextCursor:null,limit:50});}
function fixtureAccountsState(state:string):LoadState<AccountsData>{return fixtureResource(state,{page:{accounts:state==='empty'?[]:[account],nextCursor:null,limit:50},connections:state==='empty'?[]:[{...connection,lastError:state==='failed'?'ITEM_LOGIN_REQUIRED':null}],link:{...link,state:accountLinkStates.has(state)?state:'idle',outcomeCode:accountOutcomeStates.has(state)?state:state==='pending'?'success':null,canCancel:state==='linking',pendingConnectionId:state==='pending'?'pending_1':null,accounts:state==='pending'?[account]:[]}});}

function FixtureScreen({fixture,selected,draft,mutation,detailState,reviewState,accountsState,setFixture,setSelected,setDraft}:{fixture:Fixture;selected:Alert|null;draft:{category:string;note:string};mutation:ReturnType<typeof fixtureMutation>;detailState:LoadState<typeof detail>;reviewState:LoadState<{items:Alert[];nextCursor:null;limit:number}>;accountsState:LoadState<AccountsData>;setFixture:()=>void;setSelected:React.Dispatch<React.SetStateAction<Alert|null>>;setDraft:React.Dispatch<React.SetStateAction<{category:string;note:string}>>}){
  if(fixture.screen==='recurring-detail')return <RecurringDetailView dark={fixture.dark} state={detailState} mutation={mutation} onRetry={noop} onLoadMore={noop} onClassify={noop} onClose={setFixture}/>;
  if(fixture.screen==='review')return <ReviewView dark={fixture.dark} state={reviewState} mutation={mutation} selected={selected} draft={draft} onDraft={setDraft} onOpen={setSelected} onClose={()=>setSelected(null)} onResolve={noop} onSave={noop} onRetry={noop} onLoadMore={noop}/>;
  return <AccountsView dark={fixture.dark} state={accountsState} mutation={mutation} onConnect={noop} onCancelConnect={noop} onSelect={noop} onCancel={noop} onSync={noop} onDisconnect={noop} onRetry={noop} onLoadMore={noop}/>;
}

function FixtureContent({fixture,selected,draft,setFixture,setSelected,setDraft}:FixtureContentProps){
  const {screen,state,dark}=fixture;
  const mutation=fixtureMutation(state);
  const detailState=fixtureDetailState(state),reviewState=fixtureReviewState(state),accountsState=fixtureAccountsState(state);
  return <SafeAreaView style={{flex:1,backgroundColor:dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{fontFamily:'Newsreader',fontSize:24,color:dark?'#EEF1E8':'#18201F'}}>Synthetic fixture · {screen} · {state}</Text>
    <FixtureScreen fixture={fixture} selected={selected} draft={draft} mutation={mutation} detailState={detailState} reviewState={reviewState} accountsState={accountsState} setFixture={setFixture} setSelected={setSelected} setDraft={setDraft}/>
    <Action dark={dark} label="Exit synthetic fixture" onPress={setFixture}/>
  </ScrollView></SafeAreaView>;
}

export function DetailsFixtureHost({children}:{children:React.ReactNode}){
  const [fixture,setFixture]=useState<Fixture|null>(null),[selected,setSelected]=useState<Alert|null>(null),[draft,setDraft]=useState({category:'Food',note:'Synthetic draft'});
  useEffect(()=>{globalThis.__borderLedgerDetailsFixture={show:value=>{setSelected(value.screen==='review'&&reviewSelectionStates.has(value.state)?alert:null);setFixture(value);},hide:()=>setFixture(null)};return()=>{delete globalThis.__borderLedgerDetailsFixture;};},[]);
  return fixture?<FixtureContent fixture={fixture} selected={selected} draft={draft} setFixture={()=>setFixture(null)} setSelected={setSelected} setDraft={setDraft}/>:children;
}
