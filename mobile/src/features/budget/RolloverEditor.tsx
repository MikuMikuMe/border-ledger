import React,{useState} from 'react';
import {View} from 'react-native';
import {Action,Copy} from '../finance/FinanceViews';
import {BudgetField} from './BudgetControls';
import type {RolloverPolicy} from './budgetTracking';
export type RolloverRule={category:string;effectiveMonth:string;policy:RolloverPolicy};
export function RolloverEditor({dark,category,month,rules,busy,onPreview,onChange}:{dark:boolean;category:string;month:string;rules:RolloverRule[];busy:boolean;onPreview(category:string,month:string,policy:RolloverPolicy):void;onChange?():void}) {
 const current=[...rules].filter(row=>row.category===category&&row.effectiveMonth<=month).sort((a,b)=>b.effectiveMonth.localeCompare(a.effectiveMonth))[0]?.policy??'carry_all';
 const [policy,setPolicy]=useState<RolloverPolicy>(current),[effectiveMonth,setMonth]=useState(month);
 return <View style={{gap:8,marginTop:16}}><Copy dark={dark} heading>Month-end rollover</Copy><Copy dark={dark}>Choose what carries into the following month. A dated change also updates later category balances.</Copy><BudgetField dark={dark} label={`Outgoing month for ${category}`} value={effectiveMonth} onChange={value=>{onChange?.();setMonth(value);}}/>{([{value:'carry_all',label:'Carry all balances'},{value:'carry_positive',label:'Carry positive balances only'},{value:'reset',label:'Reset next month to zero'}] as const).map(item=><Action key={item.value} dark={dark} label={item.label} radio selected={policy===item.value} disabled={busy} onPress={()=>{onChange?.();setPolicy(item.value);}}/>)}<Action dark={dark} label={`Preview rollover for ${category}`} disabled={busy||!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)} onPress={()=>onPreview(category,effectiveMonth,policy)}/></View>;
}
