CREATE TABLE IF NOT EXISTS import_duplicate_decisions (
  preview_id TEXT NOT NULL REFERENCES import_previews(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  statement_transaction_id TEXT NOT NULL,
  candidate_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (preview_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS import_duplicate_decisions_preview_status_idx
  ON import_duplicate_decisions(preview_id, status, updated_at);
