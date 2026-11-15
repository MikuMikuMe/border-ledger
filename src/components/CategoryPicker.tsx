import {useEffect,useId,useState} from 'react';
import type {LedgerApi} from '../domain/api';
import {CategoryManager} from './CategoryManager';
type Category={name:string;archived:boolean};
function CategorySearch({searchId,search,setSearch,name,exists,disabled,create}:{searchId:string;search:string;setSearch(value:string):void;name:string;exists:boolean;disabled:boolean;create():Promise<void>}) {
 return <details className="category-picker-extra"><summary>Search or create a category</summary><label htmlFor={searchId}>Search or add a category</label><input id={searchId} maxLength={80} value={search} disabled={disabled} onChange={event=>setSearch(event.target.value)}/>{name&&!exists?<button type="button" className="outline-button" disabled={disabled} onClick={()=>{void create();}}>Create category</button>:null}{name&&exists?<p>Select the existing category above.</p>:null}</details>;
}
export function CategoryPicker({api,value,onChange,disabled}:{api:LedgerApi;value:string;onChange(value:string):void;disabled:boolean}) {
 const [categories,setCategories]=useState<Category[]>([]),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const selectId=useId(),searchId=useId(),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;void api<{categories:Category[]}>('/api/categories').then(data=>{if(!Array.isArray(data.categories))throw new Error('Invalid category response');if(active)setCategories(data.categories);}).catch(()=>{if(active)setError('Could not load categories.');});return()=>{active=false;};},[api,refresh]);
 const name=search.trim();
 const matches=categories.filter(category=>!category.archived&&category.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
 const exists=categories.some(category=>category.name.toLocaleLowerCase()===name.toLocaleLowerCase());
 const create=async()=>{setBusy(true);setError('');try{await api('/api/categories',{method:'POST',body:JSON.stringify({name})});setCategories(current=>[...current,{name,archived:false}]);onChange(name);setSearch('');}catch{setError('Could not create category. Refresh and try again.');}finally{setBusy(false);}};
 return <div className="category-picker"><label htmlFor={selectId}>Category</label><select id={selectId} aria-label="Category" required value={value} disabled={disabled||busy} onChange={event=>onChange(event.target.value)}><option value="">Select a category</option>{value&&!matches.some(category=>category.name===value)?<option value={value}>{value}</option>:null}{matches.map(category=><option key={category.name} value={category.name}>{category.name}</option>)}</select><CategorySearch searchId={searchId} search={search} setSearch={setSearch} name={name} exists={exists} disabled={disabled||busy} create={create}/>{categories.length===0&&!error?<p>No categories yet. Create one to get started.</p>:null}{error?<p role="alert">{error}</p>:null}<details><summary>Manage categories</summary><CategoryManager api={api} categories={categories} onChanged={(from,to)=>{if(from===value&&to)onChange(to);setRefresh(current=>current+1);}}/></details></div>;
}
