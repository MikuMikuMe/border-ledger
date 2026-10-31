import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {handleAiApi} from '../worker/ai-http';
const context={userId:'owner',ledgerId:'personal'},env={secret:'ab'.repeat(32),origin:'https://ledger.example'};
function req(path:string,method='GET',body?:unknown) {return new Request('https://ledger.example/api/analysis'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});}
describe('AI API',()=>{
  it('manages credentials without exposing them and requires an explicit preview',async()=>{
    const f=createSqliteD1Fixture();try {
      const save=await handleAiApi(req('/configuration','PUT',{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'private-key'}),{db:f.db,context,root:'/api/analysis',env});
      expect(save?.status).toBe(200);
      const list=await handleAiApi(req(''),{db:f.db,context,root:'/api/analysis',env});
      expect(await list?.text()).not.toContain('private-key');
      const preview=await handleAiApi(req('/preview','POST',{provider:'openai',from:'2026-10-01',to:'2026-10-31',detail:false,mode:'ledger'}),{db:f.db,context,root:'/api/analysis',env});
      expect(await preview?.json()).toMatchObject({provider:'openai',model:'test',detail:false,configurationRevision:expect.any(String)});
      const remove=await handleAiApi(req('/configuration/openai','DELETE'),{db:f.db,context,root:'/api/analysis',env});
      expect(remove?.status).toBe(200);
    }finally{f.close();}
  });
});
