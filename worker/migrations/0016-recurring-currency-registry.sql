-- Rebuild recurring storage after the complete currency registry is present.
-- This keeps source IDs, Plaid item links, provider stream IDs, and local revisions intact.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE recurring_streams_v16 (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
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

CREATE TABLE recurring_stream_transactions_v16 (
  recurring_stream_id TEXT NOT NULL REFERENCES recurring_streams_v16(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  provider_pending_transaction_id TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
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

CREATE TABLE recurring_classifications_v16 (
  recurring_stream_id TEXT PRIMARY KEY REFERENCES recurring_streams_v16(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('unclassified', 'subscription', 'bill', 'other', 'excluded')),
  note TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO recurring_streams_v16
  (id, item_id, stream_id, account_id, merchant_name, merchant_entity_id, currency, source_status, source_frequency, frequency,
   is_outflow, first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor,
   source_updated_at, present_in_latest_snapshot, created_at, updated_at)
SELECT id, item_id, stream_id, account_id, merchant_name, merchant_entity_id, currency, source_status, source_frequency, frequency,
  is_outflow, first_date, last_date, predicted_next_date, average_amount_minor, last_amount_minor, predicted_amount_minor,
  source_updated_at, present_in_latest_snapshot, created_at, updated_at
FROM recurring_streams;

INSERT INTO recurring_stream_transactions_v16
  (recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id, date,
   amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at)
SELECT recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id, date,
  amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at
FROM recurring_stream_transactions;

INSERT INTO recurring_classifications_v16
  (recurring_stream_id, classification, note, revision, updated_at)
SELECT recurring_stream_id, classification, note, revision, updated_at
FROM recurring_classifications;

DROP TABLE recurring_stream_transactions;
DROP TABLE recurring_classifications;
DROP TABLE recurring_streams;

ALTER TABLE recurring_streams_v16 RENAME TO recurring_streams;
ALTER TABLE recurring_stream_transactions_v16 RENAME TO recurring_stream_transactions;
ALTER TABLE recurring_classifications_v16 RENAME TO recurring_classifications;

CREATE INDEX recurring_streams_account_date_idx
  ON recurring_streams(account_id, predicted_next_date, id);

CREATE INDEX recurring_stream_transactions_provider_idx
  ON recurring_stream_transactions(item_id, provider_transaction_id);

CREATE INDEX recurring_stream_transactions_date_idx
  ON recurring_stream_transactions(account_id, date, recurring_stream_id);
