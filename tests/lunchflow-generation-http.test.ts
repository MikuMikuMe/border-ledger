import {it,expect,vi} from 'vitest';
import {createLunchFlowService} from '../worker/lunchflow-service';
import worker from '../worker/index';
import { setup, connect, token, SECOND_LEDGER, tenantOwner, browser } from './helpers/lunchflow-platform';
vi.mock('jose',async original=>({...await original(),jwtVerify:async()=>({payload:{sub:'second-subject',aud:'test-audience',iss:'https://access.example.com',exp:4070908800}})}));
function request(path:string,body:unknown){return new Request('https://ledger.example/api/lunchflow/'+path,{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'second-subject:session1',origin:'https://ledger.example','content-type':'application/json'},body:JSON.stringify(body)});}
it('rejects delayed generation-2 HTTP mutations after same-ID generation-4 reconnect',async()=>{
 let revocations=0;const queued:unknown[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.method==='DELETE'){revocations++;return new Response(null,{status:204});}
  if(new URL(request.url).pathname.endsWith('/accounts'))return Response.json({accounts:[{id:1,connection_id:9,name:'Bank',institution_name:'Bank',institution_logo:null,provider:'test',currency:'CAD',status:'ACTIVE'}],total:1});
  return Response.json(token);
 };
 const f=await setup(fetcher);vi.spyOn(globalThis,'fetch').mockImplementation(fetcher);
 try{
  const env={...f.env,ACCESS_TEAM_DOMAIN:'https://access.example.com',ACCESS_AUDIENCE:'test-audience',ASSETS:{fetch:async()=>new Response('asset')},SYNC_QUEUE:{send:async(message:unknown)=>{queued.push(message);}}};
  const id=await connect(f);
  const observed=await f.connections.status(SECOND_LEDGER);expect(observed.generation).toBe(2);

  const staleSelection=request('account-selection',{connectionId:id,expectedGeneration:2,accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]});
  const staleDisconnect=request('disconnect',{connectionId:id,expectedGeneration:2});
  await f.connections.disconnect(SECOND_LEDGER,id,(await f.connections.status(SECOND_LEDGER)).generation!);
  expect(await connect(f)).toBe(id);
  expect((await f.connections.status(SECOND_LEDGER)).generation).toBe(4);
  const before=revocations;
  for(const delayed of [staleSelection,staleDisconnect,request('sync',{connectionId:id,expectedGeneration:2})]){
    const response=await worker.fetch(delayed,env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'connection_generation_conflict'});
  }
  expect(queued).toHaveLength(0);expect(revocations).toBe(before);
  expect(await f.connections.status(SECOND_LEDGER)).toMatchObject({generation:4,connected:true});
  expect(await f.db.prepare('SELECT COUNT(*) n FROM lunchflow_accounts WHERE connection_id=? AND enabled=1').bind(id).first()).toEqual({n:0});
  await rejectInvalidGenerations(env,id,request);
  expect(revocations).toBe(before);expect(queued).toHaveLength(0);
  const fresh=await worker.fetch(request('account-selection',{connectionId:id,expectedGeneration:4,accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]}),env);
  expect(fresh.status).toBe(200);expect(queued).toHaveLength(1);expect(queued[0]).toMatchObject({generation:4});
  const disconnected=await worker.fetch(request('disconnect',{connectionId:id,expectedGeneration:4}),env);
  expect(disconnected.status).toBe(200);expect(await disconnected.json()).toMatchObject({generation:5,remoteRevocation:'succeeded'});
 }finally{vi.restoreAllMocks();f.close();}
});


