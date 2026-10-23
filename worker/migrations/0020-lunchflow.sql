-- Add Lunch Flow as a first-class source while retaining every existing row and
-- every foreign-key dependency that points at transactions or source records.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE transactions_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  fx_lock_date TEXT,
  merchant TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'needs_review')),
  source TEXT NOT NULL CHECK (source IN ('statement', 'plaid', 'alert', 'manual', 'lunchflow')),
  fingerprint TEXT NOT NULL,
  note TEXT,
  plaid_item_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, account_id),
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency)
);

CREATE TABLE transaction_source_records_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('plaid', 'statement', 'alert', 'manual', 'legacy', 'lunchflow')),
  identity_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_item_id TEXT,
  provider_account_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  bank_source_id TEXT,
  bank_row_id TEXT,
  file_sha256 TEXT,
  row_index INTEGER,
  event_id TEXT,
  manual_id TEXT,
  bank_reference TEXT,
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, source_kind, identity_key),
  FOREIGN KEY (transaction_id, account_id) REFERENCES transactions_lunchflow_v20(id, account_id) ON DELETE CASCADE,
  CHECK (
    (source_kind = 'plaid' AND provider_item_id IS NOT NULL AND (provider_transaction_id IS NOT NULL OR provider_pending_transaction_id IS NOT NULL)) OR
    (source_kind = 'statement' AND ((bank_source_id IS NOT NULL AND bank_row_id IS NOT NULL) OR (file_sha256 IS NOT NULL AND row_index IS NOT NULL))) OR
    (source_kind = 'alert' AND event_id IS NOT NULL) OR
    (source_kind = 'manual' AND manual_id IS NOT NULL) OR
    (source_kind = 'lunchflow' AND provider_account_id IS NOT NULL AND provider_transaction_id IS NOT NULL AND provider_item_id IS NULL) OR
    source_kind = 'legacy'
  )
);

CREATE TABLE recurring_stream_transactions_lunchflow_v20 (
  recurring_stream_id TEXT NOT NULL REFERENCES recurring_streams(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  provider_pending_transaction_id TEXT,
  transaction_id TEXT REFERENCES transactions_lunchflow_v20(id),
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

CREATE TABLE statement_reconciliation_candidates_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_record_id TEXT NOT NULL REFERENCES transaction_source_records_lunchflow_v20(id) ON DELETE CASCADE,
  statement_transaction_id TEXT NOT NULL REFERENCES transactions_lunchflow_v20(id) ON DELETE CASCADE,
  candidate_transaction_id TEXT NOT NULL REFERENCES transactions_lunchflow_v20(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('candidate_rank', 'bank_reference', 'user_review')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_record_id, candidate_transaction_id)
);

CREATE TABLE alert_projections_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  event_id TEXT NOT NULL REFERENCES alert_events(id),
  transaction_id TEXT REFERENCES transactions_lunchflow_v20(id),
  state TEXT NOT NULL CHECK (state IN ('provisional', 'non_spending', 'needs_review', 'voided', 'superseded')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  counted_currency TEXT REFERENCES currencies(code),
  counted_amount_minor INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id)
);

CREATE TABLE alert_projection_provenance_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  projection_id TEXT NOT NULL REFERENCES alert_projections_lunchflow_v20(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('alert_event', 'statement', 'provider', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (projection_id, source_kind, source_id, revision)
);

CREATE TABLE alert_event_links_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  from_event_id TEXT NOT NULL REFERENCES alert_events(id),
  to_event_id TEXT REFERENCES alert_events(id),
  to_transaction_id TEXT REFERENCES transactions_lunchflow_v20(id),
  relation TEXT NOT NULL CHECK (relation IN ('cancels', 'partially_reverses', 'replaces_authorization', 'confirms', 'possible_duplicate', 'refund_of')),
  allocated_currency TEXT REFERENCES currencies(code),
  allocated_amount_minor INTEGER,
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('bank_reference', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((to_event_id IS NOT NULL) != (to_transaction_id IS NOT NULL)),
  CHECK (to_event_id IS NULL OR from_event_id <> to_event_id),
  UNIQUE (ledger_id, from_event_id, to_event_id, to_transaction_id, relation, revision)
);

CREATE TABLE annotation_revisions_lunchflow_v20 (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  transaction_id TEXT NOT NULL REFERENCES transactions_lunchflow_v20(id),
  author_subject_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  category TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, revision)
);

