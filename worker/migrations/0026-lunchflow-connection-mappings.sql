-- Legacy mappings are known only for the original Personal feed. Abort ambiguous cutover.
INSERT INTO ledger_preferences(ledger_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM lunchflow_accounts WHERE ledger_id!='personal') OR EXISTS (SELECT 1 FROM lunchflow_operations WHERE ledger_id!='personal');
CREATE TABLE lunchflow_accounts_v26 (
  provider_account_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'lunchflow-personal-owner' REFERENCES lunchflow_connections(id),
  provider_bank_connection_id TEXT,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ledger_id, connection_id, provider_account_id)
);

CREATE TABLE lunchflow_operations_v26 (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'lunchflow-personal-owner' REFERENCES lunchflow_connections(id),
  connection_generation INTEGER NOT NULL DEFAULT 1 CHECK(connection_generation>0),
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, connection_id, connection_generation, owner_subject_hash, operation_kind, idempotency_key)
);

INSERT INTO lunchflow_accounts_v26(provider_account_id,account_id,ledger_id,name,institution,currency,kind,enabled,revision,last_synced_at,last_error,created_at,updated_at)
SELECT provider_account_id,account_id,ledger_id,name,institution,currency,kind,enabled,revision,last_synced_at,last_error,created_at,updated_at FROM lunchflow_accounts;
INSERT INTO lunchflow_operations_v26(id,ledger_id,owner_subject_hash,operation_kind,idempotency_key,response_json,created_at)
SELECT id,ledger_id,owner_subject_hash,operation_kind,idempotency_key,response_json,created_at FROM lunchflow_operations;
DROP TABLE lunchflow_accounts;
DROP TABLE lunchflow_operations;
ALTER TABLE lunchflow_accounts_v26 RENAME TO lunchflow_accounts;
ALTER TABLE lunchflow_operations_v26 RENAME TO lunchflow_operations;
CREATE INDEX lunchflow_accounts_ledger_idx ON lunchflow_accounts(ledger_id,connection_id,enabled,provider_account_id);
CREATE INDEX lunchflow_operations_owner_idx ON lunchflow_operations(ledger_id,connection_id,connection_generation,owner_subject_hash,created_at);
CREATE TRIGGER lunchflow_accounts_connection_insert BEFORE INSERT ON lunchflow_accounts BEGIN SELECT RAISE(ABORT,'Lunch Flow connection ownership collision') WHERE NOT EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.connection_id AND c.ledger_id=NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND ledger_id=NEW.ledger_id)) OR EXISTS (SELECT 1 FROM lunchflow_accounts c WHERE c.account_id=NEW.account_id AND (c.connection_id IS NOT NEW.connection_id OR c.ledger_id IS NOT NEW.ledger_id OR c.provider_account_id IS NOT NEW.provider_account_id)); SELECT RAISE(ABORT,'Lunch Flow mapping already exists') WHERE EXISTS (SELECT 1 FROM lunchflow_accounts c WHERE (c.ledger_id=NEW.ledger_id AND c.connection_id=NEW.connection_id AND c.provider_account_id=NEW.provider_account_id) OR c.account_id=NEW.account_id); END;
CREATE TRIGGER lunchflow_accounts_connection_update BEFORE UPDATE ON lunchflow_accounts BEGIN SELECT RAISE(ABORT,'Lunch Flow mapping is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id OR NEW.connection_id IS NOT OLD.connection_id OR NEW.provider_account_id IS NOT OLD.provider_account_id OR (OLD.account_id IS NOT NULL AND NEW.account_id IS NOT OLD.account_id) OR NEW.provider_bank_connection_id IS NOT OLD.provider_bank_connection_id OR NOT EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.connection_id AND c.ledger_id=NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND ledger_id=NEW.ledger_id)) OR EXISTS (SELECT 1 FROM lunchflow_accounts c WHERE c.account_id=NEW.account_id AND (c.connection_id IS NOT NEW.connection_id OR c.ledger_id IS NOT NEW.ledger_id OR c.provider_account_id IS NOT NEW.provider_account_id)); END;
CREATE TRIGGER lunchflow_operations_connection_insert BEFORE INSERT ON lunchflow_operations BEGIN SELECT RAISE(ABORT,'Lunch Flow connection ownership collision') WHERE NOT EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.connection_id AND c.ledger_id=NEW.ledger_id) OR EXISTS (SELECT 1 FROM lunchflow_operations c WHERE c.id=NEW.id AND (c.connection_id IS NOT NEW.connection_id OR c.connection_generation IS NOT NEW.connection_generation OR c.ledger_id IS NOT NEW.ledger_id OR c.owner_subject_hash IS NOT NEW.owner_subject_hash OR c.operation_kind IS NOT NEW.operation_kind OR c.idempotency_key IS NOT NEW.idempotency_key)); SELECT RAISE(ABORT,'Lunch Flow mapping already exists') WHERE EXISTS (SELECT 1 FROM lunchflow_operations c WHERE c.id=NEW.id OR (c.ledger_id=NEW.ledger_id AND c.connection_id=NEW.connection_id AND c.connection_generation=NEW.connection_generation AND c.owner_subject_hash=NEW.owner_subject_hash AND c.operation_kind=NEW.operation_kind AND c.idempotency_key=NEW.idempotency_key)); END;
CREATE TRIGGER lunchflow_operations_connection_update BEFORE UPDATE ON lunchflow_operations BEGIN SELECT RAISE(ABORT,'Lunch Flow mapping is immutable') WHERE NEW.id IS NOT OLD.id OR NEW.ledger_id IS NOT OLD.ledger_id OR NEW.connection_id IS NOT OLD.connection_id OR NEW.connection_generation IS NOT OLD.connection_generation OR NEW.owner_subject_hash IS NOT OLD.owner_subject_hash OR NEW.operation_kind IS NOT OLD.operation_kind OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NOT EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.connection_id AND c.ledger_id=NEW.ledger_id) OR EXISTS (SELECT 1 FROM lunchflow_operations c WHERE c.id=NEW.id AND (c.connection_id IS NOT NEW.connection_id OR c.connection_generation IS NOT NEW.connection_generation OR c.ledger_id IS NOT NEW.ledger_id OR c.owner_subject_hash IS NOT NEW.owner_subject_hash OR c.operation_kind IS NOT NEW.operation_kind OR c.idempotency_key IS NOT NEW.idempotency_key)); END;
