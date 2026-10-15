CREATE TABLE mobile_auth_requests (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  state_hash TEXT NOT NULL,
  pkce_challenge_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (state_hash)
);

CREATE TABLE owner_session_families (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  subject_hash TEXT NOT NULL,
  access_generation INTEGER NOT NULL DEFAULT 1 CHECK (access_generation > 0),
  refresh_generation INTEGER NOT NULL DEFAULT 1 CHECK (refresh_generation > 0),
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  stay_signed_in_until TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE owner_refresh_generations (
  family_id TEXT NOT NULL REFERENCES owner_session_families(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  token_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (family_id, generation),
  UNIQUE (token_hash)
);

CREATE TABLE owner_replay_records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  request_kind TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_ciphertext TEXT NOT NULL,
  response_iv TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 60 CHECK (ttl_seconds BETWEEN 1 AND 60),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, request_kind, request_digest)
);

CREATE INDEX owner_replay_records_expiry_idx ON owner_replay_records(expires_at);
CREATE INDEX owner_session_families_expiry_idx ON owner_session_families(access_expires_at, refresh_expires_at, revoked_at);

CREATE TABLE import_previews (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  preview_digest TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'ready', 'publishing', 'published', 'cancelled', 'expired')),
  operation_id TEXT,
  expires_at TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_chunks (
  preview_id TEXT NOT NULL REFERENCES import_previews(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  operation_id TEXT NOT NULL,
  chunk_digest TEXT NOT NULL,
  row_start INTEGER NOT NULL CHECK (row_start >= 0),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  PRIMARY KEY (preview_id, chunk_index),
  UNIQUE (preview_id, chunk_digest)
);

CREATE INDEX import_previews_expiry_idx ON import_previews(expires_at, status);
CREATE INDEX import_chunks_operation_idx ON import_chunks(preview_id, operation_id, chunk_index);

CREATE TABLE ledger_preferences (
  ledger_id TEXT PRIMARY KEY REFERENCES ledgers(id),
  reporting_timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
  preferred_currency TEXT REFERENCES currencies(code),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledger_preferences (ledger_id, reporting_timezone, week_start, revision)
  VALUES ('personal', 'America/Toronto', 1, 0);
