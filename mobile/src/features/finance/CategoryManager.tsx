import React,{useState} from 'react';
import {Alert,ScrollView,TextInput,View} from 'react-native';
import {useContext} from 'react';
import {CategoryServicesContext} from './categoryServices';
import {Action,Copy} from './FinanceViews';
type Category={name:string;archived:boolean};
type Preview={from:string;to:string;transactions:number;budget:Record<string,number>;conflicts:string[];version:string};
export type CategoryCleanup={from:string;to:string};
async function applyCategoryCleanup({preview,request,onChanged,onCleanup,setBusy,setMessage,setPreview,setTarget,setSource}:{preview:Preview|null;request(action:string,body:unknown):Promise<Preview>;onChanged(from?:string,to?:string):void;onCleanup?(cleanup:CategoryCleanup):Promise<boolean>|void;setBusy(value:boolean):void;setMessage(value:string):void;setPreview(value:Preview|null):void;setTarget(value:string):void;setSource(value:string):void}) {
 if(!preview)return;
 setBusy(true);setMessage('');
 try{await request('cleanup',{from:preview.from,to:preview.to,version:preview.version});}
 catch{setPreview(null);setMessage('Categories changed or budgets conflict. Preview again.');setBusy(false);return;}
 setPreview(null);setTarget('');setSource('');onChanged(preview.from,preview.to);
 setMessage(await cleanupStatusMessage(onCleanup,{from:preview.from,to:preview.to}));setBusy(false);
}
const cleanupRefreshFailed='Category updated, but the transaction could not be refreshed. Refresh Activity before saving.';
async function cleanupStatusMessage(onCleanup:((cleanup:CategoryCleanup)=>Promise<boolean>|void)|undefined,cleanup:CategoryCleanup) {
 try { if(await onCleanup?.(cleanup)===false)return cleanupRefreshFailed;return 'Category updated.'; } catch { return cleanupRefreshFailed; }
}
async function archiveCategory({name,request,onChanged,setBusy,setMessage,setPreview,setSource}:{name:string;request(action:string,body:unknown):Promise<Preview>;onChanged():void;setBusy(value:boolean):void;setMessage(value:string):void;setPreview(value:Preview|null):void;setSource(value:string):void}) {
 setBusy(true);setMessage('');try{await request('archive',{name});setPreview(null);setSource('');setMessage('Category archived.');onChanged();}catch{setMessage('Could not archive category. Try again.');}finally{setBusy(false);}
}
async function restoreCategory({name,request,onChanged,setBusy,setMessage}:{name:string;request(action:string,body:unknown):Promise<Preview>;onChanged():void;setBusy(value:boolean):void;setMessage(value:string):void}) {
 setBusy(true);setMessage('');try{await request('restore',{name});setMessage('Category restored.');onChanged();}catch{setMessage('Could not restore this category. Merged categories cannot be restored.');}finally{setBusy(false);}
}
async function inspectCategory({source,target,request,setBusy,setMessage,setPreview}:{source:string;target:string;request(action:string,body:unknown):Promise<Preview>;setBusy(value:boolean):void;setMessage(value:string):void;setPreview(value:Preview|null):void}) {
 setBusy(true);setMessage('');setPreview(null);try{setPreview(await request('preview',{from:source,to:target.trim()}));}catch{setMessage('Could not preview changes. Check the names and try again.');}finally{setBusy(false);}
}export function CategoryManager({dark,categories,onChanged,onCleanup}:{dark:boolean;categories:Category[];onChanged(from?:string,to?:string):void;onCleanup?(cleanup:CategoryCleanup):Promise<boolean>|void}) {
 const service=useContext(CategoryServicesContext);
 const active=categories.filter(category=>!category.archived),[source,setSource]=useState(''),[target,setTarget]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const chosen=source;
 const request=async(action:string,body:unknown)=>JSON.parse(await service.categoryAction(action,JSON.stringify(body))) as Preview;
 const inspect=()=>{void inspectCategory({source:chosen,target,request,setBusy,setMessage,setPreview});};
 const apply=()=>{void applyCategoryCleanup({preview,request,onChanged,onCleanup,setBusy,setMessage,setPreview,setTarget,setSource});};
 const archive=()=>Alert.alert(`Archive ${chosen}?`,'Existing history will remain visible.',[{text:'Cancel',style:'cancel'},{text:'Archive',onPress:()=>{void archiveCategory({name:chosen,request,onChanged,setBusy,setMessage,setPreview,setSource});}}]);
 const restore=(name:string)=>{void restoreCategory({name,request,onChanged,setBusy,setMessage});};
 const budget=preview?Object.values(preview.budget).reduce((sum,count)=>sum+count,0):0;
 return <View style={{gap:8}}><Copy dark={dark} heading>Manage categories</Copy><Copy dark={dark}>Category to manage</Copy><ScrollView nestedScrollEnabled accessibilityLabel="Categories to manage" style={{maxHeight:200}}>{active.map(category=><Action key={category.name} dark={dark} label={`Manage ${category.name}`} text={category.name} radio selected={category.name===chosen} disabled={busy} onPress={()=>{setSource(category.name);setPreview(null);}}/>)}</ScrollView><Copy dark={dark}>Rename or merge into</Copy><TextInput accessibilityLabel="Rename or merge into" value={target} maxLength={80} editable={!busy} onChangeText={value=>{setTarget(value);setPreview(null);}} style={{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:12,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'}}/><Action dark={dark} label="Preview changes" disabled={busy||!chosen||!target.trim()||chosen===target.trim()} onPress={()=>{void inspect();}}/><Action dark={dark} label="Archive category" disabled={busy||!chosen} onPress={archive}/>{preview?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{preview.transactions} transactions · {budget} budget records will move from {preview.from} to {preview.to}.</Copy>{preview.conflicts.length?<Copy dark={dark} error>Budget conflicts: {preview.conflicts.join(', ')}. Resolve these before merging.</Copy>:<Action dark={dark} label="Confirm changes" disabled={busy} onPress={()=>{void apply();}}/>}</View>:null}{categories.some(category=>category.archived)?<View><Copy dark={dark} heading>Archived categories</Copy>{categories.filter(category=>category.archived).map(category=><Action key={category.name} dark={dark} label={`Restore ${category.name}`} disabled={busy} onPress={()=>{void restore(category.name);}}/>)}</View>:null}{message?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{message}</Copy></View>:null}</View>;
}
