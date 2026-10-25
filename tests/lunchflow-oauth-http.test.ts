import { createOpaqueCredential,hashSecret } from '../worker/mobile-auth';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { setup, token } from './helpers/lunchflow-platform';
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),jwtVerify:async(assertion:string)=>{
 const [subject,session,expiry]=assertion.split(':');if(!session)throw new Error('invalid');
 return {payload:{sub:subject,aud:'test-audience',iss:'https://access.example.com',exp:expiry==='expired'?1:4070908800}};
}}));
afterEach(()=>vi.restoreAllMocks());
function request(path:string,options:{method?:string;assertion?:string;cookie?:string;body?:unknown}={}){
 return new Request('https://ledger.example'+path,{method:options.method??'GET',headers:{'Cf-Access-Jwt-Assertion':options.assertion??'second-subject:session1',origin:'https://ledger.example',cookie:options.cookie??'','content-type':'application/json'},...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
}
function runtime(f:Awaited<ReturnType<typeof setup>>){return {...f.env,ACCESS_TEAM_DOMAIN:'https://access.example.com',ACCESS_AUDIENCE:'test-audience',ASSETS:{fetch:async()=>new Response('asset')}};}
it('uses verified browser session and HttpOnly cookie, whitelists DTO, and redirects without secrets',async()=>{
 const f=await setup();try{
  let calls=0;vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{calls++;return Response.json(token);});
  const env=runtime(f),start=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST',body:{returnUrl:'https://evil.example'}}),env);
  expect(start.status).toBe(200);const dto=await start.json() as {authorizationUrl:string;connectionId:string};
  expect(Object.keys(dto).sort()).toEqual(['authorizationUrl','connectionId']);
  const cookie=start.headers.get('set-cookie')!;expect(cookie).toContain('__Host-lunchflow=');expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax; Path=/');
  const state=new URL(dto.authorizationUrl).searchParams.get('state'),path=`/api/lunchflow/oauth/callback?state=${state}&code=secret-provider-code&returnUrl=https://evil.example`;
  const wrong=await worker.fetch(request(path,{cookie,assertion:'second-subject:session2'}),env);expect(wrong.status).toBe(303);expect(calls).toBe(0);
  const completed=await worker.fetch(request(path,{cookie}),env);expect(completed.status).toBe(303);expect(completed.headers.get('location')).toBe('https://ledger.example/?lunchflow=connected');
  expect(completed.headers.get('set-cookie')).toContain('Max-Age=0');expect(completed.headers.get('cache-control')).toBe('no-store');expect(completed.headers.get('referrer-policy')).toBe('no-referrer');
  expect(JSON.stringify([...completed.headers])).not.toContain('secret-provider-code');
  await worker.fetch(request(path,{cookie}),env);expect(calls).toBe(1);
 }finally{f.close();}
});
it('keeps unknown users closed and rejects missing/expired browser bindings',async()=>{
 const f=await setup();try{
  const env=runtime(f);
  for(const assertion of ['unknown:session','second-subject:expired:expired','invalid']){
   const response=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST',body:{},assertion}),env);
   expect(response.status).toBeGreaterThanOrEqual(400);
  }
  expect(await f.db.prepare("SELECT COUNT(*) n FROM lunchflow_connections WHERE adapter='platform'").first()).toEqual({n:0});
 }finally{f.close();}
});

async function nativeRuntime(f:Awaited<ReturnType<typeof setup>>) {
 const environmentHash=await hashSecret('test'),origin='https://ledger.example',sessionEncryptionKey='test-native-lunchflow-session-key';
 await f.db.prepare("UPDATE owner_session_families SET environment_hash=?,scope_json='[\"connections:manage\"]' WHERE id='second-family'").bind(environmentHash).run();
 const access=await createOpaqueCredential({kind:'owner-access',familyId:'second-family',generation:1,expiresAt:'2099-01-01T00:00:00Z',environmentHash},
  {canonicalOrigin:origin,callbackUrl:origin+'/android/auth/callback',environment:'test',accessAuthorizationUrl:origin+'/mobile/authorize',sessionEncryptionKey});
 return {env:{...runtime(f),MOBILE_ENVIRONMENT:'test',MOBILE_ACCESS_AUTHORIZATION_URL:origin+'/mobile/authorize',MOBILE_SESSION_ENCRYPTION_KEY:sessionEncryptionKey},access};
}
it.each([false,true])('binds native bootstrap to browser user and live initiating family (revoked=%s)',async revoked=>{
 const f=await setup();try{
  const {env,access}=await nativeRuntime(f);let exchanges=0;
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{exchanges++;return Response.json(token);});
  const start=await worker.fetch(new Request('https://ledger.example/api/mobile/v1/lunchflow/oauth/start',{method:'POST',headers:{authorization:'Bearer '+access}}),env);
  expect(start.status).toBe(200);const dto=await start.json() as {authorizationUrl:string;connectionId:string};expect(Object.keys(dto).sort()).toEqual(['authorizationUrl','connectionId']);expect(start.headers.get('set-cookie')).toBeNull();
  const path=new URL(dto.authorizationUrl).pathname+new URL(dto.authorizationUrl).search;
  expect((await worker.fetch(request(path,{assertion:'owner-subject:session1'}),env)).status).toBe(403);
  const launch=await worker.fetch(request(path),env);expect(launch.status).toBe(303);
  const cookie=launch.headers.get('set-cookie')!,state=new URL(launch.headers.get('location')!).searchParams.get('state');
  expect((await worker.fetch(request(path),env)).status).toBe(403);
  if(revoked)await f.db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run();
  const done=await worker.fetch(request(`/api/lunchflow/oauth/callback?state=${state}&code=code`,{cookie}),env);
  expect(done.headers.get('location')).toBe(revoked?'https://ledger.example/?lunchflow=failed':'https://ledger.example/android/lunchflow/callback?result=connected');
  expect(exchanges).toBe(revoked?0:1);
 }finally{f.close();}
});
it('consumes provider denial without exchange and cannot reuse the denied state',async()=>{
 const f=await setup();try{
  const env=runtime(f),fetcher=vi.spyOn(globalThis,'fetch');
  const start=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST'}),env),dto=await start.json() as {authorizationUrl:string};
  const cookie=start.headers.get('set-cookie')!,state=new URL(dto.authorizationUrl).searchParams.get('state');
  const denied=await worker.fetch(request(`/api/lunchflow/oauth/callback?state=${state}&error=access_denied`,{cookie}),env);
  expect(denied.headers.get('location')).toBe('https://ledger.example/?lunchflow=failed');
  await worker.fetch(request(`/api/lunchflow/oauth/callback?state=${state}&code=later`,{cookie}),env);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await f.db.prepare('SELECT consumed_by FROM lunchflow_oauth_states').first()).toEqual({consumed_by:'denied'});
 }finally{f.close();}
});

