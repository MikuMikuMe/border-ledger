CREATE TABLE mobile_connections (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'plaid'),
  item_id TEXT,
  institution_name TEXT,
  mode TEXT NOT NULL DEFAULT 'create' CHECK (mode IN ('create', 'update')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'connected', 'syncing', 'canceled', 'failed', 'disconnecting')),
  expires_at TEXT,
  cleanup_state TEXT NOT NULL DEFAULT 'not_required' CHECK (cleanup_state IN ('not_required', 'pending', 'succeeded', 'uncertain')),
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  selected_account_ids_json TEXT NOT NULL DEFAULT '[]',
  pending_access_token_ciphertext TEXT,
  pending_access_token_iv TEXT,
  provider_accounts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX mobile_connections_owner_idx ON mobile_connections(ledger_id, owner_subject_hash, state, updated_at);
CREATE INDEX mobile_connections_expiry_idx ON mobile_connections(state, expires_at, cleanup_state);

CREATE TABLE mobile_connection_operations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  connection_id TEXT,
  state TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, owner_subject_hash, operation_kind, idempotency_key)
);

CREATE INDEX mobile_connection_operations_connection_idx ON mobile_connection_operations(connection_id, created_at);
