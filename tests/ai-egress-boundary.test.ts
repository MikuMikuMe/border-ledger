import {describe,expect,it,vi} from 'vitest';
import {createAiEgressFetcher} from '../worker/ai-egress';
import {authorizeGatewayRequest} from '../ai-egress/authorize';
const secret='ab'.repeat(32);
describe('private gateway boundary',()=>{
  it('accepts a signed service request and forwards the exact provider envelope',async()=>{
    const fetch=vi.fn(async(request:Request)=>{
      const authorized=await authorizeGatewayRequest(request,secret,'https://ledger.example','');
      expect(authorized).not.toBeNull();
      const envelope=await authorized!.json() as {endpoint:string;body:string};
      expect(envelope).toMatchObject({endpoint:'https://api.openai.com/v1',body:'synthetic'});
      return new Response('ok');
    });
    await createAiEgressFetcher({fetch},secret)('https://api.openai.com/v1',{method:'POST',body:'synthetic'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a signed request to an unapproved public host',async()=>{
    const fetch=vi.fn(async(request:Request)=>{
      expect(await authorizeGatewayRequest(request,secret,'https://ledger.example','')).toBeNull();
      return new Response('Unavailable',{status:503});
    });
    expect((await createAiEgressFetcher({fetch},secret)('https://unknown.example.com/v1',{method:'POST',body:'{}'})).status).toBe(503);
  });
  it('rejects an unsigned request and a mismatched shared secret',async()=>{
    const request=new Request('https://ai-egress.internal/provider',{method:'POST',body:'{}'});
    expect(await authorizeGatewayRequest(request,secret,'https://ledger.example','')).toBeNull();
    const fetch=vi.fn(async(request:Request)=>{
      expect(await authorizeGatewayRequest(request,'cd'.repeat(32),'https://ledger.example','')).toBeNull();
      return new Response('Unavailable',{status:403});
    });
    expect((await createAiEgressFetcher({fetch},secret)('https://api.openai.com/v1',{method:'POST',body:'{}'})).status).toBe(403);
  });
});
