// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {CategoryManager} from '../src/components/CategoryManager';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
describe('category management',()=>{
 it('previews a rename before enabling confirmation',async()=>{
  const api=vi.fn(async(path:string)=>path.endsWith('/preview')?{from:'Food',to:'Dining',transactions:2,budget:{allocations:1},conflicts:[],version:'a'.repeat(64)}:{ok:true});
  const changed=vi.fn(),el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(CategoryManager,{api:api as never,categories:[{name:'Food',archived:false}],onChanged:changed})));
  const source=el.querySelector('select')!;act(()=>{source.value='Food';source.dispatchEvent(new Event('change',{bubbles:true}));});
  const input=el.querySelector('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Dining');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{[...el.querySelectorAll('button')].find(x=>x.textContent==='Preview changes')!.click();});
  expect(el.textContent).toContain('2 transactions');expect(el.textContent).toContain('1 budget');
  await act(async()=>{[...el.querySelectorAll('button')].find(x=>x.textContent==='Confirm changes')!.click();});
  expect(api).toHaveBeenCalledWith('/api/categories/cleanup',expect.objectContaining({method:'POST'}));expect(changed).toHaveBeenCalledWith('Food','Dining');act(()=>root.unmount());el.remove();
 });
 it('offers restoration of an archived category',async()=>{
  const api=vi.fn(async()=>({ok:true})),changed=vi.fn(),el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(CategoryManager,{api:api as never,categories:[{name:'Old',archived:true}],onChanged:changed})));
  await act(async()=>{[...el.querySelectorAll('button')].find(node=>node.textContent==='Restore Old')!.click();});
  expect(api).toHaveBeenCalledWith('/api/categories/restore',expect.objectContaining({method:'POST',body:JSON.stringify({name:'Old'})}));expect(changed).toHaveBeenCalled();act(()=>root.unmount());el.remove();
 });
});
