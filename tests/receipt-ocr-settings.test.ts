import {expect,it} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {readOcrConfiguration,saveOcrConfiguration} from '../worker/receipt-ocr-settings';

const context={userId:'owner',ledgerId:'personal'},secret='ab'.repeat(32);
it('rejects custom and mismatched provider endpoints when saving OCR settings',async()=>{
  const f=createSqliteD1Fixture();try {
    for(const endpoint of ['https://vision.vendor.com/v1/chat/completions','https://api.anthropic.com/v1/messages','https://api.openai.com/v1/chat/completions?key=abc']) {
      await expect(saveOcrConfiguration(f.db,context,{provider:'openai',endpoint,model:'vision-model',credential:'vision-secret'},secret)).rejects.toThrow();
    }
    expect(await readOcrConfiguration(f.db,context)).toBeNull();
  }finally{f.close();}
});
it('keeps the receipt OCR key encrypted and separate from spending analysis',async()=>{
  const f=createSqliteD1Fixture();try {
    await saveOcrConfiguration(f.db,context,{provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:'',credential:'ocr-secret'},secret);
    const configuration=await readOcrConfiguration(f.db,context);
    expect(configuration).toMatchObject({provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:''});
    expect(JSON.stringify(configuration)).not.toContain('ocr-secret');
    expect((await f.db.prepare('SELECT COUNT(*) AS n FROM ai_credentials').first<{n:number}>())?.n).toBe(0);
    const stored=await f.db.prepare('SELECT ciphertext FROM receipt_ocr_settings').first<{ciphertext:string}>();
    expect(stored?.ciphertext).not.toContain('ocr-secret');
  }finally{f.close();}
});
it('accepts official AI endpoints and rejects local network targets',async()=>{
  const f=createSqliteD1Fixture();try {
    await saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions',model:'vision-model',credential:'vision-secret'},secret);
    expect(await readOcrConfiguration(f.db,context)).toMatchObject({provider:'openai',model:'vision-model'});
    await expect(saveOcrConfiguration(f.db,context,{provider:'anthropic',endpoint:'http://127.0.0.1/v1/messages',model:'vision-model',credential:'vision-secret'},secret)).rejects.toThrow();
    await expect(saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:`https://vision.vendor.com/${'x'.repeat(2048)}`,model:'vision-model',credential:'vision-secret'},secret)).rejects.toThrow();
    await expect(saveOcrConfiguration(f.db,context,{provider:'openai',endpoint:'https://vision.vendor.com/vision%2Dsecret',model:'vision-model',credential:'vision-secret'},secret)).rejects.toThrow();
    expect(await readOcrConfiguration(f.db,context)).toMatchObject({provider:'openai'});
  }finally{f.close();}
});
it('does not reveal or replace another ledger’s OCR configuration',async()=>{
  const f=createSqliteD1Fixture();try {
    await f.db.prepare("INSERT INTO users(id,status) VALUES('other','active')").run();
    await f.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
    await saveOcrConfiguration(f.db,context,{provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:'',credential:'receipt-key'},secret);
    const other={userId:'other',ledgerId:'other-ledger'};
    expect(await readOcrConfiguration(f.db,other)).toBeNull();
    await expect(readOcrConfiguration(f.db,{userId:'other',ledgerId:'personal'})).rejects.toThrow();
    await expect(saveOcrConfiguration(f.db,{userId:'other',ledgerId:'personal'},{provider:'azure',endpoint:'https://receipts.cognitiveservices.azure.com',model:'',credential:'other-key'},secret)).rejects.toThrow();
    expect(await readOcrConfiguration(f.db,context)).toMatchObject({provider:'azure'});
  }finally{f.close();}
});
