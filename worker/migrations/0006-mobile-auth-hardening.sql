ALTER TABLE device_pairings ADD COLUMN approved_subject_hash TEXT;
ALTER TABLE device_pairings ADD COLUMN approval_expires_at TEXT;
ALTER TABLE device_pairings ADD COLUMN environment_hash TEXT;
ALTER TABLE device_pairings ADD COLUMN credential_hash TEXT;

ALTER TABLE capture_credentials ADD COLUMN revocation_capability_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE capture_credentials ADD COLUMN environment_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE mobile_auth_requests ADD COLUMN code_hash TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN code_expires_at TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN callback_origin TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN callback_path TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN environment_hash TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN approved_subject_hash TEXT;
ALTER TABLE mobile_auth_requests ADD COLUMN approved_at TEXT;

ALTER TABLE owner_session_families ADD COLUMN device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL;
ALTER TABLE owner_session_families ADD COLUMN scope_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE owner_session_families ADD COLUMN environment_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE owner_session_families ADD COLUMN revocation_capability_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE owner_session_families ADD COLUMN revocation_generation INTEGER NOT NULL DEFAULT 1 CHECK (revocation_generation > 0);

CREATE INDEX device_pairings_expiry_idx ON device_pairings(expires_at, status);
CREATE INDEX capture_credentials_device_idx ON capture_credentials(device_id, generation, revoked_at);
CREATE INDEX mobile_auth_requests_expiry_idx ON mobile_auth_requests(expires_at, code_expires_at, consumed_at);
CREATE INDEX owner_refresh_generations_active_idx ON owner_refresh_generations(family_id, generation, consumed_at, revoked_at);
