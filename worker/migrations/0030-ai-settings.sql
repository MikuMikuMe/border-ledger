CREATE TABLE ai_credentials (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic')),
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(ledger_id,user_id,provider)
);
CREATE TABLE ai_sharing_settings (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  detailed_transactions INTEGER NOT NULL DEFAULT 0 CHECK(detailed_transactions IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ledger_id,user_id)
);
