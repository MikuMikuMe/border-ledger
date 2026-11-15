// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {CategoryPicker} from '../src/components/CategoryPicker';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
describe('category picker',()=>{
 it('selects existing categories and creates new names explicitly',async()=>{
  const api=vi.fn(async(path:string,init?:RequestInit)=>init?.method==='POST'?{ok:true}:{categories:[{name:'Food',archived:false},{name:'Travel',archived:false}]});
  const onChange=vi.fn(),el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(CategoryPicker,{api:api as never,value:'',onChange,disabled:false})));
  const select=el.querySelector('select')!;
  act(()=>{select.value='Food';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(onChange).toHaveBeenCalledWith('Food');
  const disclosure=[...el.querySelectorAll('summary')].find(node=>node.textContent==='Search or create a category')!;
  expect(disclosure.parentElement?.hasAttribute('open')).toBe(false);
  act(()=>disclosure.click());
  const input=el.querySelector('input')!;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Coffee');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>el.querySelector('button')!.click());
  expect(api).toHaveBeenCalledWith('/api/categories',expect.objectContaining({method:'POST',body:JSON.stringify({name:'Coffee'})}));
  expect(onChange).toHaveBeenCalledWith('Coffee');act(()=>root.unmount());el.remove();
 });
});
