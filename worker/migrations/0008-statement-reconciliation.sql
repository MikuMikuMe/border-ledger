ALTER TABLE transaction_source_records ADD COLUMN bank_reference TEXT;

CREATE TABLE statement_reconciliation_candidates (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_record_id TEXT NOT NULL REFERENCES transaction_source_records(id) ON DELETE CASCADE,
  statement_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  candidate_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('candidate_rank', 'bank_reference', 'user_review')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_record_id, candidate_transaction_id)
);

CREATE INDEX statement_reconciliation_candidates_statement_idx
  ON statement_reconciliation_candidates(statement_transaction_id, status, score DESC);
CREATE INDEX statement_reconciliation_candidates_candidate_idx
  ON statement_reconciliation_candidates(candidate_transaction_id, status, score DESC);

CREATE TABLE import_commit_operations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('committed', 'replayed', 'partial_review')),
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0),
  accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
  review_count INTEGER NOT NULL CHECK (review_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, account_id, file_sha256)
);

CREATE INDEX import_commit_operations_account_idx
  ON import_commit_operations(account_id, file_sha256, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS alert_event_links_confirms_target_idx
  ON alert_event_links(ledger_id, to_transaction_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alert_event_links_confirms_source_idx
  ON alert_event_links(ledger_id, from_event_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;
