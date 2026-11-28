// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
vi.mock('../src/components/ReceiptScan',()=>({ReceiptScan:(props:{onBegin():void;onResult(value:unknown,clearMissingDate?:boolean):void})=>createElement('div',null,createElement('button',{type:'button',onClick:()=>{props.onBegin();props.onResult({merchant:'Shop',date:null,amount:'12.50',currency:null});}},'Test scan'),createElement('button',{type:'button',onClick:()=>props.onResult({merchant:'AI Shop',date:'2026-11-20',amount:'13.50',currency:null},false)},'Test AI'))}));
import {ManualTransactions} from '../src/components/ManualTransactions';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('requires review and currency confirmation after a scan',async()=>{
  const writes:string[]=[];const api:LedgerApi=async<T>(path:string,init?:RequestInit)=>{if(path.includes('manual-matches'))return {matches:[]} as T;if(path==='/api/categories')return {categories:[{name:'Food',archived:false}]} as T;writes.push(String(init?.body));return {} as T;};
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Checking',institution:'Bank',currency:'CAD'}],api,onChanged:async()=>{}})));
    act(()=>[...host.querySelectorAll('button')].find(x=>x.textContent==='Add transaction')!.click());
    act(()=>[...host.querySelectorAll('button')].find(x=>x.textContent==='Test scan')!.click());
    const input=(name:string)=>[...host.querySelectorAll('label')].find(x=>x.textContent?.startsWith(name))!.querySelector('input')!;
    expect(input('Date').value).toBe('');expect(input('Description').value).toBe('Shop');expect(input('Amount').value).toBe('12.50');
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(writes).toHaveLength(0);expect(host.textContent).toContain('Confirm the receipt currency');
  }finally{act(()=>root.unmount());host.remove();}
});

it('preserves edits after local OCR while applying untouched AI suggestions',async()=>{
 const api:LedgerApi=async<T>(path:string)=> (path.includes('manual-matches')?{matches:[]}:{categories:[]}) as T;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Checking',institution:'Bank',currency:'CAD'}],api,onChanged:async()=>{}})));
  act(()=>[...host.querySelectorAll('button')].find(x=>x.textContent==='Add transaction')!.click());
  act(()=>[...host.querySelectorAll('button')].find(x=>x.textContent==='Test scan')!.click());
  const field=(name:string)=>[...host.querySelectorAll('label')].find(x=>x.textContent?.startsWith(name))!.querySelector('input')!;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field('Description'),'My edit');field('Description').dispatchEvent(new Event('input',{bubbles:true}));});
  act(()=>[...host.querySelectorAll('button')].find(x=>x.textContent==='Test AI')!.click());
  expect(field('Description').value).toBe('My edit');expect(field('Amount').value).toBe('13.50');
 }finally{act(()=>root.unmount());host.remove();}
});
