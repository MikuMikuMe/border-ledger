import {describe,expect,it,vi} from 'vitest';
import {createAiEgressFetcher} from '../worker/ai-egress';

describe('AI egress service binding',()=>{
  it('sends the provider request only to the internal service',async()=>{
    const fetch=vi.fn(async(request:Request)=>{
      expect(new URL(request.url).hostname).toBe('ai-egress.internal');
      expect(request.headers.get('x-gateway-signature')).toMatch(/^[0-9a-f]{64}$/);
      const envelope=await request.json() as {endpoint:string;headers:Record<string,string>;body:string};
      expect(envelope).toEqual({endpoint:'https://custom.provider.com/v1',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:'{}'});
      return new Response('provider response',{status:200});
    });
    const fetcher=createAiEgressFetcher({fetch},'ab'.repeat(32));
    const response=await fetcher('https://custom.provider.com/v1',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:'{}'});
    expect(await response.text()).toBe('provider response');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fails closed for custom endpoints without the binding',async()=>{
    const fetcher=createAiEgressFetcher(undefined);
    await expect(fetcher('https://custom.provider.com/v1',{method:'POST',body:'{}'})).rejects.toThrow();
  });
});
