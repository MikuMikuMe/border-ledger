// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import {CustomWindowPicker} from '../src/components/CustomWindowPicker';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;

describe('custom reporting window',()=>{
  it('validates and applies the chosen dates',()=>{
    const apply=vi.fn(),window={key:'month' as const,label:'This month',start:'2026-03-01',end:'2026-03-31'};
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    act(()=>root.render(createElement(CustomWindowPicker,{windows:[window],selectedWindow:window,onPreset:vi.fn(),onApply:apply})));
    act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Custom')!.click());
    const [start,end]=host.querySelectorAll('input');
    const change=(input:HTMLInputElement,value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    change(start,'2026-04-01');expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    change(end,'2026-04-10');act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(apply).toHaveBeenCalledWith('2026-04-01','2026-04-10');
    act(()=>root.unmount());host.remove();
  });
});
