import { describe, expect, it } from 'vitest';
import { createLunchFlowConnections } from '../worker/lunchflow-connections';
import { sealLunchFlowTokens, openLunchFlowTokens } from '../worker/lunchflow-crypto';
import { setup, connect, token, browser, deferred, SECOND_LEDGER, OWNER_LEDGER, platformEnv } from './helpers/lunchflow-platform';

describe('Lunch Flow encrypted connections',()=>{
  it('binds encrypted credentials to user, ledger, connection and version',async()=>{
    const binding={userId:'second',ledgerId:'second-ledger',connectionId:'c',version:1};
    const sealed=await sealLunchFlowTokens(token,{secret:platformEnv.LUNCHFLOW_TOKEN_ENCRYPTION_KEY,binding});
    expect(JSON.stringify(sealed)).not.toContain('test-refresh');
    expect(await openLunchFlowTokens(sealed,{secret:platformEnv.LUNCHFLOW_TOKEN_ENCRYPTION_KEY,binding})).toEqual(token);
    for(const changed of [{...binding,userId:'owner'},{...binding,ledgerId:'personal'},{...binding,connectionId:'d'},{...binding,version:2}]) {
      await expect(openLunchFlowTokens(sealed,{secret:platformEnv.LUNCHFLOW_TOKEN_ENCRYPTION_KEY,binding:changed})).rejects.toThrow();
    }
  });
  it('reports configuration without creating credentials or exposing the owner key',async()=>{
    const f=await setup(); try {
      const service=createLunchFlowConnections({DB:f.db,LUNCHFLOW_API_KEY:'owner-secret'});
      expect(await service.status(SECOND_LEDGER)).toMatchObject({configured:false,connected:false,reason:'configuration_required'});
      expect(await f.db.prepare("SELECT COUNT(*) n FROM lunchflow_connections WHERE user_id='second'").first()).toMatchObject({n:0});
      expect(await service.status(OWNER_LEDGER)).toMatchObject({adapter:'personal',connected:true});
    }finally{f.close();}
  });
  it('claims refresh before fetch and never rotates the same refresh token twice',async()=>{
    const gate=deferred<Response>(),entered=deferred<void>(); let refreshes=0;
    const f=await setup(async(_input,init)=>{const body=JSON.parse(String(init?.body));if(body.grant_type==='refresh_token'){refreshes++;entered.resolve();return gate.promise;}return Response.json(token);});
    try {
      const id=await connect(f); await f.db.prepare("UPDATE lunchflow_connections SET access_expires_at='2000-01-01' WHERE id=?").bind(id).run();
      const first=f.connections.accessToken(SECOND_LEDGER,id); await entered.promise;
      await expect(f.connections.accessToken(SECOND_LEDGER,id)).rejects.toMatchObject({code:'operation_in_progress'});
      expect(refreshes).toBe(1); gate.resolve(Response.json({...token,access_token:'rotated',refresh_token:'rotated-refresh'}));
      expect(await first).toBe('rotated'); expect(await f.connections.accessToken(SECOND_LEDGER,id)).toBe('rotated');
    }finally{f.close();}
  });
  it('disconnect during refresh erases local credentials and waits before remote revocation',async()=>{
    const gate=deferred<Response>(),entered=deferred<void>(); const methods:string[]=[];
    const f=await setup(async(_input,init)=>{methods.push(init?.method??'GET');if(init?.method==='DELETE')return new Response(null,{status:204});const body=JSON.parse(String(init?.body));if(body.grant_type==='refresh_token'){entered.resolve();return gate.promise;}return Response.json(token);});
    try{
      const id=await connect(f);await f.db.prepare("UPDATE lunchflow_connections SET access_expires_at='2000-01-01' WHERE id=?").bind(id).run();
      const refreshing=f.connections.accessToken(SECOND_LEDGER,id);const rejected=expect(refreshing).rejects.toThrow();await entered.promise;
      expect(await f.connections.disconnect(SECOND_LEDGER,id)).toMatchObject({connected:false,remoteRevocation:'pending',canReconnect:false});
      expect(methods).not.toContain('DELETE');
      expect(await f.db.prepare('SELECT token_ciphertext FROM lunchflow_connections WHERE id=?').bind(id).first()).toMatchObject({token_ciphertext:null});
      gate.resolve(Response.json({...token,access_token:'late'}));await rejected;
      expect(await f.connections.disconnect(SECOND_LEDGER,id)).toMatchObject({remoteRevocation:'succeeded',connected:false,canReconnect:true});
      expect((await f.db.prepare("SELECT COUNT(*) n FROM transactions WHERE ledger_id='second-ledger'").first())?.n).toBe(2);
    }finally{f.close();}
  });
  it('keeps uncertain rotating refresh locked after lease expiry',async()=>{
    let refreshes=0;const f=await setup(async(_input,init)=>{if(JSON.parse(String(init?.body)).grant_type==='refresh_token'){refreshes++;throw new Error('network lost');}return Response.json(token);});
    try{
      const id=await connect(f);await f.db.prepare("UPDATE lunchflow_connections SET access_expires_at='2000-01-01' WHERE id=?").bind(id).run();
      await expect(f.connections.accessToken(SECOND_LEDGER,id)).rejects.toThrow();
      await f.db.prepare("UPDATE lunchflow_connections SET operation_expires_at='2000-01-01' WHERE id=?").bind(id).run();
      await expect(f.connections.accessToken(SECOND_LEDGER,id)).rejects.toThrow();expect(refreshes).toBe(1);
      expect(await f.connections.status(SECOND_LEDGER)).toMatchObject({connected:false,canReconnect:false,reason:'operation_uncertain'});
      await expect(f.oauth.startWeb(SECOND_LEDGER,browser)).rejects.toThrow();
    }finally{f.close();}
  });
  it('rejects changed provider identity on refresh without overwriting imported ownership',async()=>{
    const f=await setup(async(_input,init)=>Response.json(JSON.parse(String(init?.body)).grant_type==='refresh_token'?{...token,user_id:'different-person'}:token));
    try{const id=await connect(f);await f.db.prepare("UPDATE lunchflow_connections SET access_expires_at='2000-01-01' WHERE id=?").bind(id).run();await expect(f.connections.accessToken(SECOND_LEDGER,id)).rejects.toMatchObject({code:'provider_identity_conflict'});
      expect(await f.db.prepare('SELECT provider_user_id FROM lunchflow_connections WHERE id=?').bind(id).first()).toMatchObject({provider_user_id:'external-second'});
    }finally{f.close();}
  });
  it('never assigns one provider user to two hosted users, even after disconnect',async()=>{
    const f=await setup(async(_input,init)=>init?.method==='DELETE'?new Response(null,{status:204}):Response.json(token));
    try{const id=await connect(f);await f.connections.disconnect(SECOND_LEDGER,id);
      const other=await f.oauth.startWeb(OWNER_LEDGER,browser);
      await expect(f.oauth.complete(OWNER_LEDGER,browser,{state:new URL(other.authorizationUrl).searchParams.get('state')!,cookie:other.cookie,code:'code'})).rejects.toMatchObject({code:'provider_identity_conflict'});
      expect(await f.connections.status(OWNER_LEDGER)).toMatchObject({connected:false});
    }finally{f.close();}
  });
  it('keeps remote revocation failure disabled and supports a fenced explicit retry',async()=>{
    let deletes=0;const f=await setup(async(_input,init)=>{if(init?.method==='DELETE'){deletes++;return new Response(null,{status:deletes===1?401:204});}return Response.json(token);});
    try{const id=await connect(f);
      expect(await f.connections.disconnect(SECOND_LEDGER,id)).toMatchObject({remoteRevocation:'failed',canReconnect:false,connected:false});
      await expect(f.oauth.startWeb(SECOND_LEDGER,browser)).rejects.toThrow();
      expect(await f.connections.disconnect(SECOND_LEDGER,id)).toMatchObject({remoteRevocation:'succeeded',canReconnect:true});
    }finally{f.close();}
  });
});



