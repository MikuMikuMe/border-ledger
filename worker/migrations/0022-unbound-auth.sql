CREATE TABLE hosted_auth_requests (
  id TEXT PRIMARY KEY,
  ledger_id TEXT REFERENCES ledgers(id),
  user_id TEXT REFERENCES users(id),
  installation_id TEXT,
  state_hash TEXT NOT NULL UNIQUE,
  pkce_challenge_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  code_hash TEXT,
  code_expires_at TEXT,
  callback_origin TEXT NOT NULL,
  callback_path TEXT NOT NULL,
  environment_hash TEXT NOT NULL,
  approved_subject_hash TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((ledger_id IS NULL AND user_id IS NULL AND code_hash IS NULL AND approved_subject_hash IS NULL AND approved_at IS NULL)
    OR (ledger_id IS NOT NULL AND user_id IS NOT NULL AND code_hash IS NOT NULL AND approved_subject_hash IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TRIGGER hosted_auth_binding_insert BEFORE INSERT ON hosted_auth_requests
WHEN (NEW.ledger_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledgers l JOIN users u ON u.id = l.user_id WHERE l.id = NEW.ledger_id AND u.id = NEW.user_id AND u.status = 'active'))
  OR EXISTS (SELECT 1 FROM hosted_auth_requests r WHERE r.id = NEW.id OR r.state_hash = NEW.state_hash)
BEGIN SELECT RAISE(ABORT, 'Invalid or replaced auth binding'); END;
CREATE TRIGGER hosted_auth_binding_update BEFORE UPDATE ON hosted_auth_requests
WHEN NEW.id IS NOT OLD.id OR NEW.state_hash IS NOT OLD.state_hash
  OR (OLD.ledger_id IS NOT NULL AND (NEW.ledger_id IS NOT OLD.ledger_id OR NEW.user_id IS NOT OLD.user_id OR NEW.approved_subject_hash IS NOT OLD.approved_subject_hash))
  OR (NEW.ledger_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledgers l JOIN users u ON u.id = l.user_id WHERE l.id = NEW.ledger_id AND u.id = NEW.user_id AND u.status = 'active'))
BEGIN SELECT RAISE(ABORT, 'Invalid or reassigned auth binding'); END;
CREATE TABLE hosted_device_pairings (
  id TEXT PRIMARY KEY,
  ledger_id TEXT REFERENCES ledgers(id),
  user_id TEXT REFERENCES users(id),
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_verifier_hash TEXT NOT NULL,
  user_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','claimed','expired','revoked')),
  requested_scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  approved_subject_hash TEXT,
  approved_family_id TEXT REFERENCES owner_session_families(id),
  approval_expires_at TEXT,
  environment_hash TEXT NOT NULL,
  credential_hash TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((ledger_id IS NULL AND user_id IS NULL AND approved_at IS NULL AND status IN ('pending','expired','revoked'))
    OR (ledger_id IS NOT NULL AND user_id IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TRIGGER hosted_pairing_binding_insert BEFORE INSERT ON hosted_device_pairings
WHEN NEW.ledger_id IS NOT NULL OR EXISTS (SELECT 1 FROM hosted_device_pairings p WHERE p.id = NEW.id OR p.device_id = NEW.device_id OR p.user_code_hash = NEW.user_code_hash)
BEGIN SELECT RAISE(ABORT, 'Pairing must start unbound'); END;
CREATE TRIGGER hosted_pairing_binding_update BEFORE UPDATE ON hosted_device_pairings
WHEN NEW.id IS NOT OLD.id OR NEW.device_id IS NOT OLD.device_id OR NEW.user_code_hash IS NOT OLD.user_code_hash
  OR (OLD.ledger_id IS NOT NULL AND (NEW.ledger_id IS NOT OLD.ledger_id OR NEW.user_id IS NOT OLD.user_id OR NEW.approved_subject_hash IS NOT OLD.approved_subject_hash OR NEW.approved_family_id IS NOT OLD.approved_family_id))
  OR (NEW.ledger_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledgers l JOIN users u ON u.id = l.user_id WHERE l.id = NEW.ledger_id AND u.id = NEW.user_id AND u.status = 'active'))
  OR (NEW.approved_family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM owner_session_families f WHERE f.id = NEW.approved_family_id AND f.ledger_id = NEW.ledger_id AND f.revoked_at IS NULL))
BEGIN SELECT RAISE(ABORT, 'Invalid or reassigned pairing binding'); END;