it('keeps disconnect dependent writes and remote removal fenced across the atomic batch',async()=>{
  let deletes=0;const f=await setup(async(_input,init)=>{if(init?.method==='DELETE'){deletes++;return new Response(null,{status:204});}return Response.json(token);});
  try{
    const id=await connect(f);
    await createLunchFlowService({...f.env,SYNC_QUEUE:{send:async()=>{}}},SECOND_LEDGER,{listAccounts:async()=>[{id:'1',name:'Bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'}],listTransactions:async()=>[]},{connectionId:id,expectedGeneration:2}).selectAccounts({accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]});
    const original=f.db.batch.bind(f.db);
    const batch=vi.spyOn(f.db,'batch').mockImplementationOnce(async statements=>{
      await f.db.prepare('UPDATE lunchflow_connections SET generation=4 WHERE id=?').bind(id).run();
      return original(statements);
    });
    await expect(f.connections.disconnect(SECOND_LEDGER,id,2)).rejects.toMatchObject({code:'connection_generation_conflict'});
    batch.mockRestore();
    expect(deletes).toBe(0);
    expect(await f.db.prepare('SELECT enabled FROM lunchflow_accounts WHERE connection_id=?').bind(id).first()).toEqual({enabled:1});
    expect(await f.connections.status(SECOND_LEDGER)).toMatchObject({generation:4,connected:true});
  }finally{vi.restoreAllMocks();f.close();}
});
it('requires a freshly observed pending generation for explicit remote-removal retry',async()=>{
  let deletes=0;const f=await setup(async(_input,init)=>{if(init?.method==='DELETE')return new Response(null,{status:++deletes===1?401:204});return Response.json(token);});
  try{
    const id=await connect(f);
    expect(await f.connections.disconnect(SECOND_LEDGER,id,2)).toMatchObject({generation:3,retryable:true,remoteRevocation:'failed'});
    await expect(f.connections.disconnect(SECOND_LEDGER,id,2)).rejects.toMatchObject({code:'connection_generation_conflict'});
    expect(deletes).toBe(1);
    expect(await f.connections.disconnect(SECOND_LEDGER,id,3)).toMatchObject({generation:3,remoteRevocation:'succeeded'});
    expect(deletes).toBe(2);
  }finally{f.close();}
});

async function rejectInvalidGenerations(env:Parameters<typeof worker.fetch>[1],id:string,request:(path:string,body:unknown)=>Request){
  for(const path of ['account-selection','sync','disconnect']){
    for(const invalid of [undefined,null,0,-1,1.5,'4',Number.MAX_SAFE_INTEGER+1]){
      const response=await worker.fetch(request(path,{connectionId:id,expectedGeneration:invalid,accounts:[]}),env);
      expect(response.status).toBe(400);
    }
    const foreign=await worker.fetch(request(path,{connectionId:'lunchflow-personal-owner',expectedGeneration:1,accounts:[]}),env);
    expect(foreign.status).toBe(404);
  }
 }

it('returns a typed HTTP conflict when selection loses its generation before atomic publication',async()=>{
  const queued:unknown[]=[];
  const fetcher:typeof fetch=async(input,init)=>new Request(input,init).url.endsWith('/accounts')
    ?Response.json({accounts:[{id:1,connection_id:9,name:'Bank',institution_name:'Bank',institution_logo:null,provider:'test',currency:'CAD',status:'ACTIVE'}],total:1})
    :Response.json(token);
  const f=await setup(fetcher);vi.spyOn(globalThis,'fetch').mockImplementation(fetcher);
  try{
    const id=await connect(f),original=f.db.batch.bind(f.db);
    vi.spyOn(f.db,'batch').mockImplementationOnce(async statements=>{await f.db.prepare('UPDATE lunchflow_connections SET generation=4 WHERE id=?').bind(id).run();return original(statements);});
    const response=await worker.fetch(new Request('https://ledger.example/api/lunchflow/account-selection',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'second-subject:session1',origin:'https://ledger.example','content-type':'application/json'},body:JSON.stringify({connectionId:id,expectedGeneration:2,accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]})}),
      {...f.env,ACCESS_TEAM_DOMAIN:'https://access.example.com',ACCESS_AUDIENCE:'test-audience',ASSETS:{fetch:async()=>new Response('asset')},SYNC_QUEUE:{send:async message=>{queued.push(message);}}});
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'connection_generation_conflict'});
    expect(queued).toHaveLength(0);expect(await f.db.prepare('SELECT COUNT(*) n FROM lunchflow_accounts').first()).toEqual({n:0});
  }finally{vi.restoreAllMocks();f.close();}
});

