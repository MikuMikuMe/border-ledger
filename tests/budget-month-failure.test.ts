// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import {useBudget} from '../src/components/useBudget';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('budget month loading',()=>{
  it('clears the previous month when the selected month fails to load',async()=>{
    const api=vi.fn(async(path:string)=>{
      if(path==='/api/budget') return {settings:{currency:'CAD'},cash:[]};
      if(path.includes('2026-11')) throw new Error('offline');
      return {settings:{currency:'CAD'},summary:{month:'2026-10'}};
    });
    let state:ReturnType<typeof useBudget>;
    function Harness(){state=useBudget(api as never,'2026-10');return null;}
    const node=document.createElement('div');const root=createRoot(node);
    try {
      await act(async()=>{root.render(createElement(Harness));});
      expect(state!.data?.summary.month).toBe('2026-10');
      await act(async()=>{state!.setMonth('2026-11');});
      expect(state!.error).toContain('Could not load');
      expect(state!.data).toBeNull();
      expect(state!.snapshot).toBeNull();
    }finally{act(()=>root.unmount());}
  });
});
