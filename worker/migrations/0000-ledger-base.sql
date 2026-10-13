CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'CNY')),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'CNY')),
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'needs_review')),
  source TEXT NOT NULL CHECK (source IN ('statement', 'plaid', 'alert', 'manual')),
  fingerprint TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE INDEX IF NOT EXISTS transactions_currency_idx ON transactions(currency);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_state (
  connection_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cursor TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
