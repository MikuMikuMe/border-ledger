CREATE TABLE IF NOT EXISTS plaid_items (
  item_id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plaid_accounts (
  plaid_account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  mask TEXT,
  subtype TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS plaid_accounts_item_idx ON plaid_accounts(item_id);
CREATE INDEX IF NOT EXISTS plaid_accounts_account_idx ON plaid_accounts(account_id);
