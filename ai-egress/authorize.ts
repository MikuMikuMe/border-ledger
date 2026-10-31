import {validateAiEndpoint} from '../worker/ai-endpoint';
import {verifyGatewayBody} from '../worker/ai-egress-auth';
import {readRequestText} from '../worker/security';
export async function authorizeGatewayRequest(request:Request,secret:string,origin:string,allowedHosts:string):Promise<Request|null> {
  if(request.method!=='POST' || new URL(request.url).pathname!=='/provider') return null;
  const timestamp=request.headers.get('x-gateway-time') ?? '';
  const signature=request.headers.get('x-gateway-signature') ?? '';
  try {
    const body=await readRequestText(request,280000);
    if(!await verifyGatewayBody(secret,{timestamp,body,signature},Date.now())) return null;
    const envelope=JSON.parse(body) as {endpoint?:unknown};
    if(typeof envelope.endpoint!=='string') return null;
    validateAiEndpoint(envelope.endpoint,origin,allowedHosts);
    return new Request('http://container/provider',{method:'POST',headers:{'content-type':'application/json'},body});
  } catch {return null;}
}
