// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';import {act,createElement} from 'react';import {createRoot} from 'react-dom/client';
import {CategorySpending} from '../src/components/CategorySpending';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
describe('category spending',()=>{it('loads the period total and opens paginated category activity',async()=>{
 const api=vi.fn(async(path:string)=>path==='/api/categories'?{categories:[{name:'Food',archived:false}]}:path.startsWith('/api/reports/')?{currencyTotals:[{currency:'CAD',confirmedMinorUnits:1200,provisionalMinorUnits:0}],convertedTotals:null}:{items:[{id:'tx',accountId:'account',date:'2026-10-10',merchant:'Coffee',currency:'CAD',amountMinor:-1200,kind:'expense',status:'confirmed',category:'Food',source:'manual',note:null,revision:0}],page:{nextCursor:null}});
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
 await act(async()=>root.render(createElement(CategorySpending,{api:api as never,from:'2026-10-01',to:'2026-10-31',timeZone:'America/Toronto',includeProvisional:false,reportingCurrency:null})));
 const select=el.querySelector('select')!;act(()=>{select.value='Food';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>{});expect(el.textContent).toContain('12.00');
 await act(async()=>{[...el.querySelectorAll('button')].find(button=>button.textContent==='View activity')!.click();});
 expect(el.textContent).toContain('Coffee');expect(api).toHaveBeenCalledWith(expect.stringContaining('category=Food'));
 await act(async()=>{[...el.querySelectorAll('button')].find(button=>button.textContent==='Coffee')!.click();});
 expect(el.textContent).toContain('Activity detail');
 act(()=>root.unmount());el.remove();
 });
 it('announces loading and allows retry after a report failure',async()=>{
  let resolveReport:(value:unknown)=>void=()=>{};const api=vi.fn((path:string)=>path==='/api/categories'?Promise.resolve({categories:[{name:'Food',archived:false}]}):new Promise((resolve)=>{resolveReport=resolve;}));
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(CategorySpending,{api:api as never,from:'2026-10-01',to:'2026-10-31',timeZone:'America/Toronto',includeProvisional:false,reportingCurrency:null})));
  act(()=>{const select=el.querySelector('select')!;select.value='Food';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(el.textContent).toContain('Loading category spending');
  await act(async()=>resolveReport({currencyTotals:[],convertedTotals:null}));
  expect(el.textContent).toContain('No spending in this period');act(()=>root.unmount());el.remove();
});
 it('refreshes the workspace after saving an activity edit',async()=>{
  const onChanged=vi.fn(async()=>{});
  const api=vi.fn(async(path:string)=>path==='/api/categories'?{categories:[{name:'Food',archived:false}]}:path.startsWith('/api/reports/')?{currencyTotals:[],convertedTotals:null}:path.includes('/annotation')?{}:{items:[{id:'tx',accountId:'account',date:'2026-10-10',merchant:'Coffee',currency:'CAD',amountMinor:-1200,kind:'expense',status:'confirmed',category:'Food',source:'manual',note:null,revision:0}],page:{nextCursor:null}});
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
  await act(async()=>root.render(createElement(CategorySpending,{api:api as never,from:'2026-10-01',to:'2026-10-31',timeZone:'America/Toronto',includeProvisional:false,reportingCurrency:null,onChanged})));
  act(()=>{const select=el.querySelector('select')!;select.value='Food';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{});
  await act(async()=>{[...el.querySelectorAll('button')].find(button=>button.textContent==='View activity')!.click();});
  await act(async()=>{[...el.querySelectorAll('button')].find(button=>button.textContent==='Coffee')!.click();});
  await act(async()=>{el.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(onChanged).toHaveBeenCalledOnce();act(()=>root.unmount());el.remove();
});});
