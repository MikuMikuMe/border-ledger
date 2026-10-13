ALTER TABLE transactions ADD COLUMN plaid_item_id TEXT;
ALTER TABLE transactions ADD COLUMN provider_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN provider_pending_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_plaid_item_current_id_idx
  ON transactions(plaid_item_id, provider_transaction_id)
  WHERE plaid_item_id IS NOT NULL AND provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_plaid_pending_id_idx
  ON transactions(plaid_item_id, provider_pending_transaction_id);

CREATE TABLE IF NOT EXISTS recurring_streams (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  merchant_name TEXT,
  merchant_entity_id TEXT,
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'CNY')),
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

CREATE INDEX IF NOT EXISTS recurring_streams_account_date_idx
  ON recurring_streams(account_id, predicted_next_date, id);

CREATE TABLE IF NOT EXISTS recurring_stream_transactions (
  recurring_stream_id TEXT NOT NULL REFERENCES recurring_streams(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  provider_pending_transaction_id TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'CNY')),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  is_outflow INTEGER NOT NULL CHECK (is_outflow IN (0, 1)),
  membership_id TEXT,
  present_in_latest_snapshot INTEGER NOT NULL DEFAULT 1 CHECK (present_in_latest_snapshot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recurring_stream_id, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS recurring_stream_transactions_provider_idx
  ON recurring_stream_transactions(item_id, provider_transaction_id);

CREATE INDEX IF NOT EXISTS recurring_stream_transactions_date_idx
  ON recurring_stream_transactions(account_id, date, recurring_stream_id);

CREATE TABLE IF NOT EXISTS recurring_classifications (
  recurring_stream_id TEXT PRIMARY KEY REFERENCES recurring_streams(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('unclassified', 'subscription', 'bill', 'other', 'excluded')),
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recurring_sync_state (
  item_id TEXT PRIMARY KEY REFERENCES plaid_items(item_id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS recurring_sync_state_stale_idx
  ON recurring_sync_state(last_success_at, lifecycle);