INSERT INTO transactions_lunchflow_v20
  (id, account_id, date, fx_lock_date, merchant, amount_minor, currency, category, kind, status, source,
   fingerprint, note, plaid_item_id, provider_transaction_id, provider_pending_transaction_id, created_at, updated_at)
SELECT id, account_id, date, fx_lock_date, merchant, amount_minor, currency, category, kind, status, source,
  fingerprint, note, plaid_item_id, provider_transaction_id, provider_pending_transaction_id, created_at, updated_at
FROM transactions;

INSERT INTO transaction_source_records_lunchflow_v20
  (id, ledger_id, source_kind, identity_key, transaction_id, account_id, provider_item_id, provider_account_id,
   provider_transaction_id, provider_pending_transaction_id, bank_source_id, bank_row_id, file_sha256, row_index,
   event_id, manual_id, bank_reference, content_digest, created_at)
SELECT id, ledger_id, source_kind, identity_key, transaction_id, account_id, provider_item_id, NULL,
  provider_transaction_id, provider_pending_transaction_id, bank_source_id, bank_row_id, file_sha256, row_index,
  event_id, manual_id, bank_reference, content_digest, created_at
FROM transaction_source_records;

INSERT INTO recurring_stream_transactions_lunchflow_v20
  (recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id,
   date, amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at)
SELECT recurring_stream_id, item_id, provider_transaction_id, provider_pending_transaction_id, transaction_id, account_id,
  date, amount_minor, currency, kind, is_outflow, membership_id, present_in_latest_snapshot, created_at, updated_at
FROM recurring_stream_transactions;

INSERT INTO statement_reconciliation_candidates_lunchflow_v20
  (id, ledger_id, source_record_id, statement_transaction_id, candidate_transaction_id, score, reason_codes_json,
   evidence_basis, status, created_at, updated_at)
SELECT id, ledger_id, source_record_id, statement_transaction_id, candidate_transaction_id, score, reason_codes_json,
  evidence_basis, status, created_at, updated_at
FROM statement_reconciliation_candidates;

INSERT INTO alert_projections_lunchflow_v20
  (id, ledger_id, event_id, transaction_id, state, reason_codes_json, counted_currency, counted_amount_minor,
   revision, created_at, updated_at)
SELECT id, ledger_id, event_id, transaction_id, state, reason_codes_json, counted_currency, counted_amount_minor,
  revision, created_at, updated_at
FROM alert_projections;

INSERT INTO alert_projection_provenance_lunchflow_v20
  (id, ledger_id, projection_id, source_kind, source_id, basis, revision, created_at)
SELECT id, ledger_id, projection_id, source_kind, source_id, basis, revision, created_at
FROM alert_projection_provenance;

INSERT INTO alert_event_links_lunchflow_v20
  (id, ledger_id, from_event_id, to_event_id, to_transaction_id, relation, allocated_currency, allocated_amount_minor,
   evidence_basis, revision, created_at)
SELECT id, ledger_id, from_event_id, to_event_id, to_transaction_id, relation, allocated_currency, allocated_amount_minor,
  evidence_basis, revision, created_at
FROM alert_event_links;

INSERT INTO annotation_revisions_lunchflow_v20
  (id, ledger_id, transaction_id, author_subject_hash, revision, category, note, created_at)
SELECT id, ledger_id, transaction_id, author_subject_hash, revision, category, note, created_at
FROM annotation_revisions;

