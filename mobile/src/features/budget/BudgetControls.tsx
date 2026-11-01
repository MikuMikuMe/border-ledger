import React,{useEffect,useRef,useState} from 'react';
import {BackHandler,Pressable,TextInput,View} from 'react-native';
import {Copy} from '../finance/FinanceViews';
import {formatMoney} from '../finance/model';
import {getCurrencyMeta} from '../../../../src/domain/currencies';
export type BudgetWrite=(action:string,build:(id:string)=>unknown)=>void;
export const budgetMoney=(value:number|null,currency:string)=>value===null?'Unavailable':formatMoney(String(value),currency);
export function budgetDecimal(value:number,currency:string) {
 const digits=getCurrencyMeta(currency)?.minorUnitDigits??2,n=BigInt(Math.abs(value)),scale=10n**BigInt(digits);
 return (value<0?'-':'')+(digits?`${n/scale}.${(n%scale).toString().padStart(digits,'0')}`:n.toString());
}
export const budgetSpokenMoney=(value:number|null,currency:string)=>value===null?'unavailable':`${currency} ${budgetDecimal(value,currency)}`;
export function BudgetField({dark,label,value,onChange}:{dark:boolean;label:string;value:string;onChange(value:string):void}) {
 return <View style={{gap:4,marginTop:8}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={{minHeight:48,borderWidth:1,borderRadius:8,padding:12,borderColor:dark?'#718679':'#687D70',color:dark?'#EEF1E8':'#18201F'}}/></View>;
}
export function useBudgetDisclosure() {
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{if(!expanded)return;const subscription=BackHandler?.addEventListener('hardwareBackPress',()=>{setExpanded(false);return true;});return()=>subscription?.remove();},[expanded]);
 return {expanded,setExpanded};
}
export function useBudgetDraft<T extends string>(initial:T) {
 const [value,setValue]=useState(initial),previous=useRef(initial);
 useEffect(()=>{const baseline=previous.current;setValue(current=>current===baseline?initial:current);previous.current=initial;},[initial]);
 return [value,setValue] as const;
}
export function BudgetDisclosure({dark,label,spokenValue,expanded,onPress,children}:{dark:boolean;label:string;spokenValue:string;expanded:boolean;onPress():void;children:React.ReactNode}) {
 return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{text:spokenValue}} accessibilityState={{expanded}} onPress={onPress} style={({pressed})=>({minHeight:48,paddingVertical:12,opacity:pressed?0.65:1})}><View style={{gap:4}}>{children}<Copy dark={dark}>{expanded?'Close editor':'Edit'}</Copy></View></Pressable>;
}
