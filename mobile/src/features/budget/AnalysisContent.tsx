import React,{useEffect,useRef,useState} from 'react';
import {Switch,View} from 'react-native';
import {AnalysisInput as Input,AnalysisSettingsView,type AnalysisSettings,type Provider} from './AnalysisSettingsView';
import {AnalysisReview,AnalysisError,AnalysisResult,type AnalysisPreview} from './AnalysisReview';
import {Action,Copy} from '../finance/FinanceViews';
import NativeAnalysis from '../../native/specs/NativeAnalysis';
type Settings=AnalysisSettings;
type Preview=AnalysisPreview;
const endpoints={openai:'https://api.openai.com/v1/chat/completions',anthropic:'https://api.anthropic.com/v1/messages'};
export function AnalysisContent({dark,month,execute=NativeAnalysis.execute}:{dark:boolean;month:string;execute?:(action:string,body:string)=>Promise<string>}) {
  const requestVersion=useRef(0);
  const [settings,setSettings]=useState<Settings|null>(null),[provider,setProvider]=useState<Provider>('openai'),[endpoint,setEndpoint]=useState(endpoints.openai),[model,setModel]=useState(''),[credential,setCredential]=useState('');
  const [from,setFrom]=useState(month+'-01'),[to,setTo]=useState(()=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10));
  const [detail,setDetail]=useState(false),[mode,setMode]=useState<'budget'|'ledger'>('budget'),[preview,setPreview]=useState<Preview|null>(null),[answer,setAnswer]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
  useEffect(()=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;setFrom(month+'-01');setTo(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10));requestVersion.current++;setPreview(null);setAnswer('');},[month]);
  const call=async<T=unknown>(action:string,body:unknown={}):Promise<T>=>JSON.parse(await execute(action,JSON.stringify(body))) as T;
  const refresh=async()=>setSettings(await call('settings') as Settings);
  useEffect(()=>{void refresh().catch(()=>setError('Analysis settings are unavailable.'));},[]);
  const action=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(error){setError(error instanceof Error ? error.message : 'The request could not be completed. Check the settings and try again.');}finally{setBusy(false);}};
  const reset=()=>{requestVersion.current++;setPreview(null);setAnswer('');};
  const selectProvider=(next:Provider)=>{setProvider(next);setEndpoint(endpoints[next]);setModel('');setCredential('');reset();};
  const selection={provider,from,to,detail,mode};
  return <View style={{gap:12,marginTop:20}}><Copy dark={dark} heading>AI analysis</Copy><Copy dark={dark}>Use your own provider key for optional, read-only observations. Your provider may charge for requests.</Copy>
    <AnalysisError dark={dark} message={error}/><Action dark={dark} label={expanded?'Hide provider and privacy settings':'Show provider and privacy settings'} onPress={()=>setExpanded(!expanded)}/>
    <AnalysisSettingsView expanded={expanded} dark={dark} settings={settings} provider={provider} endpoint={endpoint} model={model} credential={credential} busy={busy} onProvider={selectProvider} onEndpoint={setEndpoint} onModel={setModel} onCredential={setCredential} onSave={()=>void action(async()=>{await call('configuration',{provider,endpoint,model,credential});setCredential('');reset();await refresh();})} onRemove={selected=>void action(async()=>{await call('remove',{provider:selected});reset();await refresh();})} onSharing={enabled=>void action(async()=>{await call('sharing',{enabled});setDetail(false);reset();await refresh();})}/>
    <Copy dark={dark}>Analysis: {mode==='budget'?'Budget':'Full ledger'}</Copy><Action dark={dark} label={mode==='budget'?'Switch to full ledger':'Switch to budget'} onPress={()=>{setMode(mode==='budget'?'ledger':'budget');reset();}}/><Input dark={dark} label="From (YYYY-MM-DD)" value={from} onChange={value=>{setFrom(value);reset();}}/><Input dark={dark} label="To (YYYY-MM-DD)" value={to} onChange={value=>{setTo(value);reset();}}/><View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{flex:1}}><Copy dark={dark}>Include transaction details</Copy></View><Switch accessibilityLabel="Include transaction details" value={detail} disabled={!settings?.detailedTransactions} onValueChange={value=>{setDetail(value);reset();}}/></View>
    <Action dark={dark} label="Review request" disabled={busy||!settings?.configurations.some(item=>item.provider===provider)} onPress={()=>void action(async()=>{const version=++requestVersion.current;setAnswer('');const result=await call('preview',selection) as Preview;if(version===requestVersion.current)setPreview(result);})}/>
    <AnalysisReview dark={dark} preview={preview} busy={busy} onSend={()=>void action(async()=>{if(!preview)return;const result=await call('run',{provider:preview.provider,from:preview.from,to:preview.to,detail:preview.detail,mode:preview.mode,configurationRevision:preview.configurationRevision,confirmed:true}) as {analysis:string};setAnswer(result.analysis);setPreview(null);})}/>
    <AnalysisResult dark={dark} answer={answer}/>
  </View>;
}
