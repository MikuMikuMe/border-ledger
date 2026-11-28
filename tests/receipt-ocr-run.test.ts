import {expect,it,vi} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {readOcrConfiguration,saveOcrConfiguration} from '../worker/receipt-ocr-settings';
import {runReceiptOcr} from '../worker/receipt-ocr-run';

const context={userId:'owner',ledgerId:'personal'},secret='ab'.repeat(32),origin='https://ledger.example';
it('uses the shared Microsoft resource without saving its key in user settings',async()=>{
 const {handleAiApi}=await import('../worker/ai-http');const f=createSqliteD1Fixture();try {
  const azureEndpoint='https://receipts.cognitiveservices.azure.com',azureKey='shared-microsoft-key';
  const route={db:f.db,context,root:'/api/analysis',env:{secret,origin,azureEndpoint,azureKey}};
  const saved=await handleAiApi(new Request(`${origin}/api/analysis/ocr/configuration`,{method:'PUT',body:JSON.stringify({provider:'azure',endpoint:'',model:'',credential:''})}),route);
  expect(saved?.status).toBe(200);
  const config=await readOcrConfiguration(f.db,context);expect(config).toMatchObject({provider:'azure',endpoint:azureEndpoint});
  const stored=await f.db.prepare('SELECT ciphertext,iv FROM receipt_ocr_settings').first();expect(JSON.stringify(stored)).not.toContain(azureKey);
  const location=`${azureEndpoint}/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/123e4567-e89b-12d3-a456-426614174000?api-version=2024-11-30`;
  const fetcher=vi.fn().mockImplementationOnce(async(_url,init)=>{expect(new Headers(init.headers).get('Ocp-Apim-Subscription-Key')).toBe(azureKey);return new Response(null,{status:202,headers:{'operation-location':location}});}).mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[]}})).mockResolvedValueOnce(new Response(null,{status:204}));
  await runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE',confirmed:true},{...route.env,fetcher});
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE',confirmed:true},{...route.env,azureEndpoint:'https://other.cognitiveservices.azure.com',fetcher})).rejects.toThrow('settings changed');
  expect(fetcher).toHaveBeenCalledTimes(3);
 }finally{f.close();}
});
it('does not accept a user-supplied Microsoft endpoint or key',async()=>{
 const {handleAiApi}=await import('../worker/ai-http');const f=createSqliteD1Fixture();try {
  const route={db:f.db,context,root:'/api/analysis',env:{secret,origin,azureEndpoint:'https://receipts.cognitiveservices.azure.com',azureKey:'admin-key'}};
  const request=new Request(`${origin}/api/analysis/ocr/configuration`,{method:'PUT',body:JSON.stringify({provider:'azure',endpoint:'https://other.cognitiveservices.azure.com',model:'',credential:'user-key'})});
  expect((await handleAiApi(request,route))?.status).toBe(400);expect(await readOcrConfiguration(f.db,context)).toBeNull();
 }finally{f.close();}
});
it('requires consent and current OCR settings before submitting a receipt image',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveOcrConfiguration(f.db,context,{provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:'',credential:'receipt-key'},secret);
  const config=await readOcrConfiguration(f.db,context);const fetcher=vi.fn();
  const input={configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE\nTOTAL 12.50',confirmed:false};
  await expect(runReceiptOcr(f.db,context,input,{secret,origin,fetcher})).rejects.toThrow();
  await expect(runReceiptOcr(f.db,context,{...input,confirmed:true,configurationRevision:'stale'},{secret,origin,fetcher})).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 }finally{f.close();}
});
it('does not send an image using an older custom endpoint',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'receipt-key'},secret);
  await f.db.prepare("UPDATE receipt_ocr_settings SET endpoint='https://vision.vendor.com/v1' WHERE ledger_id='personal'").run();
  const config=await readOcrConfiguration(f.db,context);
  const input={configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE',confirmed:true};
  const fetcher=vi.fn();await expect(runReceiptOcr(f.db,context,input,{secret,origin,fetcher})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 }finally{f.close();}
});
it('sends AI image inference directly to the official provider',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'receipt-key'},secret);
  const config=await readOcrConfiguration(f.db,context);
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(url).toBe('https://api.openai.com/v1/chat/completions');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer receipt-key');expect(init?.redirect).toBe('manual');return Response.json({choices:[{message:{content:'{"merchant":"Store","date":null,"amount":"12.50","currency":"CAD"}'}}]});});
  const result=await runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE TOTAL $12.50',confirmed:true},{secret,origin,fetcher});
  expect(result).toEqual({suggestion:{merchant:'Store',date:null,amount:'12.50',currency:null},amountConflict:false,deletionRequested:null});
  expect(fetcher).toHaveBeenCalledOnce();
 }finally{f.close();}
});
it('suggests an active category from AI image analysis without creating a transaction',async()=>{
 const f=createSqliteD1Fixture();try {
  await f.db.prepare("INSERT INTO categories(ledger_id,name,name_key,archived) VALUES('personal','Groceries','groceries',0),('personal','Old','old',1)").run();
  await saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'receipt-key'},secret);
  const config=await readOcrConfiguration(f.db,context);
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const prompt=JSON.parse(String(init?.body)).messages[0].content[0].text;expect(prompt).toContain('Groceries');expect(prompt).not.toContain('"Old"');return Response.json({choices:[{message:{content:'{"merchant":"Metro","date":null,"amount":"12.50","currency":null,"category":"Groceries"}'}}]});});
  const result=await runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'METRO\nTOTAL 12.50',confirmed:true},{secret,origin,fetcher});
  expect(result.suggestion.category).toBe('Groceries');
  expect((await f.db.prepare('SELECT COUNT(*) AS n FROM transactions').first<{n:number}>())?.n).toBe(0);
 }finally{f.close();}
});
it('exposes separate receipt OCR settings without returning the key',async()=>{
 const {handleAiApi}=await import('../worker/ai-http');
 const f=createSqliteD1Fixture();try {
  const route={db:f.db,context,root:'/api/analysis',env:{secret,origin,azureEndpoint:'https://receipts.cognitiveservices.azure.com',azureKey:'receipt-key'}};
  const body={provider:'azure',endpoint:'',model:'',credential:''};
  const saved=await handleAiApi(new Request(`${origin}/api/analysis/ocr/configuration`,{method:'PUT',body:JSON.stringify(body)}),route);
  expect(saved?.status).toBe(200);
  const read=await handleAiApi(new Request(`${origin}/api/analysis/ocr/configuration`),route);
  const result=await read!.json();expect(result).toMatchObject({provider:'azure'});expect(JSON.stringify(result)).not.toContain('receipt-key');
 }finally{f.close();}
});
it('returns a reviewed Microsoft suggestion without guessing dollar currency',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveOcrConfiguration(f.db,context,{provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:'',credential:'receipt-key'},secret);
  const config=await readOcrConfiguration(f.db,context);
  const location='https://receipts.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/123e4567-e89b-12d3-a456-426614174000?api-version=2024-11-30';
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':location}})).mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[{fields:{MerchantName:{valueString:'Store'},Total:{content:'USD 12.50',valueCurrency:{amount:12.50}}}}]}})).mockResolvedValueOnce(new Response(null,{status:204}));
  const result=await runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE\nTOTAL $12.50',confirmed:true},{secret,origin,fetcher});
  expect(result).toEqual({suggestion:{merchant:'Store',date:null,amount:'12.50',currency:null},amountConflict:false,deletionRequested:true});
  expect(fetcher).toHaveBeenCalledTimes(3);
 }finally{f.close();}
});
it('leaves the amount unresolved when local and remote OCR disagree',async()=>{
 const f=createSqliteD1Fixture();try {
  await saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'receipt-key'},secret);
  const config=await readOcrConfiguration(f.db,context);
  const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Store","date":null,"amount":"125.00","currency":null}'}}]}));
  const result=await runReceiptOcr(f.db,context,{configurationRevision:config!.revision,image:'/9j/2Q==',contentType:'image/jpeg',text:'STORE\nTOTAL 12.50',confirmed:true},{secret,origin,fetcher});
  expect(result.suggestion.amount).toBeNull();expect(result.amountConflict).toBe(true);
 }finally{f.close();}
});
