import {describe,expect,it} from 'vitest';
import {decodeBudgetView} from '../mobile/src/features/budget/decodeBudget';
const valid={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:1000,unassignedMinor:1000,categories:[]},balances:[],activity:[],currentMonth:'2026-10',asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'};
describe('Android budget response validation',()=>{
 it('accepts a valid view',()=>{expect(decodeBudgetView(JSON.stringify(valid)).settings.currency).toBe('CAD');});
 it('rejects invalid money, categories and balances instead of rendering them',()=>{
  expect(()=>decodeBudgetView(JSON.stringify({...valid,summary:{...valid.summary,cashMinor:1.2}}))).toThrow();
  expect(()=>decodeBudgetView(JSON.stringify({...valid,summary:{...valid.summary,categories:[{category:'Food'}]}}))).toThrow();
  expect(()=>decodeBudgetView(JSON.stringify({...valid,balances:[{id:'x',source:'manual'}]}))).toThrow();
 });
});
