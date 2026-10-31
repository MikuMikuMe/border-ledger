// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import {BudgetView} from '../src/components/BudgetView';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('web budget view',()=>{
 it('shows monthly category balances and unavailable funding',async()=>{
  const api=vi.fn(async(path:string)=>path.includes('/view?')?{settings:{currency:'CAD'},currentMonth:'2026-10',summary:{month:'2026-10',cashMinor:null,unassignedMinor:null,categories:[{category:'Food',openingMinor:1000,assignedMinor:3000,activityMinor:-500,availableMinor:3500,targetMinor:5000,suggestedMinor:1500,missingTransactionIds:[]}]},balances:[{id:'bank',accountId:'bank',name:'Bank',source:'unavailable',sourceCurrency:'CAD',sourceMinor:null,amountMinor:null,observedAt:null,rateDate:null}],activity:[],asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'}:{settings:{currency:'CAD'},allocations:[],targets:[],cash:[],balances:[]});
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  await act(async()=>{root.render(createElement(BudgetView,{api:api as never,initialMonth:'2026-10',accounts:[]}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(node.textContent).toContain('Food');expect(node.textContent).toContain('Unavailable');expect(node.textContent).toContain('Bank');
  const save=[...node.querySelectorAll('button')].find(button=>button.textContent==='Save assignment');
  await act(async()=>{save?.click();});
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('Check the amount');
  act(()=>root.unmount());node.remove();
 });
});
