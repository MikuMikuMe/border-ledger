import {describe,it,expect,vi} from 'vitest';
import {requestAiAnalysis} from '../worker/ai-provider';

describe('official AI providers',()=>{
  it('allows DeepSeek and uses its compatible output limit',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({choices:[{message:{content:'ok'}}]}));
    const result=await requestAiAnalysis({provider:'deepseek',endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-chat',credential:'secret',prompt:'test',appOrigin:'https://pf.lofuyu.com'},fetcher as typeof fetch);
    expect(result).toBe('ok');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).max_tokens).toBe(2048);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('rejects custom destinations, wrong provider hosts, and unapproved paths before sending',async()=>{
    const fetcher=vi.fn();
    for(const endpoint of ['https://custom.example.org/v1/chat/completions','https://api.anthropic.com/v1/messages','https://api.openai.com/v1/files']) {
      await expect(requestAiAnalysis({provider:'openai',endpoint,model:'test',credential:'secret',prompt:'test',appOrigin:'https://pf.lofuyu.com',allowedHosts:'custom.example.org'},fetcher as typeof fetch)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
