import {describe,expect,it} from 'vitest';
import {createLunchFlowProvider,parseLunchFlowBalance} from '../worker/lunchflow';
import {createLunchFlowPlatform} from '../worker/lunchflow-platform';
const env={LUNCHFLOW_CLIENT_ID:'client',LUNCHFLOW_CLIENT_SECRET:'secret',LUNCHFLOW_REDIRECT_URI:'https://ledger.example/api/lunchflow/oauth/callback',LEDGER_APP_ORIGIN:'https://ledger.example'};
describe('Lunch Flow balances',()=>{
  it('reads normalized amounts and currencies in integer minor units',()=>{
    expect(parseLunchFlowBalance({balance:{amount:123.45,currency:'CAD'}})).toEqual({currency:'CAD',amountMinor:12345});
    expect(parseLunchFlowBalance({balance:{amount:-12.34,currency:'CNY'}})).toEqual({currency:'CNY',amountMinor:-1234});
    expect(()=>parseLunchFlowBalance({balance:{amount:1.234,currency:'CAD'}})).toThrow();
    expect(()=>parseLunchFlowBalance({balance:{amount:null,currency:'CAD'}})).toThrow();
    expect(()=>parseLunchFlowBalance({balance:{amount:1,currency:'XXX'}})).toThrow();
  });
  it('requests Personal and Platform balances with their respective credentials',async()=>{
    const fetcher:typeof fetch=async(input,init)=>{
      const request=new Request(input,init);
      expect(request.redirect).toBe('manual');
      expect(request.url).toMatch(/\/accounts\/42\/balance$/);
      expect(request.headers.get('x-api-key') || request.headers.get('authorization')).toMatch(/test/);
      return Response.json({balance:{amount:12.34,currency:'CAD'}});
    };
    expect(await createLunchFlowProvider({LUNCHFLOW_API_KEY:'test-key'},fetcher).getBalance('42')).toEqual({currency:'CAD',amountMinor:1234});
    expect(await createLunchFlowPlatform(env,fetcher).getBalance('test-access','42')).toEqual({currency:'CAD',amountMinor:1234});
  });
});
