import {apiSecurityHeaders} from './security';
export function budgetJson(value:unknown,status=200) {return new Response(JSON.stringify(value),{status,headers:{...apiSecurityHeaders(),'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
