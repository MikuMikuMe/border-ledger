// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('../src/login-demo/ThreadField',()=>({ThreadField:()=>null}));
import {LoginDemo} from '../src/login-demo/LoginDemo';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it('restores the first Thread Field composition with only approved wordmark/unchecked exceptions',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  act(()=>root.render(createElement(LoginDemo)));
  expect(host.textContent).toContain('Personal finance, composed.');
  expect(host.textContent).toContain('See the flow.');expect(host.textContent).toContain('Keep the perspective.');
  expect(host.textContent).toContain('Continue in your verified browser.');expect(host.textContent).toContain('Passkey ready');
  expect(host.textContent).toContain('Bank passwords never enter Border Ledger.');
  expect(host.querySelector('header')?.textContent).toBe('Border Ledger');
  expect(host.querySelector('header svg')).toBeNull();expect(host.textContent).not.toContain('Private');
  expect(host.textContent).not.toContain('Appearance:');expect(host.textContent).not.toContain('About');
  const checkbox=host.querySelector<HTMLInputElement>('input[type=checkbox]')!;expect(checkbox.checked).toBe(false);
  act(()=>checkbox.click());expect(checkbox.checked).toBe(true);
  const submitted=new Event('submit',{bubbles:true,cancelable:true});host.querySelector('form')!.dispatchEvent(submitted);expect(submitted.defaultPrevented).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});
