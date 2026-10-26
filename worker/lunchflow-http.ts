import type { FinancialContext } from './financial-authority';
import type { LedgerContext } from './tenant-context';
import { LunchFlowError } from './lunchflow';
import { createLunchFlowConnections } from './lunchflow-connections';
import { createLunchFlowOAuth, type LunchFlowBrowserSession } from './lunchflow-oauth';
import { createLunchFlowService, type LunchFlowServiceEnv } from './lunchflow-service';
import { parseLunchFlowMobileSelectionAccounts } from './lunchflow-routing';
import { apiSecurityHeaders, readJsonBody } from './security';
const COOKIE='__Host-lunchflow';
function json(value:unknown,status=200,headers:Record<string,string>={}) {
 return Response.json(value,{status,headers:{...apiSecurityHeaders(),'cache-control':'no-store','referrer-policy':'no-referrer',...headers}});
}
function flowCookie(value:string) {return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${value?'600':'0'}`;}
function cookieValue(request:Request) {
 const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(COOKIE+'='));
 return values.length===1?values[0].slice(COOKIE.length+1):'';
}
function invalid(message='The Lunch Flow request is invalid.'):never {throw new LunchFlowError('invalid_request',message,400);}
function connectionId(value:unknown) {
 if(value===undefined||value===null)return undefined;
 if(typeof value!=='string')return invalid();
 if(!value.length)return invalid();
 if(value.length>256)return invalid();
 return value;
}
function expectedGeneration(value:unknown) {
 if(typeof value!=='number')return invalid('A positive expectedGeneration is required. Refresh connection status.');
 if(!Number.isSafeInteger(value)||value<1)return invalid('A positive expectedGeneration is required. Refresh connection status.');
 return value;
}
function browserRequired(browser?:LunchFlowBrowserSession) {
 if(!browser)throw new LunchFlowError('browser_session_required','A current verified browser session is required.',401);
 return browser;
}
function idempotencyKey(request:Request,native:boolean) {
 const value=request.headers.get('idempotency-key')?.trim();
 if(value&&value.length>256)invalid();
 if(native&&!value)invalid('An idempotency key is required.');
 return value||undefined;
}
async function body(request:Request) {
 if(!request.body)return {} as Record<string,unknown>;
 const value=await readJsonBody<unknown>(request,32*1024);
 if(!value)return invalid();
 if(typeof value!=='object')return invalid();
 if(Array.isArray(value))return invalid();
 return value as Record<string,unknown>;
}
function redirect(location:string,cookie='') {
 return new Response(null,{status:303,headers:{...apiSecurityHeaders(),'cache-control':'no-store','referrer-policy':'no-referrer',location,'set-cookie':flowCookie(cookie)}});
}
async function callback(request:Request,env:LunchFlowServiceEnv,context:LedgerContext,browser?:LunchFlowBrowserSession) {
 const url=new URL(request.url),origin=new URL(env.LEDGER_APP_ORIGIN!.split(',')[0]).origin;
 try{
  const input={state:url.searchParams.get('state')??'',cookie:cookieValue(request),code:url.searchParams.get('code')??''};
  const oauth=createLunchFlowOAuth(env);
  if(url.searchParams.has('error')){
   const denied=await oauth.deny(context,browserRequired(browser),input);
   return redirect(new URL(denied.returnKind==='native'?'/android/lunchflow/callback?result=failed':'/?lunchflow=failed',origin).href);
  }
  const result=await oauth.complete(context,browserRequired(browser),input);
  return redirect(new URL(result.returnKind==='native'?'/android/lunchflow/callback?result=connected':'/?lunchflow=connected',origin).href);
 }catch{return redirect(new URL('/?lunchflow=failed',origin).href);}
}
interface Route {request:Request;env:LunchFlowServiceEnv;context:FinancialContext;browser?:LunchFlowBrowserSession}
async function startRoute({env,context,browser}:Route) {
 const oauth=createLunchFlowOAuth(env);
 const result='credentialType' in context?await oauth.startNative(context):await oauth.startWeb(context,browserRequired(browser));
 const headers:Record<string,string>={};
 if('cookie' in result&&typeof result.cookie==='string')headers['set-cookie']=flowCookie(result.cookie);
 return json({authorizationUrl:result.authorizationUrl,connectionId:result.connectionId},200,headers);
}
async function launchRoute({request,env,context,browser}:Route) {
 if('credentialType' in context)return null;
 const result=await createLunchFlowOAuth(env).launch(context,browserRequired(browser),new URL(request.url).searchParams.get('ticket')??'');
 return redirect(result.authorizationUrl,result.cookie);
}
async function callbackRoute({request,env,context,browser}:Route) {
 if('credentialType' in context)return null;
 return callback(request,env,context,browser);
}
async function accountsRoute({request,env,context}:Route) {
 const url=new URL(request.url),service=createLunchFlowService(env,context,undefined,connectionId(url.searchParams.get('connectionId')));
 return json(url.searchParams.get('status')==='local'?await service.readStatus():await service.readAccounts());
}
async function disconnectRoute({request,env,context}:Route) {
 const input=await body(request),id=connectionId(input.connectionId);
 if(!id)return invalid('A connectionId is required.');
 const status=await createLunchFlowConnections(env).disconnect(context,id,expectedGeneration(input.expectedGeneration));
 return json(status,['pending','failed','uncertain'].includes(status.remoteRevocation)?202:200);
}
function requestIdentity(request:Request,context:FinancialContext) {
 const native='credentialType' in context;
 return {subject:native?context.subjectHash:'web-owner',key:idempotencyKey(request,native)};
}
async function selectionRoute({request,env,context}:Route) {
 const input=await body(request),id=connectionId(input.connectionId),accounts=parseLunchFlowMobileSelectionAccounts(input.accounts);
 if(!accounts)return invalid();
 const identity=requestIdentity(request,context);
 return json(await createLunchFlowService(env,context,undefined,{connectionId:id,expectedGeneration:expectedGeneration(input.expectedGeneration)}).selectAccounts({accounts,ownerSubjectHash:identity.subject,idempotencyKey:identity.key}));
}
async function syncRoute({request,env,context}:Route) {
 const input=await body(request),identity=requestIdentity(request,context);
 return json(await createLunchFlowService(env,context,undefined,{connectionId:connectionId(input.connectionId),expectedGeneration:expectedGeneration(input.expectedGeneration)}).requestSync(identity.subject,identity.key),202);
}
const routes=new Map<string,(route:Route)=>Promise<Response|null>>([
 ['POST /oauth/start',startRoute],['GET /oauth/launch',launchRoute],['GET /oauth/callback',callbackRoute],
 ['GET /connection',async({env,context})=>json(await createLunchFlowConnections(env).status(context))],
 ['GET /accounts',accountsRoute],['POST /disconnect',disconnectRoute],['POST /account-selection',selectionRoute],['POST /sync',syncRoute],
]);
export async function handleLunchFlowHttp(request:Request,env:LunchFlowServiceEnv,context:FinancialContext,browser?:LunchFlowBrowserSession) {
 const prefix='credentialType' in context?'/api/mobile/v1/lunchflow':'/api/lunchflow',pathname=new URL(request.url).pathname;
 if(!pathname.startsWith(prefix+'/'))return null;
 const handler=routes.get(`${request.method} ${pathname.slice(prefix.length)}`);
 return handler?handler({request,env,context,browser}):null;
}
