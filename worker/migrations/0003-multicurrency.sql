-- D1/SQLite keeps FK enforcement enabled; this defers checks only inside the migration transaction.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledgers (id) VALUES ('personal');

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  minor_unit_digits INTEGER NOT NULL CHECK (minor_unit_digits BETWEEN 0 AND 3),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO currencies (code, minor_unit_digits, display_name) VALUES
  ('CAD', 2, 'Canadian dollar'),
  ('CNY', 2, 'Chinese yuan'),
  ('USD', 2, 'United States dollar'),
  ('HKD', 2, 'Hong Kong dollar');

CREATE TABLE accounts_v3 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  currency_mode TEXT NOT NULL DEFAULT 'single' CHECK (currency_mode IN ('single', 'multi')),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE account_currencies_v3 (
  account_id TEXT NOT NULL REFERENCES accounts_v3(id) ON DELETE CASCADE,
  currency TEXT NOT NULL REFERENCES currencies(code),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, currency)
);

CREATE TABLE transactions_v3 (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts_v3(id),
  date TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'needs_review')),
  source TEXT NOT NULL CHECK (source IN ('statement', 'plaid', 'alert', 'manual')),
  fingerprint TEXT NOT NULL,
  note TEXT,
  plaid_item_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, account_id),
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies_v3(account_id, currency)
);

