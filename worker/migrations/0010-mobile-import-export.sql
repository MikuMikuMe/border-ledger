ALTER TABLE import_previews ADD COLUMN file_size_bytes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE import_previews ADD COLUMN owner_binding_digest TEXT NOT NULL DEFAULT '';
ALTER TABLE import_previews ADD COLUMN selected_row_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE import_previews ADD COLUMN receipt_id TEXT;
ALTER TABLE import_previews ADD COLUMN committed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_previews ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_previews ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_previews ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS import_preview_errors (
  preview_id TEXT PRIMARY KEY REFERENCES import_previews(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
