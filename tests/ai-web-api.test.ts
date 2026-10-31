import {afterEach,describe,expect,it} from 'vitest';
import {VERIFIED_WEB_ENV,VERIFIED_WEB_HEADERS,provisionWebOwner} from './helpers/web-identity';
import {createD1Fixture,task24MigrationNames} from './helpers/d1';
import worker from '../worker/index';
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{while(fixtures.length) await fixtures.pop()!.dispose();});
describe('analysis web access',()=>{
  it('requires a ledger session and never returns a stored key',async()=>{
    const f=await createD1Fixture([...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql','0030-ai-settings.sql']);fixtures.push(f);await provisionWebOwner(f.db);
    const env={DB:f.db,...VERIFIED_WEB_ENV,AI_CREDENTIAL_ENCRYPTION_KEY:'ab'.repeat(32),LEDGER_APP_ORIGIN:'https://pf.example.com',ASSETS:{fetch:async()=>new Response('missing',{status:404})}};
    const root='https://pf.example.com/api/analysis';
    expect((await worker.fetch(new Request(root),env as never)).status).toBe(401);
    const headers={...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'};
    const save=await worker.fetch(new Request(root+'/configuration',{method:'PUT',headers,body:JSON.stringify({provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-private-key'})}),env as never);
    expect(save.status).toBe(200);
    const response=await worker.fetch(new Request(root,{headers:VERIFIED_WEB_HEADERS}),env as never);
    expect(response.status).toBe(200);expect(await response.text()).not.toContain('test-private-key');
    const csrf=await worker.fetch(new Request(root+'/sharing',{method:'PUT',headers:{...VERIFIED_WEB_HEADERS,origin:'https://evil.example','content-type':'application/json'},body:'{"enabled":true}'}),env as never);
    expect(csrf.status).toBe(403);
  },30000);
});
