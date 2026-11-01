// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import {useBudget} from '../src/components/useBudget';
import {LedgerApiError} from '../src/domain/api';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

describe('budget mode and revision handling',()=>{
 it('loads the saved tracking preference explicitly and saves mode with the current revision',async()=>{
  let preferredMode='tracking',revision=7;
  const writes:unknown[]=[];
  const api=vi.fn(async(path:string,init?:RequestInit)=>{
   if(init){const body=JSON.parse(init.body as string);writes.push(body);preferredMode=body.mode;revision++;return {ok:true,revision};}
   if(path==='/api/budget')return {settings:{currency:'CAD',preferredMode,revision},cash:[]};
   return {mode:preferredMode,settings:{currency:'CAD'},summary:{month:'2026-10'}};
  });
  let state:ReturnType<typeof useBudget>;
  function Harness(){state=useBudget(api as never,'2026-10');return null;}
  const root=createRoot(document.createElement('div'));
  try {
   await act(async()=>root.render(createElement(Harness)));
   expect(api).toHaveBeenCalledWith('/api/budget/view?month=2026-10&mode=tracking');
   await act(async()=>{await state!.changeMode('envelope');});
   expect(writes[0]).toMatchObject({mode:'envelope',expectedRevision:7,operationId:expect.any(String)});
   expect(state!.mode).toBe('envelope');
  }finally{act(()=>root.unmount());}
 });
 it('refreshes conflicts and keeps a useful conflict message',async()=>{
  let revision=2;
  const api=vi.fn(async(path:string,init?:RequestInit)=>{
   if(init){revision=3;throw new LedgerApiError(409,'Stale','budget_conflict');}
   if(path==='/api/budget')return {settings:{currency:'CAD',preferredMode:'envelope',revision},cash:[]};
   return {settings:{currency:'CAD'},summary:{month:'2026-10'}};
  });
  let state:ReturnType<typeof useBudget>;
  function Harness(){state=useBudget(api as never,'2026-10');return null;}
  const root=createRoot(document.createElement('div'));
  try {
   await act(async()=>root.render(createElement(Harness)));
   await act(async()=>{await state!.save('tracking-plans',{month:'2026-10',direction:'expense',category:'Food',plannedMinor:100,expectedRevision:2,operationId:'save-1'}).catch(()=>undefined);});
   expect(state!.snapshot?.settings?.revision).toBe(3);
   expect(state!.error).toContain('changed');
  }finally{act(()=>root.unmount());}
 });
 it('reuses an operation ID for an exact retry after a lost response',async()=>{
  const writes:Record<string,unknown>[]=[];
  const api=vi.fn(async(path:string,init?:RequestInit)=>{
   if(init){const body=JSON.parse(init.body as string);writes.push(body);if(writes.length===1)throw new Error('offline');return {ok:true,revision:5};}
   return path==='/api/budget'?{settings:{currency:'CAD',preferredMode:'envelope',revision:4},cash:[]}:{settings:{currency:'CAD'},summary:{month:'2026-10'}};
  });
  let state:ReturnType<typeof useBudget>;
  function Harness(){state=useBudget(api as never,'2026-10');return null;}
  const root=createRoot(document.createElement('div'));
  try{
   await act(async()=>root.render(createElement(Harness)));
   await act(async()=>{await state!.guardedSave('tracking-plans',{month:'2026-10',direction:'expense',category:'Food',plannedMinor:0}).catch(()=>undefined);});
   await act(async()=>{await state!.guardedSave('tracking-plans',{month:'2026-10',direction:'expense',category:'Food',plannedMinor:0});});
   expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);
  }finally{act(()=>root.unmount());}
 });

 it('guards writes with the displayed view revision when FX loading advanced the snapshot revision',async()=>{
  const writes:Record<string,unknown>[]=[];
  const api=vi.fn(async(path:string,init?:RequestInit)=>{
   if(init){writes.push(JSON.parse(init.body as string));return {ok:true,revision:6};}
   return path==='/api/budget'?{settings:{currency:'CAD',preferredMode:'tracking',revision:4},cash:[]}:{mode:'tracking',settings:{currency:'CAD',preferredMode:'tracking',revision:5},summary:{month:'2026-10'}};
  });
  let state:ReturnType<typeof useBudget>;
  function Harness(){state=useBudget(api as never,'2026-10');return null;}
  const root=createRoot(document.createElement('div'));
  try{
   await act(async()=>root.render(createElement(Harness)));
   await act(async()=>{await state!.guardedSave('tracking-plans',{month:'2026-10',direction:'income',category:'Salary',plannedMinor:100});});
   expect(writes[0]).toMatchObject({expectedRevision:5});
  }finally{act(()=>root.unmount());}
 });

});
