import { describe, expect, it } from 'vitest';
import { createLunchFlowPlatform, platformConfiguration } from '../worker/lunchflow-platform';

const env = { LUNCHFLOW_CLIENT_ID:'test-client', LUNCHFLOW_CLIENT_SECRET:'test-secret', LUNCHFLOW_REDIRECT_URI:'https://ledger.example/api/lunchflow/oauth/callback', LEDGER_APP_ORIGIN:'https://ledger.example' };
const tokens = {access_token:'test-access',refresh_token:'test-refresh',token_type:'Bearer',expires_in:3600,user_id:'external-1'};
const account = {id:42,connection_id:73,name:'Checking',institution_name:'Bank',institution_logo:null,provider:'gocardless'};

describe('Lunch Flow Platform public contract',()=>{
  it('uses confidential JSON OAuth outside the resource v1 base',async()=>{
    const requests:Array<{url:string;init:RequestInit}>=[];
    const fetcher:typeof fetch=async(input,init)=>{requests.push({url:String(input),init:init!});return Response.json(tokens);};
    const provider=createLunchFlowPlatform(env,fetcher);
    expect(await provider.exchange('auth-code')).toEqual(tokens);
    expect(requests[0].url).toBe('https://www.lunchflow.app/api/platform/oauth/token');
    expect(requests[0].init.redirect).toBe('manual');
    expect(JSON.parse(String(requests[0].init.body))).toEqual({grant_type:'authorization_code',code:'auth-code',redirect_uri:env.LUNCHFLOW_REDIRECT_URI,client_id:'test-client',client_secret:'test-secret'});
    expect(new Headers(requests[0].init.headers).get('content-type')).toBe('application/json');
  });
  it('rejects OAuth, account, and transaction redirects without following or forwarding credentials', async () => {
    async function assertRedirectRejected(operation: (provider: ReturnType<typeof createLunchFlowPlatform>) => Promise<unknown>, expectedUrl: string, authorization: string | null) {
      const requests: Request[] = [];
      const provider = createLunchFlowPlatform(env, async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return new Response('synthetic redirect', { status: 303, headers: { location: 'https://redirect.example/final' } });
      });

      await expect(operation(provider)).rejects.toMatchObject({ code: 'provider_rejected', status: 502, uncertain: false });
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(expectedUrl);
      expect(requests[0].redirect).toBe('manual');
      expect(requests[0].headers.get('authorization')).toBe(authorization);
      expect(requests.some(({ url }) => url === 'https://redirect.example/final')).toBe(false);
    }

    await assertRedirectRejected(
      provider => provider.exchange('auth-code'),
      'https://www.lunchflow.app/api/platform/oauth/token',
      null,
    );
    await assertRedirectRejected(
      provider => provider.listAccounts('test-access'),
      'https://www.lunchflow.app/api/platform/v1/accounts',
      'Bearer test-access',
    );
    await assertRedirectRejected(
      provider => provider.listTransactions('test-access', '42'),
      'https://www.lunchflow.app/api/platform/v1/accounts/42/transactions?include_pending=true',
      'Bearer test-access',
    );
  });
  it('preserves bank identity independently and accepts absent optional currency/status',async()=>{
    const provider=createLunchFlowPlatform(env,async(input,init)=>{
      expect(String(input)).toBe('https://www.lunchflow.app/api/platform/v1/accounts');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-access');
      return Response.json({accounts:[account],total:1});
    });
    expect(await provider.listAccounts('test-access')).toEqual([{id:'42',bankConnectionId:'73',name:'Checking',institutionName:'Bank',currency:null,status:'UNKNOWN'}]);
  });
  it.each([{accounts:[account],total:2},{accounts:[account,account],total:2},{accounts:[{...account,connection_id:null}],total:1}])('rejects incomplete or ambiguous account snapshots',async payload=>{
    await expect(createLunchFlowPlatform(env,async()=>Response.json(payload)).listAccounts('token')).rejects.toMatchObject({code:'malformed_response'});
  });
  it('validates transactions and explicitly includes pending without raw data',async()=>{
    const row={id:'tx',accountId:42,amount:-1.25,currency:'CAD',date:'2026-10-24',merchant:'Shop',description:null,isPending:true};
    const provider=createLunchFlowPlatform(env,async(input)=>{expect(String(input)).toBe('https://www.lunchflow.app/api/platform/v1/accounts/42/transactions?include_pending=true');return Response.json({transactions:[row],total:1});});
    expect(await provider.listTransactions('token','42')).toEqual([{...row,accountId:'42'}]);
  });
  it.each([{...tokens,refresh_token:''},{...tokens,expires_in:0},{...tokens,user_id:null},{...tokens,token_type:'Basic'}])('rejects malformed token success',async payload=>{
    await expect(createLunchFlowPlatform(env,async()=>Response.json(payload)).exchange('code')).rejects.toMatchObject({code:'malformed_response'});
  });
  it('never exposes provider bodies on rejection',async()=>{
    const provider=createLunchFlowPlatform(env,async()=>new Response('private-secret',{status:401}));
    await expect(provider.refresh('test-refresh')).rejects.toMatchObject({code:'provider_rejected',uncertain:false});
    try{await provider.refresh('test-refresh');}catch(error){expect(String(error)).not.toContain('private-secret');}
  });
  it('revokes app membership with Basic credentials, never a bank connection',async()=>{
    const provider=createLunchFlowPlatform(env,async(input,init)=>{
      expect(String(input)).toBe('https://www.lunchflow.app/api/platform/v1/users/external-1');
      expect(init?.method).toBe('DELETE');expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa('test-client:test-secret')}`);
      return new Response(null,{status:204});
    });
    await expect(provider.revoke('external-1')).resolves.toBeUndefined();
  });
  it('fails configuration closed for cross-origin or noncanonical callback',()=>{
    expect(platformConfiguration({...env,LUNCHFLOW_REDIRECT_URI:'https://other.example/callback'})).toBeNull();
    expect(platformConfiguration({...env,LUNCHFLOW_CLIENT_SECRET:''})).toBeNull();
  });
});
