import {describe,expect,it,vi} from 'vitest';
import {analyzeAzureReceipt} from '../worker/receipt-azure';

const endpoint='https://example-resource.cognitiveservices.azure.com';
const operation=`${endpoint}/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/123e4567-e89b-12d3-a456-426614174000?api-version=2024-11-30`;
const input={endpoint,credential:'test-key',image:new Uint8Array([255,216,255,217]),contentType:'image/jpeg' as const};
const immediate=async()=>{};

describe('Microsoft receipt analysis',()=>{
  it('extracts validated fields and requests deletion after success',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation}}))
      .mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[{fields:{MerchantName:{valueString:'STORE'},TransactionDate:{valueDate:'2026-11-25'},Total:{valueCurrency:{amount:12.50,currencySymbol:'$'}}}}]}}))
      .mockResolvedValueOnce(new Response(null,{status:204}));
    const result=await analyzeAzureReceipt(input,fetcher,immediate);
    expect(result).toEqual({suggestion:{merchant:'STORE',date:'2026-11-25',amount:'12.50',currency:null},deletionRequested:true});
    expect(fetcher.mock.calls.map(call=>call[1].method)).toEqual(['POST','GET','DELETE']);
    expect(fetcher.mock.calls.every(call=>call[1].redirect==='manual')).toBe(true);
  });
  it('refuses malicious operation locations and does not forward the credential to them',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':'https://attacker.example/result'}}));
    await expect(analyzeAzureReceipt(input,fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports that deletion was not requested successfully',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation}}))
      .mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[]}}))
      .mockRejectedValueOnce(new Error('offline'));
    expect((await analyzeAzureReceipt(input,fetcher,immediate)).deletionRequested).toBe(false);
  });
  it('does not accept non-Microsoft or private endpoints',async()=>{
    const fetcher=vi.fn();
    await expect(analyzeAzureReceipt({...input,endpoint:'https://localhost'},fetcher)).rejects.toThrow();
    await expect(analyzeAzureReceipt({...input,endpoint:'https://cognitiveservices.azure.com.attacker.example'},fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('leaves ambiguous currency and invalid financial fields empty',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation}}))
      .mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[{fields:{TransactionDate:{valueDate:'2026-02-30'},Total:{content:'CAD or USD',valueCurrency:{amount:-12.50}}}}]}}))
      .mockResolvedValueOnce(new Response(null,{status:204}));
    const {suggestion}=await analyzeAzureReceipt(input,fetcher,immediate);
    expect(suggestion).toMatchObject({date:null,amount:null,currency:null});
  });
  it('accepts a numeric total when the receipt model returns a number field',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation}}))
      .mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[{fields:{Total:{valueNumber:12.50}}}]}})).mockResolvedValueOnce(new Response(null,{status:204}));
    expect((await analyzeAzureReceipt(input,fetcher,immediate)).suggestion.amount).toBe('12.50');
  });
  it('returns an explicit Microsoft currency code for comparison with local OCR',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation}}))
      .mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[{fields:{Total:{content:'$12.50',valueCurrency:{amount:12.50,currencyCode:'CAD'}}}}]}})).mockResolvedValueOnce(new Response(null,{status:204}));
    expect((await analyzeAzureReceipt(input,fetcher,immediate)).suggestion.currency).toBe('CAD');
  });
  it('respects the provider retry interval between polling attempts',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:202,headers:{'operation-location':operation,'retry-after':'3'}}))
      .mockResolvedValueOnce(Response.json({status:'running'})).mockResolvedValueOnce(Response.json({status:'succeeded',analyzeResult:{documents:[]}})).mockResolvedValueOnce(new Response(null,{status:204}));
    const wait=vi.fn(async(_ms:number)=>{});
    await analyzeAzureReceipt(input,fetcher,wait);
    expect(wait.mock.calls[0][0]).toBe(3000);expect(wait.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
  });
});
