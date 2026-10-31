import {describe,expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {saveAiConfiguration,listAiConfigurations,removeAiConfiguration,readAiSharing,setAiSharing} from '../worker/ai-store';
const owner={userId:'owner',ledgerId:'personal'};
const secret='ab'.repeat(32);
describe('AI settings',()=>{
  it('stores encrypted credentials per ledger and exposes only configuration metadata',async()=>{
    const f=createSqliteD1Fixture();try {
      await f.db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
      await f.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
      await saveAiConfiguration(f.db,owner,{provider:'openai',model:'test',endpoint:'https://api.openai.com/v1/chat/completions',credential:'private-key'},{secret,appOrigin:'https://ledger.example'});
      const stored=await f.db.prepare('SELECT * FROM ai_credentials').all();
      expect(JSON.stringify(stored)).not.toContain('private-key');
      expect(JSON.stringify(await listAiConfigurations(f.db,owner))).not.toContain('ciphertext');
      expect(await listAiConfigurations(f.db,{userId:'other',ledgerId:'other-ledger'})).toEqual([]);
      expect(await readAiSharing(f.db,owner)).toBe(false);
      await setAiSharing(f.db,owner,true);expect(await readAiSharing(f.db,owner)).toBe(true);
      await removeAiConfiguration(f.db,owner,'openai');expect(await listAiConfigurations(f.db,owner)).toEqual([]);
    } finally {f.close();}
  });
  it('rejects provider keys hidden in endpoint paths or model metadata',async()=>{
    const f=createSqliteD1Fixture();try {
      const base={provider:'openai' as const,model:'test',endpoint:'https://api.openai.com/v1/sk%2Dsecret',credential:'sk-secret'};
      await expect(saveAiConfiguration(f.db,owner,base,{secret,appOrigin:'https://ledger.example'})).rejects.toThrow();
      await expect(saveAiConfiguration(f.db,owner,{...base,endpoint:'https://api.openai.com/v1/chat/completions',model:'sk-secret'},{secret,appOrigin:'https://ledger.example'})).rejects.toThrow();
      expect(await listAiConfigurations(f.db,owner)).toEqual([]);
    }finally{f.close();}
  });
});
