import {parseProviderResponse} from './ai-provider-response';
import type {AiProvider} from './ai-crypto';
export class AiProviderError extends Error {
  constructor(message:string,public readonly status:number) {super(message);this.name='AiProviderError';}
}
export interface AiRequest {provider:AiProvider;endpoint:string;model:string;credential:string;prompt:string;appOrigin:string;allowedHosts?:string}
export {validateAiEndpoint} from './ai-endpoint';
import {validateAiEndpoint} from './ai-endpoint';
function providerError(status:number):Error {
  if(status===401 || status===403) return new AiProviderError('Provider authentication failed',422);
  if(status===429) return new AiProviderError('Provider rate limit reached',429);
  return new AiProviderError('Provider is unavailable',503);
}
export async function requestAiAnalysis(input:AiRequest,fetcher:typeof fetch):Promise<string> {
  const endpoint=validateAiEndpoint(input.endpoint,input.appOrigin,input.allowedHosts);
  if(!/^[\w.\-:/]{1,160}$/.test(input.model) || input.prompt.length>200000) throw new RangeError('Invalid analysis request');
  const headers=new Headers({'content-type':'application/json'});
  if(input.provider==='anthropic') {headers.set('x-api-key',input.credential);headers.set('anthropic-version','2023-06-01');}
  else headers.set('authorization',`Bearer ${input.credential}`);
  const tokenLimit=input.provider==='anthropic'?{max_tokens:2048}:{max_completion_tokens:2048};
  const body=JSON.stringify({model:input.model,...tokenLimit,messages:[{role:'user',content:input.prompt}]});
  let response:Response;
  try {response=await fetcher(endpoint,{method:'POST',headers,body,redirect:'manual',signal:AbortSignal.timeout(30000)});} catch {throw new AiProviderError('Provider is unavailable',503);}
  if(!response.ok) throw providerError(response.status);
  return parseProviderResponse(response,input.provider,input.credential);
}
