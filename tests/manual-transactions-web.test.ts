// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ManualTransactions } from '../src/components/ManualTransactions';
import type { LedgerApi } from '../src/domain/api';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

describe('manual transaction form',()=>{
  it('keeps the same request and fields when a save outcome is uncertain',async()=>{
    const writes:string[]=[];
    const api:LedgerApi=async <T>(path:string,init?:RequestInit)=>{
      if(path.includes('/manual-matches'))return {matches:[]} as T;
      writes.push(String(init?.body));if(writes.length===1)throw new Error('connection lost');return {id:'saved'} as T;
    };
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container),changed=vi.fn(async()=>{});
    try {
      await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Chequing',institution:'Bank',currency:'CAD'}],api,onChanged:changed})));
      const button=(label:string)=>[...container.querySelectorAll('button')].find(node=>node.textContent===label)!;
      act(()=>button('Add transaction').click());
      const set=(label:string,value:string)=>{const input=[...container.querySelectorAll('label')].find(node=>node.textContent?.startsWith(label))!.querySelector('input')!;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      act(()=>{set('Description','Coffee');set('Amount','12.34');set('Category','Food');});
      await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      expect(container.textContent).toContain('Save status is unknown');
      expect(container.querySelector('fieldset')?.disabled).toBe(true);
      await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      expect(writes).toHaveLength(2);expect(writes[0]).toBe(writes[1]);expect(changed).toHaveBeenCalledOnce();
    } finally {act(()=>root.unmount());container.remove();}
  });
  it('reports a successful save when the subsequent refresh fails',async()=>{
    let writes=0;
    const api:LedgerApi=async <T>(path:string)=>{
      if(path.includes('/manual-matches'))return {matches:[]} as T;
      writes++;return {id:'saved'} as T;
    };
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    try {
      await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Chequing',institution:'Bank',currency:'CAD'}],api,onChanged:async()=>{throw new Error('refresh failed');}})));
      const button=[...container.querySelectorAll('button')].find(node=>node.textContent==='Add transaction')!;
      act(()=>button.click());
      const set=(label:string,value:string)=>{const input=[...container.querySelectorAll('label')].find(node=>node.textContent?.startsWith(label))!.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      act(()=>{set('Description','Coffee');set('Amount','12.34');set('Category','Food');});
      await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      expect(writes).toBe(1);
      expect(container.textContent).toContain('Transaction saved, but refresh failed');
      expect(container.textContent).not.toContain('Save status is unknown');
    } finally {act(()=>root.unmount());container.remove();}
  });

  it('moves focus into the form, associates amount errors, and restores focus on cancel',async()=>{
    const api:LedgerApi=async <T>()=>({matches:[]} as T);
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    try {
      await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Chequing',institution:'Bank',currency:'CAD'}],api,onChanged:async()=>{}})));
      act(()=>[...container.querySelectorAll('button')].find(node=>node.textContent==='Add transaction')!.click());
      expect(document.activeElement).toBe(container.querySelector('select'));
      const amount=[...container.querySelectorAll('label')].find(node=>node.textContent?.startsWith('Amount'))!.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,'1.001');
      act(()=>amount.dispatchEvent(new Event('input',{bubbles:true})));
      await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      expect(amount.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(amount.getAttribute('aria-describedby')!)?.textContent).toContain('decimal places');
      act(()=>[...container.querySelectorAll('button')].find(node=>node.textContent==='Cancel')!.click());
      expect((document.activeElement as HTMLElement).textContent).toBe('Add transaction');
    } finally {act(()=>root.unmount());container.remove();}
  });

  it('shows the account, amount, and clear status for duplicate candidates',async()=>{
    const api:LedgerApi=async <T>()=>({matches:[{manualId:'manual',bankId:'bank',accountId:'acct',manualDate:'2026-11-07',bankDate:'2026-11-08',manualMerchant:'Coffee',bankMerchant:'Coffee Bank',amountMinor:-1234,currency:'CAD',bankAmountMinor:-1234,bankCurrency:'CAD',category:'Food',note:null,decision:'open',revision:0}]} as T);
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    try {
      await act(async()=>root.render(createElement(ManualTransactions,{accounts:[{id:'acct',name:'Chequing',institution:'Example Bank',currency:'CAD'}],api,onChanged:async()=>{}})));
      expect(container.textContent).toContain('Example Bank · Chequing');
      expect(container.textContent).toContain('Needs review');
      expect(container.textContent?.match(/12\.34/g)).toHaveLength(2);
    } finally {act(()=>root.unmount());container.remove();}
  });

});
