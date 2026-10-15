CREATE TABLE source_profiles (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  provider TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paused', 'unsupported')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, provider, source_kind)
);

CREATE TABLE source_profile_hints (
  id TEXT PRIMARY KEY,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  hint_kind TEXT NOT NULL,
  hint_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_profile_id, hint_kind, hint_value)
);

CREATE TABLE source_account_mappings (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  hint_kind TEXT NOT NULL DEFAULT 'none',
  hint_value TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'revoked')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, source_profile_id, hint_kind, hint_value, account_id)
);

CREATE TABLE mobile_devices (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('pairing', 'paired', 'paused', 'revoked')),
  paired_at TEXT,
  expires_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_pairings (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  device_verifier_hash TEXT NOT NULL,
  user_code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed', 'expired', 'revoked')),
  requested_scopes_json TEXT NOT NULL DEFAULT '["alerts:write"]',
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_verifier_hash),
  UNIQUE (user_code_hash)
);

CREATE TABLE capture_credentials (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type = 'capture'),
  scope TEXT NOT NULL CHECK (scope = 'alerts:write'),
  generation INTEGER NOT NULL CHECK (generation > 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (credential_hash)
);

CREATE TABLE device_source_scopes (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'paused', 'revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency),
  UNIQUE (device_id, source_profile_id, account_id, currency)
);

CREATE TABLE transaction_source_records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('plaid', 'statement', 'alert', 'manual', 'legacy')),
  identity_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_item_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  bank_source_id TEXT,
  bank_row_id TEXT,
  file_sha256 TEXT,
  row_index INTEGER,
  event_id TEXT,
  manual_id TEXT,
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, source_kind, identity_key),
  FOREIGN KEY (transaction_id, account_id) REFERENCES transactions(id, account_id) ON DELETE CASCADE,
  CHECK (
    (source_kind = 'plaid' AND provider_item_id IS NOT NULL AND (provider_transaction_id IS NOT NULL OR provider_pending_transaction_id IS NOT NULL)) OR
    (source_kind = 'statement' AND ((bank_source_id IS NOT NULL AND bank_row_id IS NOT NULL) OR (file_sha256 IS NOT NULL AND row_index IS NOT NULL))) OR
    (source_kind = 'alert' AND event_id IS NOT NULL) OR
    (source_kind = 'manual' AND manual_id IS NOT NULL) OR
    source_kind = 'legacy'
  )
);

CREATE INDEX transaction_source_records_transaction_idx ON transaction_source_records(transaction_id);
CREATE INDEX transaction_source_records_provider_idx ON transaction_source_records(provider_item_id, provider_transaction_id);
CREATE INDEX transaction_source_records_account_idx ON transaction_source_records(account_id, source_kind);
CREATE INDEX IF NOT EXISTS transactions_fingerprint_candidate_idx ON transactions(fingerprint);

INSERT OR IGNORE INTO transaction_source_records
  (id, ledger_id, source_kind, identity_key, transaction_id, account_id, provider_item_id, provider_transaction_id,
   provider_pending_transaction_id, content_digest)
  SELECT
    'source-record:' || t.id,
    'personal',
    CASE WHEN t.plaid_item_id IS NOT NULL AND (t.provider_transaction_id IS NOT NULL OR t.provider_pending_transaction_id IS NOT NULL) THEN 'plaid' ELSE 'legacy' END,
    CASE WHEN t.plaid_item_id IS NOT NULL AND (t.provider_transaction_id IS NOT NULL OR t.provider_pending_transaction_id IS NOT NULL)
      THEN 'plaid:' || t.plaid_item_id || ':' || COALESCE(t.provider_transaction_id, 'pending:' || t.provider_pending_transaction_id)
      ELSE 'legacy:' || t.id END,
    t.id,
    t.account_id,
    t.plaid_item_id,
    t.provider_transaction_id,
    t.provider_pending_transaction_id,
    'legacy:' || t.id
  FROM transactions t;

CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  event_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id),
  parser_version TEXT NOT NULL,
  notification_posted_at TEXT,
  captured_at TEXT NOT NULL,
  event_time_basis TEXT NOT NULL CHECK (event_time_basis IN ('notification_posted', 'bank_transaction_date', 'statement_posting_date', 'unresolved')),
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase_notice', 'authorization_reversal', 'declined', 'refund_notice', 'hold_notice', 'adjustment_notice', 'repayment_notice', 'transfer_notice', 'fee_notice', 'unknown')),
  direction TEXT NOT NULL CHECK (direction IN ('outflow', 'inflow', 'none', 'unknown')),
  instrument_hint_kind TEXT,
  instrument_hint_value TEXT,
  account_id TEXT REFERENCES accounts(id),
  event_money_currency TEXT REFERENCES currencies(code),
  event_money_amount_minor INTEGER,
  primary_money_role TEXT CHECK (primary_money_role IN ('transaction', 'authorization', 'billing', 'fee')),
  amounts_json TEXT NOT NULL DEFAULT '[]',
  fee_treatment TEXT NOT NULL DEFAULT 'unknown' CHECK (fee_treatment IN ('included', 'separate', 'unknown')),
  bank_reference TEXT,
  bank_displayed_time TEXT,
  bank_displayed_zone TEXT,
  bank_displayed_precision TEXT,
  bank_year_provenance TEXT,
  merchant TEXT,
  completeness_json TEXT NOT NULL DEFAULT '{}',
  payload_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = event_id),
  UNIQUE (ledger_id, event_id)
);

CREATE TABLE alert_event_digests (
  event_id TEXT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, algorithm)
);

CREATE TABLE alert_projections (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  event_id TEXT NOT NULL REFERENCES alert_events(id),
  transaction_id TEXT REFERENCES transactions(id),
  state TEXT NOT NULL CHECK (state IN ('provisional', 'non_spending', 'needs_review', 'voided', 'superseded')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  counted_currency TEXT REFERENCES currencies(code),
  counted_amount_minor INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id)
);

CREATE TABLE alert_projection_provenance (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  projection_id TEXT NOT NULL REFERENCES alert_projections(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('alert_event', 'statement', 'provider', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (projection_id, source_kind, source_id, revision)
);

CREATE TABLE alert_event_links (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  from_event_id TEXT NOT NULL REFERENCES alert_events(id),
  to_event_id TEXT REFERENCES alert_events(id),
  to_transaction_id TEXT REFERENCES transactions(id),
  relation TEXT NOT NULL CHECK (relation IN ('cancels', 'partially_reverses', 'replaces_authorization', 'refund_of', 'confirms', 'possible_duplicate')),
  allocated_currency TEXT REFERENCES currencies(code),
  allocated_amount_minor INTEGER,
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('bank_reference', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((to_event_id IS NOT NULL) != (to_transaction_id IS NOT NULL)),
  CHECK (to_event_id IS NULL OR from_event_id <> to_event_id),
  UNIQUE (ledger_id, from_event_id, to_event_id, to_transaction_id, relation, revision)
);

CREATE INDEX alert_event_links_target_event_idx ON alert_event_links(to_event_id, relation);
CREATE INDEX alert_event_links_target_transaction_idx ON alert_event_links(to_transaction_id, relation);
CREATE INDEX alert_events_effective_time_idx ON alert_events(notification_posted_at, event_id);
CREATE INDEX alert_projections_state_idx ON alert_projections(state, updated_at);

CREATE TABLE annotation_revisions (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  author_subject_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  category TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, revision)
);

CREATE TRIGGER alert_event_links_same_scope BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert link ledger mismatch') WHERE NEW.ledger_id <> 'personal' OR (NEW.to_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN alert_events target ON target.id = NEW.to_event_id WHERE source.id = NEW.from_event_id AND (source.ledger_id <> target.ledger_id OR (source.account_id IS NOT NULL AND target.account_id IS NOT NULL AND source.account_id <> target.account_id)))) OR (NEW.to_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN transactions target ON target.id = NEW.to_transaction_id WHERE source.id = NEW.from_event_id AND source.account_id IS NOT NULL AND source.account_id <> target.account_id)); END;
CREATE TRIGGER alert_event_links_no_cycle BEFORE INSERT ON alert_event_links WHEN NEW.to_event_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'alert event link cycle') WHERE EXISTS (WITH RECURSIVE reachable(id) AS (SELECT NEW.to_event_id UNION ALL SELECT l.to_event_id FROM alert_event_links l JOIN reachable r ON l.from_event_id = r.id WHERE l.to_event_id IS NOT NULL) SELECT 1 FROM reachable WHERE id = NEW.from_event_id); END;
CREATE TRIGGER alert_events_immutable_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
CREATE TRIGGER alert_events_immutable_delete BEFORE DELETE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
CREATE TRIGGER alert_event_digests_immutable_update BEFORE UPDATE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert event digests are immutable'); END;
CREATE TRIGGER alert_event_digests_immutable_delete BEFORE DELETE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert event digests are immutable'); END;
CREATE TRIGGER alert_event_links_immutable_update BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_event_links_immutable_delete BEFORE DELETE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_projection_provenance_immutable_update BEFORE UPDATE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER alert_projection_provenance_immutable_delete BEFORE DELETE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER annotation_revisions_immutable_update BEFORE UPDATE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
CREATE TRIGGER annotation_revisions_immutable_delete BEFORE DELETE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
