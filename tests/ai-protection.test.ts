import {describe,expect,it,vi} from 'vitest';
import {sealAiCredential,openAiCredential} from '../worker/ai-crypto';
import {validateAiEndpoint,requestAiAnalysis} from '../worker/ai-provider';
const secret='ab'.repeat(32), binding={userId:'user-a',ledgerId:'ledger-a',provider:'openai' as const};
describe('BYOK protections',()=>{
  it('encrypts credentials and binds them to the user, ledger and provider',async()=>{
    const sealed=await sealAiCredential('example-secret',secret,binding);
    expect(JSON.stringify(sealed)).not.toContain('example-secret');
    expect(await openAiCredential(sealed,secret,binding)).toBe('example-secret');
    await expect(openAiCredential(sealed,secret,{...binding,ledgerId:'other'})).rejects.toThrow();
    await expect(sealAiCredential('example-secret','bad',binding)).rejects.toThrow();
  });
  it('rejects unsafe endpoint destinations',()=>{
    for(const url of ['http://example.com','https://localhost/v1','https://127.0.0.1','https://[::1]','https://foo.internal','https://user:pass@example.com','https://example.com:444','https://example.com/?token=secret']) expect(()=>validateAiEndpoint(url,'https://ledger.example')).toThrow();
    expect(()=>validateAiEndpoint('https://ledger.example/api','https://ledger.example')).toThrow();
    expect(validateAiEndpoint('https://api.example.com/v1/chat/completions','https://ledger.example','api.example.com')).toBe('https://api.example.com/v1/chat/completions');
    expect(validateAiEndpoint('https://123.api.example.com/v1','https://ledger.example','123.api.example.com')).toBe('https://123.api.example.com/v1');
    expect(()=>validateAiEndpoint('https://0x7f000001','https://ledger.example')).toThrow();
    for(const endpoint of ['https://x.169.254.169.254.nip.io/v1','https://x.10.0.0.1.nip.io/v1','https://unapproved.example.com/v1']) expect(()=>validateAiEndpoint(endpoint,'https://ledger.example')).toThrow();
    expect(()=>validateAiEndpoint('https://x.10.0.0.1.nip.io/v1','https://ledger.example','x.10.0.0.1.nip.io')).toThrow();
  });
  it('uses provider-specific formats without returning provider errors',async()=>{
    const fetcher=vi.fn(async (_input:RequestInfo|URL, init?:RequestInit)=>{
      expect(init?.redirect).toBe('manual');
      const headers=new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe('test-key');
      expect(headers.get('anthropic-version')).toBe('2023-06-01');
      expect(JSON.parse(String(init?.body)).max_tokens).toBe(2048);
      return Response.json({content:[{type:'text',text:'A useful observation'}]});
    });
    const result=await requestAiAnalysis({provider:'anthropic',endpoint:'https://api.example.com/v1/messages',model:'test',credential:'test-key',prompt:'summary',appOrigin:'https://ledger.example',allowedHosts:'api.example.com'},fetcher);
    expect(result).toBe('A useful observation');
    await expect(requestAiAnalysis({provider:'openai',endpoint:'https://api.example.com/v1/chat/completions',model:'test',credential:'test-key',prompt:'summary',appOrigin:'https://ledger.example',allowedHosts:'api.example.com'},async()=>new Response('secret provider error',{status:401}))).rejects.toThrow('Provider authentication failed');
  });
  it('sends OpenAI chat format and redacts a key echoed in the response',async()=>{
    const fetcher:typeof fetch=async(_input,init)=>{
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({model:'test',max_completion_tokens:2048,messages:[{role:'user',content:'summary'}]});
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('max_tokens');
      return Response.json({choices:[{message:{content:'Never repeat test-key'}}]});
    };
    const response=await requestAiAnalysis({provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key',prompt:'summary',appOrigin:'https://ledger.example',allowedHosts:'api.example.com'},fetcher);
    expect(response).toBe('Never repeat [redacted]');
  });
  it('rejects redirects, rate limits and malformed responses without returning provider content',async()=>{
    const input={provider:'openai' as const,endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key',prompt:'summary',appOrigin:'https://ledger.example',allowedHosts:'api.example.com'};
    await expect(requestAiAnalysis(input,async()=>new Response('sensitive',{status:401}))).rejects.toMatchObject({message:'Provider authentication failed',status:422});
    await expect(requestAiAnalysis(input,async()=>new Response('sensitive',{status:429}))).rejects.toThrow('Provider rate limit reached');
    await expect(requestAiAnalysis(input,async()=>new Response(null,{status:302,headers:{location:'https://other.example.com'}}))).rejects.toThrow('Provider is unavailable');
    await expect(requestAiAnalysis(input,async()=>new Response('sensitive'))).rejects.toThrow('invalid response');
  });
  it('marks responses cut short by the provider output limit',async()=>{
    const input={provider:'openai' as const,endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key',prompt:'summary',appOrigin:'https://ledger.example',allowedHosts:'api.example.com'};
    const result=await requestAiAnalysis(input,async()=>Response.json({choices:[{finish_reason:'length',message:{content:'Partial advice'}}]}));
    expect(result).toContain('Partial advice');expect(result).toContain('output limit');
  });
  it('redacts URL-encoded provider keys echoed in analysis output',async()=>{
    const input={provider:'openai' as const,endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'sk-secret',prompt:'summary',appOrigin:'https://ledger.example'};
    const result=await requestAiAnalysis(input,async()=>Response.json({choices:[{message:{content:'Key: sk%2Dsecret'}}]}));
    expect(result).not.toContain('sk%2Dsecret');
  });
});
