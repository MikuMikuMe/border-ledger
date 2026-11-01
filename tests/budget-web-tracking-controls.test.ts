// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it} from 'vitest';
import {BudgetView} from '../src/components/BudgetView';
import {LedgerApiError,type LedgerApi} from '../src/domain/api';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const tracking={mode:'tracking',settings:{currency:'CAD',preferredMode:'tracking',revision:4},currentMonth:'2026-10',summary:{month:'2026-10',plannedIncomeMinor:300000,plannedExpenseMinor:100000,plannedSavingsMinor:200000,actualIncomeMinor:250000,actualExpenseMinor:null,actualSavingsMinor:null,categories:[{direction:'income',category:'Salary',plannedMinor:300000,actualMinor:250000,varianceMinor:-50000,missingTransactionIds:[]},{direction:'expense',category:'Food',plannedMinor:100000,actualMinor:null,varianceMinor:null,missingTransactionIds:['fx']}]},plans:[],activity:[{id:'foreign',date:'2026-10-12',category:'Food',kind:'expense',sourceCurrency:'CNY',sourceMinor:5000,activityMinor:null,rateDate:null,rate:null}],asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'};
function withFoodPlan(plannedMinor:number){return {...tracking,summary:{...tracking.summary,categories:tracking.summary.categories.map(row=>row.category==='Food'?{...row,plannedMinor}:row)}};}
function click(node:HTMLElement,text:string){const button=[...node.querySelectorAll('button')].find(x=>x.textContent===text);expect(button,`Missing ${text}`).toBeTruthy();button!.click();}
async function mount(api:LedgerApi){const node=document.createElement('div');document.body.append(node);const root=createRoot(node);await act(async()=>root.render(createElement(BudgetView,{api,initialMonth:'2026-10',accounts:[]})));return {node,close:()=>{act(()=>root.unmount());node.remove();}};}
describe('tracking budget controls',()=>{
 it('keeps planned savings readable when actual FX is unavailable and confirms copying before writes',async()=>{
  const writes:{path:string;body:Record<string,unknown>}[]=[];let copied=false;
  const api=(async(path:string,init?:RequestInit)=>{
   if(init){writes.push({path,body:JSON.parse(init.body as string)});copied=true;return {ok:true,revision:5};}
   if(path==='/api/budget')return {settings:tracking.settings,cash:[]};
   if(path.includes('/tracking-copy?'))return {month:'2026-10',sourceMonth:'2026-09',revision:4,sourceRevision:4,plans:[{month:'2026-09',direction:'expense',category:'Food',plannedMinor:80000}]};
   if(path.includes('/view?'))return copied?withFoodPlan(80000):tracking;
   return {};
  }) as LedgerApi;
  const view=await mount(api);
  try {
   expect(view.node.textContent).toContain('Planned savings');expect(view.node.textContent).toContain('$2,000.00');expect(view.node.textContent).toContain('Unavailable');
   expect(view.node.textContent).not.toContain('Available to assign');expect(view.node.textContent).toContain('2026-10-12');expect(view.node.textContent).toContain('Rate date unavailable');
   await act(async()=>click(view.node,'Copy previous month'));
   expect(writes).toHaveLength(0);expect(view.node.textContent).toContain('2026-09');
   await act(async()=>click(view.node,'Replace tracking plans'));
   expect(writes[0]).toMatchObject({path:'/api/budget/tracking-copy',body:{month:'2026-10',sourceMonth:'2026-09',expectedRevision:4,expectedSourceRevision:4,operationId:expect.any(String)}});
   expect((view.node.querySelector('[aria-label="Planned expense for Food"]') as HTMLInputElement).value).toBe('800.00');
  }finally{view.close();}
 });
 it('saves a category forecast with its direction and revision, preserving the draft when offline',async()=>{
  const writes:Record<string,unknown>[]=[];
  const api=(async(path:string,init?:RequestInit)=>{
   if(init){writes.push(JSON.parse(init.body as string));throw new Error('offline');}
   return path==='/api/budget'?{settings:tracking.settings,cash:[]}:path.includes('/view?')?tracking:{};
  }) as LedgerApi;
  const view=await mount(api);
  try {
   const input=view.node.querySelector('[aria-label="Planned expense for Food"]') as HTMLInputElement;
   expect(input).toBeTruthy();
   await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,'900');input.dispatchEvent(new Event('input',{bubbles:true}));});
   await act(async()=>click(view.node,'Save Food plan'));
   expect(writes[0]).toMatchObject({month:'2026-10',direction:'expense',category:'Food',plannedMinor:90000,expectedRevision:4});
   expect(input.value).toBe('900');expect(view.node.querySelector('[role="alert"]')?.textContent).toContain('draft');
  }finally{view.close();}
 });
 it('preserves an edited forecast when conflict refresh returns a different server plan',async()=>{
  let changed=false;
  const api=(async(path:string,init?:RequestInit)=>{
   if(init){changed=true;throw new LedgerApiError(409,'Stale','budget_conflict');}
   if(path==='/api/budget')return {settings:{...tracking.settings,revision:changed?5:4},cash:[]};
   if(path.includes('/view?'))return changed?withFoodPlan(200000):tracking;
   return {};
  }) as LedgerApi;
  const view=await mount(api);
  try{
   const input=view.node.querySelector('[aria-label="Planned expense for Food"]') as HTMLInputElement;
   await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'900');input.dispatchEvent(new Event('input',{bubbles:true}));});
   await act(async()=>click(view.node,'Save Food plan'));
   expect(input.value).toBe('900');expect(view.node.textContent).toContain('$2,000.00');expect(view.node.querySelector('[role="alert"]')?.textContent).toContain('changed');
  }finally{view.close();}
 });

});
