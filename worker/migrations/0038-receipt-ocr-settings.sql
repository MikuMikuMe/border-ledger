CREATE TABLE receipt_ocr_settings (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('azure','openai','anthropic')),
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(ledger_id,user_id)
);
