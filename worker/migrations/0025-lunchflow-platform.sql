CREATE TABLE lunchflow_provider_bindings (
  provider_user_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  ledger_id TEXT NOT NULL UNIQUE REFERENCES ledgers(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER lunchflow_provider_binding_insert BEFORE INSERT ON lunchflow_provider_bindings BEGIN SELECT RAISE(ABORT,'provider ownership mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id=NEW.ledger_id AND user_id=NEW.user_id) OR EXISTS (SELECT 1 FROM lunchflow_provider_bindings b WHERE (b.provider_user_id=NEW.provider_user_id OR b.user_id=NEW.user_id OR b.ledger_id=NEW.ledger_id) AND (b.provider_user_id IS NOT NEW.provider_user_id OR b.user_id IS NOT NEW.user_id OR b.ledger_id IS NOT NEW.ledger_id)); END;
CREATE TRIGGER lunchflow_provider_binding_immutable BEFORE UPDATE ON lunchflow_provider_bindings BEGIN SELECT RAISE(ABORT,'provider ownership is immutable') WHERE NEW.provider_user_id IS NOT OLD.provider_user_id OR NEW.user_id IS NOT OLD.user_id OR NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER lunchflow_provider_binding_retained BEFORE DELETE ON lunchflow_provider_bindings BEGIN SELECT RAISE(ABORT,'provider ownership binding must be retained'); END;
CREATE TABLE lunchflow_connections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  adapter TEXT NOT NULL CHECK(adapter IN ('personal','platform')),
  app_client_id TEXT,
  provider_user_id TEXT REFERENCES lunchflow_provider_bindings(provider_user_id),
  lifecycle TEXT NOT NULL DEFAULT 'disconnected' CHECK(lifecycle IN ('disconnected','connected','reconnect_required','revocation_pending','revocation_failed','revoked')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),
  credential_version INTEGER NOT NULL DEFAULT 0 CHECK(credential_version>=0),
  token_ciphertext TEXT,
  token_iv TEXT,
  access_expires_at TEXT,
  operation_id TEXT,
  operation_kind TEXT CHECK(operation_kind IN ('exchange','refresh','revoke')),
  operation_expires_at TEXT,
  operation_uncertain INTEGER NOT NULL DEFAULT 0 CHECK(operation_uncertain IN (0,1)),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,adapter),
  UNIQUE(ledger_id,adapter),
  CHECK(adapter!='personal' OR (id='lunchflow-personal-owner' AND user_id='owner' AND ledger_id='personal' AND provider_user_id IS NULL)),
  CHECK(adapter!='platform' OR app_client_id IS NOT NULL),
  CHECK((token_ciphertext IS NULL)=(token_iv IS NULL)),
  CHECK((operation_id IS NULL)=(operation_kind IS NULL))
);
CREATE TRIGGER lunchflow_connection_insert BEFORE INSERT ON lunchflow_connections BEGIN SELECT RAISE(ABORT,'connection ownership mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id=NEW.ledger_id AND user_id=NEW.user_id) OR (NEW.provider_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lunchflow_provider_bindings WHERE provider_user_id=NEW.provider_user_id AND user_id=NEW.user_id AND ledger_id=NEW.ledger_id)); SELECT RAISE(ABORT,'connection already exists') WHERE EXISTS (SELECT 1 FROM lunchflow_connections c WHERE c.id=NEW.id OR (c.user_id=NEW.user_id AND c.adapter=NEW.adapter) OR (c.ledger_id=NEW.ledger_id AND c.adapter=NEW.adapter)); END;
CREATE TRIGGER lunchflow_connection_update BEFORE UPDATE ON lunchflow_connections BEGIN SELECT RAISE(ABORT,'connection ownership mismatch') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.ledger_id IS NOT OLD.ledger_id OR NEW.adapter IS NOT OLD.adapter OR NEW.app_client_id IS NOT OLD.app_client_id OR (OLD.provider_user_id IS NOT NULL AND NEW.provider_user_id IS NOT OLD.provider_user_id) OR (NEW.provider_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lunchflow_provider_bindings WHERE provider_user_id=NEW.provider_user_id AND user_id=NEW.user_id AND ledger_id=NEW.ledger_id)); END;
INSERT INTO lunchflow_connections(id,user_id,ledger_id,adapter,lifecycle) VALUES ('lunchflow-personal-owner','owner','personal','personal','connected');
CREATE TABLE lunchflow_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES lunchflow_connections(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  generation INTEGER NOT NULL,
  state_hash TEXT UNIQUE,
  launch_hash TEXT UNIQUE,
  cookie_hash TEXT,
  browser_session_hash TEXT,
  browser_identity_hash TEXT,
  native_context_json TEXT,
  return_kind TEXT NOT NULL CHECK(return_kind IN ('web','native')),
  expires_at TEXT NOT NULL,
  launch_consumed INTEGER NOT NULL DEFAULT 0 CHECK(launch_consumed IN (0,1)),
  consumed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX lunchflow_oauth_expiry ON lunchflow_oauth_states(expires_at);
CREATE TRIGGER lunchflow_oauth_owner_insert BEFORE INSERT ON lunchflow_oauth_states BEGIN SELECT RAISE(ABORT,'OAuth ownership mismatch') WHERE NOT EXISTS (SELECT 1 FROM lunchflow_connections WHERE id=NEW.connection_id AND user_id=NEW.user_id AND ledger_id=NEW.ledger_id AND adapter='platform'); END;
CREATE TRIGGER lunchflow_oauth_owner_update BEFORE UPDATE ON lunchflow_oauth_states BEGIN SELECT RAISE(ABORT,'OAuth ownership is immutable') WHERE NEW.id IS NOT OLD.id OR NEW.connection_id IS NOT OLD.connection_id OR NEW.user_id IS NOT OLD.user_id OR NEW.ledger_id IS NOT OLD.ledger_id OR NEW.generation IS NOT OLD.generation OR NEW.native_context_json IS NOT OLD.native_context_json OR NEW.return_kind IS NOT OLD.return_kind; END;