async function selectedConnection(f:Awaited<ReturnType<typeof setup>>) {
  const id=await connect(f);
  await createLunchFlowService({...f.env,SYNC_QUEUE:{send:async()=>{}}},SECOND_LEDGER,{listAccounts:async()=>[{id:'1',name:'Bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'}],listTransactions:async()=>[]},{connectionId:id,expectedGeneration:2}).selectAccounts({accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]});
  await f.oauth.startWeb(SECOND_LEDGER,browser);
  return id;
}
async function disconnectRows(f:Awaited<ReturnType<typeof setup>>,id:string) {
  return {
    connection:await f.db.prepare('SELECT * FROM lunchflow_connections WHERE id=?').bind(id).first(),
    accounts:(await f.db.prepare('SELECT * FROM lunchflow_accounts WHERE connection_id=?').bind(id).all()).results,
    oauth:(await f.db.prepare('SELECT * FROM lunchflow_oauth_states WHERE connection_id=? ORDER BY state_hash').bind(id).all()).results,
  };
}
it.each([2,3])('rolls back dependent writes when unchanged native authority expires before batch statement %i',async(expiryStep)=>{
  let deletes=0;const f=await setup(async(_input,init)=>{if(init?.method==='DELETE'){deletes++;return new Response(null,{status:204});}return Response.json(token);});
  try {
    const id=await selectedConnection(f),before=await disconnectRows(f,id);
    const owner={...tenantOwner(SECOND_LEDGER),scopes:['connections:manage']};
    await f.db.prepare("UPDATE owner_session_families SET scope_json=?,access_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+0.4 seconds') WHERE id=?").bind(JSON.stringify(owner.scopes),owner.familyId).run();
    const family=await f.db.prepare('SELECT * FROM owner_session_families WHERE id=?').bind(owner.familyId).first();
    const original=f.db.batch.bind(f.db);let dependentChanges:number[]=[];
    vi.spyOn(f.db,'batch').mockImplementationOnce(async statements=>{
      for(const index of [0,1]) {
        const run=statements[index].run.bind(statements[index]);
        statements[index].run=async()=>{const result=await run();dependentChanges.push(result.meta?.changes??0);return result;};
      }
      const transition=statements[expiryStep].run.bind(statements[expiryStep]);
      statements[expiryStep].run=async()=>{
        // No rows change here: the real SQLite clock crosses the stored expiry.
        while((await f.db.prepare("SELECT julianday(access_expires_at)>julianday('now') active FROM owner_session_families WHERE id=?").bind(owner.familyId).first<{active:number}>())?.active)await new Promise(resolve=>setTimeout(resolve,10));
        return transition();
      };
      return original(statements);
    });
    await expect(f.connections.disconnect(owner,id,2)).rejects.toMatchObject({code:'access_not_enabled'});
    expect(dependentChanges).toEqual([1,2]);expect(await disconnectRows(f,id)).toEqual(before);expect(deletes).toBe(0);
    expect(await f.db.prepare('SELECT * FROM owner_session_families WHERE id=?').bind(owner.familyId).first()).toEqual(family);
  }finally{vi.restoreAllMocks();f.close();}
});

it.each([
  ["generation=3,lifecycle='revocation_pending',token_ciphertext=NULL,token_iv=NULL,access_expires_at=NULL",'connection_generation_conflict'],
  ["operation_id='concurrent-operation',operation_kind='refresh'",'operation_in_progress'],
])('fails inside the disconnect transaction when its exact transition was already replaced: %s',async(change,code)=>{
  let deletes=0;const f=await setup(async(_input,init)=>{if(init?.method==='DELETE'){deletes++;return new Response(null,{status:204});}return Response.json(token);});
  try {
    const id=await selectedConnection(f),original=f.db.batch.bind(f.db);let rolledBack=false;
    vi.spyOn(f.db,'batch').mockImplementationOnce(async statements=>{
      await f.db.prepare(`UPDATE lunchflow_connections SET ${change} WHERE id=?`).bind(id).run();
      try{return await original(statements);}catch(error){rolledBack=true;throw error;}
    });
    await expect(f.connections.disconnect(SECOND_LEDGER,id,2)).rejects.toMatchObject({code});
    expect(rolledBack).toBe(true);expect(deletes).toBe(0);
    expect(await f.db.prepare('SELECT enabled,revision FROM lunchflow_accounts WHERE connection_id=?').bind(id).first()).toEqual({enabled:1,revision:1});
    expect(await f.db.prepare("SELECT COUNT(*) n FROM lunchflow_oauth_states WHERE connection_id=? AND consumed_by='disconnected'").bind(id).first()).toEqual({n:0});
  }finally{vi.restoreAllMocks();f.close();}
});
it('preserves unrelated SQL failures after rolling back disconnect writes',async()=>{
  const f=await setup();
  try {
    const id=await selectedConnection(f),before=await disconnectRows(f,id),original=f.db.batch.bind(f.db);
    vi.spyOn(f.db,'batch').mockImplementationOnce(statements=>original([...statements.slice(0,2),f.db.prepare('UPDATE nonexistent_disconnect_table SET invalid=1'),...statements.slice(2)]));
    await expect(f.connections.disconnect(SECOND_LEDGER,id,2)).rejects.toThrow('no such table: nonexistent_disconnect_table');
    expect(await disconnectRows(f,id)).toEqual(before);
  }finally{vi.restoreAllMocks();f.close();}
});
