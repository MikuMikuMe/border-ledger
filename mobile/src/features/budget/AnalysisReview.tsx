import React from 'react';
import {View} from 'react-native';
import {Action,Copy} from '../finance/FinanceViews';
import type {Provider} from './AnalysisSettingsView';
export type AnalysisPreview={provider:Provider;endpoint:string;model:string;configurationRevision:string;from:string;to:string;detail:boolean;mode:'budget'|'ledger'};
export function AnalysisReview({dark,preview,busy,onSend}:{dark:boolean;preview:AnalysisPreview|null;busy:boolean;onSend():void}) {
  if(!preview)return null;
  return <View style={{gap:8}}><Copy dark={dark} heading>Review before sending</Copy><Copy dark={dark}>{preview.provider} · {preview.model}</Copy><Copy dark={dark}>{preview.endpoint}</Copy><Copy dark={dark}>{preview.from} to {preview.to} · {preview.detail?'Transaction details':'Aggregated summaries'}</Copy><Copy dark={dark}>Your selected provider will receive this financial information.{preview.detail?' Transaction details include dates, merchants, amounts, categories, accounts, notes, and sources.':''}</Copy><Action dark={dark} label="Send for analysis" disabled={busy} onPress={onSend}/></View>;
}
export function AnalysisError({dark,message}:{dark:boolean;message:string}) {return message?<View accessibilityRole="alert"><Copy dark={dark} error>{message}</Copy></View>:null;}
export function AnalysisResult({dark,answer}:{dark:boolean;answer:string}) {return answer?<View accessibilityLiveRegion="polite"><Copy dark={dark} heading>Analysis</Copy><Copy dark={dark}>{answer}</Copy><Copy dark={dark}>These observations are advisory.</Copy></View>:null;}
