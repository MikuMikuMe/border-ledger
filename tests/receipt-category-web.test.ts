// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
vi.mock('../src/components/ReceiptScan',()=>({ReceiptScan:(props:{onResult(value:unknown):void})=>createElement('button',{type:'button',onClick:()=>props.onResult({merchant:'Metro',date:'2026-11-20',amount:'12.50',currency:null,category:'Groceries'})},'Apply AI result')}));
import {ManualTransactions} from '../src/components/ManualTransactions';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('fills the category in the draft without saving the transaction',async()=>{
 const writes:string[]=[];const api:LedgerApi=async<T>(path:string,init?:RequestInit)=>{if(init?.method)writes.push(path);return (path==='/api/categories'?{categories:[{name:'Groceries',archived:false}]}:{matches:[]}) as T;};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ManualTransactions,{accounts:[{id:'a',name:'Account',institution:'Bank',currency:'CAD'}],api,onChanged:async()=>{}}));await Promise.resolve();});
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Add transaction')!.click();await Promise.resolve();});
  act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Apply AI result')!.click());
  expect((host.querySelector('select[aria-label="Category"]') as HTMLSelectElement).value).toBe('Groceries');
  expect(writes).toEqual([]);
 }finally{act(()=>root.unmount());host.remove();}
});
