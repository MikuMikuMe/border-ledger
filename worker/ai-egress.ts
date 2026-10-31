import {signGatewayBody} from './ai-egress-auth';
export interface AiEgressBinding {fetch(request:Request):Promise<Response>}
export function createAiEgressFetcher(binding:AiEgressBinding|undefined,secret=''):typeof fetch {
  return async (input,init) => {
    if (!binding) throw new Error('Provider service is unavailable');
    if (typeof input !== 'string' || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('Invalid provider request');
    const headers=Object.fromEntries(new Headers(init.headers).entries());
    const body=JSON.stringify({endpoint:input,headers,body:init.body});
    const timestamp=String(Date.now());
    const signature=await signGatewayBody(secret,timestamp,body);
    const request=new Request('https://ai-egress.internal/provider',{
      method:'POST', headers:{'content-type':'application/json','x-gateway-time':timestamp,'x-gateway-signature':signature},
      body, signal:init.signal,
    });
    return binding.fetch(request);
  };
}