it('reports missing configuration and rejects another user connection at HTTP boundaries',async()=>{
 const f=await setup();try{
  const env=runtime(f),missing={...env,LUNCHFLOW_CLIENT_SECRET:undefined};
  const status=await worker.fetch(request('/api/lunchflow/connection'),missing);
  expect(await status.json()).toMatchObject({userId:'second',ledgerId:'second-ledger',configured:false,connected:false,canReconnect:false,reason:'configuration_required'});
  const unavailable=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST'}),missing);
  expect(unavailable.status).toBe(503);expect(await unavailable.json()).toMatchObject({code:'configuration_required',retryable:false});
  const start=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST'}),env),dto=await start.json() as {connectionId:string};
  for(const suffix of ['/accounts?status=local&connectionId='+dto.connectionId,'/disconnect']){
   const options=suffix==='/disconnect'?{method:'POST',body:{connectionId:dto.connectionId}}:{};
   const foreign=await worker.fetch(request('/api/lunchflow'+suffix,{...options,assertion:'owner-subject:session1'}),env);
   expect(foreign.status).toBe(404);expect(await foreign.json()).toMatchObject({code:'connection_not_found'});
  }
  expect(await f.db.prepare('SELECT generation FROM lunchflow_connections WHERE id=?').bind(dto.connectionId).first()).toEqual({generation:1});
 }finally{f.close();}
});

async function authorizeOwnerPlatform(env:ReturnType<typeof runtime>) {
 const assertion='owner-subject:session1';
 const start=await worker.fetch(request('/api/lunchflow/oauth/start',{method:'POST',assertion}),env);
 expect(start.status).toBe(200);
 const dto=await start.json() as {authorizationUrl:string;connectionId:string},state=new URL(dto.authorizationUrl).searchParams.get('state');
 const done=await worker.fetch(request(`/api/lunchflow/oauth/callback?state=${state}&code=owner-code`,{assertion,cookie:start.headers.get('set-cookie')!}),env);
 expect(done.headers.get('location')).toBe('https://ledger.example/?lunchflow=connected');
 return dto.connectionId;
}
it('discovers the owner Platform connection through HTTP status across selection, disconnect and reconnect',async()=>{
 const f=await setup();try{
  const env={...runtime(f),SYNC_QUEUE:{send:async()=>{}}},assertion='owner-subject:session1';
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
   const upstream=new Request(input,init);
   if(upstream.method==='DELETE')return new Response(null,{status:204});
   if(new URL(upstream.url).pathname.endsWith('/accounts'))return Response.json({accounts:[{id:1,connection_id:9,name:'Bank',institution_name:'Bank',institution_logo:null,provider:'test',currency:'CAD',status:'ACTIVE'}],total:1});
   return Response.json({...token,user_id:'external-owner'});
  });
  const id=await authorizeOwnerPlatform(env);
  const connected=await worker.fetch(request('/api/lunchflow/connection',{assertion}),env),status=await connected.json() as {connectionId:string};
  expect(status).toMatchObject({connectionId:id,adapter:'platform',connected:true,canReconnect:true});
  const selected=await worker.fetch(request('/api/lunchflow/account-selection',{method:'POST',assertion,body:{connectionId:status.connectionId,accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]}}),env);
  expect(selected.status).toBe(200);
  await worker.fetch(request('/api/lunchflow/disconnect',{method:'POST',assertion,body:{connectionId:status.connectionId}}),env);
  const disconnected=await worker.fetch(request('/api/lunchflow/connection',{assertion}),env);
  expect(await disconnected.json()).toMatchObject({connectionId:id,adapter:'platform',connected:false,canReconnect:true,remoteRevocation:'succeeded'});
  expect(await authorizeOwnerPlatform(env)).toBe(id);
  const reconnected=await worker.fetch(request('/api/lunchflow/connection',{assertion}),env);
  expect(await reconnected.json()).toMatchObject({connectionId:id,adapter:'platform',connected:true,generation:4});
  expect(await f.db.prepare("SELECT adapter FROM lunchflow_connections WHERE id='lunchflow-personal-owner'").first()).toEqual({adapter:'personal'});
 }finally{f.close();}
});
