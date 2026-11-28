// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
import {ReceiptOcrSettings} from '../src/components/ReceiptOcrSettings';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

it('shows separate OCR settings with Microsoft and compatible AI options',async()=>{
 const api:LedgerApi=async<T>()=>null as T;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ReceiptOcrSettings,{api,disabled:false,onConfiguration:vi.fn()})));
  expect(host.textContent).toContain('Microsoft Document Intelligence');
  expect(host.textContent).toContain('OpenAI');
  expect(host.textContent).toContain('Anthropic');
  expect(host.textContent).toContain('configured by the application administrator');
 }finally{act(()=>root.unmount());host.remove();}
});
it('saves an OCR provider independently from spending-analysis settings',async()=>{
 const requests:Array<{path:string;method:string;body:string|undefined}>=[];
 const api:LedgerApi=async<T>(path:string,init?:RequestInit)=>{requests.push({path,method:init?.method??'GET',body:init?.body as string|undefined});return (init?.method==='PUT'?{ok:true}:{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',revision:'r1'}) as T;};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ReceiptOcrSettings,{api,disabled:false,onConfiguration:vi.fn()}));await Promise.resolve();});
  const input=host.querySelector('input[type=password]')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'ocr-key');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Save OCR settings')!.click();await Promise.resolve();});
  const saved=requests.find(request=>request.method==='PUT');expect(saved?.path).toBe('/api/analysis/ocr/configuration');
  expect(JSON.parse(saved!.body!)).toMatchObject({provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'ocr-key'});
  expect(host.querySelector('input[aria-label="Provider endpoint"]')).toBeNull();
  expect((input as HTMLInputElement).value).toBe('');
 }finally{act(()=>root.unmount());host.remove();}
});
it('disables a previously saved custom endpoint until the user saves official settings',async()=>{
 const onConfiguration=vi.fn();const api:LedgerApi=async<T>()=>({provider:'openai',endpoint:'https://old.vendor.com/v1',model:'vision',revision:'r1'}) as T;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>{root.render(createElement(ReceiptOcrSettings,{api,disabled:false,onConfiguration}));await Promise.resolve();});
  expect(onConfiguration).toHaveBeenLastCalledWith(null);
  expect(host.textContent).toContain('Custom OCR endpoints are no longer supported');
  expect(host.textContent).toContain('https://api.openai.com/v1/chat/completions');
 }finally{act(()=>root.unmount());host.remove();}
});