DROP TRIGGER IF EXISTS transactions_fx_lock_date_insert;
DROP TRIGGER IF EXISTS transactions_fx_lock_date_default;
DROP TRIGGER IF EXISTS transactions_fx_lock_date_immutable;
DROP TRIGGER IF EXISTS alert_event_links_same_scope;
DROP TRIGGER IF EXISTS alert_event_links_no_cycle;
DROP TRIGGER IF EXISTS alert_event_links_immutable_update;
DROP TRIGGER IF EXISTS alert_event_links_immutable_delete;
DROP TRIGGER IF EXISTS alert_projection_provenance_immutable_update;
DROP TRIGGER IF EXISTS alert_projection_provenance_immutable_delete;
DROP TRIGGER IF EXISTS annotation_revisions_immutable_update;
DROP TRIGGER IF EXISTS annotation_revisions_immutable_delete;

DROP INDEX IF EXISTS transactions_date_idx;
DROP INDEX IF EXISTS transactions_currency_idx;
DROP INDEX IF EXISTS transactions_status_idx;
DROP INDEX IF EXISTS transactions_fingerprint_candidate_idx;
DROP INDEX IF EXISTS transactions_plaid_item_current_id_idx;
DROP INDEX IF EXISTS transactions_plaid_pending_id_idx;
DROP INDEX IF EXISTS transaction_source_records_transaction_idx;
DROP INDEX IF EXISTS transaction_source_records_provider_idx;
DROP INDEX IF EXISTS transaction_source_records_account_idx;
DROP INDEX IF EXISTS recurring_stream_transactions_provider_idx;
DROP INDEX IF EXISTS recurring_stream_transactions_date_idx;
DROP INDEX IF EXISTS statement_reconciliation_candidates_statement_idx;
DROP INDEX IF EXISTS statement_reconciliation_candidates_candidate_idx;
DROP INDEX IF EXISTS alert_projections_state_idx;
DROP INDEX IF EXISTS alert_event_links_target_event_idx;
DROP INDEX IF EXISTS alert_event_links_target_transaction_idx;
DROP INDEX IF EXISTS alert_event_links_confirms_target_idx;
DROP INDEX IF EXISTS alert_event_links_confirms_source_idx;

DROP TABLE alert_projection_provenance;
DROP TABLE statement_reconciliation_candidates;
DROP TABLE transaction_source_records;
DROP TABLE recurring_stream_transactions;
DROP TABLE alert_event_links;
DROP TABLE annotation_revisions;
DROP TABLE alert_projections;
DROP TABLE transactions;

ALTER TABLE transactions_lunchflow_v20 RENAME TO transactions;
ALTER TABLE recurring_stream_transactions_lunchflow_v20 RENAME TO recurring_stream_transactions;
ALTER TABLE transaction_source_records_lunchflow_v20 RENAME TO transaction_source_records;
ALTER TABLE statement_reconciliation_candidates_lunchflow_v20 RENAME TO statement_reconciliation_candidates;
ALTER TABLE alert_projections_lunchflow_v20 RENAME TO alert_projections;
ALTER TABLE alert_projection_provenance_lunchflow_v20 RENAME TO alert_projection_provenance;
ALTER TABLE alert_event_links_lunchflow_v20 RENAME TO alert_event_links;
ALTER TABLE annotation_revisions_lunchflow_v20 RENAME TO annotation_revisions;

CREATE INDEX transactions_date_idx ON transactions(date);
CREATE INDEX transactions_currency_idx ON transactions(currency);
CREATE INDEX transactions_status_idx ON transactions(status);
CREATE INDEX transactions_fingerprint_candidate_idx ON transactions(fingerprint);
CREATE UNIQUE INDEX transactions_plaid_item_current_id_idx
  ON transactions(plaid_item_id, provider_transaction_id)
  WHERE plaid_item_id IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE INDEX transactions_plaid_pending_id_idx
  ON transactions(plaid_item_id, provider_pending_transaction_id);
CREATE INDEX transaction_source_records_transaction_idx ON transaction_source_records(transaction_id);
CREATE INDEX transaction_source_records_provider_idx ON transaction_source_records(provider_item_id, provider_transaction_id);
CREATE INDEX transaction_source_records_lunchflow_idx ON transaction_source_records(source_kind, provider_account_id, provider_transaction_id);
CREATE INDEX transaction_source_records_account_idx ON transaction_source_records(account_id, source_kind);
CREATE INDEX recurring_stream_transactions_provider_idx
  ON recurring_stream_transactions(item_id, provider_transaction_id);
