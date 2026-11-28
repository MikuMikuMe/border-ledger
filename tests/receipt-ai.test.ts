import {describe,expect,it,vi} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {saveAiConfiguration,listAiConfigurations} from '../worker/ai-store';
import {runReceiptAnalysis} from '../worker/receipt-ai';
const context={userId:'owner',ledgerId:'personal'},secret='ab'.repeat(32),origin='https://ledger.example';
async function categoryFixture() {
  const f=createSqliteD1Fixture();
  await f.db.prepare("INSERT INTO categories(ledger_id,name,name_key,archived) VALUES('personal','Groceries','groceries',0),('personal','Old','old',1)").run();
  await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
  const [config]=await listAiConfigurations(f.db,context);
  return {f,config};
}
it('asks AI to choose from active ledger categories and accepts only an existing choice',async()=>{
  const {f,config}=await categoryFixture();try {
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const prompt=JSON.parse(String(init?.body)).messages[0].content;expect(prompt).toContain('Groceries');expect(prompt).not.toContain('Old');return Response.json({choices:[{message:{content:'{"merchant":"Metro","date":null,"amount":"12.50","currency":null,"category":"Groceries"}'}}]});});
    const result=await runReceiptAnalysis(f.db,context,{provider:'openai',configurationRevision:config.revision,text:'METRO\nTOTAL 12.50',confirmed:true},{secret,origin,fetcher});
    expect(result.suggestion).toMatchObject({category:'Groceries'});
  }finally{f.close();}
});
it('discards an AI category archived while the request is running',async()=>{
  const {f,config}=await categoryFixture();try {
    const fetcher=vi.fn(async()=>{await f.db.prepare("UPDATE categories SET archived=1 WHERE ledger_id='personal' AND name='Groceries'").run();return Response.json({choices:[{message:{content:'{"merchant":"Metro","date":null,"amount":"12.50","currency":null,"category":"Groceries"}'}}]});});
    const result=await runReceiptAnalysis(f.db,context,{provider:'openai',configurationRevision:config.revision,text:'METRO\nTOTAL 12.50',confirmed:true},{secret,origin,fetcher});
    expect(result.suggestion).not.toHaveProperty('category');
  }finally{f.close();}
});

it('flags an AI total that disagrees with the recognized receipt total',async()=>{
  const f=createSqliteD1Fixture();try {
    await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
    const [config]=await listAiConfigurations(f.db,context);
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Shop","date":null,"amount":"125.00","currency":null}'}}]}));
    const result=await runReceiptAnalysis(f.db,context,{provider:'openai',configurationRevision:config.revision,text:'SHOP\nTOTAL 12.50',confirmed:true},{secret,origin,fetcher});
    expect(result).toMatchObject({suggestion:{amount:null},amountConflict:true});
  }finally{f.close();}
});
describe('receipt AI consent',()=>{
  it('requires confirmation and the current provider revision before sending',async()=>{
    const f=createSqliteD1Fixture();try {
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
      const [config]=await listAiConfigurations(f.db,context);
      const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Shop","date":"2026-11-22","amount":"13.56","currency":null}'}}]}));
      const input={provider:'openai' as const,configurationRevision:config.revision,text:'Shop TOTAL 13.56',confirmed:false};
      await expect(runReceiptAnalysis(f.db,context,input,{secret,origin,fetcher})).rejects.toThrow();
      await expect(runReceiptAnalysis(f.db,context,{...input,confirmed:true,configurationRevision:'stale'},{secret,origin,fetcher})).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(await runReceiptAnalysis(f.db,context,{...input,confirmed:true},{secret,origin,fetcher})).toMatchObject({suggestion:{merchant:'Shop',amount:'13.56'},amountConflict:false});
    }finally{f.close();}
  });
});

it('rejects invalid receipt analysis and overly long input',async()=>{
  const f=createSqliteD1Fixture();try {
    await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
    const [config]=await listAiConfigurations(f.db,context);
    const input={provider:'openai' as const,configurationRevision:config.revision,text:'receipt',confirmed:true};
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Shop","date":"2026-02-30","amount":"5.00","currency":"CAD"}'}}]}));
    await expect(runReceiptAnalysis(f.db,context,input,{secret,origin,fetcher})).rejects.toThrow();
    await expect(runReceiptAnalysis(f.db,context,{...input,text:'x'.repeat(12001)},{secret,origin,fetcher})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{f.close();}
});

it('routes receipt analysis with confirmation and returns only validated fields',async()=>{
 const {handleAiApi}=await import('../worker/ai-http');
 const f=createSqliteD1Fixture();try {
  await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
  const [config]=await listAiConfigurations(f.db,context);const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Shop","date":"2026-11-20","amount":"12.50","currency":null,"extra":"ignored"}'}}]}));
  const body={provider:'openai',configurationRevision:config.revision,text:'SHOP TOTAL 12.50',confirmed:true};
  const request=new Request('https://ledger.example/api/analysis/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const response=await handleAiApi(request,{db:f.db,context,root:'/api/analysis',env:{secret,origin,fetcher}});
  expect(response?.status).toBe(200);expect(await response?.json()).toEqual({suggestion:{merchant:'Shop',date:'2026-11-20',amount:'12.50',currency:null},amountConflict:false});expect(fetcher).toHaveBeenCalledOnce();
 }finally{f.close();}
});

it('does not accept a positive AI amount for a negative total',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
  const [config]=await listAiConfigurations(f.db,context);
  const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Shop","date":null,"amount":"12.50","currency":null}'}}]}));
  const result=await runReceiptAnalysis(f.db,context,{provider:'openai',configurationRevision:config.revision,text:'SHOP\nTOTAL -12.50',confirmed:true},{secret,origin,fetcher});
  expect(result.suggestion.amount).toBeNull();
 }finally{f.close();}
});
