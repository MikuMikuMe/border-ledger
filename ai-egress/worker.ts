import {Container} from '@cloudflare/containers';
import {authorizeGatewayRequest} from './authorize';

export class AiEgressContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
}
interface Env {AI_EGRESS_AUTH_KEY?:string;LEDGER_APP_ORIGIN?:string;AI_ALLOWED_ENDPOINT_HOSTS?:string;AI_CONTAINER:{getByName(name:string):{fetch(request:Request):Promise<Response>}}}
export default {
  async fetch(request:Request, env:Env):Promise<Response> {
    const authorized=await authorizeGatewayRequest(request,env.AI_EGRESS_AUTH_KEY ?? '',env.LEDGER_APP_ORIGIN ?? '',env.AI_ALLOWED_ENDPOINT_HOSTS ?? '');
    if(!authorized) return new Response('Unavailable',{status:503});
    return env.AI_CONTAINER.getByName('provider-requests').fetch(authorized);
  },
};
