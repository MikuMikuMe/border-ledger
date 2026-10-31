import type {AiEgressBinding} from './ai-egress';
import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {apiSecurityHeaders} from './security';
interface Environment {secret:string;origin:string;allowedHosts?:string;fetcher?:typeof fetch;egress?:AiEgressBinding;egressSecret?:string}
export interface Route {db:D1Database;context:FinancialContext;root:string;env:Environment}
export function json(value:unknown,status=200) {return new Response(JSON.stringify(value),{status,headers:{...apiSecurityHeaders(),'content-type':'application/json; charset=utf-8'}});}
