// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
vi.mock('tesseract.js',()=>({createWorker:async()=>({recognize:async()=>({data:{text:'STORE\nTOTAL 12.50'}}),terminate:async()=>{}})}));
import {ReceiptScan} from '../src/components/ReceiptScan';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('only sends an image to the configured receipt provider after per-scan confirmation',async()=>{
 const sent:string[]=[];
 const api:LedgerApi=async<T>(path:string)=>{
  sent.push(path);
  if(path.endsWith('/ocr/configuration'))return {provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'rev'} as T;
  if(path.endsWith('/ocr/scan'))return {suggestion:{merchant:'Store',date:null,amount:'12.50',currency:null},deletionRequested:true} as T;
  return {configurations:[]} as T;
 };
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:()=>{},onResult:()=>{}}));await Promise.resolve();});
  const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File([new Uint8Array([255,216,255,217])],'receipt.jpg',{type:'image/jpeg'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  const button=[...host.querySelectorAll('button')].find(x=>x.textContent==='Analyze receipt image')!;
  await act(async()=>button.click());expect(sent).not.toContain('/api/analysis/ocr/scan');
  confirm.mockReturnValue(true);await act(async()=>{button.click();await new Promise(resolve=>setTimeout(resolve,20));});
  expect(sent).toContain('/api/analysis/ocr/scan');
 }finally{act(()=>root.unmount());host.remove();confirm.mockRestore();}
});
it('does not submit the same receipt twice while provider analysis is running',async()=>{
 const requests:string[]=[];const api:LedgerApi=async<T>(path:string)=>{requests.push(path);if(path.endsWith('/ocr/configuration'))return {provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'rev'} as T;if(path.endsWith('/ocr/scan'))return await new Promise<T>(()=>{});return {configurations:[]} as T;};
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true),host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:()=>{},onResult:()=>{}}));await Promise.resolve();});
  const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File([new Uint8Array([255,216,255,217])],'receipt.jpg',{type:'image/jpeg'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  const button=[...host.querySelectorAll('button')].find(x=>x.textContent==='Analyze receipt image')!;
  await act(async()=>{button.click();button.click();await new Promise(resolve=>setTimeout(resolve,20));});
  expect(requests.filter(path=>path.endsWith('/ocr/scan'))).toHaveLength(1);
 }finally{act(()=>root.unmount());host.remove();confirm.mockRestore();}
});
it('keeps recognized text for the image total check after text improvement',async()=>{
 let imageBody:Record<string,unknown>|undefined;
 const api:LedgerApi=async<T>(path:string,init?:RequestInit)=>{
  if(path.endsWith('/ocr/configuration'))return {provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'rev'} as T;
  if(path==='/api/analysis')return {configurations:[{provider:'openai',model:'test',revision:'r'}]} as T;
  if(path.endsWith('/receipt'))return {suggestion:{merchant:'Store',date:null,amount:'12.50',currency:null},amountConflict:false} as T;
  if(path.endsWith('/ocr/scan')){imageBody=JSON.parse(String(init?.body));return {suggestion:{merchant:'Store',date:null,amount:null,currency:null},amountConflict:true,deletionRequested:true} as T;}
  return null as T;
 };
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true),host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:()=>{},onResult:()=>{}}));await Promise.resolve();});
  const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File([new Uint8Array([255,216,255,217])],'receipt.jpg',{type:'image/jpeg'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  await act(async()=>{[...host.querySelectorAll('button')].find(x=>x.textContent==='Improve with AI')!.click();await new Promise(resolve=>setTimeout(resolve,0));});
  await act(async()=>{[...host.querySelectorAll('button')].find(x=>x.textContent==='Analyze receipt image')!.click();await new Promise(resolve=>setTimeout(resolve,20));});
  expect(imageBody?.text).toBe('STORE\nTOTAL 12.50');
 }finally{act(()=>root.unmount());host.remove();confirm.mockRestore();}
});
