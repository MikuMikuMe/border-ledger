import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

describe('official AI provider migration',()=>{
  it('preserves existing keys and allows a separate DeepSeek key',()=>{
    const db=new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE ledgers(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO ledgers VALUES (\'l\'); INSERT INTO users VALUES (\'u\');');
      db.exec(readFileSync('worker/migrations/0030-ai-settings.sql','utf8'));
      db.exec("INSERT INTO ai_credentials VALUES ('l','u','openai','https://api.openai.com/v1/chat/completions','model','cipher','iv','rev')");
      db.exec(readFileSync('worker/migrations/0032-ai-official-providers.sql','utf8'));
      expect(db.prepare('SELECT provider,ciphertext,revision FROM ai_credentials').all()).toMatchObject([{provider:'openai',ciphertext:'cipher',revision:'rev'}]);
      db.exec("INSERT INTO ai_credentials VALUES ('l','u','deepseek','https://api.deepseek.com/chat/completions','model','cipher2','iv2','rev2')");
      expect(db.prepare('SELECT provider FROM ai_credentials ORDER BY provider').all()).toMatchObject([{provider:'deepseek'},{provider:'openai'}]);
    } finally {db.close();}
  });
});
