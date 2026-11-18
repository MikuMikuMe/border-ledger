import React,{useState} from 'react';
import {ScrollView,TextInput,View} from 'react-native';
import fallbackNames from './currency-names.en.json';
import {supportedCurrencyCodes} from '../../../../src/domain/currencies';
import {Action,Copy} from './FinanceViews';

function currencyNames() {
  try { return new Intl.DisplayNames(['en'],{type:'currency'}); } catch { return null; }
}
const names=currencyNames();
function currencyName(code:string) {
  const localized=names?.of(code);
  return localized&&localized!==code?localized:(fallbackNames as Record<string,string>)[code]??code;
}
function currencyLabel(code:string) {
  const name=currencyName(code);
  return name===code?code:`${code} - ${name}`;
}

export function CurrencyPicker({dark,accountCurrency,value,disabled,onChange}:{dark:boolean;accountCurrency:string|undefined;value:string;disabled:boolean;onChange(value:string):void}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const quick=[...new Set([accountCurrency,value,'CAD','USD','CNY','JPY'].filter((code):code is string=>!!code))];
  const matches=supportedCurrencyCodes.filter(code=>`${code} ${currencyName(code)}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><Copy dark={dark}>Currency</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{quick.map(code=><Action key={code} dark={dark} label={code} disabled={disabled} radio selected={value===code} onPress={()=>onChange(code)}/>)}</View><Action dark={dark} variant="disclosure" label={open?'Hide currencies':'More currencies'} expanded={open} disabled={disabled} onPress={()=>{setOpen(!open);setSearch('');}}/>
    {open?<View style={{gap:8}}><Copy dark={dark}>Search currencies</Copy><TextInput accessibilityLabel="Search currencies" value={search} editable={!disabled} onChangeText={setSearch} style={{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:12,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'}}/>{matches.length?<ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" accessibilityLabel="Currency options" style={{maxHeight:240}} contentContainerStyle={{gap:8}}>{matches.map(code=><Action key={code} dark={dark} label={code} text={currencyLabel(code)} disabled={disabled} radio selected={value===code} onPress={()=>{onChange(code);setOpen(false);setSearch('');}}/>)}</ScrollView>:<Copy dark={dark}>No matching currencies.</Copy>}</View>:null}</>;
}
