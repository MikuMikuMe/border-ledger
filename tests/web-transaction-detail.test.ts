// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createElement,act} from 'react';
import {createRoot} from 'react-dom/client';
import {TransactionDetail} from '../src/components/TransactionDetail';
import {TransactionTable} from '../src/App';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const transaction={id:'tx',accountId:'acct',date:'2026-11-07',merchant:'Coffee',amountMinor:-1234,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'manual',fingerprint:'hash',annotationRevision:0} as const;
describe('web transaction detail',()=>{
 afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
 it('opens saved transaction rows from any cell while previews stay read only',async()=>{
  const onOpen=vi.fn(),el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(TransactionTable,{transactions:[transaction],onOpen})));
  expect(el.textContent).toContain('Manual');
  act(()=>el.querySelector('tbody td')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(onOpen).toHaveBeenCalledWith(transaction);
  await act(async()=>root.render(createElement(TransactionTable,{transactions:[transaction],compact:true})));
  expect(el.querySelector('tbody button')).toBeNull();act(()=>root.unmount());
 });
 it('saves the category and note with the displayed revision',async()=>{
  const calls:unknown[]=[];const api=async <T>(path:string,init?:RequestInit)=>{calls.push([path,init]);return {revision:1} as T;};
  const onChanged=vi.fn(async()=>{}),onClose=vi.fn();const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(TransactionDetail,{transaction,api,onChanged,onClose})));
  const category=el.querySelector('input[aria-label="Category"]') as HTMLInputElement;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(category,'Dining');category.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>el.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject(['/api/transactions/tx/annotation',{method:'PATCH',body:expect.stringContaining('Dining')}]);expect(onChanged).toHaveBeenCalled();
  act(()=>root.unmount());
 });
 it('confirms before discarding a changed draft on backdrop or Escape',async()=>{
  const onClose=vi.fn(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false),api=async <T>()=>({} as T);
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(TransactionDetail,{transaction,api,onChanged:async()=>{},onClose})));
  const category=el.querySelector('input[aria-label="Category"]') as HTMLInputElement;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(category,'Dining');category.dispatchEvent(new Event('input',{bubbles:true}));});
  const dialog=el.querySelector('dialog')!;
  vi.spyOn(dialog,'getBoundingClientRect').mockReturnValue({left:100,top:100,right:500,bottom:500,width:400,height:400,x:100,y:100,toJSON:()=>({})});
  act(()=>dialog.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:150,clientY:150})));
  expect(confirm).not.toHaveBeenCalled();
  act(()=>dialog.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:50,clientY:50})));
  expect(confirm).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);act(()=>el.querySelector('dialog')!.dispatchEvent(new Event('cancel',{bubbles:true,cancelable:true})));
  expect(onClose).toHaveBeenCalledTimes(1);act(()=>root.unmount());
 });
 it('prevents automatic retry when save outcome is unknown',async()=>{
  const api=vi.fn(async()=>{throw new Error('offline');});const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(TransactionDetail,{transaction,api,onChanged:async()=>{},onClose:()=>{}})));
  await act(async()=>el.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(el.textContent).toContain('Save status is unknown');expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>el.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(api).toHaveBeenCalledTimes(1);act(()=>root.unmount());
 });
 it('does not mistake a refresh failure for an uncertain save',async()=>{
  const api=async <T,>()=>({revision:1} as T);const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const onClose=vi.fn();const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(TransactionDetail,{transaction,api,onChanged:async()=>{throw new Error('refresh failed');},onClose})));
  const category=el.querySelector('input[aria-label="Category"]') as HTMLInputElement;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(category,'Dining');category.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>el.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(el.textContent).toContain('saved, but refresh failed');expect(el.textContent).not.toContain('Save status is unknown');
  expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);act(()=>(el.querySelector('button[type="button"]') as HTMLButtonElement).click());expect(confirm).not.toHaveBeenCalled();expect(onClose).toHaveBeenCalled();act(()=>root.unmount());
 });
});
