import {afterEach,describe,expect,it} from 'vitest';
import {VERIFIED_WEB_ENV,VERIFIED_WEB_HEADERS,provisionWebOwner} from './helpers/web-identity';
import {createD1Fixture,task24MigrationNames} from './helpers/d1';
import worker from '../worker/index';
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{while(fixtures.length) await fixtures.pop()!.dispose();});
describe('budget web API',()=>{
  it('requires authentication and exposes settings and funding data',async()=>{
    const f=await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql']);fixtures.push(f);await provisionWebOwner(f.db);
    const env={DB:f.db,...VERIFIED_WEB_ENV,LEDGER_APP_ORIGIN:'https://pf.example.com',ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
    const root='https://pf.example.com/api/budget';
    expect((await worker.fetch(new Request(root),env as never)).status).toBe(401);
    const headers={...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'};
    for(const [path,body] of [['/settings',{currency:'CAD',startMonth:'2026-10'}],['/allocations',{month:'2026-10',category:'Food',assignedMinor:2500}],['/targets',{category:'Food',targetMinor:4000}],['/cash',{id:'wallet',name:'Wallet',currency:'CAD',amountMinor:10000}]] as const) {
      expect((await worker.fetch(new Request(root+path,{method:'PUT',headers,body:JSON.stringify(body)}),env as never)).status).toBe(200);
    }
    const response=await worker.fetch(new Request(root,{headers:VERIFIED_WEB_HEADERS}),env as never);
    expect(await response.json()).toMatchObject({settings:{currency:'CAD'},allocations:[{category:'Food',assignedMinor:2500}],targets:[{category:'Food',targetMinor:4000}],cash:[{id:'wallet',amountMinor:10000}]});
    const transfer=await worker.fetch(new Request(root+'/transfers',{method:'PUT',headers,body:JSON.stringify({id:'move-1',month:'2026-10',from:'Food',to:'Rent',amountMinor:500})}),env as never);
    expect(transfer.status).toBe(200);
    const view=await worker.fetch(new Request(`${root}/view?month=2026-10`,{headers:VERIFIED_WEB_HEADERS}),env as never);
    expect(await view.json()).toMatchObject({summary:{cashMinor:10000,categories:[{category:'Food',availableMinor:2000,targetMinor:4000},{category:'Rent',availableMinor:500}]}});
    const remove=await worker.fetch(new Request(`${root}/cash/wallet`,{method:'DELETE',headers}),env as never);
    expect(remove.status).toBe(200);
    const after=await worker.fetch(new Request(root,{headers:VERIFIED_WEB_HEADERS}),env as never);
    expect(await after.json()).toMatchObject({cash:[]});
  },30000);
});
