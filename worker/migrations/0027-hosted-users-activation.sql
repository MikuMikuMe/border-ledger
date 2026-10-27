CREATE TABLE hosted_users_activation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  contract_version INTEGER NOT NULL CHECK (contract_version = 1),
  environment TEXT NOT NULL,
  database_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  baseline TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  owner_bindings_sha256 TEXT NOT NULL,
  maintenance_run_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('prepared','active')),
  prepared_at TEXT NOT NULL,
  completion_sha256 TEXT,
  activated_at TEXT,
  CHECK ((phase = 'prepared' AND completion_sha256 IS NULL AND activated_at IS NULL)
    OR (phase = 'active' AND length(completion_sha256) = 64 AND activated_at IS NOT NULL))
);
-- Schema installation never activates deployment. Only the explicit operator tool inserts a receipt.
CREATE TRIGGER hosted_activation_immutable BEFORE UPDATE ON hosted_users_activation BEGIN SELECT RAISE(ABORT, 'activation receipt is immutable') WHERE NEW.singleton IS NOT OLD.singleton OR NEW.contract_version IS NOT OLD.contract_version OR NEW.environment IS NOT OLD.environment OR NEW.database_id IS NOT OLD.database_id OR NEW.revision IS NOT OLD.revision OR NEW.baseline IS NOT OLD.baseline OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.owner_bindings_sha256 IS NOT OLD.owner_bindings_sha256 OR NEW.maintenance_run_id IS NOT OLD.maintenance_run_id OR NEW.prepared_at IS NOT OLD.prepared_at OR OLD.phase = 'active'; END;
CREATE TRIGGER hosted_activation_no_replace BEFORE INSERT ON hosted_users_activation WHEN EXISTS (SELECT 1 FROM hosted_users_activation) BEGIN SELECT RAISE(ABORT, 'activation receipt already exists'); END;
CREATE TRIGGER hosted_activation_no_delete BEFORE DELETE ON hosted_users_activation BEGIN SELECT RAISE(ABORT, 'activation receipt cannot be deleted'); END;
