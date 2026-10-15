ALTER TABLE recurring_classifications ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
