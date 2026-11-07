// @vitest-environment jsdom
import { IdentityResponse as Response, privateFetchSpy } from './helpers/web-session';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML=''; });

it('labels different months separately and allows changing a failed custom report', async () => {
  const report = {ledgerId:'personal',from:'2026-01-01',to:'2026-02-28',includeProvisional:false,currencyTotals:[{currency:'CAD',confirmedMinorUnits:200,provisionalMinorUnits:0,confirmedCount:2,provisionalCount:0}],dailyTotals:[{date:'2026-01-05',currency:'CAD',confirmedMinorUnits:100,provisionalMinorUnits:0},{date:'2026-02-05',currency:'CAD',confirmedMinorUnits:100,provisionalMinorUnits:0}],reviewCount:0,excludedCount:0,sourceCoverage:{statement:2}};
  let fail=false;
  privateFetchSpy().mockImplementation(async input => {
    const url=String(input);
    if(url.includes('/api/accounts')) return new Response(JSON.stringify({accounts:[]}),{status:200});
    if(url.includes('/api/reports/summary')) return new Response(JSON.stringify(fail?{message:'unavailable'}:report),{status:fail?500:200});
    return new Response(JSON.stringify({transactions:[{id:'t',account_id:'a',date:'2026-01-05',merchant:'Test',amount_minor:-100,currency:'CAD',category:'Other',kind:'expense',status:'confirmed',source:'statement',fingerprint:'t'}]}),{status:200});
  });
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>{root.render(createElement(App));await new Promise(resolve=>setTimeout(resolve,0));});
  await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Custom')!.click();});
  const inputs=host.querySelectorAll<HTMLInputElement>('input[type=date]');
  const change=(input:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
  await act(async()=>{change(inputs[0],'2026-01-01');change(inputs[1],'2026-02-28');});
  await act(async()=>{host.querySelector('form.custom-window-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.querySelector('.chart-data-table')?.textContent).toContain('2026-01-05');
  expect(host.querySelector('.chart-data-table')?.textContent).toContain('2026-02-05');
  await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Custom')!.click();});
  const next=host.querySelectorAll<HTMLInputElement>('input[type=date]');
  await act(async()=>{change(next[0],'2026-01-02');}); fail=true;
  await act(async()=>{host.querySelector('form.custom-window-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));});
  expect(host.querySelector('[aria-label="Reporting window"]')).not.toBeNull();
  act(()=>root.unmount());
});
