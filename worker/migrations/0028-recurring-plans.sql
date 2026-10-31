CREATE TABLE recurring_plans (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL REFERENCES currencies(code),
  merchant TEXT NOT NULL CHECK (length(trim(merchant)) BETWEEN 1 AND 120),
  direction TEXT NOT NULL CHECK (direction IN ('expense','income')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  operation_id TEXT NOT NULL,
  initial_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, operation_id)
);
CREATE INDEX recurring_plans_ledger_idx ON recurring_plans(ledger_id, enabled, id);
CREATE TRIGGER recurring_plan_account_insert BEFORE INSERT ON recurring_plans BEGIN SELECT RAISE(ABORT, 'invalid plan account') WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND (a.currency=NEW.currency OR EXISTS (SELECT 1 FROM account_currencies c WHERE c.ledger_id=NEW.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))); END;
CREATE TRIGGER recurring_plan_account_update BEFORE UPDATE ON recurring_plans BEGIN SELECT RAISE(ABORT, 'invalid plan account') WHERE NEW.ledger_id IS NOT OLD.ledger_id OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND (a.currency=NEW.currency OR EXISTS (SELECT 1 FROM account_currencies c WHERE c.ledger_id=NEW.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))); END;

CREATE TABLE recurring_lunchflow_sync_jobs (
  job_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  connection_id TEXT NOT NULL REFERENCES lunchflow_connections(id),
  connection_generation INTEGER NOT NULL,
  provider_account_id TEXT NOT NULL,
  account_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','superseded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(job_id, provider_account_id)
);
CREATE INDEX recurring_lunchflow_pending_idx ON recurring_lunchflow_sync_jobs(ledger_id, connection_id, connection_generation, provider_account_id, account_revision, state);

CREATE TRIGGER recurring_lunchflow_job_scope_insert BEFORE INSERT ON recurring_lunchflow_sync_jobs BEGIN SELECT RAISE(ABORT, 'sync job ownership mismatch') WHERE NOT EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.connection_id AND c.ledger_id=NEW.ledger_id AND c.generation=NEW.connection_generation) OR NOT EXISTS (SELECT 1 FROM lunchflow_accounts a WHERE a.ledger_id=NEW.ledger_id AND a.connection_id=NEW.connection_id AND a.provider_account_id=NEW.provider_account_id AND a.revision=NEW.account_revision AND a.enabled=1); END;
