import React,{useEffect,useRef,useState} from 'react';
import {Alert,NativeModules,View} from 'react-native';
import {parseReceipt,receiptProviderMessage,receiptScanMessage,type ReceiptSuggestion} from '../../../../src/domain/receipt';
import {Action,Copy} from './FinanceViews';
import {ReceiptOcrSettings,type OcrConfiguration} from './ReceiptOcrSettings';

type Configuration={provider:string;model:string;revision:string};
type Props={dark:boolean;disabled:boolean;sessionKey:number;onBegin():void;onBusy(value:boolean):void;onResult(value:ReceiptSuggestion,clearMissingDate?:boolean,clearMissingAmount?:boolean):void};
const supportedProviders=new Set(['openai','anthropic','deepseek']);
function AiControls({dark,configurations,provider,disabled,onProvider,onImprove}:{dark:boolean;configurations:Configuration[];provider:string;disabled:boolean;onProvider(value:string):void;onImprove():void}) {
  return <><Copy dark={dark}>AI provider</Copy>{configurations.map(item=><Action key={item.provider} dark={dark} label={`${item.provider} · ${item.model}`} radio selected={provider===item.provider} disabled={disabled} onPress={()=>onProvider(item.provider)}/>)}<Action dark={dark} label="Improve with AI" disabled={disabled} onPress={onImprove}/></>;
}
function validText(value:unknown):value is string {return typeof value==='string' && !!value.trim();}
function validString(value:unknown,max:number):value is string {return typeof value==='string' && !!value.trim() && value.length<=max;}
function validProvider(value:unknown):value is string {return validString(value,80) && supportedProviders.has(value);}
function isConfiguration(value:unknown):value is Configuration {
  if(!value || typeof value!=='object')return false;
  const item=value as Record<string,unknown>;
  return validProvider(item.provider) && validString(item.model,160) && validString(item.revision,256);
}
function configurationsFrom(value:unknown):Configuration[] {
  if(!value || typeof value!=='object')return [];
  const configurations=(value as Record<string,unknown>).configurations;
  return Array.isArray(configurations)?configurations.filter(isConfiguration):[];
}
function ScanStatus({dark,busy,message}:{dark:boolean;busy:boolean;message:string}) {return <>{busy?<Copy dark={dark}>Reading receipt…</Copy>:null}{message?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{message}</Copy></View>:null}</>;}
function hasAiOptions(text:string,configurations:Configuration[]) {return !!text && configurations.length>0;}
async function executeOcr(action:string,body:string) {const {default:analysis}=await import('../../native/specs/NativeAnalysis');return analysis.execute(action,body);}
function cloudScan(value:unknown):{text:string;image:string;contentType:string}|null {
  if(typeof value!=='string')return null;
  try {const item=JSON.parse(value) as Record<string,unknown>;return typeof item.text==='string' && typeof item.image==='string' && typeof item.contentType==='string'?{text:item.text,image:item.image,contentType:item.contentType}:null;}catch{return null;}
}
export function ReceiptScan({dark,disabled,sessionKey,onBegin,onBusy,onResult}:Props) {
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [configurations,setConfigurations]=useState<Configuration[]>([]),[provider,setProvider]=useState('');
  const [ocrConfiguration,setOcrConfiguration]=useState<OcrConfiguration|null>(null);
  const active=useRef(0);
  const mounted=useRef(true);
  const current=(token:number)=>mounted.current&&token===active.current;
  useEffect(()=>{onBusy(busy);},[busy]);
  useEffect(()=>{active.current++;setText('');setConfigurations([]);setProvider('');setMessage('');setBusy(false);},[sessionKey]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current++;onBusy(false);};},[]);
  async function scan() {
    const token=++active.current;setText('');setConfigurations([]);setMessage('');setBusy(true);onBegin();
    try {
      const recognized:unknown=await NativeModules.NativeReceiptScanner.scan();
      if(!current(token))return;
      if(recognized===null)return;
      if(!validText(recognized))throw new Error();
      const suggestion=parseReceipt(recognized);
      setText(recognized);onResult(suggestion);setMessage(receiptScanMessage(suggestion));
      void loadSettings(token);
    }catch {if(current(token))setMessage('Could not read this receipt. Try again or enter the details manually.');}
    finally {if(current(token))setBusy(false);}
  }
  async function loadSettings(token:number) {
    try {const {default:analysis}=await import('../../native/specs/NativeAnalysis');if(!current(token))return;const configurations=configurationsFrom(JSON.parse(await analysis.execute('settings','{}')));if(current(token)){setConfigurations(configurations);setProvider(configurations[0]?.provider??'');}}catch {/* Local suggestions remain available. */}
  }
  async function send(chosen:Configuration,consentToken:number,consentText:string) {
    if(!current(consentToken))return;
    const token=++active.current;setBusy(true);
    try {const {default:analysis}=await import('../../native/specs/NativeAnalysis');if(!current(token))return;const result=JSON.parse(await analysis.execute('receipt',JSON.stringify({provider:chosen.provider,configurationRevision:chosen.revision,text:consentText,confirmed:true}))) as {suggestion:ReceiptSuggestion;amountConflict:boolean};if(current(token)){onResult(result.suggestion,false,result.amountConflict);setMessage(receiptProviderMessage({...result,deletionRequested:null}));}}
    catch {if(current(token))setMessage('AI interpretation was unavailable. Your local suggestions are still here.');}
    finally {if(current(token)){setText('');setBusy(false);}}
  }
  function improve() {
    const chosen=configurations.find(item=>item.provider===provider);if(!chosen)return;
    const consentToken=active.current,consentText=text;
    Alert.alert('Send receipt text?',`Send recognized text and your active category names to ${chosen.provider} (${chosen.model})? The text may contain sensitive information.`,[{text:'Cancel',style:'cancel'},{text:'Send',onPress:()=>{if(current(consentToken))void send(chosen,consentToken,consentText);}}]);
  }
  async function scanWithProvider(chosen:OcrConfiguration,consentToken:number) {
    if(!current(consentToken))return;
    const token=++active.current;setBusy(true);setMessage('');onBegin();
    let submitted=false;
    try {
      const raw:unknown=await NativeModules.NativeReceiptScanner.scanForCloud();if(!current(token) || raw===null)return;
      const image=cloudScan(raw);if(!image)throw new Error();
      setText(image.text);onResult(parseReceipt(image.text));
      if(!current(token))return;
      submitted=true;
      const result=JSON.parse(await executeOcr('ocr_scan',JSON.stringify({configurationRevision:chosen.revision,...image,confirmed:true}))) as {suggestion:ReceiptSuggestion;deletionRequested:boolean|null;amountConflict:boolean};
      if(current(token)){onResult(result.suggestion,false,result.amountConflict);setMessage(receiptProviderMessage(result));}
    }catch {if(current(token))setMessage(!submitted?'Could not read the image. Try a receipt photo under 3.75 MB.':chosen.provider==='azure'?'Microsoft analysis was unavailable. Microsoft may retain the image and result for up to 24 hours.':'Provider analysis was unavailable. You can use local scanning or enter the details manually.');}
    finally {if(current(token))setBusy(false);}
  }
  function confirmProviderScan() {
    const chosen=ocrConfiguration;if(!chosen)return;
    const token=active.current;
    const retention=chosen.provider==='azure'?'Microsoft may store the image and result for up to 24 hours; the app will request earlier deletion.':'Your active category names will also be sent. The provider may retain the image and categories according to its own policy.';
    Alert.alert('Send receipt image?',`Send a receipt image to ${chosen.endpoint}? ${retention} Provider charges may apply.`,[{text:'Cancel',style:'cancel'},{text:'Continue',onPress:()=>{if(current(token))void scanWithProvider(chosen,token);}}]);
  }
  return <View style={{gap:8}}><Copy dark={dark}>For a clearer scan, keep the receipt flat, in focus, and evenly lit.</Copy><Action dark={dark} label="Scan receipt" disabled={disabled||busy} onPress={()=>{void scan();}}/><ScanStatus dark={dark} busy={busy} message={message}/>
    <ReceiptOcrSettings dark={dark} disabled={disabled||busy} execute={executeOcr} onConfiguration={setOcrConfiguration}/>
    {ocrConfiguration?<Action dark={dark} label="Scan with OCR provider" disabled={disabled||busy} onPress={confirmProviderScan}/>:null}
    {hasAiOptions(text,configurations)?<AiControls dark={dark} configurations={configurations} provider={provider} disabled={disabled||busy} onProvider={setProvider} onImprove={improve}/>:null}
  </View>;
}
