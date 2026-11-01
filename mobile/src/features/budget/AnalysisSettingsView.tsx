import React from 'react';
import {Switch,TextInput,View} from 'react-native';
import {Action,Copy} from '../finance/FinanceViews';
export type Provider='openai'|'anthropic';
export type AnalysisSettings={configurations:{provider:Provider;model:string}[];detailedTransactions:boolean};
export function AnalysisInput({dark,label,value,onChange,secure=false}:{dark:boolean;label:string;value:string;onChange(value:string):void;secure?:boolean}) {
  return <View style={{gap:4}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:10,borderColor:dark?'#43534B':'#9AADA2',color:dark?'#EEF1E8':'#18201F'}}/></View>;
}
interface Props {expanded:boolean;dark:boolean;settings:AnalysisSettings|null;provider:Provider;endpoint:string;model:string;credential:string;busy:boolean;onProvider(value:Provider):void;onEndpoint(value:string):void;onModel(value:string):void;onCredential(value:string):void;onSave():void;onRemove(provider:Provider):void;onSharing(enabled:boolean):void}
export function AnalysisSettingsView(props:Props) {
  const {expanded,dark,settings,provider,endpoint,model,credential,busy,onProvider,onEndpoint,onModel,onCredential,onSave,onRemove,onSharing}=props;
  if(!expanded)return null;
  return <View style={{gap:10}}><Copy dark={dark}>Provider: {provider}</Copy><Action dark={dark} label="Use OpenAI-compatible provider" onPress={()=>onProvider('openai')}/><Action dark={dark} label="Use Anthropic-compatible provider" onPress={()=>onProvider('anthropic')}/><Copy dark={dark}>Custom endpoint hosts must be approved in the server configuration.</Copy><AnalysisInput dark={dark} label="Endpoint" value={endpoint} onChange={onEndpoint}/><AnalysisInput dark={dark} label="Model" value={model} onChange={onModel}/><AnalysisInput dark={dark} label="API key" value={credential} onChange={onCredential} secure/><Action dark={dark} label="Save or replace key" disabled={busy||!credential||!model} onPress={onSave}/>
    {settings?.configurations.map(item=><View key={item.provider}><Copy dark={dark}>{item.provider} · {item.model}</Copy><Action dark={dark} label={`Remove ${item.provider} key`} disabled={busy} onPress={()=>onRemove(item.provider)}/></View>)}
    <View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{flex:1}}><Copy dark={dark}>Allow transaction details when selected. Details include dates, merchants, amounts, categories, accounts, notes, and sources.</Copy></View><Switch accessibilityLabel="Allow transaction details" value={settings?.detailedTransactions??false} disabled={busy||!settings} onValueChange={onSharing}/></View></View>;
}
