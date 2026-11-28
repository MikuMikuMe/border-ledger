import {useEffect,useState} from 'react';
import type {LedgerApi} from '../domain/api';

export type OcrProvider='azure'|'openai'|'anthropic';
export type OcrConfiguration={provider:OcrProvider;endpoint:string;model:string;revision:string};
function isConfiguration(value:unknown):value is OcrConfiguration {
  if(!value || typeof value!=='object')return false;
  const record=value as Record<string,unknown>;
  return typeof record.provider==='string' && ['azure','openai','anthropic'].includes(record.provider) && [record.endpoint,record.model,record.revision].every(item=>typeof item==='string');
}
type Props={api:LedgerApi;disabled:boolean;onConfiguration(value:OcrConfiguration|null):void};
const defaults:Record<OcrProvider,string>={azure:'',openai:'https://api.openai.com/v1/chat/completions',anthropic:'https://api.anthropic.com/v1/messages'};
function unsupportedEndpoint(config:OcrConfiguration|null) {return !!config && config.provider!=='azure' && config.endpoint!==defaults[config.provider];}
function configurationInput(provider:OcrProvider,endpoint:string,model:string,credential:string) {return provider==='azure'?{provider,endpoint:'',model:'',credential:''}:{provider,endpoint,model,credential};}
function cannotSave({unavailable,endpoint,credential,needsModel,model}:{unavailable:boolean;endpoint:string;credential:string;needsModel:boolean;model:string}) {return unavailable || (needsModel && (!endpoint || !credential || !model));}
export function ReceiptOcrSettings({api,disabled,onConfiguration}:Props) {
  const [provider,setProvider]=useState<OcrProvider>('azure'),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState(''),[credential,setCredential]=useState('');
  const [configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const unavailable=disabled||busy,needsModel=provider!=='azure';
  useEffect(()=>{let active=true;api<unknown>('/api/analysis/ocr/configuration').then(value=>{if(!active)return;const config=isConfiguration(value)?value:null;const unsupported=unsupportedEndpoint(config);onConfiguration(unsupported?null:config);if(config){setProvider(config.provider);setEndpoint(defaults[config.provider]);setModel(config.model);setConfigured(true);if(unsupported)setMessage('Custom OCR endpoints are no longer supported. Enter your key and save to use the official provider.');}}).catch(()=>{if(active)setMessage('OCR settings are unavailable.');});return()=>{active=false;};},[api]);
  async function save() {
    setBusy(true);setMessage('');
    try {
      await api('/api/analysis/ocr/configuration',{method:'PUT',body:JSON.stringify(configurationInput(provider,endpoint,model,credential))});
      setCredential('');const value=await api<OcrConfiguration>('/api/analysis/ocr/configuration');onConfiguration(value);setConfigured(true);setMessage('OCR settings saved.');
    } catch {setMessage('Could not save OCR settings. Check the provider details.');}
    finally {setBusy(false);}
  }
  async function remove() {
    setBusy(true);setMessage('');
    try {await api('/api/analysis/ocr/configuration',{method:'DELETE'});onConfiguration(null);setConfigured(false);setCredential('');setMessage('OCR settings removed.');}
    catch {setMessage('Could not remove OCR settings.');}finally {setBusy(false);}
  }
  return <details><summary>Receipt OCR provider settings</summary><p>These settings are separate from spending analysis. Your provider may charge for use.</p>
    <label>OCR provider<select value={provider} disabled={unavailable} onChange={event=>{const next=event.target.value as OcrProvider;setProvider(next);setEndpoint(defaults[next]);setModel('');setCredential('');}}><option value="azure">Microsoft Document Intelligence</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
    {needsModel?<><p>Official endpoint: {endpoint}</p><label>Vision model<input value={model} disabled={unavailable} onChange={event=>setModel(event.target.value)} autoComplete="off"/></label><label>OCR provider key<input type="password" value={credential} disabled={unavailable} onChange={event=>setCredential(event.target.value)} autoComplete="off"/></label></>:<p>Uses the Microsoft resource configured by the application administrator.</p>}
    <button type="button" disabled={cannotSave({unavailable,endpoint,credential,needsModel,model})} onClick={()=>{void save();}}>Save OCR settings</button>
    {configured?<button type="button" disabled={unavailable} onClick={()=>{void remove();}}>Remove OCR settings</button>:null}{message?<p role="status">{message}</p>:null}
  </details>;
}