CREATE INDEX recurring_stream_transactions_date_idx
  ON recurring_stream_transactions(account_id, date, recurring_stream_id);
CREATE INDEX statement_reconciliation_candidates_statement_idx
  ON statement_reconciliation_candidates(statement_transaction_id, status, score DESC);
CREATE INDEX statement_reconciliation_candidates_candidate_idx
  ON statement_reconciliation_candidates(candidate_transaction_id, status, score DESC);
CREATE INDEX alert_projections_state_idx ON alert_projections(state, updated_at);
CREATE INDEX alert_event_links_target_event_idx ON alert_event_links(to_event_id, relation);
CREATE INDEX alert_event_links_target_transaction_idx ON alert_event_links(to_transaction_id, relation);
CREATE UNIQUE INDEX alert_event_links_confirms_target_idx
  ON alert_event_links(ledger_id, to_transaction_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX alert_event_links_confirms_source_idx
  ON alert_event_links(ledger_id, from_event_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;

CREATE TRIGGER transactions_fx_lock_date_insert BEFORE INSERT ON transactions WHEN NEW.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT NEW.date BEGIN SELECT RAISE(ABORT, 'transaction fx lock date must match date'); END;
CREATE TRIGGER transactions_fx_lock_date_default AFTER INSERT ON transactions WHEN NEW.fx_lock_date IS NULL BEGIN UPDATE transactions SET fx_lock_date = NEW.date WHERE id = NEW.id; END;
CREATE TRIGGER transactions_fx_lock_date_immutable BEFORE UPDATE OF fx_lock_date ON transactions BEGIN SELECT RAISE(ABORT, 'transaction fx lock date is immutable') WHERE OLD.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT OLD.fx_lock_date; SELECT RAISE(ABORT, 'transaction fx lock date must match date') WHERE OLD.fx_lock_date IS NULL AND NEW.fx_lock_date IS NOT NEW.date; END;
CREATE TRIGGER alert_event_links_same_scope BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert link ledger mismatch') WHERE NEW.ledger_id <> 'personal' OR (NEW.to_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN alert_events target ON target.id = NEW.to_event_id WHERE source.id = NEW.from_event_id AND (source.ledger_id <> target.ledger_id OR (source.account_id IS NOT NULL AND target.account_id IS NOT NULL AND source.account_id <> target.account_id)))) OR (NEW.to_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN transactions target ON target.id = NEW.to_transaction_id WHERE source.id = NEW.from_event_id AND source.account_id IS NOT NULL AND source.account_id <> target.account_id)); END;
CREATE TRIGGER alert_event_links_no_cycle BEFORE INSERT ON alert_event_links WHEN NEW.to_event_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'alert event link cycle') WHERE EXISTS (WITH RECURSIVE reachable(id) AS (SELECT NEW.to_event_id UNION ALL SELECT l.to_event_id FROM alert_event_links l JOIN reachable r ON l.from_event_id = r.id WHERE l.to_event_id IS NOT NULL) SELECT 1 FROM reachable WHERE id = NEW.from_event_id); END;
CREATE TRIGGER alert_event_links_immutable_update BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_event_links_immutable_delete BEFORE DELETE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_projection_provenance_immutable_update BEFORE UPDATE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER alert_projection_provenance_immutable_delete BEFORE DELETE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER annotation_revisions_immutable_update BEFORE UPDATE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
CREATE TRIGGER annotation_revisions_immutable_delete BEFORE DELETE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;

CREATE TABLE lunchflow_accounts (
  provider_account_id TEXT PRIMARY KEY,
  account_id TEXT UNIQUE REFERENCES accounts(id),
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  currency TEXT REFERENCES currencies(code),
  kind TEXT CHECK (kind IN ('chequing', 'savings', 'credit')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX lunchflow_accounts_ledger_idx ON lunchflow_accounts(ledger_id, enabled, provider_account_id);

CREATE TABLE lunchflow_operations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, owner_subject_hash, operation_kind, idempotency_key)
);

CREATE INDEX lunchflow_operations_owner_idx
  ON lunchflow_operations(ledger_id, owner_subject_hash, created_at);
