CREATE TABLE ai_credentials_official (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic','deepseek')),
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(ledger_id,user_id,provider)
);
INSERT INTO ai_credentials_official SELECT ledger_id,user_id,provider,endpoint,model,ciphertext,iv,revision FROM ai_credentials;
DROP TABLE ai_credentials;
ALTER TABLE ai_credentials_official RENAME TO ai_credentials;
