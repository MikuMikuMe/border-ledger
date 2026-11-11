// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useDismissible} from '../src/components/useDismissible';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
function Fixture(){const [open,setOpen]=useState(false),{container:ref,dismiss}=useDismissible(open,()=>setOpen(false));return createElement('div',null,createElement('div',{ref},createElement('button',{onClick:()=>setOpen(true)},'Open'),open?createElement('button',{onClick:dismiss},'Close menu'):null),createElement('button',null,'Outside'));}
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
it('dismisses on outside pointer or Escape, without dismissing inside clicks',async()=>{
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);await act(async()=>root.render(createElement(Fixture)));
 const open=el.querySelector('button')!,outside=el.querySelectorAll('button')[1];act(()=>{open.focus();open.click();});expect(el.textContent).toContain('Close menu');
 act(()=>open.parentElement!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));expect(el.textContent).toContain('Close menu');
 act(()=>outside.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));expect(el.textContent).not.toContain('Close menu');
 act(()=>{open.focus();open.click();});act(()=>{const close=el.querySelectorAll('button')[1];close.focus();close.click();});expect(document.activeElement).toBe(open);
 act(()=>open.click());act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(el.textContent).not.toContain('Close menu');expect(document.activeElement).toBe(open);act(()=>root.unmount());
});