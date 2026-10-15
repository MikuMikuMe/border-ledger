ALTER TABLE device_source_scopes RENAME TO device_source_scopes_legacy;

CREATE TABLE device_source_scopes (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  instrument_hint_kind TEXT NOT NULL DEFAULT 'none',
  instrument_hint_value TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'paused', 'revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency),
  UNIQUE (device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value)
);

INSERT INTO device_source_scopes
  (id, device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value, status, expires_at, created_at, updated_at)
SELECT id, device_id, source_profile_id, account_id, currency, 'none', '', status, expires_at, created_at, updated_at
  FROM device_source_scopes_legacy;

DROP TABLE device_source_scopes_legacy;
