import { afterEach,expect,it,vi } from 'vitest';
import worker from '../worker/index';
import { scheduleLunchFlow } from '../worker/lunchflow-jobs';
import { setup,connect,SECOND_LEDGER,token } from './helpers/lunchflow-platform';
import { createLunchFlowService } from '../worker/lunchflow-service';
afterEach(()=>vi.restoreAllMocks());
async function jobFixture(){
 const f=await setup(async(_input,init)=>init?.method==='DELETE'?new Response(null,{status:204}):Response.json(token));
 const id=await connect(f),messages:unknown[]=[],env={...f.env,LUNCHFLOW_API_KEY:'owner-key-never-platform',ASSETS:{fetch:async()=>new Response('asset')},SYNC_QUEUE:{send:async(message:unknown)=>{messages.push(message);}}};
 const provider={listAccounts:async()=>[{id:'1',bankConnectionId:'9',name:'Bank',institutionName:'Bank',currency:'CAD',status:'ACTIVE'}],listTransactions:async()=>[]};
 await createLunchFlowService(env,SECOND_LEDGER,provider,id).selectAccounts({accounts:[{providerAccountId:'1',currency:'CAD',kind:'chequing'}]});
 return {...f,id,env,messages,body:messages[0] as Record<string,unknown>};
}
function providerFetch(){return vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
 const request=new Request(input,init);expect(request.headers.get('authorization')).toBe('Bearer test-access');expect(request.headers.has('x-api-key')).toBe(false);
 if(new URL(request.url).pathname.endsWith('/balance'))return Response.json({balance:{amount:42.50,currency:'CAD'}});
 if(new URL(request.url).pathname.endsWith('/accounts'))return Response.json({accounts:[{id:1,connection_id:9,name:'Bank',institution_name:'Bank',institution_logo:null,provider:'test',currency:'CAD',status:'ACTIVE'}],total:1});
 return Response.json({transactions:[{id:'same-tx',accountId:1,amount:-1,currency:'CAD',date:'2026-10-24',merchant:'Cafe',description:'purchase',isPending:false}],total:1});
});}
async function deliver(f:Awaited<ReturnType<typeof jobFixture>>,body:unknown){
 const outcome={acked:0,retried:0};await worker.queue({messages:[{body,ack:()=>{outcome.acked++;},retry:()=>{outcome.retried++;}}]},f.env);return outcome;
}
it('executes a bound Platform job using its own Bearer and never an owner Personal key',async()=>{
 const f=await jobFixture();try{
  const fetcher=providerFetch();expect(await deliver(f,f.body)).toEqual({acked:1,retried:0});expect(fetcher).toHaveBeenCalledTimes(3);
  expect(await f.db.prepare("SELECT amount_minor FROM lunchflow_account_balances WHERE ledger_id='second-ledger'").first()).toEqual({amount_minor:4250});
  expect(await f.db.prepare("SELECT COUNT(*) n FROM transactions WHERE ledger_id='second-ledger' AND source='lunchflow'").first()).toEqual({n:1});
 }finally{f.close();}
});
it('acknowledges forged, old and disconnected jobs without provider reads',async()=>{
 const f=await jobFixture();try{
  const fetcher=providerFetch(),{connectionId:_,generation:__,...legacy}=f.body;
  for(const body of [legacy,{...f.body,generation:1},{...f.body,userId:'owner',ledgerId:'personal'},{...f.body,connectionId:'absent'}])expect(await deliver(f,body)).toEqual({acked:1,retried:0});
  await f.connections.disconnect(SECOND_LEDGER,f.id,(await f.connections.status(SECOND_LEDGER)).generation!);expect(await deliver(f,f.body)).toEqual({acked:1,retried:0});expect(fetcher).not.toHaveBeenCalled();
 }finally{f.close();}
});
it('retries a busy connection and schedules only active connection generations',async()=>{
 const f=await jobFixture();try{
  const fetcher=providerFetch();vi.spyOn(console,'error').mockImplementation(()=>{});
  await f.db.prepare("UPDATE lunchflow_connections SET operation_id='busy',operation_kind='refresh',operation_expires_at='2099-01-01' WHERE id=?").bind(f.id).run();
  expect(await deliver(f,f.body)).toEqual({acked:0,retried:1});expect(fetcher).not.toHaveBeenCalled();
  await f.db.prepare('UPDATE lunchflow_connections SET operation_id=NULL,operation_kind=NULL,operation_expires_at=NULL WHERE id=?').bind(f.id).run();
  f.messages.length=0;await scheduleLunchFlow(f.env);expect(f.messages).toEqual([{...f.body,jobId:expect.any(String)}]);
  expect((f.messages[0] as {jobId:string}).jobId).not.toBe(f.body.jobId);
  await f.connections.disconnect(SECOND_LEDGER,f.id,(await f.connections.status(SECOND_LEDGER)).generation!);f.messages.length=0;await scheduleLunchFlow(f.env);expect(f.messages).toEqual([]);
 }finally{f.close();}
});
