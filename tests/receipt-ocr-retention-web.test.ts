// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {LedgerApi} from '../src/domain/api';
vi.mock('tesseract.js',()=>({createWorker:async()=>({recognize:async()=>({data:{text:'STORE\nTOTAL 12.50'}}),terminate:async()=>{}})}));
vi.mock('../src/components/ReceiptOcrSettings',()=>({ReceiptOcrSettings:(props:{onConfiguration(value:unknown):void})=>createElement('button',{onClick:()=>props.onConfiguration({provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'new'})},'Configure OCR')}));
import {ReceiptScan} from '../src/components/ReceiptScan';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('does not retain a local scan for later use after OCR settings change',async()=>{
 const api:LedgerApi=async<T>()=>({configurations:[]}) as T,host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(ReceiptScan,{api,disabled:false,onBegin:()=>{},onBusy:()=>{},onResult:()=>{}})));
  const input=host.querySelector('input[type=file]')!;Object.defineProperty(input,'files',{value:[new File(['receipt'],'receipt.jpg',{type:'image/jpeg'})],configurable:true});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Configure OCR')!.click());
  expect(host.textContent).not.toContain('Analyze receipt image');
 }finally{act(()=>root.unmount());host.remove();}
});
