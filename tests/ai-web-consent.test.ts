// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {AnalysisPanel} from '../src/components/AnalysisPanel';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('discards a preview when the user changes the period while it is loading',async()=>{
  let finish!:(value:unknown)=>void;
  const api=vi.fn((path:string)=>path.endsWith('/preview')?new Promise(resolve=>{finish=resolve;}):Promise.resolve({configurations:[{provider:'openai',model:'test',endpoint:'https://api.openai.com/v1/chat/completions',revision:'r1'}],detailedTransactions:false}));
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  await act(async()=>{root.render(createElement(AnalysisPanel,{api:api as never,month:'2026-10'}));});
  const review=[...node.querySelectorAll('button')].find(button=>button.textContent==='Review request')!;
  act(()=>review.click());
  const mode=[...node.querySelectorAll('select')].find(select=>select.value==='budget')!;
  act(()=>{mode.value='ledger';mode.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{finish({provider:'openai',model:'test',endpoint:'https://api.openai.com/v1/chat/completions',configurationRevision:'r1',from:'2026-10-01',to:'2026-10-31',detail:false,mode:'budget',summary:{}});});
  expect(node.textContent).not.toContain('Send for analysis');
  act(()=>root.unmount());node.remove();
});
it('selects the official DeepSeek endpoint without permitting an editable destination',async()=>{
  const api=vi.fn(async()=>({configurations:[],detailedTransactions:false}));
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try {
    await act(async()=>{root.render(createElement(AnalysisPanel,{api:api as never,month:'2026-10'}));});
    const provider=node.querySelector('select')!;
    act(()=>{provider.value='deepseek';provider.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(node.textContent).toContain('https://api.deepseek.com/chat/completions');
    expect(node.querySelector('input[type="url"]')).toBeNull();
  } finally {act(()=>root.unmount());node.remove();}
});
