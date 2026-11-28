import {useEffect,useRef,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import {parseReceipt,receiptProviderMessage,receiptScanMessage,type ReceiptSuggestion} from '../domain/receipt';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import coreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import languageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import {ReceiptOcrSettings,type OcrConfiguration} from './ReceiptOcrSettings';

type Configuration={provider:string;model:string;revision:string};
type Props={api:LedgerApi;disabled:boolean;onBegin():void;onBusy(value:boolean):void;onResult(value:ReceiptSuggestion,clearMissingDate?:boolean,clearMissingAmount?:boolean):void};
async function recognize(file:File) {
  const {createWorker}=await import('tesseract.js');
  const langPath=new URL('.',new URL(languageUrl,window.location.href)).href;
  let failInitialization:(error:unknown)=>void=()=>{};
  const failure=new Promise<never>((_,reject)=>{failInitialization=reject;});
  const worker=await Promise.race([createWorker('eng',1,{workerPath:workerUrl,corePath:coreUrl,langPath,workerBlobURL:false,cacheMethod:'none',errorHandler:failInitialization}),failure]);
  try {return (await worker.recognize(file)).data.text;} finally {await worker.terminate();}
}
function AiControls({configurations,provider,disabled,onProvider,onImprove}:{configurations:Configuration[];provider:string;disabled:boolean;onProvider(value:string):void;onImprove():void}) {
  return <><label>AI provider<select value={provider} onChange={event=>onProvider(event.target.value)} disabled={disabled}>{configurations.map(item=><option key={item.provider} value={item.provider}>{item.provider} · {item.model}</option>)}</select></label><button type="button" className="outline-button" disabled={disabled} onClick={onImprove}>Improve with AI</button></>;
}
function validConfiguration(value:unknown):value is Configuration {
  if(!value || typeof value!=='object')return false;
  const item=value as Record<string,unknown>;
  if(typeof item.provider!=='string' || !['openai','anthropic','deepseek'].includes(item.provider))return false;
  return [item.model,item.revision].every(field=>typeof field==='string' && field.length>0);
}
function validConfigurations(value:unknown):Configuration[] {
  if(!value || typeof value!=='object')return [];
  if(!('configurations' in value))return [];
  return Array.isArray(value.configurations)?value.configurations.filter(validConfiguration):[];
}
function validImage(file:File) {return file.type.startsWith('image/') && file.size<=10*1024*1024;}
function confirmedProvider(configurations:Configuration[],provider:string,text:string) {
  const chosen=configurations.find(item=>item.provider===provider);
  if(!chosen || !text)return null;
  return window.confirm(`Send the recognized receipt text and your active category names to ${chosen.provider} (${chosen.model}) for interpretation? The text may contain sensitive information.`)?chosen:null;
}
function ScanPicker({disabled,onSelect}:{disabled:boolean;onSelect(file:File):void}) {
  return <label>Scan receipt image<input type="file" accept="image/*" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)onSelect(file);}}/></label>;
}
function ScanStatus({busy,message}:{busy:boolean;message:string}) {return <>{busy?<p role="status">Reading receipt…</p>:null}{message?<p role="status">{message}</p>:null}</>;}
function hasAiOptions(text:string,configurations:Configuration[]) {return !!text && configurations.length>0;}
function imageBase64(file:File):Promise<string> {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error());reader.onload=()=>{const value=reader.result;if(typeof value!=='string' || !value.includes(','))reject(new Error());else resolve(value.slice(value.indexOf(',')+1));};reader.readAsDataURL(file);});
}
export function ReceiptScan({api,disabled,onBegin,onBusy,onResult}:Props) {
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [configurations,setConfigurations]=useState<Configuration[]>([]),[provider,setProvider]=useState('');
  const [ocrConfiguration,setOcrConfiguration]=useState<OcrConfiguration|null>(null);
  const image=useRef<File|null>(null);
  const ocrConfigurationRef=useRef<OcrConfiguration|null>(null);
  const active=useRef(0);
  useEffect(()=>{onBusy(busy);},[busy]);
  useEffect(()=>()=>{active.current++;image.current=null;onBusy(false);},[]);
  async function scan(file:File) {
    const token=++active.current;image.current=null;setText('');setConfigurations([]);setMessage('');
    if(!validImage(file)){setMessage('Choose an image smaller than 10 MB.');return;}
    image.current=ocrConfigurationRef.current?file:null;
    setBusy(true);onBegin();
    try {
      const recognized=await recognize(file);
      if(token!==active.current)return;
      if(!recognized.trim())throw new Error();
      const suggestion=parseReceipt(recognized);
      image.current=ocrConfigurationRef.current?file:null;setText(recognized);onResult(suggestion);setMessage(receiptScanMessage(suggestion));
      void loadSettings(token);
    } catch {if(token===active.current)setMessage('Could not read this receipt. Try another image or enter the details manually.');}
    finally {if(token===active.current)setBusy(false);}
  }
  async function loadSettings(token:number) {
    try {const configurations=validConfigurations(await api<unknown>('/api/analysis'));if(token===active.current){setConfigurations(configurations);setProvider(configurations[0]?.provider??'');}}catch {/* Local suggestions remain available. */}
  }
  async function improve() {
    const chosen=confirmedProvider(configurations,provider,text);if(!chosen)return;
    const token=++active.current;setBusy(true);setMessage('');
    try {const result=await api<{suggestion:ReceiptSuggestion;amountConflict:boolean}>('/api/analysis/receipt',{method:'POST',body:JSON.stringify({provider:chosen.provider,configurationRevision:chosen.revision,text,confirmed:true})});if(token===active.current){onResult(result.suggestion,false,result.amountConflict);setMessage(receiptProviderMessage({...result,deletionRequested:null}));}}
    catch {if(token===active.current)setMessage('AI interpretation was unavailable. Your local suggestions are still here.');}
    finally {if(token===active.current){setConfigurations([]);setBusy(false);}}
  }
  async function analyzeImage() {
    const chosen=ocrConfiguration,file=image.current;if(!chosen || !file)return;
    if(!['image/jpeg','image/png'].includes(file.type) || file.size>Math.floor(5*1024*1024*3/4)){setMessage('Choose a JPEG or PNG under 3.75 MB for provider analysis.');return;}
    const retention=chosen.provider==='azure'?'Microsoft may store the image and result for up to 24 hours; the app will request earlier deletion.':'Your active category names will also be sent. The provider may retain the image and categories according to its own policy.';
    if(!window.confirm(`Send this receipt image to ${chosen.endpoint}? ${retention} Provider charges may apply.`))return;
    const token=++active.current;setBusy(true);setMessage('');
    try {
      const encoded=await imageBase64(file);if(token!==active.current)return;
      const result=await api<{suggestion:ReceiptSuggestion;deletionRequested:boolean|null;amountConflict:boolean}>('/api/analysis/ocr/scan',{method:'POST',body:JSON.stringify({configurationRevision:chosen.revision,image:encoded,contentType:file.type,text,confirmed:true})});
      if(token===active.current){onResult(result.suggestion,false,result.amountConflict);setMessage(receiptProviderMessage(result));}
    } catch {if(token===active.current)setMessage(chosen.provider==='azure'?'Microsoft analysis was unavailable. Microsoft may retain the image and result for up to 24 hours.':'Provider analysis was unavailable. Your local suggestions are still here.');}
    finally {if(token===active.current){image.current=null;setBusy(false);}}
  }
  function updateOcrConfiguration(value:OcrConfiguration|null) {
    if(ocrConfigurationRef.current?.revision!==value?.revision)image.current=null;
    ocrConfigurationRef.current=value;setOcrConfiguration(value);
  }
  return <div className="receipt-scan"><p>For a clearer scan, keep the receipt flat, in focus, and evenly lit.</p><ScanPicker disabled={disabled||busy} onSelect={file=>{void scan(file);}}/>
    <ScanStatus busy={busy} message={message}/>
    <ReceiptOcrSettings api={api} disabled={disabled||busy} onConfiguration={updateOcrConfiguration}/>
    {image.current && ocrConfiguration?<button type="button" disabled={disabled||busy} onClick={()=>{void analyzeImage();}}>Analyze receipt image</button>:null}
    {hasAiOptions(text,configurations)?<AiControls configurations={configurations} provider={provider} disabled={disabled||busy} onProvider={setProvider} onImprove={()=>{void improve();}}/>:null}
  </div>;
}
