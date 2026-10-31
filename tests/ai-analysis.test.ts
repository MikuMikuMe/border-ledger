import {describe,expect,it,vi} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {saveAiConfiguration,setAiSharing,removeAiConfiguration} from '../worker/ai-store';
import {previewAiAnalysis,runAiAnalysis} from '../worker/ai-analysis';
import {configureBudget,setBudgetAllocation} from '../worker/budget-store';
const context={userId:'owner',ledgerId:'personal'}, secret='ab'.repeat(32),origin='https://ledger.example';
describe('analysis consent',()=>{
  it('requires matching preview, honors the sharing switch and sends only on request',async()=>{
    const f=createSqliteD1Fixture();try {
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
      const selection={provider:'openai' as const,from:'2026-10-01',to:'2026-10-31',detail:false,mode:'ledger' as const};
      const preview=await previewAiAnalysis(f.db,context,selection);
      const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'advice'}}]}));
      expect(fetcher).not.toHaveBeenCalled();
      expect(await runAiAnalysis(f.db,context,{...selection,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher})).toBe('advice');
      await expect(runAiAnalysis(f.db,context,{...selection,detail:true,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher})).rejects.toThrow();
      await setAiSharing(f.db,context,true);
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test2',credential:'replacement'},{secret,appOrigin:origin});
      await expect(runAiAnalysis(f.db,context,{...selection,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher})).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }finally{f.close();}
  });
  it('keeps transaction identifiers out of aggregate budget previews',async()=>{
    const f=createSqliteD1Fixture();try {
      await configureBudget(f.db,context,'CAD','2026-10');
      await setBudgetAllocation(f.db,context,{month:'2026-10',category:'Food',assignedMinor:100});
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
      const preview=await previewAiAnalysis(f.db,context,{provider:'openai',from:'2026-10-01',to:'2026-10-31',detail:false,mode:'budget'});
      expect(JSON.stringify(preview)).not.toContain('missingTransactionIds');
      expect(JSON.stringify(preview)).toContain('missingRateCount');
    }finally{f.close();}
  });
  it('rejects a stale preview after a provider is removed and recreated',async()=>{
    const f=createSqliteD1Fixture();try {
      const original={provider:'openai' as const,endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'};
      await saveAiConfiguration(f.db,context,original,{secret,appOrigin:origin});
      const selection={provider:'openai' as const,from:'2026-10-01',to:'2026-10-31',detail:false,mode:'ledger' as const};
      const preview=await previewAiAnalysis(f.db,context,selection);
      await removeAiConfiguration(f.db,context,'openai');
      await saveAiConfiguration(f.db,context,{...original,endpoint:'https://other.example.com/v1/chat/completions'},{secret,appOrigin:origin,allowedHosts:'other.example.com'});
      const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'advice'}}]}));
      await expect(runAiAnalysis(f.db,context,{...selection,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher})).rejects.toThrow('settings changed');
      expect(fetcher).not.toHaveBeenCalled();
    }finally{f.close();}
  });
  it('sends transaction details only after sharing is enabled and explicitly selected',async()=>{
    const f=createSqliteD1Fixture();try {
      await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      await f.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id,note) VALUES('tx','acct','2026-10-05','Private Merchant',-500,'CAD','Food','expense','confirmed','manual','fp','personal','Private Note')").run();
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin});
      const selection={provider:'openai' as const,from:'2026-10-01',to:'2026-10-31',detail:false,mode:'ledger' as const};
      const sent:string[]=[];const fetcher:typeof fetch=async(_url,init)=>{sent.push(String(init?.body));return Response.json({choices:[{message:{content:'advice'}}]});};
      const aggregate=await previewAiAnalysis(f.db,context,selection);
      await runAiAnalysis(f.db,context,{...selection,configurationRevision:aggregate.configurationRevision,confirmed:true},{secret,origin,fetcher});
      expect(sent[0]).not.toContain('Private Merchant');expect(sent[0]).not.toContain('Private Note');
      await setAiSharing(f.db,context,true);
      const detailed={...selection,detail:true};const preview=await previewAiAnalysis(f.db,context,detailed);
      await runAiAnalysis(f.db,context,{...detailed,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher});
      expect(sent[1]).toContain('Private Merchant');expect(sent[1]).toContain('Private Note');
    }finally{f.close();}
  });
  it('rechecks an approved custom host at send time',async()=>{
    const f=createSqliteD1Fixture();try {
      await saveAiConfiguration(f.db,context,{provider:'openai',endpoint:'https://custom.example.com/v1/chat/completions',model:'test',credential:'test-key'},{secret,appOrigin:origin,allowedHosts:'custom.example.com'});
      const selection={provider:'openai' as const,from:'2026-10-01',to:'2026-10-31',detail:false,mode:'ledger' as const};
      const preview=await previewAiAnalysis(f.db,context,selection);
      const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'advice'}}]}));
      await expect(runAiAnalysis(f.db,context,{...selection,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,fetcher})).rejects.toThrow('not approved');
      expect(fetcher).not.toHaveBeenCalled();
      expect(await runAiAnalysis(f.db,context,{...selection,configurationRevision:preview.configurationRevision,confirmed:true},{secret,origin,allowedHosts:'custom.example.com',fetcher})).toBe('advice');
    }finally{f.close();}
  });
});
