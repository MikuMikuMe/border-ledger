import {describe,expect,it,vi} from 'vitest';
import {analyzeVisionReceipt} from '../worker/receipt-vision';

const input={endpoint:'https://api.openai.com/v1/chat/completions',provider:'openai' as const,model:'vision-model',credential:'vision-key',image:'LzlqLw==',contentType:'image/jpeg' as const};
describe('vision AI receipt analysis',()=>{
  it('rejects a nonofficial endpoint before sending the image or key',async()=>{
    const fetcher=vi.fn();
    await expect(analyzeVisionReceipt({...input,endpoint:'https://vision.vendor.com/v1/chat/completions'},fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends the selected image in OpenAI format and validates the result',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({choices:[{message:{content:'{"merchant":"Store","date":"2026-11-25","amount":"12.50","currency":null}'}}]}));
    expect(await analyzeVisionReceipt(input,fetcher)).toEqual({merchant:'Store',date:'2026-11-25',amount:'12.50',currency:null});
    const body=JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.model).toBe('vision-model');expect(body.max_completion_tokens).toBe(1024);expect(body).not.toHaveProperty('max_tokens');expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,LzlqLw==');
  });
  it('uses Anthropic image blocks and provider authentication',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({content:[{type:'text',text:'{"merchant":null,"date":null,"amount":null,"currency":null}'}]}));
    await analyzeVisionReceipt({...input,provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages'},fetcher);
    const [_,request]=fetcher.mock.calls[0];const body=JSON.parse(request!.body as string);
    expect(body.max_tokens).toBe(1024);expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body.messages[0].content[1].source).toEqual({type:'base64',media_type:'image/jpeg',data:'LzlqLw=='});
    expect(new Headers(request!.headers).get('x-api-key')).toBe('vision-key');
  });
  it('rejects invalid model outputs',async()=>{
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Store","date":"2026-02-30","amount":"-1.00","currency":"CAD"}'}}]}));
    await expect(analyzeVisionReceipt(input,fetcher)).rejects.toThrow();
  });
  it('only returns a category present in the supplied active categories',async()=>{
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"merchant":"Metro","date":null,"amount":"12.50","currency":null,"category":"Groceries"}'}}]}));
    expect(await analyzeVisionReceipt({...input,categories:['Groceries']},fetcher)).toMatchObject({category:'Groceries'});
    expect(await analyzeVisionReceipt({...input,categories:['Dining']},fetcher)).not.toHaveProperty('category');
  });
});
