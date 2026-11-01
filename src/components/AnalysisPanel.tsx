import {useEffect,useRef,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import {AnalysisReview,AnalysisError,AnalysisResult,type AnalysisPreview} from './AnalysisReview';
type Provider='openai'|'anthropic';
type Config={provider:Provider;endpoint:string;model:string;revision:string};
type Settings={configurations:Config[];detailedTransactions:boolean};
type Preview=AnalysisPreview;
const endpoints:Record<Provider,string>={openai:'https://api.openai.com/v1/chat/completions',anthropic:'https://api.anthropic.com/v1/messages'};
const send=(api:LedgerApi,path:string,method:string,body?:unknown)=>api<unknown>(`/api/analysis${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
export function AnalysisPanel({api,month}:{api:LedgerApi;month:string}) {
  const requestVersion=useRef(0);
  const [settings,setSettings]=useState<Settings|null>(null),[provider,setProvider]=useState<Provider>('openai');
  const [endpoint,setEndpoint]=useState(endpoints.openai),[model,setModel]=useState(''),[credential,setCredential]=useState('');
  const [from,setFrom]=useState(month+'-01'),[to,setTo]=useState(()=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10));
  const [detail,setDetail]=useState(false),[mode,setMode]=useState<'budget'|'ledger'>('budget'),[preview,setPreview]=useState<Preview|null>(null),[answer,setAnswer]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;setFrom(month+'-01');setTo(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10));requestVersion.current++;setPreview(null);setAnswer('');},[month]);
  const refresh=async()=>setSettings(await api<Settings>('/api/analysis'));
  useEffect(()=>{let active=true;api<Settings>('/api/analysis').then(value=>{if(active)setSettings(value);}).catch(()=>{if(active)setError('Analysis settings are unavailable.');});return()=>{active=false;};},[api]);
  const action=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(error){setError(error instanceof Error ? error.message : 'The request could not be completed. Check the settings and try again.');}finally{setBusy(false);}};
  const save=()=>void action(async()=>{await send(api,'/configuration','PUT',{provider,endpoint,model,credential});setCredential('');setPreview(null);await refresh();});
  const sharing=(enabled:boolean)=>void action(async()=>{await send(api,'/sharing','PUT',{enabled});setDetail(false);setPreview(null);await refresh();});
  const selection={provider,from,to,detail,mode};
  const review=()=>void action(async()=>{const version=++requestVersion.current;setAnswer('');const result=await send(api,'/preview','POST',selection) as Preview;if(version===requestVersion.current)setPreview(result);});
  const analyze=()=>void action(async()=>{if(!preview)return;const result=await send(api,'/run','POST',{provider:preview.provider,from:preview.from,to:preview.to,detail:preview.detail,mode:preview.mode,configurationRevision:preview.configurationRevision,confirmed:true}) as {analysis:string};setAnswer(result.analysis);setPreview(null);});
  const invalidate=()=>{requestVersion.current++;setPreview(null);setAnswer('');};
  return <section className="budget-section"><h2>AI analysis</h2><p>Use your own provider key for optional, read-only observations. Your provider may charge for requests.</p>
    <AnalysisError message={error}/>
    <details><summary>Provider and privacy settings</summary><div className="budget-form">
      <label>Provider<select value={provider} onChange={e=>{const next=e.target.value as Provider;setProvider(next);setEndpoint(endpoints[next]);setModel('');setCredential('');invalidate();}}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic-compatible</option></select></label>
      <p>Custom endpoint hosts must be approved in the server configuration.</p><label>Endpoint<input type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} autoComplete="off"/></label><label>Model<input value={model} onChange={e=>setModel(e.target.value)}/></label><label>API key<input type="password" value={credential} onChange={e=>setCredential(e.target.value)} autoComplete="off"/></label><button type="button" disabled={busy||!credential||!model} onClick={save}>Save or replace key</button>
      {settings?.configurations?.map(item=><div className="budget-balance" key={item.provider}><span>{item.provider} · {item.model}</span><button type="button" disabled={busy} onClick={()=>void action(async()=>{await send(api,`/configuration/${item.provider}`,'DELETE');invalidate();await refresh();})}>Remove key</button></div>)}
      <label className="analysis-check"><input type="checkbox" checked={settings?.detailedTransactions??false} disabled={busy||!settings} onChange={e=>sharing(e.target.checked)}/> Allow transaction details to be sent when selected</label><p>Details include dates, merchants, amounts, categories, accounts, notes, and sources. This is off by default.</p>
    </div></details>
    <div className="budget-form"><label>Analysis<select value={mode} onChange={e=>{setMode(e.target.value as 'budget'|'ledger');invalidate();}}><option value="budget">Budget</option><option value="ledger">Full ledger</option></select></label><label>From<input type="date" value={from} onChange={e=>{setFrom(e.target.value);invalidate();}}/></label><label>To<input type="date" value={to} onChange={e=>{setTo(e.target.value);invalidate();}}/></label><label className="analysis-check"><input type="checkbox" checked={detail} disabled={!settings?.detailedTransactions} onChange={e=>{setDetail(e.target.checked);invalidate();}}/> Include transaction details</label><button type="button" disabled={busy||!settings?.configurations?.some(item=>item.provider===provider)} onClick={review}>Review request</button></div>
    <AnalysisReview preview={preview} busy={busy} onSend={analyze}/>
    <AnalysisResult answer={answer}/>
  </section>;
}
