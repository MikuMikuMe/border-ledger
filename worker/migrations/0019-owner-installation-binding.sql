-- Owner sign-in binds to an installation before any capture device is paired.
-- Preserve existing bindings while keeping capture pairing foreign keys separate.
ALTER TABLE mobile_auth_requests ADD COLUMN installation_id TEXT;
UPDATE mobile_auth_requests SET installation_id = device_id;

ALTER TABLE owner_session_families ADD COLUMN installation_id TEXT;
UPDATE owner_session_families SET installation_id = device_id;