it.each(['exchange','revoke'] as const)('keeps an uncertain %s outcome blocked after its lease expires',async kind=>{
  let attempts=0;const f=await setup(async(_input,init)=>{
    const isTarget=kind==='exchange'?init?.method==='POST':init?.method==='DELETE';
    if(isTarget){attempts++;throw new Error('response lost');}return Response.json(token);
  });
  try{
    let id:string;
    if(kind==='exchange') {
      const start=await f.oauth.startWeb(SECOND_LEDGER,browser);id=start.connectionId;
      await expect(f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'})).rejects.toThrow();
    }else{id=await connect(f);await f.connections.disconnect(SECOND_LEDGER,id);}
    await f.db.prepare("UPDATE lunchflow_connections SET operation_expires_at='2000-01-01' WHERE id=?").bind(id).run();
    await expect(f.oauth.startWeb(SECOND_LEDGER,browser)).rejects.toMatchObject({code:'operation_uncertain'});
    const status=await f.connections.disconnect(SECOND_LEDGER,id);
    expect(status).toMatchObject({connected:false,canReconnect:false,reason:'operation_uncertain',remoteRevocation:'uncertain'});
    expect(attempts).toBe(1);
    expect(JSON.stringify(status)).not.toContain('test-refresh');
  }finally{f.close();}
});

it('retains the durable connection owner against replacement inserts',async()=>{
  const f=await setup();try{
    await expect(f.db.prepare("INSERT OR REPLACE INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id) VALUES ('lunchflow-personal-owner','second','second-ledger','platform','test-client')").run()).rejects.toThrow();
    expect(await f.db.prepare("SELECT user_id FROM lunchflow_connections WHERE id='lunchflow-personal-owner'").first()).toMatchObject({user_id:'owner'});
  }finally{f.close();}
});

it('never revokes through a different configured OAuth application',async()=>{
  const f=await setup();try{
    const id=await connect(f);let requests=0;
    const changed=createLunchFlowConnections({...f.env,LUNCHFLOW_CLIENT_ID:'another-app'},async()=>{requests++;return new Response(null,{status:404});});
    await expect(changed.accessToken(SECOND_LEDGER,id)).rejects.toMatchObject({code:'application_configuration_changed'});
    await expect(changed.disconnect(SECOND_LEDGER,id)).rejects.toMatchObject({code:'application_configuration_changed'});
    expect(requests).toBe(0);
    expect(await f.connections.status(SECOND_LEDGER)).toMatchObject({connected:false,remoteRevocation:'pending',canReconnect:false});
  }finally{f.close();}
});


type CompletedOperation='exchange'|'refresh'|'revoke';
function completedOperationFetcher(operation:CompletedOperation,failed:boolean):typeof fetch {
  return async(_input,init)=>{
    if(init?.method==='DELETE')return new Response(null,{status:failed?401:204});
    const grant=JSON.parse(String(init?.body)).grant_type;
    const target=operation==='exchange'||(operation==='refresh'&&grant==='refresh_token');
    return target&&failed?new Response(null,{status:401}):Response.json(token);
  };
}
async function completeOperation(f:Awaited<ReturnType<typeof setup>>,operation:CompletedOperation,failed:boolean) {
  const start=await f.oauth.startWeb(SECOND_LEDGER,browser),id=start.connectionId;
  const completing=f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'});
  if(operation==='exchange'&&failed)await expect(completing).rejects.toThrow();else await completing;
  if(operation==='refresh'){
    await f.db.prepare("UPDATE lunchflow_connections SET access_expires_at='2000-01-01' WHERE id=?").bind(id).run();
    const refreshing=f.connections.accessToken(SECOND_LEDGER,id);
    if(failed)await expect(refreshing).rejects.toThrow();else await refreshing;
  }
  if(operation==='revoke')await f.connections.disconnect(SECOND_LEDGER,id);
  return id;
}
it.each([
  {operation:'exchange',failed:false,connected:true,reason:'connected'},
  {operation:'refresh',failed:false,connected:true,reason:'connected'},
  {operation:'revoke',failed:false,connected:false,reason:'revoked'},
  {operation:'exchange',failed:true,connected:false,reason:'reconnect_required'},
  {operation:'refresh',failed:true,connected:false,reason:'reconnect_required'},
  {operation:'revoke',failed:true,connected:false,reason:'revocation_failed'},
] as const)('releases $operation expiry (failed=$failed) and ignores stale expiry without a claim',async outcome=>{
  const f=await setup(completedOperationFetcher(outcome.operation,outcome.failed));
  try{
    const id=await completeOperation(f,outcome.operation,outcome.failed);
    expect(await f.db.prepare('SELECT operation_id,operation_expires_at FROM lunchflow_connections WHERE id=?').bind(id).first()).toEqual({operation_id:null,operation_expires_at:null});
    const before=await f.connections.status(SECOND_LEDGER);
    // Simulate an old completed claim's expiry crossing the database clock.
    await f.db.prepare("UPDATE lunchflow_connections SET operation_expires_at=datetime('now','-1 minute') WHERE id=?").bind(id).run();
    expect(await f.connections.status(SECOND_LEDGER)).toEqual(before);
    expect(before).toMatchObject({connected:outcome.connected,reason:outcome.reason});
    if(outcome.reason==='revocation_failed')expect(before).toMatchObject({remoteRevocation:'failed',retryable:true,canReconnect:false});
  }finally{f.close();}
});

it('blocks an active expired claim even before its outcome is marked uncertain',async()=>{
  const f=await setup();try{
    const id=await connect(f);
    await f.db.prepare("UPDATE lunchflow_connections SET operation_id='inflight',operation_kind='refresh',operation_uncertain=0,operation_expires_at=datetime('now','-1 minute') WHERE id=?").bind(id).run();
    expect(await f.connections.status(SECOND_LEDGER)).toMatchObject({connected:false,canReconnect:false,reason:'operation_uncertain'});
    await expect(f.connections.accessToken(SECOND_LEDGER,id)).rejects.toMatchObject({code:'operation_uncertain'});
    await expect(f.oauth.startWeb(SECOND_LEDGER,browser)).rejects.toMatchObject({code:'operation_uncertain'});
  }finally{f.close();}
});
