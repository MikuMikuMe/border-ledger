// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {BudgetRollover} from '../src/components/BudgetRollover';
import {BudgetView} from '../src/components/BudgetView';
import type {LedgerApi} from '../src/domain/api';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('previews dated category rollover before saving its guarded revision',async()=>{
 const writes:{path:string;body:Record<string,unknown>}[]=[];let requests=0;let completePreview:(value:unknown)=>void=()=>undefined;
 const settings={currency:'CAD',preferredMode:'envelope',revision:8};
 const api=(async(path:string,init?:RequestInit)=>{
  if(init){writes.push({path,body:JSON.parse(init.body as string)});return {ok:true};}
  if(path==='/api/budget')return {settings,cash:[]};
  if(path.includes('rollover-preview')){const result={category:'Food',effectiveMonth:'2026-10',policy:'reset',revision:8,changes:[{month:'2026-11',category:'Food',beforeOpeningMinor:3500,afterOpeningMinor:0,beforeClosingMinor:3500,afterClosingMinor:0}]};if(++requests===1)return new Promise<unknown>(resolve=>{completePreview=resolve;});return result;}
  if(path.includes('/view?'))return {settings,currentMonth:'2026-10',summary:{month:'2026-10',cashMinor:5000,unassignedMinor:1500,categories:[{category:'Food',openingMinor:1000,assignedMinor:3000,activityMinor:-500,availableMinor:3500,targetMinor:null,suggestedMinor:null,missingTransactionIds:[]}]},balances:[],activity:[],asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'};
  return {};
 }) as LedgerApi;
 const node=document.createElement('div'),root=createRoot(node);document.body.append(node);
 function button(text:string){const found=[...node.querySelectorAll('button')].find(x=>x.textContent===text);expect(found).toBeTruthy();return found!;}
 try{
  await act(async()=>root.render(createElement(BudgetView,{api,initialMonth:'2026-10',accounts:[]})));
  const select=node.querySelector('[aria-label="Rollover for Food"]') as HTMLSelectElement;expect(select).toBeTruthy();
  await act(async()=>{select.value='reset';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>button('Preview rollover').click());
  await act(async()=>{select.value='carry_positive';select.dispatchEvent(new Event('change',{bubbles:true}));completePreview({category:'Food',effectiveMonth:'2026-10',policy:'reset',revision:8,changes:[]});});
  expect([...node.querySelectorAll('button')].some(x=>x.textContent==='Save rollover policy')).toBe(false);
  await act(async()=>{select.value='reset';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>button('Preview rollover').click());
  expect(writes).toHaveLength(0);expect(node.textContent).toContain('2026-11');expect(node.textContent).toContain('Before');
  const table=node.querySelector('[aria-label="Projected rollover changes"] [role="table"]');
  expect(table).toBeTruthy();expect(table!.querySelectorAll('[role="cell"]')).toHaveLength(4);
  expect([...table!.querySelectorAll('[role="columnheader"]')].map(cell=>cell.textContent)).toEqual(['Month','Before opening','After opening','Before closing','After closing']);
  expect([...table!.querySelectorAll('[aria-hidden="true"]')].map(label=>label.textContent)).toEqual(['Before opening','After opening','Before closing','After closing']);
  await act(async()=>{select.value='carry_positive';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect([...node.querySelectorAll('button')].some(x=>x.textContent==='Save rollover policy')).toBe(false);
  await act(async()=>{select.value='reset';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>button('Preview rollover').click());
  await act(async()=>button('Save rollover policy').click());
  expect(writes[0]).toMatchObject({path:'/api/budget/rollover',body:{category:'Food',effectiveMonth:'2026-10',policy:'reset',expectedRevision:8,operationId:expect.any(String)}});
 }finally{act(()=>root.unmount());node.remove();}
});


it('refreshes pristine rollover selection while preserving edited selection',async()=>{
 const node=document.createElement('div'),root=createRoot(node);
 const props={category:'Food',month:'2026-10',currency:'CAD',state:{busy:false} as never};
 try{
  await act(async()=>root.render(createElement(BudgetRollover,{...props,currentPolicy:'carry_all'})));
  const select=node.querySelector('select') as HTMLSelectElement;
  await act(async()=>root.render(createElement(BudgetRollover,{...props,currentPolicy:'reset'})));
  expect(select.value).toBe('reset');
  await act(async()=>{select.value='carry_positive';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>root.render(createElement(BudgetRollover,{...props,currentPolicy:'carry_all'})));
  expect(select.value).toBe('carry_positive');
 }finally{act(()=>root.unmount());}
});
