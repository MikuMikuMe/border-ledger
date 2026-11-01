import {describe,expect,it} from 'vitest';
import {describeFxRate} from '../worker/budget-fx';
describe('displaying exchange rates',()=>{
 it('derives a visible cross-rate from the stored EUR quotes',()=>{
  expect(describeFxRate('CNY','CAD',{effectiveDate:'2026-10-06',rates:{CNY:'10',CAD:'2'}})).toBe('0.2');
  expect(describeFxRate('EUR','CAD',{effectiveDate:'2026-10-06',rates:{CAD:'2'}})).toBe('2');
  expect(describeFxRate('CNY','EUR',{effectiveDate:'2026-10-06',rates:{CNY:'10'}})).toBe('0.1');
  expect(describeFxRate('USD','CAD',{effectiveDate:'2026-10-06',rates:{CAD:'2'}})).toBeNull();
 });
});
