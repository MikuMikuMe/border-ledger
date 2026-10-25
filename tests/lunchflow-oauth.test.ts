import { describe, expect, it } from 'vitest';
import { setup, connect, token, browser, deferred, SECOND_LEDGER, OWNER_LEDGER, tenantOwner } from './helpers/lunchflow-platform';

describe('Lunch Flow single-use OAuth',()=>{
  it('binds state to cookie and verified browser session and consumes it only once',async()=>{
    let exchanges=0;const f=await setup(async()=>{exchanges++;return Response.json(token);});
    try{const start=await f.oauth.startWeb(SECOND_LEDGER,browser);const state=new URL(start.authorizationUrl).searchParams.get('state')!;
      const input={state,cookie:start.cookie,code:'code'};
      await expect(f.oauth.complete(SECOND_LEDGER,{...browser,sessionHash:'different'},input)).rejects.toThrow();
      await expect(f.oauth.complete(SECOND_LEDGER,browser,{...input,cookie:'wrong'})).rejects.toThrow();
      await expect(f.oauth.complete(OWNER_LEDGER,browser,input)).rejects.toThrow();expect(exchanges).toBe(0);
      expect(await f.oauth.complete(SECOND_LEDGER,browser,input)).toMatchObject({completed:true});
      await expect(f.oauth.complete(SECOND_LEDGER,browser,input)).rejects.toThrow();expect(exchanges).toBe(1);
    }finally{f.close();}
  });
  it('expires state using database time and never enrolls an unknown identity',async()=>{
    const f=await setup();try{
      await expect(f.oauth.startWeb({userId:'unknown',ledgerId:'unknown'},browser)).rejects.toThrow();
      const start=await f.oauth.startWeb(SECOND_LEDGER,browser);await f.db.prepare("UPDATE lunchflow_oauth_states SET expires_at='2000-01-01'").run();
      await expect(f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'})).rejects.toThrow();
      expect(await f.db.prepare('SELECT COUNT(*) n FROM users').first()).toMatchObject({n:2});
    }finally{f.close();}
  });
  it.each([
    ['user disabled',"UPDATE users SET status='disabled' WHERE id='second'"],
    ['authorization expired',"UPDATE lunchflow_oauth_states SET expires_at='2000-01-01'"],
  ])('does not publish exchanged credentials after %s',async(_label,mutation)=>{
    const f=await setup();try{
      const oauth=(await import('../worker/lunchflow-oauth')).createLunchFlowOAuth(f.env,async()=>{
        await f.db.prepare(mutation).run();return Response.json(token);
      });
      const start=await oauth.startWeb(SECOND_LEDGER,browser);
      await expect(oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'})).rejects.toThrow();
      expect(await f.db.prepare("SELECT token_ciphertext FROM lunchflow_connections WHERE user_id='second'").first()).toMatchObject({token_ciphertext:null});
    }finally{f.close();}
  });
  it('blocks owner cutover while Personal credentials or historical mappings exist',async()=>{
    const f=await setup();try{
      const oauth=(await import('../worker/lunchflow-oauth')).createLunchFlowOAuth({...f.env,LUNCHFLOW_API_KEY:'owner-key'});
      await expect(oauth.startWeb(OWNER_LEDGER,browser)).rejects.toMatchObject({code:'legacy_cutover_required'});
      await f.db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,ledger_id,name,institution,enabled) VALUES ('old','personal','Old','Bank',0)").run();
      await expect(f.oauth.startWeb(OWNER_LEDGER,browser)).rejects.toMatchObject({code:'legacy_cutover_required'});
    }finally{f.close();}
  });
  it('binds native browser bootstrap and callback to the initiating live family',async()=>{
    const f=await setup();try{
      await f.db.prepare("UPDATE owner_session_families SET scope_json='[\"connections:manage\"]' WHERE id='second-family'").run();
      const native={...tenantOwner(SECOND_LEDGER),scopes:['connections:manage' as const]};
      const launch=await f.oauth.startNative(native);const ticket=new URL(launch.authorizationUrl).searchParams.get('ticket')!;
      await expect(f.oauth.launch(OWNER_LEDGER,browser,ticket)).rejects.toThrow();
      const started=await f.oauth.launch(SECOND_LEDGER,browser,ticket);
      await expect(f.oauth.launch(SECOND_LEDGER,browser,ticket)).rejects.toThrow();
      await f.db.prepare("UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run();
      await expect(f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(started.authorizationUrl).searchParams.get('state')!,cookie:started.cookie,code:'code'})).rejects.toThrow();
    }finally{f.close();}
  });
  it('does not allow a pending revoke or stale callback to attach credentials',async()=>{
    const gate=deferred<Response>(),entered=deferred<void>();
    const f=await setup(async(_input,init)=>{if(init?.method==='DELETE'){entered.resolve();return gate.promise;}return Response.json(token);});
    try{const id=await connect(f);const start=await f.oauth.startWeb(SECOND_LEDGER,browser);
      const disconnect=f.connections.disconnect(SECOND_LEDGER,id);await entered.promise;
      await expect(f.oauth.startWeb(SECOND_LEDGER,browser)).rejects.toThrow();
      await expect(f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'})).rejects.toThrow();
      gate.resolve(new Response(null,{status:204}));await disconnect;
    }finally{f.close();}
  });
});

it('disconnect fences an initial token exchange that has not returned yet',async()=>{
  const gate=deferred<Response>(),entered=deferred<void>();
  const f=await setup(async(_input,init)=>{if(init?.method==='DELETE')return new Response(null,{status:204});entered.resolve();return gate.promise;});
  try{
    const start=await f.oauth.startWeb(SECOND_LEDGER,browser);
    const completing=f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(start.authorizationUrl).searchParams.get('state')!,cookie:start.cookie,code:'code'});
    const rejected=expect(completing).rejects.toThrow();await entered.promise;
    const pending=await f.connections.disconnect(SECOND_LEDGER,start.connectionId);
    gate.resolve(Response.json(token));await rejected;
    expect(pending).toMatchObject({connected:false,remoteRevocation:'pending',canReconnect:false});
    expect(await f.connections.disconnect(SECOND_LEDGER,start.connectionId)).toMatchObject({remoteRevocation:'succeeded',connected:false});
  }finally{f.close();}
});
it('invalidates other issued states when an authorization completes',async()=>{
  const f=await setup();try{
    const first=await f.oauth.startWeb(SECOND_LEDGER,browser),second=await f.oauth.startWeb(SECOND_LEDGER,browser);
    await f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(second.authorizationUrl).searchParams.get('state')!,cookie:second.cookie,code:'new-code'});
    await expect(f.oauth.complete(SECOND_LEDGER,browser,{state:new URL(first.authorizationUrl).searchParams.get('state')!,cookie:first.cookie,code:'old-code'})).rejects.toThrow();
  }finally{f.close();}
});

it('rejects an already expired verified browser session before issuing state',async()=>{
  const f=await setup();try{
    await expect(f.oauth.startWeb(SECOND_LEDGER,{...browser,expiresAt:'2000-01-01T00:00:00Z'})).rejects.toThrow();
    expect(await f.db.prepare('SELECT COUNT(*) n FROM lunchflow_oauth_states').first()).toMatchObject({n:0});
  }finally{f.close();}
});
