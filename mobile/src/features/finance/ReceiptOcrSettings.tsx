import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import {AnalysisInput} from '../budget/AnalysisSettingsView';
import {Action,Copy} from './FinanceViews';

export type OcrProvider='azure'|'openai'|'anthropic';
export type OcrConfiguration={provider:OcrProvider;endpoint:string;model:string;revision:string};
type Props={dark:boolean;disabled:boolean;execute(action:string,body:string):Promise<string>;onConfiguration(value:OcrConfiguration|null):void};
const defaults:Record<OcrProvider,string>={azure:'',openai:'https://api.openai.com/v1/chat/completions',anthropic:'https://api.anthropic.com/v1/messages'};
function unsupportedEndpoint(config:OcrConfiguration|null) {return !!config && config.provider!=='azure' && config.endpoint!==defaults[config.provider];}
function cannotSave({unavailable,endpoint,credential,needsModel,model}:{unavailable:boolean;endpoint:string;credential:string;needsModel:boolean;model:string}) {return unavailable || (needsModel && (!endpoint || !credential || !model));}
function configurationInput(provider:OcrProvider,endpoint:string,model:string,credential:string) {
  return provider==='azure'?{provider,endpoint:'',model:'',credential:''}:{provider,endpoint,model,credential};
}
function isConfiguration(value:unknown):value is OcrConfiguration {
  if(!value || typeof value!=='object')return false;
  const item=value as Record<string,unknown>;
  return typeof item.provider==='string' && ['azure','openai','anthropic'].includes(item.provider) && [item.endpoint,item.model,item.revision].every(field=>typeof field==='string');
}
function VisionInputs({dark,provider,endpoint,model,credential,setModel,setCredential}:{dark:boolean;provider:OcrProvider;endpoint:string;model:string;credential:string;setModel(value:string):void;setCredential(value:string):void}) {
  if(provider==='azure')return <Copy dark={dark}>Uses the Microsoft resource configured by the application administrator.</Copy>;
  return <><Copy dark={dark}>Official endpoint: {endpoint}</Copy><AnalysisInput dark={dark} label="OCR vision model" value={model} onChange={setModel}/><AnalysisInput dark={dark} label="OCR provider key" value={credential} onChange={setCredential} secure/></>;
}
export function ReceiptOcrSettings({dark,disabled,execute,onConfiguration}:Props) {
  const [expanded,setExpanded]=useState(false),[provider,setProvider]=useState<OcrProvider>('azure'),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState(''),[credential,setCredential]=useState('');
  const [configured,setConfigured]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const unavailable=disabled||busy,needsModel=provider!=='azure';
  useEffect(()=>{let active=true;execute('ocr_settings','{}').then(value=>{if(!active)return;const result:unknown=JSON.parse(value);const config=isConfiguration(result)?result:null;const unsupported=unsupportedEndpoint(config);onConfiguration(unsupported?null:config);if(config){setProvider(config.provider);setEndpoint(defaults[config.provider]);setModel(config.model);setConfigured(true);if(unsupported)setMessage('Custom OCR endpoints are no longer supported. Enter your key and save to use the official provider.');}}).catch(()=>{if(active)setMessage('OCR settings are unavailable.');});return()=>{active=false;};},[execute]);
  function select(next:OcrProvider){setProvider(next);setEndpoint(defaults[next]);setModel('');setCredential('');}
  async function save(){setBusy(true);setMessage('');try{await execute('ocr_configuration',JSON.stringify(configurationInput(provider,endpoint,model,credential)));setCredential('');const value:unknown=JSON.parse(await execute('ocr_settings','{}'));const config=isConfiguration(value)?value:null;onConfiguration(config);setConfigured(!!config);setMessage('OCR settings saved.');}catch{setMessage('Could not save OCR settings. Check the provider details.');}finally{setBusy(false);}}
  async function remove(){setBusy(true);setMessage('');try{await execute('ocr_remove','{}');onConfiguration(null);setConfigured(false);setCredential('');setMessage('OCR settings removed.');}catch{setMessage('Could not remove OCR settings.');}finally{setBusy(false);}}
  return <View style={{gap:8}}><Action dark={dark} label="Receipt OCR provider settings" disabled={unavailable} onPress={()=>setExpanded(!expanded)}/>
    {expanded?<View style={{gap:8}}><Copy dark={dark}>These settings are separate from spending analysis. Your provider may charge for use.</Copy>
      <Action dark={dark} label="Use Microsoft Document Intelligence" radio selected={provider==='azure'} onPress={()=>select('azure')}/>
      <Action dark={dark} label="Use OpenAI" radio selected={provider==='openai'} onPress={()=>select('openai')}/>
      <Action dark={dark} label="Use Anthropic" radio selected={provider==='anthropic'} onPress={()=>select('anthropic')}/>
      <VisionInputs {...{dark,provider,endpoint,model,credential,setModel,setCredential}}/>
      <Action dark={dark} label="Save OCR settings" disabled={cannotSave({unavailable,endpoint,credential,needsModel,model})} onPress={()=>{void save();}}/>
      {configured?<Action dark={dark} label="Remove OCR settings" disabled={unavailable} onPress={()=>{void remove();}}/>:null}
    </View>:null}{message?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{message}</Copy></View>:null}
  </View>;
}
