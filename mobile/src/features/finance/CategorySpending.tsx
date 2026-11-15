import React,{useEffect,useRef,useState} from 'react';
import {ScrollView,TextInput,View} from 'react-native';
import {useContext} from 'react';
import {CategoryServicesContext,type CategoryServices} from './categoryServices';
import type {Report,Transaction} from './contracts';
import {formatMoney} from './model';
import {Action,Card,Copy} from './FinanceViews';
type Category={name:string;archived:boolean};
type Props={dark:boolean;from:string;to:string;timeZone:string;includeProvisional:boolean;currency:string|null;reportingCurrency:string|null;onOpen?(item:Transaction):void;refreshVersion?:number};
function sum(confirmed:string,provisional:string,include:boolean){return (BigInt(confirmed)+(include?BigInt(provisional):0n)).toString();}
function CategoryTotals({dark,report,includeProvisional,busy,load}:{dark:boolean;report:Report;includeProvisional:boolean;busy:boolean;load(next:string|null):Promise<void>}) {
 return <View accessibilityLiveRegion="polite">{report.currencyTotals.length?report.currencyTotals.map(total=><Copy key={total.currency} dark={dark}>{total.currency}: {formatMoney(sum(total.confirmedMinorUnits,total.provisionalMinorUnits,includeProvisional),total.currency)}</Copy>):<Copy dark={dark}>No spending in this period.</Copy>}{report.reportingCurrency&&report.convertedTotals?<Copy dark={dark}>Converted: {report.fx.complete?formatMoney(sum(report.convertedTotals.confirmedMinorUnits,report.convertedTotals.provisionalMinorUnits,includeProvisional),report.reportingCurrency):'Unavailable for some transactions'}</Copy>:null}<Action dark={dark} label="View category activity" disabled={busy} onPress={()=>{void load(null);}}/></View>;
}
function CategoryReport({category,report,dark,includeProvisional,busy,load}:{category:string;report:Report|null;dark:boolean;includeProvisional:boolean;busy:boolean;load(next:string|null):Promise<void>}) {
 if(!category||!report)return null;
 return <CategoryTotals dark={dark} report={report} includeProvisional={includeProvisional} busy={busy} load={load}/>;
}
function CategoryActivity({dark,items,cursor,busy,load,onOpen}:{dark:boolean;items:Transaction[];cursor:string|null;busy:boolean;load(next:string|null):Promise<void>;onOpen?(item:Transaction):void}) {
 return <View><Copy dark={dark}>All activity in this category and period, including items excluded from spending.</Copy>{items.map(item=><Action key={item.id} dark={dark} label={`Open activity: ${item.merchant??'Merchant unavailable'}`} text={`${item.merchant??'Merchant unavailable'} · ${item.occurredAt.replace('T',' ').replace(/Z$/,' UTC')} · ${item.kind} · ${item.status} · ${formatMoney(item.signedMinorUnits,item.currency)}`} onPress={()=>onOpen?.(item)}/>)}{cursor?<Action dark={dark} label="Load more category activity" disabled={busy} onPress={()=>{void load(cursor);}}/>:null}</View>;
}
function SpendingCategoryOptions({dark,search,setSearch,categories,setCategory,setOpen}:{dark:boolean;search:string;setSearch(value:string):void;categories:Category[];setCategory(value:string):void;setOpen(value:boolean):void}) {
 return <View style={{gap:8}}><TextInput accessibilityLabel="Search spending categories" placeholder="Search categories" value={search} onChangeText={setSearch} style={{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:12,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'}}/><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" accessibilityLabel="Spending categories" style={{maxHeight:200}}>{categories.filter(item=>item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(item=><Action key={item.name} dark={dark} label={item.name} text={`${item.name}${item.archived?' (archived)':''}`} onPress={()=>{setCategory(item.name);setOpen(false);setSearch('');}}/>)}</ScrollView></View>;
}
function useCategories(service:CategoryServices,refresh:number,refreshVersion:number|undefined,setError:(value:string)=>void) {
 const [categories,setCategories]=useState<Category[]>([]);
 useEffect(()=>{let active=true;void (async()=>{try{const value=JSON.parse(await service.readCategories());if(!Array.isArray(value.categories))throw new Error('Invalid categories');if(active)setCategories(value.categories);}catch{if(active)setError('Could not load categories.');}})();return()=>{active=false;};},[service,refresh,refreshVersion,setError]);
 return categories;
}
export function CategorySpending({dark,from,to,timeZone,includeProvisional,currency,reportingCurrency,onOpen,refreshVersion}:Props) {
 const service=useContext(CategoryServicesContext);
 const [category,setCategory]=useState(''),[search,setSearch]=useState(''),[open,setOpen]=useState(false),[report,setReport]=useState<Report|null>(null),[items,setItems]=useState<Transaction[]>([]),[cursor,setCursor]=useState<string|null>(null),[opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState('');
 const categories=useCategories(service,refresh,refreshVersion,setError);
 const generation=useRef(0);
 useEffect(()=>{const current=++generation.current;setItems([]);setOpened(false);setCursor(null);setReport(null);setBusy(false);setLoading(Boolean(category));setError('');if(!category)return;
  void service.readReport({startDate:from,endDate:to,timeZone,includeProvisional,currency,reportingCurrency,category}).then(value=>{if(current===generation.current){setReport(value);setLoading(false);}}).catch(()=>{if(current===generation.current){setLoading(false);setError('Could not load category spending.');}});
  return()=>{generation.current++;};
 },[category,from,to,timeZone,includeProvisional,currency,reportingCurrency,service,refresh,refreshVersion]);
 const load=async(next:string|null)=>{const current=generation.current;setBusy(true);setError('');try{const page=await service.readTransactions({cursor:next,limit:50,query:null,currency,status:null,source:null,category,from,to});if(current!==generation.current)return;setItems(previous=>next?[...previous,...page.items]:page.items);setCursor(page.nextCursor);setOpened(true);}catch{if(current===generation.current)setError('Could not load category activity.');}finally{if(current===generation.current)setBusy(false);}};
 return <Card dark={dark}><Copy dark={dark} heading>Spending by category</Copy><Copy dark={dark}>For {from} to {to}, using your report settings.</Copy><Action dark={dark} label="Choose spending category" value={category||'No category selected'} expanded={open} text={category||'Choose a category'} onPress={()=>setOpen(!open)}/>{open?<SpendingCategoryOptions dark={dark} search={search} setSearch={setSearch} categories={categories} setCategory={setCategory} setOpen={setOpen}/>:null}{loading?<View accessibilityLiveRegion="polite"><Copy dark={dark}>Loading category spending…</Copy></View>:null}<CategoryReport category={category} dark={dark} report={report} includeProvisional={includeProvisional} busy={busy} load={load}/>{opened?<CategoryActivity dark={dark} items={items} cursor={cursor} busy={busy} load={load} onOpen={onOpen}/>:null}{error?<View accessibilityLiveRegion="polite"><Copy dark={dark} error>{error}</Copy><Action dark={dark} label="Retry category spending" onPress={()=>setRefresh(current=>current+1)}/></View>:null}</Card>;
}