CREATE TABLE plaid_items_v3 (
  item_id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plaid_accounts_v3 (
  plaid_account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items_v3(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts_v3(id),
  name TEXT NOT NULL,
  mask TEXT,
  subtype TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_streams_v3 (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items_v3(item_id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts_v3(id),
  merchant_name TEXT,
  merchant_entity_id TEXT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  source_status TEXT NOT NULL,
  source_frequency TEXT NOT NULL,
  frequency TEXT NOT NULL,
  is_outflow INTEGER NOT NULL CHECK (is_outflow IN (0, 1)),
  first_date TEXT,
  last_date TEXT,
  predicted_next_date TEXT,
  average_amount_minor INTEGER,
  last_amount_minor INTEGER,
  predicted_amount_minor INTEGER,
  source_updated_at TEXT,
  present_in_latest_snapshot INTEGER NOT NULL DEFAULT 1 CHECK (present_in_latest_snapshot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_id, stream_id)
);

CREATE TABLE recurring_stream_transactions_v3 (
  recurring_stream_id TEXT NOT NULL REFERENCES recurring_streams_v3(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES plaid_items_v3(item_id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  provider_pending_transaction_id TEXT,
  transaction_id TEXT REFERENCES transactions_v3(id),
  account_id TEXT NOT NULL REFERENCES accounts_v3(id),
  date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  is_outflow INTEGER NOT NULL CHECK (is_outflow IN (0, 1)),
  membership_id TEXT,
  present_in_latest_snapshot INTEGER NOT NULL DEFAULT 1 CHECK (present_in_latest_snapshot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recurring_stream_id, provider_transaction_id)
);

CREATE TABLE recurring_classifications_v3 (
  recurring_stream_id TEXT PRIMARY KEY REFERENCES recurring_streams_v3(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('unclassified', 'subscription', 'bill', 'other', 'excluded')),
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_sync_state_v3 (
  item_id TEXT PRIMARY KEY REFERENCES plaid_items_v3(item_id) ON DELETE CASCADE,
  history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
  requested_generation INTEGER NOT NULL DEFAULT 0,
  completed_generation INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  coverage_warnings TEXT NOT NULL DEFAULT '[]',
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'disconnecting', 'disconnected')),
  scope_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO accounts_v3 (id, name, institution, currency, currency_mode, kind, status, last_synced_at)
  SELECT id, name, institution, currency, 'single', kind, status, last_synced_at FROM accounts;

INSERT INTO account_currencies_v3 (account_id, currency)
  SELECT id, currency FROM accounts_v3;

INSERT INTO transactions_v3
  (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note,
   plaid_item_id, provider_transaction_id, provider_pending_transaction_id, created_at, updated_at)
  SELECT id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint, note,
    plaid_item_id, provider_transaction_id, provider_pending_transaction_id, created_at, updated_at
  FROM transactions;

INSERT INTO plaid_items_v3
  (item_id, access_token_ciphertext, access_token_iv, institution_id, institution_name, created_at, updated_at)
  SELECT item_id, access_token_ciphertext, access_token_iv, institution_id, institution_name, created_at, updated_at
  FROM plaid_items;

INSERT INTO plaid_accounts_v3
  (plaid_account_id, item_id, account_id, name, mask, subtype, created_at, updated_at)
  SELECT plaid_account_id, item_id, account_id, name, mask, subtype, created_at, updated_at
  FROM plaid_accounts;

INSERT INTO recurring_streams_v3
  (id, item_id, stream_id, account_id, merchant_name, merchant_entity_id, currency, source_status, source_frequency, frequency,
   is_outflow, first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor,
   source_updated_at, present_in_latest_snapshot, created_at, updated_at)
  SELECT id, item_id, stream_id, account_id, merchant_name, merchant_entity_id, currency, source_status, source_frequency, frequency,
    is_outflow, first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor,
    source_updated_at, present_in_latest_snapshot, created_at, updated_at
  FROM recurring_streams;

INSERT INTO recurring_stream_transactions_v3
  (recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id, date,
   amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at)
  SELECT recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id, date,
    amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at
  FROM recurring_stream_transactions;

INSERT INTO recurring_classifications_v3 (recurring_stream_id, classification, note, updated_at)
  SELECT recurring_stream_id, classification, note, updated_at FROM recurring_classifications;

INSERT INTO recurring_sync_state_v3
  (item_id, history_complete, requested_generation, completed_generation, source_updated_at, last_success_at, last_attempt_at,
   last_error, coverage_warnings, lifecycle, scope_version, updated_at)
  SELECT item_id, history_complete, requested_generation, completed_generation, source_updated_at, last_success_at, last_attempt_at,
    last_error, coverage_warnings, lifecycle, scope_version, updated_at
  FROM recurring_sync_state;

DROP TABLE recurring_sync_state;
DROP TABLE recurring_classifications;
DROP TABLE recurring_stream_transactions;
DROP TABLE recurring_streams;
DROP TABLE plaid_accounts;
DROP TABLE plaid_items;
DROP TABLE transactions;
DROP TABLE accounts;

ALTER TABLE accounts_v3 RENAME TO accounts;
ALTER TABLE account_currencies_v3 RENAME TO account_currencies;
ALTER TABLE transactions_v3 RENAME TO transactions;
ALTER TABLE plaid_items_v3 RENAME TO plaid_items;
ALTER TABLE plaid_accounts_v3 RENAME TO plaid_accounts;
ALTER TABLE recurring_streams_v3 RENAME TO recurring_streams;
ALTER TABLE recurring_stream_transactions_v3 RENAME TO recurring_stream_transactions;
ALTER TABLE recurring_classifications_v3 RENAME TO recurring_classifications;
ALTER TABLE recurring_sync_state_v3 RENAME TO recurring_sync_state;

CREATE INDEX transactions_date_idx ON transactions(date);
CREATE INDEX transactions_currency_idx ON transactions(currency);
CREATE INDEX transactions_status_idx ON transactions(status);
CREATE INDEX transactions_fingerprint_candidate_idx ON transactions(fingerprint);
CREATE UNIQUE INDEX transactions_plaid_item_current_id_idx
  ON transactions(plaid_item_id, provider_transaction_id)
  WHERE plaid_item_id IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE INDEX transactions_plaid_pending_id_idx
  ON transactions(plaid_item_id, provider_pending_transaction_id);
CREATE INDEX plaid_accounts_item_idx ON plaid_accounts(item_id);
CREATE INDEX plaid_accounts_account_idx ON plaid_accounts(account_id);
CREATE INDEX recurring_streams_account_date_idx
  ON recurring_streams(account_id, predicted_next_date, id);
CREATE INDEX recurring_stream_transactions_provider_idx
  ON recurring_stream_transactions(item_id, provider_transaction_id);
CREATE INDEX recurring_stream_transactions_date_idx
  ON recurring_stream_transactions(account_id, date, recurring_stream_id);
CREATE INDEX recurring_sync_state_stale_idx
  ON recurring_sync_state(last_success_at, lifecycle);

CREATE TRIGGER accounts_default_currency_insert AFTER INSERT ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (NEW.id, NEW.currency); END;

CREATE TRIGGER accounts_default_currency_update AFTER UPDATE OF currency ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (NEW.id, NEW.currency); END;
