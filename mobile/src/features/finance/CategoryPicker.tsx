import React,{useEffect,useState} from 'react';
import {ScrollView,TextInput,View} from 'react-native';
import {useContext} from 'react';
import {CategoryServicesContext} from './categoryServices';
import {Action,Copy} from './FinanceViews';
import {CategoryManager,type CategoryCleanup} from './CategoryManager';
export type {CategoryCleanup} from './CategoryManager';
type Category={name:string;archived:boolean};
type CategoryChoicesProps={dark:boolean;search:string;setSearch(value:string):void;disabled:boolean;busy:boolean;matches:Category[];value:string;onChange(value:string):void;setOpen(value:boolean):void;name:string;exists:boolean;create():Promise<void>;categories:Category[];error:string};
function CategoryChoices({dark,search,setSearch,disabled,busy,matches,value,onChange,setOpen,name,exists,create,categories,error}:CategoryChoicesProps) {
 return <View style={{gap:8}}><TextInput accessibilityLabel="Search or add a category" placeholder="Search or add a category" value={search} maxLength={80} editable={!disabled&&!busy} onChangeText={setSearch} style={{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:12,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'}}/><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" accessibilityLabel="Category options" style={{maxHeight:240}}>{matches.map(category=><Action key={category.name} dark={dark} label={category.name} radio selected={value===category.name} disabled={disabled||busy} onPress={()=>{onChange(category.name);setOpen(false);setSearch('');}}/>)}</ScrollView>{name&&!exists?<Action dark={dark} label="Create category" disabled={disabled||busy} onPress={()=>{void create();}}/>:null}{name&&exists?<Copy dark={dark}>Select the existing category above.</Copy>:null}{!categories.length&&!error?<Copy dark={dark}>No categories yet. Enter a name to create one.</Copy>:null}</View>;
}
function updateSelectedCategory({value,from,to,onChange}:{value:string;from?:string;to?:string;onChange(value:string):void}) { if(from===value&&to)onChange(to); }
export function CategoryPicker({dark,value,disabled,onChange,onCleanup}:{dark:boolean;value:string;disabled:boolean;onChange(value:string):void;onCleanup?(cleanup:CategoryCleanup):Promise<boolean>|void}) {
 const service=useContext(CategoryServicesContext);
 const [categories,setCategories]=useState<Category[]>([]),[open,setOpen]=useState(false),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[manage,setManage]=useState(false);
 const load=async()=>{try{const data=JSON.parse(await service.readCategories());if(!Array.isArray(data.categories))throw new Error('Invalid categories');setCategories(data.categories);setError('');}catch{setError('Could not load categories.');}};
 useEffect(()=>{void load();},[]);
 const name=search.trim(),key=name.toLocaleLowerCase();
 const matches=categories.filter(category=>!category.archived&&category.name.toLocaleLowerCase().includes(key));
 const exists=categories.some(category=>category.name.toLocaleLowerCase()===key);
 const create=async()=>{setBusy(true);setError('');try{await service.createCategory(name);setCategories(current=>[...current,{name,archived:false}]);onChange(name);setSearch('');setOpen(false);}catch{setError('Could not create category. Refresh and try again.');}finally{setBusy(false);}};
 return <><Copy dark={dark}>Category</Copy><Action dark={dark} label="Choose category" value={value||'No category selected'} expanded={open} text={value||'Choose category'} disabled={disabled||busy} onPress={()=>setOpen(!open)}/>{open?<CategoryChoices dark={dark} search={search} setSearch={setSearch} disabled={disabled} busy={busy} matches={matches} value={value} onChange={onChange} setOpen={setOpen} name={name} exists={exists} create={create} categories={categories} error={error}/>:null}<Action dark={dark} label={manage?"Close category management":"Manage categories"} expanded={manage} disabled={disabled||busy} onPress={()=>setManage(!manage)}/>{manage?<CategoryManager dark={dark} categories={categories} onChanged={(from,to)=>{updateSelectedCategory({value,from,to,onChange});void load();}} onCleanup={onCleanup}/>:null}{error?<View accessibilityLiveRegion="polite"><Copy dark={dark} error>{error}</Copy><Action dark={dark} label="Refresh categories" onPress={()=>{void load();}}/></View>:null}</>;
}
