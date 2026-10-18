/** Debug-only synthetic renderer. No native service imports or financial writes. */
import React,{useEffect,useState} from 'react';
import {ScrollView,StatusBar,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AccountsView,RecurringDetailView,ReviewView} from '../features/details/DetailsViews';
import {Action} from '../features/finance/FinanceViews';
import type {Alert} from '../features/details/contracts';
import type {LoadState} from '../features/finance/model';
import {account,alert,connection,detail,link} from './detailsFixtures';
type Fixture={screen:'recurring-detail'|'review'|'accounts';state:string;dark:boolean};
declare global {var __borderLedgerDetailsFixture:{show(value:Fixture):void;hide():void}|undefined;}
export function DetailsFixtureHost({children}:{children:React.ReactNode}){
  const [fixture,setFixture]=useState<Fixture|null>(null),[selected,setSelected]=useState<Alert|null>(null),[draft,setDraft]=useState({category:'Food',note:'Synthetic draft'});
  useEffect(()=>{globalThis.__borderLedgerDetailsFixture={show:value=>{setSelected(value.screen==='review'&&['detail','conflict','saving','unresolved'].includes(value.state)?alert:null);setFixture(value);},hide:()=>setFixture(null)};return()=>{delete globalThis.__borderLedgerDetailsFixture;};},[]);
  if(!fixture)return children;
  const {screen,state,dark}=fixture;
  const resource=<T,>(data:T):LoadState<T>=>({phase:['loading','offline','error','locked'].includes(state)?state as LoadState<T>['phase']:'ready',data:['loading','error','locked'].includes(state)?null:data,message:state==='offline'?'Unavailable offline. Showing cached fixture.':state==='locked'?'Renew your owner session to continue.':state==='error'?'Fixture native service unavailable. Refresh to retry.':null});
  const mutation={blocked:['saving','unresolved'].includes(state),status:state==='conflict'?'revision_conflict':state==='saving'?'saving':state==='unresolved'?'reconciliation_required':'ready'};
  const noop=()=>{};
  return <SafeAreaView style={{flex:1,backgroundColor:dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{fontFamily:'Newsreader',fontSize:24,color:dark?'#EEF1E8':'#18201F'}}>Synthetic fixture · {screen} · {state}</Text>
    {screen==='recurring-detail'?<RecurringDetailView dark={dark} state={resource({...detail,history:state==='empty'?[]:detail.history})} mutation={mutation} onRetry={noop} onLoadMore={noop} onClassify={noop} onClose={()=>setFixture(null)}/>:null}
    {screen==='review'?<ReviewView dark={dark} state={resource({items:state==='empty'?[]:[alert],nextCursor:null,limit:50})} mutation={mutation} selected={selected} draft={draft} onDraft={setDraft} onOpen={setSelected} onClose={()=>setSelected(null)} onResolve={noop} onSave={noop} onRetry={noop} onLoadMore={noop}/>:null}
    {screen==='accounts'?<AccountsView dark={dark} state={resource({page:{accounts:state==='empty'?[]:[account],nextCursor:null,limit:50},connections:state==='empty'?[]:[{...connection,lastError:state==='failed'?'ITEM_LOGIN_REQUIRED':null}],link:{...link,state:['pending','canceled','failed','unsupported','linking','connected'].includes(state)?state:'idle',outcomeCode:['canceled','failed','unsupported'].includes(state)?state:state==='pending'?'success':null,canCancel:state==='linking',pendingConnectionId:state==='pending'?'pending_1':null,accounts:state==='pending'?[account]:[]}})} mutation={mutation} onConnect={noop} onCancelConnect={noop} onSelect={noop} onCancel={noop} onSync={noop} onDisconnect={noop} onRetry={noop} onLoadMore={noop}/>:null}
    <Action dark={dark} label="Exit synthetic fixture" onPress={()=>setFixture(null)}/>
  </ScrollView></SafeAreaView>;
}
