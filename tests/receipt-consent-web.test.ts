// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
const ocr=vi.hoisted(()=>({createWorker:vi.fn()}));
vi.mock('tesseract.js',()=>({createWorker:ocr.createWorker.mockImplementation(async()=>({recognize:async()=>({data:{text:'SHOP\n2026-11-20\nTOTAL 12.50'}}),terminate:async()=>{}}))}));
import {ReceiptScan} from '../src/components/ReceiptScan';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('offers retake guidance when the OCR output misses important details',async()=>{
 ocr.createWorker.mockImplementationOnce(async()=>({recognize:async()=>({data:{text:'SHOP\nSUBTOTAL 12.00'}}),terminate:async()=>{}}));
 const api:LedgerApi=async<T>()=>({configurations:[]}) as T;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:()=>{},onResult:()=>{}})));
  const input=host.querySelector('input')!;Object.defineProperty(input,'files',{value:[new File(['image'],'receipt.png',{type:'image/png'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.textContent).toContain('try another photo');
 }finally{act(()=>root.unmount());host.remove();}
});
it('sends receipt text only after explicit confirmation',async()=>{
 const begin=vi.fn();
 const requests:string[]=[];const api:LedgerApi=async<T>(path:string)=>{requests.push(path);return (path==='/api/analysis'?{configurations:[{provider:'openai',model:'test',revision:'r'}]}:{suggestion:{merchant:'Shop',date:null,amount:'12.50',currency:null},amountConflict:false}) as T;};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:begin,onBusy:()=>{},onResult:()=>{}})));
  const file=new File(['image'],'receipt.png',{type:'image/png'});const input=host.querySelector('input')!;Object.defineProperty(input,'files',{value:[file],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(ocr.createWorker).toHaveBeenCalledWith('eng',1,expect.objectContaining({langPath:expect.any(String)}));
  expect(requests).toEqual(['/api/analysis/ocr/configuration','/api/analysis']);const improve=[...host.querySelectorAll('button')].find(x=>x.textContent==='Improve with AI')!;
  await act(async()=>improve.click());expect(requests).toEqual(['/api/analysis/ocr/configuration','/api/analysis']);
  confirm.mockReturnValue(true);await act(async()=>{improve.click();await new Promise(resolve=>setTimeout(resolve,0));});
  expect(requests).toEqual(['/api/analysis/ocr/configuration','/api/analysis','/api/analysis/receipt']);expect(begin).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());host.remove();confirm.mockRestore();vi.unstubAllGlobals();}
});

async function scanWithSettings(api:LedgerApi) {
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
 const busy=vi.fn(),result=vi.fn(),host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:busy,onResult:result})));
 const input=host.querySelector('input')!;Object.defineProperty(input,'files',{value:[new File(['image'],'receipt.png',{type:'image/png'})],configurable:true});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
 return {busy,result,host,root,input};
}
it('warns and requires manual amount entry when text AI disagrees',async()=>{
 const api:LedgerApi=async<T>(path:string)=> (path==='/api/analysis'?{configurations:[{provider:'openai',model:'test',revision:'r'}]}:path.endsWith('/receipt')?{suggestion:{merchant:'Shop',date:null,amount:null,currency:null},amountConflict:true}:null) as T;
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);const {result,host,root}=await scanWithSettings(api);
 try {
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Improve with AI')!.click();await new Promise(resolve=>setTimeout(resolve,0));});
  expect(result).toHaveBeenLastCalledWith(expect.objectContaining({amount:null}),false,true);
  expect(host.textContent).toContain('totals disagree');
 }finally{act(()=>root.unmount());host.remove();confirm.mockRestore();vi.unstubAllGlobals();}
});
it('finishes local scanning while optional AI settings remain unavailable',async()=>{
 const api:LedgerApi=async()=>await new Promise(()=>{});
 const {busy,result,host,root,input}=await scanWithSettings(api);
 try {
  expect(result).toHaveBeenCalledOnce();expect(busy.mock.lastCall?.[0]).toBe(false);expect(input.disabled).toBe(false);
 }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it('keeps local suggestions usable when AI settings have an invalid shape',async()=>{
 const api:LedgerApi=async<T>()=>({configurations:null}) as T;
 const {result,host,root,input}=await scanWithSettings(api);
 try {
  expect(result).toHaveBeenCalledOnce();expect(input.disabled).toBe(false);expect(host.textContent).not.toContain('Improve with AI');
 }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});


it('stops scanning if OCR initialization fails',async()=>{
 ocr.createWorker.mockImplementationOnce(async (_language,_mode,options)=>{queueMicrotask(()=>options.errorHandler('initialization failed'));return await new Promise(()=>{});});
 const api:LedgerApi=async<T>()=>({configurations:[]}) as T;
 const busy=vi.fn(),host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:busy,onResult:()=>{}})));
  const input=host.querySelector('input')!;Object.defineProperty(input,'files',{value:[new File(['image'],'receipt.png',{type:'image/png'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.textContent).toContain('Could not read this receipt');expect(input.disabled).toBe(false);expect(busy.mock.lastCall?.[0]).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
