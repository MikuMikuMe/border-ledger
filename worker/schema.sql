CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (id) VALUES ('owner');

CREATE TABLE IF NOT EXISTS user_identities (
  issuer TEXT NOT NULL CHECK (length(trim(issuer)) > 0),
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT NOT NULL DEFAULT 'owner'
);

INSERT OR IGNORE INTO ledgers (id) VALUES ('personal');
CREATE UNIQUE INDEX IF NOT EXISTS ledgers_user_idx ON ledgers(user_id);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  minor_unit_digits INTEGER NOT NULL CHECK (minor_unit_digits BETWEEN 0 AND 3),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO currencies (code, minor_unit_digits, display_name) VALUES
  ('AED', 2, 'AED'),
  ('AFN', 2, 'AFN'),
  ('ALL', 2, 'ALL'),
  ('AMD', 2, 'AMD'),
  ('ANG', 2, 'ANG'),
  ('AOA', 2, 'AOA'),
  ('ARS', 2, 'ARS'),
  ('AUD', 2, 'AUD'),
  ('AWG', 2, 'AWG'),
  ('AZN', 2, 'AZN'),
  ('BAM', 2, 'BAM'),
  ('BBD', 2, 'BBD'),
  ('BDT', 2, 'BDT'),
  ('BGN', 2, 'BGN'),
  ('BHD', 3, 'BHD'),
  ('BIF', 0, 'BIF'),
  ('BMD', 2, 'BMD'),
  ('BND', 2, 'BND'),
  ('BOB', 2, 'BOB'),
  ('BRL', 2, 'BRL'),
  ('BSD', 2, 'BSD'),
  ('BTN', 2, 'BTN'),
  ('BWP', 2, 'BWP'),
  ('BYN', 2, 'BYN'),
  ('BZD', 2, 'BZD'),
  ('CAD', 2, 'Canadian dollar'),
  ('CDF', 2, 'CDF'),
  ('CHF', 2, 'CHF'),
  ('CLP', 0, 'CLP'),
  ('CNY', 2, 'Chinese yuan'),
  ('COP', 2, 'COP'),
  ('CRC', 2, 'CRC'),
  ('CUC', 2, 'CUC'),
  ('CUP', 2, 'CUP'),
  ('CVE', 2, 'CVE'),
  ('CZK', 2, 'CZK'),
  ('DJF', 0, 'DJF'),
  ('DKK', 2, 'DKK'),
  ('DOP', 2, 'DOP'),
  ('DZD', 2, 'DZD'),
  ('EGP', 2, 'EGP'),
  ('ERN', 2, 'ERN'),
  ('ETB', 2, 'ETB'),
  ('EUR', 2, 'EUR'),
  ('FJD', 2, 'FJD'),
  ('FKP', 2, 'FKP'),
  ('GBP', 2, 'GBP'),
  ('GEL', 2, 'GEL'),
  ('GHS', 2, 'GHS'),
  ('GIP', 2, 'GIP'),
  ('GMD', 2, 'GMD'),
  ('GNF', 0, 'GNF'),
  ('GTQ', 2, 'GTQ'),
  ('GYD', 2, 'GYD'),
  ('HKD', 2, 'Hong Kong dollar'),
  ('HNL', 2, 'HNL'),
  ('HRK', 2, 'HRK'),
  ('HTG', 2, 'HTG'),
  ('HUF', 2, 'HUF'),
  ('IDR', 2, 'IDR'),
  ('ILS', 2, 'ILS'),
  ('INR', 2, 'INR'),
  ('IQD', 3, 'IQD'),
  ('IRR', 2, 'IRR'),
  ('ISK', 0, 'ISK'),
  ('JMD', 2, 'JMD'),
  ('JOD', 3, 'JOD'),
  ('JPY', 0, 'JPY'),
  ('KES', 2, 'KES'),
  ('KGS', 2, 'KGS'),
  ('KHR', 2, 'KHR'),
  ('KMF', 0, 'KMF'),
  ('KPW', 2, 'KPW'),
  ('KRW', 0, 'KRW'),
  ('KWD', 3, 'KWD'),
  ('KYD', 2, 'KYD'),
  ('KZT', 2, 'KZT'),
  ('LAK', 2, 'LAK'),
  ('LBP', 2, 'LBP'),
  ('LKR', 2, 'LKR'),
  ('LRD', 2, 'LRD'),
  ('LSL', 2, 'LSL'),
  ('LYD', 3, 'LYD'),
  ('MAD', 2, 'MAD'),
  ('MDL', 2, 'MDL'),
  ('MGA', 2, 'MGA'),
  ('MKD', 2, 'MKD'),
  ('MMK', 2, 'MMK'),
  ('MNT', 2, 'MNT'),
  ('MOP', 2, 'MOP'),
  ('MRU', 2, 'MRU'),
  ('MUR', 2, 'MUR'),
  ('MVR', 2, 'MVR'),
  ('MWK', 2, 'MWK'),
  ('MXN', 2, 'MXN'),
  ('MYR', 2, 'MYR'),
  ('MZN', 2, 'MZN'),
  ('NAD', 2, 'NAD'),
  ('NGN', 2, 'NGN'),
  ('NIO', 2, 'NIO'),
  ('NOK', 2, 'NOK'),
  ('NPR', 2, 'NPR'),
  ('NZD', 2, 'NZD'),
  ('OMR', 3, 'OMR'),
  ('PAB', 2, 'PAB'),
  ('PEN', 2, 'PEN'),
  ('PGK', 2, 'PGK'),
  ('PHP', 2, 'PHP'),
  ('PKR', 2, 'PKR'),
  ('PLN', 2, 'PLN'),
  ('PYG', 0, 'PYG'),
  ('QAR', 2, 'QAR'),
  ('RON', 2, 'RON'),
  ('RSD', 2, 'RSD'),
  ('RUB', 2, 'RUB'),
  ('RWF', 0, 'RWF'),
  ('SAR', 2, 'SAR'),
  ('SBD', 2, 'SBD'),
  ('SCR', 2, 'SCR'),
  ('SDG', 2, 'SDG'),
  ('SEK', 2, 'SEK'),
  ('SGD', 2, 'SGD'),
  ('SHP', 2, 'SHP'),
  ('SLE', 2, 'SLE'),
  ('SLL', 2, 'SLL'),
  ('SOS', 2, 'SOS'),
  ('SRD', 2, 'SRD'),
  ('SSP', 2, 'SSP'),
  ('STN', 2, 'STN'),
  ('SVC', 2, 'SVC'),
  ('SYP', 2, 'SYP'),
  ('SZL', 2, 'SZL'),
  ('THB', 2, 'THB'),
  ('TJS', 2, 'TJS'),
  ('TMT', 2, 'TMT'),
  ('TND', 3, 'TND'),
  ('TOP', 2, 'TOP'),
  ('TRY', 2, 'TRY'),
  ('TTD', 2, 'TTD'),
  ('TWD', 2, 'TWD'),
  ('TZS', 2, 'TZS'),
  ('UAH', 2, 'UAH'),
  ('UGX', 0, 'UGX'),
  ('USD', 2, 'United States dollar'),
  ('UYU', 2, 'UYU'),
  ('UZS', 2, 'UZS'),
  ('VES', 2, 'VES'),
  ('VND', 0, 'VND'),
  ('VUV', 0, 'VUV'),
  ('WST', 2, 'WST'),
  ('XAF', 0, 'XAF'),
  ('XCD', 2, 'XCD'),
  ('XCG', 2, 'XCG'),
  ('XDR', 0, 'XDR'),
  ('XOF', 0, 'XOF'),
  ('XPF', 0, 'XPF'),
  ('XSU', 0, 'XSU'),
  ('YER', 2, 'YER'),
  ('ZAR', 2, 'ZAR'),
  ('ZMW', 2, 'ZMW'),
  ('ZWG', 2, 'ZWG'),
  ('ZWL', 2, 'ZWL');

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  currency_mode TEXT NOT NULL DEFAULT 'single' CHECK (currency_mode IN ('single', 'multi')),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  last_synced_at TEXT,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS account_currencies (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL REFERENCES currencies(code),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (account_id, currency)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  fx_lock_date TEXT,
  merchant TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'needs_review')),
  source TEXT NOT NULL CHECK (source IN ('statement', 'plaid', 'alert', 'manual', 'lunchflow')),
  fingerprint TEXT NOT NULL,
  note TEXT,
  plaid_item_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  UNIQUE (id, account_id),
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency)
);

CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
  requested_date TEXT NOT NULL PRIMARY KEY CHECK (length(requested_date) = 10 AND requested_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_date TEXT NOT NULL CHECK (length(effective_date) = 10 AND effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  provider TEXT NOT NULL CHECK (provider = 'frankfurter'),
  rates_json TEXT NOT NULL CHECK (length(rates_json) BETWEEN 2 AND 65536),
  content_digest TEXT NOT NULL CHECK (length(content_digest) BETWEEN 1 AND 128),
  fetched_at TEXT NOT NULL CHECK (length(fetched_at) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE INDEX IF NOT EXISTS transactions_currency_idx ON transactions(currency);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);
CREATE INDEX IF NOT EXISTS transactions_fingerprint_candidate_idx ON transactions(fingerprint);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS sync_state (
  connection_revision INTEGER NOT NULL DEFAULT 1,
  requested_generation INTEGER NOT NULL DEFAULT 0,
  completed_generation INTEGER NOT NULL DEFAULT 0,
  recurring_enqueued_generation INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  connection_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cursor TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS plaid_items (
  provider_item_id TEXT,
  item_id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS plaid_accounts (
  provider_account_id TEXT,
  plaid_account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  mask TEXT,
  subtype TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE INDEX IF NOT EXISTS plaid_accounts_item_idx ON plaid_accounts(item_id);
CREATE INDEX IF NOT EXISTS plaid_accounts_account_idx ON plaid_accounts(account_id);

CREATE TABLE IF NOT EXISTS lunchflow_accounts (
  provider_account_id TEXT NOT NULL,
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
  PRIMARY KEY (ledger_id, provider_account_id)
);

CREATE INDEX IF NOT EXISTS lunchflow_accounts_ledger_idx ON lunchflow_accounts(ledger_id, enabled, provider_account_id);

CREATE TABLE IF NOT EXISTS mobile_connections (
  provider_item_id TEXT,
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'plaid'),
  item_id TEXT,
  institution_name TEXT,
  mode TEXT NOT NULL DEFAULT 'create' CHECK (mode IN ('create', 'update')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'connected', 'syncing', 'canceled', 'failed', 'disconnecting')),
  expires_at TEXT,
  cleanup_state TEXT NOT NULL DEFAULT 'not_required' CHECK (cleanup_state IN ('not_required', 'pending', 'succeeded', 'uncertain')),
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  selected_account_ids_json TEXT NOT NULL DEFAULT '[]',
  pending_access_token_ciphertext TEXT,
  pending_access_token_iv TEXT,
  provider_accounts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mobile_connections_owner_idx ON mobile_connections(ledger_id, owner_subject_hash, state, updated_at);
CREATE INDEX IF NOT EXISTS mobile_connections_expiry_idx ON mobile_connections(state, expires_at, cleanup_state);

CREATE TABLE IF NOT EXISTS mobile_connection_operations (
  request_digest TEXT,
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  connection_id TEXT,
  state TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, owner_subject_hash, operation_kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS mobile_connection_operations_connection_idx ON mobile_connection_operations(connection_id, created_at);

CREATE TABLE IF NOT EXISTS lunchflow_operations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  owner_subject_hash TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, owner_subject_hash, operation_kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS lunchflow_operations_owner_idx
  ON lunchflow_operations(ledger_id, owner_subject_hash, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_plaid_item_current_id_idx
  ON transactions(plaid_item_id, provider_transaction_id)
  WHERE plaid_item_id IS NOT NULL AND provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_plaid_pending_id_idx
  ON transactions(plaid_item_id, provider_pending_transaction_id);

CREATE TABLE IF NOT EXISTS recurring_streams (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  merchant_name TEXT,
  merchant_entity_id TEXT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  source_status TEXT NOT NULL,
  source_frequency TEXT NOT NULL,
  frequency TEXT NOT NULL,
  is_outflow INTEGER NOT NULL CHECK (is_outflow IN (0, 1)),
  first_date TEXT,
  last_date TEXT,
  predicted_next_date TEXT,
  average_amount_minor INTEGER,
  last_amount_minor INTEGER,
  predicted_amount_minor INTEGER,
  source_updated_at TEXT,
  present_in_latest_snapshot INTEGER NOT NULL DEFAULT 1 CHECK (present_in_latest_snapshot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  UNIQUE(item_id, stream_id)
);

CREATE INDEX IF NOT EXISTS recurring_streams_account_date_idx
  ON recurring_streams(account_id, predicted_next_date, id);

CREATE TABLE IF NOT EXISTS recurring_stream_transactions (
  recurring_stream_id TEXT NOT NULL REFERENCES recurring_streams(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  provider_transaction_id TEXT NOT NULL,
  provider_pending_transaction_id TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'fee')),
  is_outflow INTEGER NOT NULL CHECK (is_outflow IN (0, 1)),
  membership_id TEXT,
  present_in_latest_snapshot INTEGER NOT NULL DEFAULT 1 CHECK (present_in_latest_snapshot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (recurring_stream_id, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS recurring_stream_transactions_provider_idx
  ON recurring_stream_transactions(item_id, provider_transaction_id);

CREATE INDEX IF NOT EXISTS recurring_stream_transactions_date_idx
  ON recurring_stream_transactions(account_id, date, recurring_stream_id);

CREATE TABLE IF NOT EXISTS recurring_classifications (
  recurring_stream_id TEXT PRIMARY KEY REFERENCES recurring_streams(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('unclassified', 'subscription', 'bill', 'other', 'excluded')),
  note TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS recurring_sync_state (
  item_id TEXT PRIMARY KEY REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  history_complete INTEGER NOT NULL DEFAULT 0 CHECK (history_complete IN (0, 1)),
  requested_generation INTEGER NOT NULL DEFAULT 0,
  completed_generation INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  coverage_warnings TEXT NOT NULL DEFAULT '[]',
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'disconnecting', 'disconnected')),
  scope_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE INDEX IF NOT EXISTS recurring_sync_state_stale_idx
  ON recurring_sync_state(last_success_at, lifecycle);

CREATE TABLE IF NOT EXISTS source_profiles (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  provider TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paused', 'unsupported')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, provider, source_kind)
);

CREATE TABLE IF NOT EXISTS source_profile_hints (
  id TEXT PRIMARY KEY,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  hint_kind TEXT NOT NULL,
  hint_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  UNIQUE (source_profile_id, hint_kind, hint_value)
);

CREATE TABLE IF NOT EXISTS source_account_mappings (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  hint_kind TEXT NOT NULL DEFAULT 'none',
  hint_value TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'revoked')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, source_profile_id, hint_kind, hint_value, account_id)
);

CREATE TABLE IF NOT EXISTS mobile_devices (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paired' CHECK (status IN ('pairing', 'paired', 'paused', 'revoked')),
  paired_at TEXT,
  expires_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  source_config_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_config_revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_pairings (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  device_verifier_hash TEXT NOT NULL,
  user_code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed', 'expired', 'revoked')),
  requested_scopes_json TEXT NOT NULL DEFAULT '["alerts:write"]',
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  claimed_at TEXT,
  approved_subject_hash TEXT,
  approval_expires_at TEXT,
  environment_hash TEXT,
  credential_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_verifier_hash),
  UNIQUE (user_code_hash)
);

CREATE TABLE IF NOT EXISTS capture_credentials (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type = 'capture'),
  scope TEXT NOT NULL CHECK (scope = 'alerts:write'),
  generation INTEGER NOT NULL CHECK (generation > 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  environment_hash TEXT NOT NULL DEFAULT '',
  revocation_capability_hash TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  UNIQUE (credential_hash)
);

CREATE TABLE IF NOT EXISTS device_source_scopes (
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
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency),
  UNIQUE (device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value)
);

CREATE TABLE IF NOT EXISTS transaction_source_records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('plaid', 'statement', 'alert', 'manual', 'legacy', 'lunchflow')),
  identity_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_item_id TEXT,
  provider_account_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  bank_source_id TEXT,
  bank_row_id TEXT,
  file_sha256 TEXT,
  row_index INTEGER,
  event_id TEXT,
  manual_id TEXT,
  bank_reference TEXT,
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, source_kind, identity_key),
  FOREIGN KEY (transaction_id, account_id) REFERENCES transactions(id, account_id) ON DELETE CASCADE,
  CHECK (
    (source_kind = 'plaid' AND provider_item_id IS NOT NULL AND (provider_transaction_id IS NOT NULL OR provider_pending_transaction_id IS NOT NULL)) OR
    (source_kind = 'statement' AND ((bank_source_id IS NOT NULL AND bank_row_id IS NOT NULL) OR (file_sha256 IS NOT NULL AND row_index IS NOT NULL))) OR
    (source_kind = 'alert' AND event_id IS NOT NULL) OR
    (source_kind = 'manual' AND manual_id IS NOT NULL) OR
    (source_kind = 'lunchflow' AND provider_account_id IS NOT NULL AND provider_transaction_id IS NOT NULL AND provider_item_id IS NULL) OR
    source_kind = 'legacy'
  )
);

CREATE INDEX IF NOT EXISTS transaction_source_records_transaction_idx ON transaction_source_records(transaction_id);
CREATE INDEX IF NOT EXISTS transaction_source_records_provider_idx ON transaction_source_records(provider_item_id, provider_transaction_id);
CREATE INDEX IF NOT EXISTS transaction_source_records_lunchflow_idx ON transaction_source_records(source_kind, provider_account_id, provider_transaction_id);
CREATE INDEX IF NOT EXISTS transaction_source_records_account_idx ON transaction_source_records(account_id, source_kind);

CREATE TABLE IF NOT EXISTS statement_reconciliation_candidates (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_record_id TEXT NOT NULL REFERENCES transaction_source_records(id) ON DELETE CASCADE,
  statement_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  candidate_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('candidate_rank', 'bank_reference', 'user_review')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_record_id, candidate_transaction_id)
);

CREATE INDEX IF NOT EXISTS statement_reconciliation_candidates_statement_idx
  ON statement_reconciliation_candidates(statement_transaction_id, status, score DESC);
CREATE INDEX IF NOT EXISTS statement_reconciliation_candidates_candidate_idx
  ON statement_reconciliation_candidates(candidate_transaction_id, status, score DESC);

CREATE TABLE IF NOT EXISTS import_commit_operations (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('committed', 'replayed', 'partial_review')),
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0),
  accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
  review_count INTEGER NOT NULL CHECK (review_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, account_id, file_sha256)
);

CREATE INDEX IF NOT EXISTS import_commit_operations_account_idx
  ON import_commit_operations(account_id, file_sha256, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  event_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  source_profile_id TEXT NOT NULL REFERENCES source_profiles(id),
  parser_version TEXT NOT NULL,
  notification_posted_at TEXT,
  captured_at TEXT NOT NULL,
  event_time_basis TEXT NOT NULL CHECK (event_time_basis IN ('notification_posted', 'bank_transaction_date', 'statement_posting_date', 'unresolved')),
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase_notice', 'authorization_reversal', 'declined', 'refund_notice', 'hold_notice', 'adjustment_notice', 'repayment_notice', 'transfer_notice', 'fee_notice', 'unknown')),
  direction TEXT NOT NULL CHECK (direction IN ('outflow', 'inflow', 'none', 'unknown')),
  instrument_hint_kind TEXT,
  instrument_hint_value TEXT,
  account_id TEXT REFERENCES accounts(id),
  event_money_currency TEXT REFERENCES currencies(code),
  event_money_amount_minor INTEGER,
  primary_money_role TEXT CHECK (primary_money_role IN ('transaction', 'authorization', 'billing', 'fee')),
  amounts_json TEXT NOT NULL DEFAULT '[]',
  fee_treatment TEXT NOT NULL DEFAULT 'unknown' CHECK (fee_treatment IN ('included', 'separate', 'unknown')),
  bank_reference TEXT,
  bank_displayed_time TEXT,
  bank_displayed_zone TEXT,
  bank_displayed_precision TEXT,
  bank_year_provenance TEXT,
  merchant TEXT,
  completeness_json TEXT NOT NULL DEFAULT '{}',
  payload_digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_event_id TEXT CHECK (raw_event_id IS NULL OR length(trim(raw_event_id)) > 0),
  CHECK (id = event_id),
  UNIQUE (ledger_id, event_id)
);

CREATE TABLE IF NOT EXISTS alert_event_digests (
  event_id TEXT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (event_id, algorithm)
);

CREATE TABLE IF NOT EXISTS alert_projections (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  event_id TEXT NOT NULL REFERENCES alert_events(id),
  transaction_id TEXT REFERENCES transactions(id),
  state TEXT NOT NULL CHECK (state IN ('provisional', 'non_spending', 'needs_review', 'voided', 'superseded')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  counted_currency TEXT REFERENCES currencies(code),
  counted_amount_minor INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS alert_projection_provenance (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  projection_id TEXT NOT NULL REFERENCES alert_projections(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('alert_event', 'statement', 'provider', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (projection_id, source_kind, source_id, revision)
);

CREATE TABLE IF NOT EXISTS alert_event_links (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  from_event_id TEXT NOT NULL REFERENCES alert_events(id),
  to_event_id TEXT REFERENCES alert_events(id),
  to_transaction_id TEXT REFERENCES transactions(id),
  relation TEXT NOT NULL CHECK (relation IN ('cancels', 'partially_reverses', 'replaces_authorization', 'refund_of', 'confirms', 'possible_duplicate')),
  allocated_currency TEXT REFERENCES currencies(code),
  allocated_amount_minor INTEGER,
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('bank_reference', 'user_review')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((to_event_id IS NOT NULL) != (to_transaction_id IS NOT NULL)),
  CHECK (to_event_id IS NULL OR from_event_id <> to_event_id),
  UNIQUE (ledger_id, from_event_id, to_event_id, to_transaction_id, relation, revision)
);

CREATE TABLE IF NOT EXISTS alert_event_link_conflicts (
  original_link_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  from_event_id TEXT NOT NULL,
  to_event_id TEXT,
  to_transaction_id TEXT,
  original_relation TEXT NOT NULL,
  allocated_currency TEXT,
  allocated_amount_minor INTEGER,
  evidence_basis TEXT NOT NULL,
  revision INTEGER NOT NULL,
  original_created_at TEXT,
  winner_link_id TEXT,
  conflict_reason TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS alert_event_links_target_event_idx ON alert_event_links(to_event_id, relation);
CREATE INDEX IF NOT EXISTS alert_event_links_target_transaction_idx ON alert_event_links(to_transaction_id, relation);
CREATE UNIQUE INDEX IF NOT EXISTS alert_event_links_confirms_target_idx
  ON alert_event_links(ledger_id, to_transaction_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS alert_event_links_confirms_source_idx
  ON alert_event_links(ledger_id, from_event_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alert_events_effective_time_idx ON alert_events(notification_posted_at, event_id);
CREATE INDEX IF NOT EXISTS alert_events_device_idx ON alert_events(device_id, event_id, created_at);
CREATE INDEX IF NOT EXISTS alert_projections_state_idx ON alert_projections(state, updated_at);

CREATE TABLE IF NOT EXISTS annotation_revisions (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  author_subject_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  category TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, revision)
);

CREATE TABLE IF NOT EXISTS mobile_auth_requests (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  installation_id TEXT,
  state_hash TEXT NOT NULL,
  pkce_challenge_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  code_hash TEXT,
  code_expires_at TEXT,
  callback_origin TEXT,
  callback_path TEXT,
  environment_hash TEXT,
  approved_subject_hash TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (state_hash)
);

CREATE TABLE IF NOT EXISTS owner_session_families (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  subject_hash TEXT NOT NULL,
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL,
  installation_id TEXT,
  access_generation INTEGER NOT NULL DEFAULT 1 CHECK (access_generation > 0),
  refresh_generation INTEGER NOT NULL DEFAULT 1 CHECK (refresh_generation > 0),
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  stay_signed_in_until TEXT,
  revoked_at TEXT,
  scope_json TEXT NOT NULL DEFAULT '[]',
  environment_hash TEXT NOT NULL DEFAULT '',
  revocation_capability_hash TEXT NOT NULL DEFAULT '',
  revocation_generation INTEGER NOT NULL DEFAULT 1 CHECK (revocation_generation > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_refresh_generations (
  family_id TEXT NOT NULL REFERENCES owner_session_families(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  token_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (family_id, generation),
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS owner_replay_records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  request_kind TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_ciphertext TEXT NOT NULL,
  response_iv TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 60 CHECK (ttl_seconds BETWEEN 1 AND 60),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ledger_id, request_kind, request_digest)
);

CREATE INDEX IF NOT EXISTS owner_replay_records_expiry_idx ON owner_replay_records(expires_at);
CREATE INDEX IF NOT EXISTS owner_session_families_expiry_idx ON owner_session_families(access_expires_at, refresh_expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS import_previews (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 1 CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  file_sha256 TEXT NOT NULL,
  preview_digest TEXT NOT NULL,
  owner_binding_digest TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'ready', 'publishing', 'published', 'cancelled', 'expired')),
  operation_id TEXT,
  selected_row_ids_json TEXT NOT NULL DEFAULT '[]',
  receipt_id TEXT,
  committed_count INTEGER NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  expires_at TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_chunks (
  preview_id TEXT NOT NULL REFERENCES import_previews(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  operation_id TEXT NOT NULL,
  chunk_digest TEXT NOT NULL,
  row_start INTEGER NOT NULL CHECK (row_start >= 0),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (preview_id, chunk_index),
  UNIQUE (preview_id, chunk_digest)
);

CREATE INDEX IF NOT EXISTS import_previews_expiry_idx ON import_previews(expires_at, status);
CREATE INDEX IF NOT EXISTS import_chunks_operation_idx ON import_chunks(preview_id, operation_id, chunk_index);

CREATE TABLE IF NOT EXISTS import_preview_errors (
  preview_id TEXT PRIMARY KEY REFERENCES import_previews(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal'
);

CREATE TABLE IF NOT EXISTS import_duplicate_decisions (
  preview_id TEXT NOT NULL REFERENCES import_previews(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  statement_transaction_id TEXT NOT NULL,
  candidate_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_id TEXT NOT NULL DEFAULT 'personal',
  PRIMARY KEY (preview_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS import_duplicate_decisions_preview_status_idx
  ON import_duplicate_decisions(preview_id, status, updated_at);

CREATE TABLE IF NOT EXISTS ledger_preferences (
  ledger_id TEXT PRIMARY KEY REFERENCES ledgers(id),
  reporting_timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
  preferred_currency TEXT REFERENCES currencies(code),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledger_preferences (ledger_id, reporting_timezone, week_start, revision)
  VALUES ('personal', 'America/Toronto', 1, 0);



CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_insert BEFORE INSERT ON transactions WHEN NEW.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT NEW.date BEGIN SELECT RAISE(ABORT, 'transaction fx lock date must match date'); END;
CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_default AFTER INSERT ON transactions WHEN NEW.fx_lock_date IS NULL BEGIN UPDATE transactions SET fx_lock_date = NEW.date WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_immutable BEFORE UPDATE OF fx_lock_date ON transactions BEGIN SELECT RAISE(ABORT, 'transaction fx lock date is immutable') WHERE OLD.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT OLD.fx_lock_date; SELECT RAISE(ABORT, 'transaction fx lock date must match date') WHERE OLD.fx_lock_date IS NULL AND NEW.fx_lock_date IS NOT NEW.date; END;

CREATE TRIGGER IF NOT EXISTS fx_rate_snapshots_immutable_update BEFORE UPDATE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS fx_rate_snapshots_immutable_delete BEFORE DELETE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;

CREATE TRIGGER alert_event_links_same_scope BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert link ledger mismatch') WHERE (NEW.to_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN alert_events target ON target.id = NEW.to_event_id WHERE source.id = NEW.from_event_id AND (source.ledger_id <> target.ledger_id OR (source.account_id IS NOT NULL AND target.account_id IS NOT NULL AND source.account_id <> target.account_id)))) OR (NEW.to_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN transactions target ON target.id = NEW.to_transaction_id WHERE source.id = NEW.from_event_id AND source.account_id IS NOT NULL AND source.account_id <> target.account_id)); END;
CREATE TRIGGER IF NOT EXISTS alert_event_links_no_cycle BEFORE INSERT ON alert_event_links WHEN NEW.to_event_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'alert event link cycle') WHERE EXISTS (WITH RECURSIVE reachable(id) AS (SELECT NEW.to_event_id UNION ALL SELECT l.to_event_id FROM alert_event_links l JOIN reachable r ON l.from_event_id = r.id WHERE l.to_event_id IS NOT NULL) SELECT 1 FROM reachable WHERE id = NEW.from_event_id); END;
CREATE TRIGGER IF NOT EXISTS alert_events_immutable_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_events_immutable_delete BEFORE DELETE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_event_digests_immutable_update BEFORE UPDATE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert event digests are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_event_digests_immutable_delete BEFORE DELETE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert event digests are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_event_links_immutable_update BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_event_links_immutable_delete BEFORE DELETE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_projection_provenance_immutable_update BEFORE UPDATE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS alert_projection_provenance_immutable_delete BEFORE DELETE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert projection provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS annotation_revisions_immutable_update BEFORE UPDATE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS annotation_revisions_immutable_delete BEFORE DELETE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;

CREATE TRIGGER accounts_default_currency_insert AFTER INSERT ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency, ledger_id) VALUES (NEW.id, NEW.currency, NEW.ledger_id); END;
CREATE TRIGGER accounts_default_currency_update AFTER UPDATE OF currency ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency, ledger_id) VALUES (NEW.id, NEW.currency, NEW.ledger_id); END;
CREATE TRIGGER user_identities_no_takeover BEFORE INSERT ON user_identities BEGIN SELECT RAISE(ABORT, 'identity is already assigned') WHERE EXISTS (SELECT 1 FROM user_identities WHERE issuer = NEW.issuer AND subject = NEW.subject AND user_id <> NEW.user_id); END;
CREATE TRIGGER user_identities_immutable_update BEFORE UPDATE ON user_identities BEGIN SELECT RAISE(ABORT, 'identity mappings are immutable'); END;
CREATE TRIGGER user_identities_immutable_delete BEFORE DELETE ON user_identities BEGIN SELECT RAISE(ABORT, 'identity mappings are immutable'); END;
CREATE TRIGGER ledgers_owner_insert BEFORE INSERT ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger owner is required') WHERE NEW.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id); END;
CREATE TRIGGER ledgers_owner_update BEFORE UPDATE OF user_id, id ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.user_id IS NOT OLD.user_id OR NEW.id IS NOT OLD.id; END;
CREATE TRIGGER accounts_ledger_scope_insert BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER accounts_ledger_scope_update BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER accounts_ledger_immutable BEFORE UPDATE OF ledger_id ON accounts BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER account_currencies_ledger_scope_insert BEFORE INSERT ON account_currencies BEGIN SELECT RAISE(ABORT, 'account_currencies ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER account_currencies_ledger_scope_update BEFORE UPDATE ON account_currencies BEGIN SELECT RAISE(ABORT, 'account_currencies ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER account_currencies_ledger_immutable BEFORE UPDATE OF ledger_id ON account_currencies BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER transactions_ledger_scope_insert BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT, 'transactions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER transactions_ledger_scope_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT, 'transactions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER transactions_ledger_immutable BEFORE UPDATE OF ledger_id ON transactions BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER imports_ledger_scope_insert BEFORE INSERT ON imports BEGIN SELECT RAISE(ABORT, 'imports ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER imports_ledger_scope_update BEFORE UPDATE ON imports BEGIN SELECT RAISE(ABORT, 'imports ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER imports_ledger_immutable BEFORE UPDATE OF ledger_id ON imports BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER sync_state_ledger_scope_insert BEFORE INSERT ON sync_state BEGIN SELECT RAISE(ABORT, 'sync_state ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER sync_state_ledger_scope_update BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'sync_state ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER sync_state_ledger_immutable BEFORE UPDATE OF ledger_id ON sync_state BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER plaid_items_ledger_scope_insert BEFORE INSERT ON plaid_items BEGIN SELECT RAISE(ABORT, 'plaid_items ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER plaid_items_ledger_scope_update BEFORE UPDATE ON plaid_items BEGIN SELECT RAISE(ABORT, 'plaid_items ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER plaid_items_ledger_immutable BEFORE UPDATE OF ledger_id ON plaid_items BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER plaid_accounts_ledger_scope_insert BEFORE INSERT ON plaid_accounts BEGIN SELECT RAISE(ABORT, 'plaid_accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER plaid_accounts_ledger_scope_update BEFORE UPDATE ON plaid_accounts BEGIN SELECT RAISE(ABORT, 'plaid_accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER plaid_accounts_ledger_immutable BEFORE UPDATE OF ledger_id ON plaid_accounts BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER lunchflow_accounts_ledger_scope_insert BEFORE INSERT ON lunchflow_accounts BEGIN SELECT RAISE(ABORT, 'lunchflow_accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER lunchflow_accounts_ledger_scope_update BEFORE UPDATE ON lunchflow_accounts BEGIN SELECT RAISE(ABORT, 'lunchflow_accounts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER lunchflow_accounts_ledger_immutable BEFORE UPDATE OF ledger_id ON lunchflow_accounts BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER mobile_connections_ledger_scope_insert BEFORE INSERT ON mobile_connections BEGIN SELECT RAISE(ABORT, 'mobile_connections ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_connections_ledger_scope_update BEFORE UPDATE ON mobile_connections BEGIN SELECT RAISE(ABORT, 'mobile_connections ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_connections_ledger_immutable BEFORE UPDATE OF ledger_id ON mobile_connections BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER mobile_connection_operations_ledger_scope_insert BEFORE INSERT ON mobile_connection_operations BEGIN SELECT RAISE(ABORT, 'mobile_connection_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_connection_operations_ledger_scope_update BEFORE UPDATE ON mobile_connection_operations BEGIN SELECT RAISE(ABORT, 'mobile_connection_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_connection_operations_ledger_immutable BEFORE UPDATE OF ledger_id ON mobile_connection_operations BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER lunchflow_operations_ledger_scope_insert BEFORE INSERT ON lunchflow_operations BEGIN SELECT RAISE(ABORT, 'lunchflow_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER lunchflow_operations_ledger_scope_update BEFORE UPDATE ON lunchflow_operations BEGIN SELECT RAISE(ABORT, 'lunchflow_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER lunchflow_operations_ledger_immutable BEFORE UPDATE OF ledger_id ON lunchflow_operations BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER recurring_streams_ledger_scope_insert BEFORE INSERT ON recurring_streams BEGIN SELECT RAISE(ABORT, 'recurring_streams ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_streams_ledger_scope_update BEFORE UPDATE ON recurring_streams BEGIN SELECT RAISE(ABORT, 'recurring_streams ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_streams_ledger_immutable BEFORE UPDATE OF ledger_id ON recurring_streams BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER recurring_stream_transactions_ledger_scope_insert BEFORE INSERT ON recurring_stream_transactions BEGIN SELECT RAISE(ABORT, 'recurring_stream_transactions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.recurring_stream_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recurring_streams WHERE id = NEW.recurring_stream_id AND ledger_id = NEW.ledger_id)) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_stream_transactions_ledger_scope_update BEFORE UPDATE ON recurring_stream_transactions BEGIN SELECT RAISE(ABORT, 'recurring_stream_transactions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.recurring_stream_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recurring_streams WHERE id = NEW.recurring_stream_id AND ledger_id = NEW.ledger_id)) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_stream_transactions_ledger_immutable BEFORE UPDATE OF ledger_id ON recurring_stream_transactions BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER recurring_classifications_ledger_scope_insert BEFORE INSERT ON recurring_classifications BEGIN SELECT RAISE(ABORT, 'recurring_classifications ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.recurring_stream_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recurring_streams WHERE id = NEW.recurring_stream_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_classifications_ledger_scope_update BEFORE UPDATE ON recurring_classifications BEGIN SELECT RAISE(ABORT, 'recurring_classifications ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.recurring_stream_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recurring_streams WHERE id = NEW.recurring_stream_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_classifications_ledger_immutable BEFORE UPDATE OF ledger_id ON recurring_classifications BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER recurring_sync_state_ledger_scope_insert BEFORE INSERT ON recurring_sync_state BEGIN SELECT RAISE(ABORT, 'recurring_sync_state ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_sync_state_ledger_scope_update BEFORE UPDATE ON recurring_sync_state BEGIN SELECT RAISE(ABORT, 'recurring_sync_state ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plaid_items WHERE item_id = NEW.item_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER recurring_sync_state_ledger_immutable BEFORE UPDATE OF ledger_id ON recurring_sync_state BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER source_profiles_ledger_scope_insert BEFORE INSERT ON source_profiles BEGIN SELECT RAISE(ABORT, 'source_profiles ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER source_profiles_ledger_scope_update BEFORE UPDATE ON source_profiles BEGIN SELECT RAISE(ABORT, 'source_profiles ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER source_profiles_ledger_immutable BEFORE UPDATE OF ledger_id ON source_profiles BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER source_profile_hints_ledger_scope_insert BEFORE INSERT ON source_profile_hints BEGIN SELECT RAISE(ABORT, 'source_profile_hints ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER source_profile_hints_ledger_scope_update BEFORE UPDATE ON source_profile_hints BEGIN SELECT RAISE(ABORT, 'source_profile_hints ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER source_profile_hints_ledger_immutable BEFORE UPDATE OF ledger_id ON source_profile_hints BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER source_account_mappings_ledger_scope_insert BEFORE INSERT ON source_account_mappings BEGIN SELECT RAISE(ABORT, 'source_account_mappings ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER source_account_mappings_ledger_scope_update BEFORE UPDATE ON source_account_mappings BEGIN SELECT RAISE(ABORT, 'source_account_mappings ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER source_account_mappings_ledger_immutable BEFORE UPDATE OF ledger_id ON source_account_mappings BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER mobile_devices_ledger_scope_insert BEFORE INSERT ON mobile_devices BEGIN SELECT RAISE(ABORT, 'mobile_devices ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_devices_ledger_scope_update BEFORE UPDATE ON mobile_devices BEGIN SELECT RAISE(ABORT, 'mobile_devices ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER mobile_devices_ledger_immutable BEFORE UPDATE OF ledger_id ON mobile_devices BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER device_pairings_ledger_scope_insert BEFORE INSERT ON device_pairings BEGIN SELECT RAISE(ABORT, 'device_pairings ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER device_pairings_ledger_scope_update BEFORE UPDATE ON device_pairings BEGIN SELECT RAISE(ABORT, 'device_pairings ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER device_pairings_ledger_immutable BEFORE UPDATE OF ledger_id ON device_pairings BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER capture_credentials_ledger_scope_insert BEFORE INSERT ON capture_credentials BEGIN SELECT RAISE(ABORT, 'capture_credentials ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER capture_credentials_ledger_scope_update BEFORE UPDATE ON capture_credentials BEGIN SELECT RAISE(ABORT, 'capture_credentials ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER capture_credentials_ledger_immutable BEFORE UPDATE OF ledger_id ON capture_credentials BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER device_source_scopes_ledger_scope_insert BEFORE INSERT ON device_source_scopes BEGIN SELECT RAISE(ABORT, 'device_source_scopes ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER device_source_scopes_ledger_scope_update BEFORE UPDATE ON device_source_scopes BEGIN SELECT RAISE(ABORT, 'device_source_scopes ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER device_source_scopes_ledger_immutable BEFORE UPDATE OF ledger_id ON device_source_scopes BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER transaction_source_records_ledger_scope_insert BEFORE INSERT ON transaction_source_records BEGIN SELECT RAISE(ABORT, 'transaction_source_records ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)) OR (NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND account_id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER transaction_source_records_ledger_scope_update BEFORE UPDATE ON transaction_source_records BEGIN SELECT RAISE(ABORT, 'transaction_source_records ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)) OR (NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND account_id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER transaction_source_records_ledger_immutable BEFORE UPDATE OF ledger_id ON transaction_source_records BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER statement_reconciliation_candidates_ledger_scope_insert BEFORE INSERT ON statement_reconciliation_candidates BEGIN SELECT RAISE(ABORT, 'statement_reconciliation_candidates ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transaction_source_records WHERE id = NEW.source_record_id AND ledger_id = NEW.ledger_id)) OR (NEW.statement_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.statement_transaction_id AND ledger_id = NEW.ledger_id)) OR (NEW.candidate_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.candidate_transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER statement_reconciliation_candidates_ledger_scope_update BEFORE UPDATE ON statement_reconciliation_candidates BEGIN SELECT RAISE(ABORT, 'statement_reconciliation_candidates ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.source_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transaction_source_records WHERE id = NEW.source_record_id AND ledger_id = NEW.ledger_id)) OR (NEW.statement_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.statement_transaction_id AND ledger_id = NEW.ledger_id)) OR (NEW.candidate_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.candidate_transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER statement_reconciliation_candidates_ledger_immutable BEFORE UPDATE OF ledger_id ON statement_reconciliation_candidates BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER import_commit_operations_ledger_scope_insert BEFORE INSERT ON import_commit_operations BEGIN SELECT RAISE(ABORT, 'import_commit_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_commit_operations_ledger_scope_update BEFORE UPDATE ON import_commit_operations BEGIN SELECT RAISE(ABORT, 'import_commit_operations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_commit_operations_ledger_immutable BEFORE UPDATE OF ledger_id ON import_commit_operations BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_events_ledger_scope_insert BEFORE INSERT ON alert_events BEGIN SELECT RAISE(ABORT, 'alert_events ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_events_ledger_scope_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert_events ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)) OR (NEW.source_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_profiles WHERE id = NEW.source_profile_id AND ledger_id = NEW.ledger_id)) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_events_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_events BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_event_digests_ledger_scope_insert BEFORE INSERT ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert_event_digests ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.event_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_event_digests_ledger_scope_update BEFORE UPDATE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert_event_digests ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.event_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_event_digests_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_projections_ledger_scope_insert BEFORE INSERT ON alert_projections BEGIN SELECT RAISE(ABORT, 'alert_projections ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.event_id AND ledger_id = NEW.ledger_id)) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_projections_ledger_scope_update BEFORE UPDATE ON alert_projections BEGIN SELECT RAISE(ABORT, 'alert_projections ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.event_id AND ledger_id = NEW.ledger_id)) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_projections_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_projections BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_projection_provenance_ledger_scope_insert BEFORE INSERT ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert_projection_provenance ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.projection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_projections WHERE id = NEW.projection_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_projection_provenance_ledger_scope_update BEFORE UPDATE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert_projection_provenance ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.projection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_projections WHERE id = NEW.projection_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_projection_provenance_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_event_links_ledger_scope_insert BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert_event_links ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.from_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.from_event_id AND ledger_id = NEW.ledger_id)) OR (NEW.to_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.to_event_id AND ledger_id = NEW.ledger_id)) OR (NEW.to_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.to_transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_event_links_ledger_scope_update BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert_event_links ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.from_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.from_event_id AND ledger_id = NEW.ledger_id)) OR (NEW.to_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_events WHERE id = NEW.to_event_id AND ledger_id = NEW.ledger_id)) OR (NEW.to_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.to_transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER alert_event_links_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_event_links BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER alert_event_link_conflicts_ledger_scope_insert BEFORE INSERT ON alert_event_link_conflicts BEGIN SELECT RAISE(ABORT, 'alert_event_link_conflicts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER alert_event_link_conflicts_ledger_scope_update BEFORE UPDATE ON alert_event_link_conflicts BEGIN SELECT RAISE(ABORT, 'alert_event_link_conflicts ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER alert_event_link_conflicts_ledger_immutable BEFORE UPDATE OF ledger_id ON alert_event_link_conflicts BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER annotation_revisions_ledger_scope_insert BEFORE INSERT ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation_revisions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER annotation_revisions_ledger_scope_update BEFORE UPDATE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation_revisions ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER annotation_revisions_ledger_immutable BEFORE UPDATE OF ledger_id ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER mobile_auth_requests_ledger_scope_insert BEFORE INSERT ON mobile_auth_requests BEGIN SELECT RAISE(ABORT, 'mobile_auth_requests ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER mobile_auth_requests_ledger_scope_update BEFORE UPDATE ON mobile_auth_requests BEGIN SELECT RAISE(ABORT, 'mobile_auth_requests ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER mobile_auth_requests_ledger_immutable BEFORE UPDATE OF ledger_id ON mobile_auth_requests BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER owner_session_families_ledger_scope_insert BEFORE INSERT ON owner_session_families BEGIN SELECT RAISE(ABORT, 'owner_session_families ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER owner_session_families_ledger_scope_update BEFORE UPDATE ON owner_session_families BEGIN SELECT RAISE(ABORT, 'owner_session_families ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.device_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mobile_devices WHERE id = NEW.device_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER owner_session_families_ledger_immutable BEFORE UPDATE OF ledger_id ON owner_session_families BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER owner_refresh_generations_ledger_scope_insert BEFORE INSERT ON owner_refresh_generations BEGIN SELECT RAISE(ABORT, 'owner_refresh_generations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM owner_session_families WHERE id = NEW.family_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER owner_refresh_generations_ledger_scope_update BEFORE UPDATE ON owner_refresh_generations BEGIN SELECT RAISE(ABORT, 'owner_refresh_generations ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM owner_session_families WHERE id = NEW.family_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER owner_refresh_generations_ledger_immutable BEFORE UPDATE OF ledger_id ON owner_refresh_generations BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER owner_replay_records_ledger_scope_insert BEFORE INSERT ON owner_replay_records BEGIN SELECT RAISE(ABORT, 'owner_replay_records ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER owner_replay_records_ledger_scope_update BEFORE UPDATE ON owner_replay_records BEGIN SELECT RAISE(ABORT, 'owner_replay_records ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER owner_replay_records_ledger_immutable BEFORE UPDATE OF ledger_id ON owner_replay_records BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER import_previews_ledger_scope_insert BEFORE INSERT ON import_previews BEGIN SELECT RAISE(ABORT, 'import_previews ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_previews_ledger_scope_update BEFORE UPDATE ON import_previews BEGIN SELECT RAISE(ABORT, 'import_previews ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_previews_ledger_immutable BEFORE UPDATE OF ledger_id ON import_previews BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER import_chunks_ledger_scope_insert BEFORE INSERT ON import_chunks BEGIN SELECT RAISE(ABORT, 'import_chunks ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_previews WHERE id = NEW.preview_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_chunks_ledger_scope_update BEFORE UPDATE ON import_chunks BEGIN SELECT RAISE(ABORT, 'import_chunks ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_previews WHERE id = NEW.preview_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_chunks_ledger_immutable BEFORE UPDATE OF ledger_id ON import_chunks BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER import_preview_errors_ledger_scope_insert BEFORE INSERT ON import_preview_errors BEGIN SELECT RAISE(ABORT, 'import_preview_errors ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_previews WHERE id = NEW.preview_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_preview_errors_ledger_scope_update BEFORE UPDATE ON import_preview_errors BEGIN SELECT RAISE(ABORT, 'import_preview_errors ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id) OR (NEW.preview_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM import_previews WHERE id = NEW.preview_id AND ledger_id = NEW.ledger_id)); END;
CREATE TRIGGER import_preview_errors_ledger_immutable BEFORE UPDATE OF ledger_id ON import_preview_errors BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER import_duplicate_decisions_ledger_scope_insert BEFORE INSERT ON import_duplicate_decisions BEGIN
  SELECT RAISE(ABORT, 'import_duplicate_decisions ledger mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM import_previews p JOIN transactions candidate
      ON candidate.id = NEW.candidate_transaction_id AND candidate.ledger_id = p.ledger_id AND candidate.account_id = p.account_id
    WHERE p.id = NEW.preview_id AND p.ledger_id = NEW.ledger_id AND (
      EXISTS (SELECT 1 FROM transactions statement WHERE statement.id = NEW.statement_transaction_id
        AND statement.ledger_id = p.ledger_id AND statement.account_id = p.account_id)
      OR EXISTS (SELECT 1 FROM import_chunks chunk, json_each(chunk.rows_json) staged
        WHERE chunk.preview_id = p.id AND chunk.ledger_id = p.ledger_id
          AND (json_extract(staged.value, '$.rowId') = NEW.statement_transaction_id OR json_extract(staged.value, '$.canonicalTransactionId') = NEW.statement_transaction_id)
          AND json_extract(staged.value, '$.accountId') = p.account_id)
    )
  ); END;
CREATE TRIGGER import_duplicate_decisions_ledger_scope_update BEFORE UPDATE ON import_duplicate_decisions BEGIN
  SELECT RAISE(ABORT, 'import_duplicate_decisions ledger mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM import_previews p JOIN transactions candidate
      ON candidate.id = NEW.candidate_transaction_id AND candidate.ledger_id = p.ledger_id AND candidate.account_id = p.account_id
    WHERE p.id = NEW.preview_id AND p.ledger_id = NEW.ledger_id AND (
      EXISTS (SELECT 1 FROM transactions statement WHERE statement.id = NEW.statement_transaction_id
        AND statement.ledger_id = p.ledger_id AND statement.account_id = p.account_id)
      OR EXISTS (SELECT 1 FROM import_chunks chunk, json_each(chunk.rows_json) staged
        WHERE chunk.preview_id = p.id AND chunk.ledger_id = p.ledger_id
          AND (json_extract(staged.value, '$.rowId') = NEW.statement_transaction_id OR json_extract(staged.value, '$.canonicalTransactionId') = NEW.statement_transaction_id)
          AND json_extract(staged.value, '$.accountId') = p.account_id)
    )
  ); END;
CREATE TRIGGER import_duplicate_decisions_ledger_immutable BEFORE UPDATE OF ledger_id ON import_duplicate_decisions BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;
CREATE TRIGGER ledger_preferences_ledger_scope_insert BEFORE INSERT ON ledger_preferences BEGIN SELECT RAISE(ABORT, 'ledger_preferences ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER ledger_preferences_ledger_scope_update BEFORE UPDATE ON ledger_preferences BEGIN SELECT RAISE(ABORT, 'ledger_preferences ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE id = NEW.ledger_id); END;
CREATE TRIGGER ledger_preferences_ledger_immutable BEFORE UPDATE OF ledger_id ON ledger_preferences BEGIN SELECT RAISE(ABORT, 'ledger ownership is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id; END;

CREATE TRIGGER users_owned_ledger_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'user owns a ledger') WHERE EXISTS (SELECT 1 FROM ledgers WHERE user_id = OLD.id); END;
CREATE TRIGGER users_owned_ledger_id_update BEFORE UPDATE OF id ON users BEGIN SELECT RAISE(ABORT, 'user identity is immutable') WHERE NEW.id IS NOT OLD.id AND EXISTS (SELECT 1 FROM ledgers WHERE user_id = OLD.id); END;

CREATE TRIGGER ledgers_accounts_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains accounts') WHERE EXISTS (SELECT 1 FROM accounts WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_account_currencies_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains account_currencies') WHERE EXISTS (SELECT 1 FROM account_currencies WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_transactions_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains transactions') WHERE EXISTS (SELECT 1 FROM transactions WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_imports_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains imports') WHERE EXISTS (SELECT 1 FROM imports WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_sync_state_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains sync_state') WHERE EXISTS (SELECT 1 FROM sync_state WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_plaid_items_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains plaid_items') WHERE EXISTS (SELECT 1 FROM plaid_items WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_plaid_accounts_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains plaid_accounts') WHERE EXISTS (SELECT 1 FROM plaid_accounts WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_recurring_streams_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains recurring_streams') WHERE EXISTS (SELECT 1 FROM recurring_streams WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_recurring_stream_transactions_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains recurring_stream_transactions') WHERE EXISTS (SELECT 1 FROM recurring_stream_transactions WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_recurring_classifications_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains recurring_classifications') WHERE EXISTS (SELECT 1 FROM recurring_classifications WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_recurring_sync_state_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains recurring_sync_state') WHERE EXISTS (SELECT 1 FROM recurring_sync_state WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_source_profile_hints_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains source_profile_hints') WHERE EXISTS (SELECT 1 FROM source_profile_hints WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_capture_credentials_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains capture_credentials') WHERE EXISTS (SELECT 1 FROM capture_credentials WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_device_source_scopes_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains device_source_scopes') WHERE EXISTS (SELECT 1 FROM device_source_scopes WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_alert_event_digests_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains alert_event_digests') WHERE EXISTS (SELECT 1 FROM alert_event_digests WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_owner_refresh_generations_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains owner_refresh_generations') WHERE EXISTS (SELECT 1 FROM owner_refresh_generations WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_import_chunks_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains import_chunks') WHERE EXISTS (SELECT 1 FROM import_chunks WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_import_preview_errors_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains import_preview_errors') WHERE EXISTS (SELECT 1 FROM import_preview_errors WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_import_duplicate_decisions_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains import_duplicate_decisions') WHERE EXISTS (SELECT 1 FROM import_duplicate_decisions WHERE ledger_id = OLD.id); END;
CREATE TRIGGER ledgers_alert_event_link_conflicts_delete_guard BEFORE DELETE ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger contains alert_event_link_conflicts') WHERE EXISTS (SELECT 1 FROM alert_event_link_conflicts WHERE ledger_id = OLD.id); END;

-- INSERT collision checks run before REPLACE can implicitly delete an existing owner row.
-- Do not rely on recursive_triggers: every global primary/unique key is checked.
CREATE TRIGGER ledgers_owner_insert_collision BEFORE INSERT ON ledgers BEGIN SELECT RAISE(ABORT, 'ledger ownership collision') WHERE NEW.id IS NULL OR length(trim(NEW.id)) = 0 OR EXISTS (SELECT 1 FROM ledgers WHERE (id = NEW.id AND user_id IS NOT NEW.user_id) OR (user_id = NEW.user_id AND id IS NOT NEW.id)); END;
CREATE TRIGGER accounts_ownership_insert_collision BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'accounts ownership collision') WHERE EXISTS (SELECT 1 FROM accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER account_currencies_ownership_insert_collision BEFORE INSERT ON account_currencies BEGIN SELECT RAISE(ABORT, 'account_currencies ownership collision') WHERE EXISTS (SELECT 1 FROM account_currencies existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.account_id = NEW.account_id AND existing.currency = NEW.currency))); END;
CREATE TRIGGER transactions_ownership_insert_collision BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT, 'transactions ownership collision') WHERE EXISTS (SELECT 1 FROM transactions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.plaid_item_id = NEW.plaid_item_id AND existing.provider_transaction_id = NEW.provider_transaction_id) OR (existing.id = NEW.id AND existing.account_id = NEW.account_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER imports_ownership_insert_collision BEFORE INSERT ON imports BEGIN SELECT RAISE(ABORT, 'imports ownership collision') WHERE EXISTS (SELECT 1 FROM imports existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER sync_state_ownership_insert_collision BEFORE INSERT ON sync_state BEGIN SELECT RAISE(ABORT, 'sync_state ownership collision') WHERE EXISTS (SELECT 1 FROM sync_state existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.connection_id = NEW.connection_id))); END;
CREATE TRIGGER plaid_items_ownership_insert_collision BEFORE INSERT ON plaid_items BEGIN SELECT RAISE(ABORT, 'plaid_items ownership collision') WHERE EXISTS (SELECT 1 FROM plaid_items existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id))); END;
CREATE TRIGGER plaid_accounts_ownership_insert_collision BEFORE INSERT ON plaid_accounts BEGIN SELECT RAISE(ABORT, 'plaid_accounts ownership collision') WHERE EXISTS (SELECT 1 FROM plaid_accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.plaid_account_id = NEW.plaid_account_id))); END;
CREATE TRIGGER lunchflow_accounts_ownership_insert_collision BEFORE INSERT ON lunchflow_accounts BEGIN SELECT RAISE(ABORT, 'lunchflow_accounts ownership collision') WHERE EXISTS (SELECT 1 FROM lunchflow_accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.provider_account_id = NEW.provider_account_id) OR (existing.account_id = NEW.account_id))); END;
CREATE TRIGGER mobile_connections_ownership_insert_collision BEFORE INSERT ON mobile_connections BEGIN SELECT RAISE(ABORT, 'mobile_connections ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_connections existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER mobile_connection_operations_ownership_insert_collision BEFORE INSERT ON mobile_connection_operations BEGIN SELECT RAISE(ABORT, 'mobile_connection_operations ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_connection_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.owner_subject_hash = NEW.owner_subject_hash AND existing.operation_kind = NEW.operation_kind AND existing.idempotency_key = NEW.idempotency_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER lunchflow_operations_ownership_insert_collision BEFORE INSERT ON lunchflow_operations BEGIN SELECT RAISE(ABORT, 'lunchflow_operations ownership collision') WHERE EXISTS (SELECT 1 FROM lunchflow_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.owner_subject_hash = NEW.owner_subject_hash AND existing.operation_kind = NEW.operation_kind AND existing.idempotency_key = NEW.idempotency_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER recurring_streams_ownership_insert_collision BEFORE INSERT ON recurring_streams BEGIN SELECT RAISE(ABORT, 'recurring_streams ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_streams existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id AND existing.stream_id = NEW.stream_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER recurring_stream_transactions_ownership_insert_collision BEFORE INSERT ON recurring_stream_transactions BEGIN SELECT RAISE(ABORT, 'recurring_stream_transactions ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_stream_transactions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.recurring_stream_id = NEW.recurring_stream_id AND existing.provider_transaction_id = NEW.provider_transaction_id))); END;
CREATE TRIGGER recurring_classifications_ownership_insert_collision BEFORE INSERT ON recurring_classifications BEGIN SELECT RAISE(ABORT, 'recurring_classifications ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_classifications existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.recurring_stream_id = NEW.recurring_stream_id))); END;
CREATE TRIGGER recurring_sync_state_ownership_insert_collision BEFORE INSERT ON recurring_sync_state BEGIN SELECT RAISE(ABORT, 'recurring_sync_state ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_sync_state existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id))); END;
CREATE TRIGGER source_profiles_ownership_insert_collision BEFORE INSERT ON source_profiles BEGIN SELECT RAISE(ABORT, 'source_profiles ownership collision') WHERE EXISTS (SELECT 1 FROM source_profiles existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.provider = NEW.provider AND existing.source_kind = NEW.source_kind) OR (existing.id = NEW.id))); END;
CREATE TRIGGER source_profile_hints_ownership_insert_collision BEFORE INSERT ON source_profile_hints BEGIN SELECT RAISE(ABORT, 'source_profile_hints ownership collision') WHERE EXISTS (SELECT 1 FROM source_profile_hints existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.source_profile_id = NEW.source_profile_id AND existing.hint_kind = NEW.hint_kind AND existing.hint_value = NEW.hint_value) OR (existing.id = NEW.id))); END;
CREATE TRIGGER source_account_mappings_ownership_insert_collision BEFORE INSERT ON source_account_mappings BEGIN SELECT RAISE(ABORT, 'source_account_mappings ownership collision') WHERE EXISTS (SELECT 1 FROM source_account_mappings existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.source_profile_id = NEW.source_profile_id AND existing.hint_kind = NEW.hint_kind AND existing.hint_value = NEW.hint_value AND existing.account_id = NEW.account_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER mobile_devices_ownership_insert_collision BEFORE INSERT ON mobile_devices BEGIN SELECT RAISE(ABORT, 'mobile_devices ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_devices existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER device_pairings_ownership_insert_collision BEFORE INSERT ON device_pairings BEGIN SELECT RAISE(ABORT, 'device_pairings ownership collision') WHERE EXISTS (SELECT 1 FROM device_pairings existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.user_code_hash = NEW.user_code_hash) OR (existing.device_verifier_hash = NEW.device_verifier_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER capture_credentials_ownership_insert_collision BEFORE INSERT ON capture_credentials BEGIN SELECT RAISE(ABORT, 'capture_credentials ownership collision') WHERE EXISTS (SELECT 1 FROM capture_credentials existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.credential_hash = NEW.credential_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER device_source_scopes_ownership_insert_collision BEFORE INSERT ON device_source_scopes BEGIN SELECT RAISE(ABORT, 'device_source_scopes ownership collision') WHERE EXISTS (SELECT 1 FROM device_source_scopes existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.device_id = NEW.device_id AND existing.source_profile_id = NEW.source_profile_id AND existing.account_id = NEW.account_id AND existing.currency = NEW.currency AND existing.instrument_hint_kind = NEW.instrument_hint_kind AND existing.instrument_hint_value = NEW.instrument_hint_value) OR (existing.id = NEW.id))); END;
CREATE TRIGGER transaction_source_records_ownership_insert_collision BEFORE INSERT ON transaction_source_records BEGIN SELECT RAISE(ABORT, 'transaction_source_records ownership collision') WHERE EXISTS (SELECT 1 FROM transaction_source_records existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.source_kind = NEW.source_kind AND existing.identity_key = NEW.identity_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER statement_reconciliation_candidates_ownership_insert_collision BEFORE INSERT ON statement_reconciliation_candidates BEGIN SELECT RAISE(ABORT, 'statement_reconciliation_candidates ownership collision') WHERE EXISTS (SELECT 1 FROM statement_reconciliation_candidates existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.source_record_id = NEW.source_record_id AND existing.candidate_transaction_id = NEW.candidate_transaction_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER import_commit_operations_ownership_insert_collision BEFORE INSERT ON import_commit_operations BEGIN SELECT RAISE(ABORT, 'import_commit_operations ownership collision') WHERE EXISTS (SELECT 1 FROM import_commit_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.account_id = NEW.account_id AND existing.file_sha256 = NEW.file_sha256) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_events_ownership_insert_collision BEFORE INSERT ON alert_events BEGIN SELECT RAISE(ABORT, 'alert_events ownership collision') WHERE EXISTS (SELECT 1 FROM alert_events existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.event_id = NEW.event_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_digests_ownership_insert_collision BEFORE INSERT ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert_event_digests ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_digests existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.event_id = NEW.event_id AND existing.algorithm = NEW.algorithm))); END;
CREATE TRIGGER alert_projections_ownership_insert_collision BEFORE INSERT ON alert_projections BEGIN SELECT RAISE(ABORT, 'alert_projections ownership collision') WHERE EXISTS (SELECT 1 FROM alert_projections existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.event_id = NEW.event_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_projection_provenance_ownership_insert_collision BEFORE INSERT ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert_projection_provenance ownership collision') WHERE EXISTS (SELECT 1 FROM alert_projection_provenance existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.projection_id = NEW.projection_id AND existing.source_kind = NEW.source_kind AND existing.source_id = NEW.source_id AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_links_ownership_insert_collision BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert_event_links ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_links existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.from_event_id = NEW.from_event_id) OR (existing.ledger_id = NEW.ledger_id AND existing.to_transaction_id = NEW.to_transaction_id) OR (existing.ledger_id = NEW.ledger_id AND existing.from_event_id = NEW.from_event_id AND existing.to_event_id = NEW.to_event_id AND existing.to_transaction_id = NEW.to_transaction_id AND existing.relation = NEW.relation AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_link_conflicts_ownership_insert_collision BEFORE INSERT ON alert_event_link_conflicts BEGIN SELECT RAISE(ABORT, 'alert_event_link_conflicts ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_link_conflicts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.original_link_id = NEW.original_link_id))); END;
CREATE TRIGGER annotation_revisions_ownership_insert_collision BEFORE INSERT ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation_revisions ownership collision') WHERE EXISTS (SELECT 1 FROM annotation_revisions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.transaction_id = NEW.transaction_id AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER mobile_auth_requests_ownership_insert_collision BEFORE INSERT ON mobile_auth_requests BEGIN SELECT RAISE(ABORT, 'mobile_auth_requests ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_auth_requests existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.state_hash = NEW.state_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER owner_session_families_ownership_insert_collision BEFORE INSERT ON owner_session_families BEGIN SELECT RAISE(ABORT, 'owner_session_families ownership collision') WHERE EXISTS (SELECT 1 FROM owner_session_families existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER owner_refresh_generations_ownership_insert_collision BEFORE INSERT ON owner_refresh_generations BEGIN SELECT RAISE(ABORT, 'owner_refresh_generations ownership collision') WHERE EXISTS (SELECT 1 FROM owner_refresh_generations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.token_hash = NEW.token_hash) OR (existing.family_id = NEW.family_id AND existing.generation = NEW.generation))); END;
CREATE TRIGGER owner_replay_records_ownership_insert_collision BEFORE INSERT ON owner_replay_records BEGIN SELECT RAISE(ABORT, 'owner_replay_records ownership collision') WHERE EXISTS (SELECT 1 FROM owner_replay_records existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.request_kind = NEW.request_kind AND existing.request_digest = NEW.request_digest) OR (existing.id = NEW.id))); END;
CREATE TRIGGER import_previews_ownership_insert_collision BEFORE INSERT ON import_previews BEGIN SELECT RAISE(ABORT, 'import_previews ownership collision') WHERE EXISTS (SELECT 1 FROM import_previews existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER import_chunks_ownership_insert_collision BEFORE INSERT ON import_chunks BEGIN SELECT RAISE(ABORT, 'import_chunks ownership collision') WHERE EXISTS (SELECT 1 FROM import_chunks existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id AND existing.chunk_digest = NEW.chunk_digest) OR (existing.preview_id = NEW.preview_id AND existing.chunk_index = NEW.chunk_index))); END;
CREATE TRIGGER import_preview_errors_ownership_insert_collision BEFORE INSERT ON import_preview_errors BEGIN SELECT RAISE(ABORT, 'import_preview_errors ownership collision') WHERE EXISTS (SELECT 1 FROM import_preview_errors existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id))); END;
CREATE TRIGGER import_duplicate_decisions_ownership_insert_collision BEFORE INSERT ON import_duplicate_decisions BEGIN SELECT RAISE(ABORT, 'import_duplicate_decisions ownership collision') WHERE EXISTS (SELECT 1 FROM import_duplicate_decisions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id AND existing.candidate_id = NEW.candidate_id))); END;
CREATE TRIGGER ledger_preferences_ownership_insert_collision BEFORE INSERT ON ledger_preferences BEGIN SELECT RAISE(ABORT, 'ledger_preferences ownership collision') WHERE EXISTS (SELECT 1 FROM ledger_preferences existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id))); END;

-- UPDATE OR REPLACE can delete a conflicting row too; protect the same keys.
CREATE TRIGGER accounts_ownership_update_collision BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'accounts ownership collision') WHERE EXISTS (SELECT 1 FROM accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER account_currencies_ownership_update_collision BEFORE UPDATE ON account_currencies BEGIN SELECT RAISE(ABORT, 'account_currencies ownership collision') WHERE EXISTS (SELECT 1 FROM account_currencies existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.account_id = NEW.account_id AND existing.currency = NEW.currency))); END;
CREATE TRIGGER transactions_ownership_update_collision BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT, 'transactions ownership collision') WHERE EXISTS (SELECT 1 FROM transactions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.plaid_item_id = NEW.plaid_item_id AND existing.provider_transaction_id = NEW.provider_transaction_id) OR (existing.id = NEW.id AND existing.account_id = NEW.account_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER imports_ownership_update_collision BEFORE UPDATE ON imports BEGIN SELECT RAISE(ABORT, 'imports ownership collision') WHERE EXISTS (SELECT 1 FROM imports existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER sync_state_ownership_update_collision BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'sync_state ownership collision') WHERE EXISTS (SELECT 1 FROM sync_state existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.connection_id = NEW.connection_id))); END;
CREATE TRIGGER plaid_items_ownership_update_collision BEFORE UPDATE ON plaid_items BEGIN SELECT RAISE(ABORT, 'plaid_items ownership collision') WHERE EXISTS (SELECT 1 FROM plaid_items existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id))); END;
CREATE TRIGGER plaid_accounts_ownership_update_collision BEFORE UPDATE ON plaid_accounts BEGIN SELECT RAISE(ABORT, 'plaid_accounts ownership collision') WHERE EXISTS (SELECT 1 FROM plaid_accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.plaid_account_id = NEW.plaid_account_id))); END;
CREATE TRIGGER lunchflow_accounts_ownership_update_collision BEFORE UPDATE ON lunchflow_accounts BEGIN SELECT RAISE(ABORT, 'lunchflow_accounts ownership collision') WHERE EXISTS (SELECT 1 FROM lunchflow_accounts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.provider_account_id = NEW.provider_account_id) OR (existing.account_id = NEW.account_id))); END;
CREATE TRIGGER mobile_connections_ownership_update_collision BEFORE UPDATE ON mobile_connections BEGIN SELECT RAISE(ABORT, 'mobile_connections ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_connections existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER mobile_connection_operations_ownership_update_collision BEFORE UPDATE ON mobile_connection_operations BEGIN SELECT RAISE(ABORT, 'mobile_connection_operations ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_connection_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.owner_subject_hash = NEW.owner_subject_hash AND existing.operation_kind = NEW.operation_kind AND existing.idempotency_key = NEW.idempotency_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER lunchflow_operations_ownership_update_collision BEFORE UPDATE ON lunchflow_operations BEGIN SELECT RAISE(ABORT, 'lunchflow_operations ownership collision') WHERE EXISTS (SELECT 1 FROM lunchflow_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.owner_subject_hash = NEW.owner_subject_hash AND existing.operation_kind = NEW.operation_kind AND existing.idempotency_key = NEW.idempotency_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER recurring_streams_ownership_update_collision BEFORE UPDATE ON recurring_streams BEGIN SELECT RAISE(ABORT, 'recurring_streams ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_streams existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id AND existing.stream_id = NEW.stream_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER recurring_stream_transactions_ownership_update_collision BEFORE UPDATE ON recurring_stream_transactions BEGIN SELECT RAISE(ABORT, 'recurring_stream_transactions ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_stream_transactions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.recurring_stream_id = NEW.recurring_stream_id AND existing.provider_transaction_id = NEW.provider_transaction_id))); END;
CREATE TRIGGER recurring_classifications_ownership_update_collision BEFORE UPDATE ON recurring_classifications BEGIN SELECT RAISE(ABORT, 'recurring_classifications ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_classifications existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.recurring_stream_id = NEW.recurring_stream_id))); END;
CREATE TRIGGER recurring_sync_state_ownership_update_collision BEFORE UPDATE ON recurring_sync_state BEGIN SELECT RAISE(ABORT, 'recurring_sync_state ownership collision') WHERE EXISTS (SELECT 1 FROM recurring_sync_state existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.item_id = NEW.item_id))); END;
CREATE TRIGGER source_profiles_ownership_update_collision BEFORE UPDATE ON source_profiles BEGIN SELECT RAISE(ABORT, 'source_profiles ownership collision') WHERE EXISTS (SELECT 1 FROM source_profiles existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.provider = NEW.provider AND existing.source_kind = NEW.source_kind) OR (existing.id = NEW.id))); END;
CREATE TRIGGER source_profile_hints_ownership_update_collision BEFORE UPDATE ON source_profile_hints BEGIN SELECT RAISE(ABORT, 'source_profile_hints ownership collision') WHERE EXISTS (SELECT 1 FROM source_profile_hints existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.source_profile_id = NEW.source_profile_id AND existing.hint_kind = NEW.hint_kind AND existing.hint_value = NEW.hint_value) OR (existing.id = NEW.id))); END;
CREATE TRIGGER source_account_mappings_ownership_update_collision BEFORE UPDATE ON source_account_mappings BEGIN SELECT RAISE(ABORT, 'source_account_mappings ownership collision') WHERE EXISTS (SELECT 1 FROM source_account_mappings existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.source_profile_id = NEW.source_profile_id AND existing.hint_kind = NEW.hint_kind AND existing.hint_value = NEW.hint_value AND existing.account_id = NEW.account_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER mobile_devices_ownership_update_collision BEFORE UPDATE ON mobile_devices BEGIN SELECT RAISE(ABORT, 'mobile_devices ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_devices existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER device_pairings_ownership_update_collision BEFORE UPDATE ON device_pairings BEGIN SELECT RAISE(ABORT, 'device_pairings ownership collision') WHERE EXISTS (SELECT 1 FROM device_pairings existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.user_code_hash = NEW.user_code_hash) OR (existing.device_verifier_hash = NEW.device_verifier_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER capture_credentials_ownership_update_collision BEFORE UPDATE ON capture_credentials BEGIN SELECT RAISE(ABORT, 'capture_credentials ownership collision') WHERE EXISTS (SELECT 1 FROM capture_credentials existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.credential_hash = NEW.credential_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER device_source_scopes_ownership_update_collision BEFORE UPDATE ON device_source_scopes BEGIN SELECT RAISE(ABORT, 'device_source_scopes ownership collision') WHERE EXISTS (SELECT 1 FROM device_source_scopes existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.device_id = NEW.device_id AND existing.source_profile_id = NEW.source_profile_id AND existing.account_id = NEW.account_id AND existing.currency = NEW.currency AND existing.instrument_hint_kind = NEW.instrument_hint_kind AND existing.instrument_hint_value = NEW.instrument_hint_value) OR (existing.id = NEW.id))); END;
CREATE TRIGGER transaction_source_records_ownership_update_collision BEFORE UPDATE ON transaction_source_records BEGIN SELECT RAISE(ABORT, 'transaction_source_records ownership collision') WHERE EXISTS (SELECT 1 FROM transaction_source_records existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.source_kind = NEW.source_kind AND existing.identity_key = NEW.identity_key) OR (existing.id = NEW.id))); END;
CREATE TRIGGER statement_reconciliation_candidates_ownership_update_collision BEFORE UPDATE ON statement_reconciliation_candidates BEGIN SELECT RAISE(ABORT, 'statement_reconciliation_candidates ownership collision') WHERE EXISTS (SELECT 1 FROM statement_reconciliation_candidates existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.source_record_id = NEW.source_record_id AND existing.candidate_transaction_id = NEW.candidate_transaction_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER import_commit_operations_ownership_update_collision BEFORE UPDATE ON import_commit_operations BEGIN SELECT RAISE(ABORT, 'import_commit_operations ownership collision') WHERE EXISTS (SELECT 1 FROM import_commit_operations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.account_id = NEW.account_id AND existing.file_sha256 = NEW.file_sha256) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_events_ownership_update_collision BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert_events ownership collision') WHERE EXISTS (SELECT 1 FROM alert_events existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.event_id = NEW.event_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_digests_ownership_update_collision BEFORE UPDATE ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert_event_digests ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_digests existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.event_id = NEW.event_id AND existing.algorithm = NEW.algorithm))); END;
CREATE TRIGGER alert_projections_ownership_update_collision BEFORE UPDATE ON alert_projections BEGIN SELECT RAISE(ABORT, 'alert_projections ownership collision') WHERE EXISTS (SELECT 1 FROM alert_projections existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.event_id = NEW.event_id) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_projection_provenance_ownership_update_collision BEFORE UPDATE ON alert_projection_provenance BEGIN SELECT RAISE(ABORT, 'alert_projection_provenance ownership collision') WHERE EXISTS (SELECT 1 FROM alert_projection_provenance existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.projection_id = NEW.projection_id AND existing.source_kind = NEW.source_kind AND existing.source_id = NEW.source_id AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_links_ownership_update_collision BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert_event_links ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_links existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.from_event_id = NEW.from_event_id) OR (existing.ledger_id = NEW.ledger_id AND existing.to_transaction_id = NEW.to_transaction_id) OR (existing.ledger_id = NEW.ledger_id AND existing.from_event_id = NEW.from_event_id AND existing.to_event_id = NEW.to_event_id AND existing.to_transaction_id = NEW.to_transaction_id AND existing.relation = NEW.relation AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER alert_event_link_conflicts_ownership_update_collision BEFORE UPDATE ON alert_event_link_conflicts BEGIN SELECT RAISE(ABORT, 'alert_event_link_conflicts ownership collision') WHERE EXISTS (SELECT 1 FROM alert_event_link_conflicts existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.original_link_id = NEW.original_link_id))); END;
CREATE TRIGGER annotation_revisions_ownership_update_collision BEFORE UPDATE ON annotation_revisions BEGIN SELECT RAISE(ABORT, 'annotation_revisions ownership collision') WHERE EXISTS (SELECT 1 FROM annotation_revisions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.transaction_id = NEW.transaction_id AND existing.revision = NEW.revision) OR (existing.id = NEW.id))); END;
CREATE TRIGGER mobile_auth_requests_ownership_update_collision BEFORE UPDATE ON mobile_auth_requests BEGIN SELECT RAISE(ABORT, 'mobile_auth_requests ownership collision') WHERE EXISTS (SELECT 1 FROM mobile_auth_requests existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.state_hash = NEW.state_hash) OR (existing.id = NEW.id))); END;
CREATE TRIGGER owner_session_families_ownership_update_collision BEFORE UPDATE ON owner_session_families BEGIN SELECT RAISE(ABORT, 'owner_session_families ownership collision') WHERE EXISTS (SELECT 1 FROM owner_session_families existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER owner_refresh_generations_ownership_update_collision BEFORE UPDATE ON owner_refresh_generations BEGIN SELECT RAISE(ABORT, 'owner_refresh_generations ownership collision') WHERE EXISTS (SELECT 1 FROM owner_refresh_generations existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.token_hash = NEW.token_hash) OR (existing.family_id = NEW.family_id AND existing.generation = NEW.generation))); END;
CREATE TRIGGER owner_replay_records_ownership_update_collision BEFORE UPDATE ON owner_replay_records BEGIN SELECT RAISE(ABORT, 'owner_replay_records ownership collision') WHERE EXISTS (SELECT 1 FROM owner_replay_records existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id AND existing.request_kind = NEW.request_kind AND existing.request_digest = NEW.request_digest) OR (existing.id = NEW.id))); END;
CREATE TRIGGER import_previews_ownership_update_collision BEFORE UPDATE ON import_previews BEGIN SELECT RAISE(ABORT, 'import_previews ownership collision') WHERE EXISTS (SELECT 1 FROM import_previews existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.id = NEW.id))); END;
CREATE TRIGGER import_chunks_ownership_update_collision BEFORE UPDATE ON import_chunks BEGIN SELECT RAISE(ABORT, 'import_chunks ownership collision') WHERE EXISTS (SELECT 1 FROM import_chunks existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id AND existing.chunk_digest = NEW.chunk_digest) OR (existing.preview_id = NEW.preview_id AND existing.chunk_index = NEW.chunk_index))); END;
CREATE TRIGGER import_preview_errors_ownership_update_collision BEFORE UPDATE ON import_preview_errors BEGIN SELECT RAISE(ABORT, 'import_preview_errors ownership collision') WHERE EXISTS (SELECT 1 FROM import_preview_errors existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id))); END;
CREATE TRIGGER import_duplicate_decisions_ownership_update_collision BEFORE UPDATE ON import_duplicate_decisions BEGIN SELECT RAISE(ABORT, 'import_duplicate_decisions ownership collision') WHERE EXISTS (SELECT 1 FROM import_duplicate_decisions existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.preview_id = NEW.preview_id AND existing.candidate_id = NEW.candidate_id))); END;
CREATE TRIGGER ledger_preferences_ownership_update_collision BEFORE UPDATE ON ledger_preferences BEGIN SELECT RAISE(ABORT, 'ledger_preferences ownership collision') WHERE EXISTS (SELECT 1 FROM ledger_preferences existing WHERE existing.ledger_id IS NOT NEW.ledger_id AND ((existing.ledger_id = NEW.ledger_id))); END;
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

CREATE INDEX IF NOT EXISTS plaid_items_raw_idx ON plaid_items(provider_item_id,ledger_id);
CREATE UNIQUE INDEX IF NOT EXISTS plaid_accounts_raw_idx ON plaid_accounts(ledger_id,item_id,provider_account_id);
CREATE TRIGGER IF NOT EXISTS plaid_item_initial_state AFTER INSERT ON plaid_items BEGIN
 INSERT OR IGNORE INTO sync_state(connection_id,provider,ledger_id) VALUES ('plaid:' || NEW.item_id,'plaid',NEW.ledger_id);
 UPDATE plaid_items SET provider_item_id=NEW.item_id WHERE item_id=NEW.item_id AND provider_item_id IS NULL AND ledger_id='personal';
END;
CREATE TRIGGER IF NOT EXISTS plaid_account_legacy_raw AFTER INSERT ON plaid_accounts
 WHEN NEW.provider_account_id IS NULL AND NEW.ledger_id='personal' BEGIN
 UPDATE plaid_accounts SET provider_account_id=NEW.plaid_account_id WHERE plaid_account_id=NEW.plaid_account_id;
END;
CREATE TRIGGER IF NOT EXISTS mobile_connection_active_item_insert BEFORE INSERT ON mobile_connections
 WHEN NEW.state IN ('connected','syncing','disconnecting') AND NOT EXISTS
 (SELECT 1 FROM plaid_items p WHERE p.item_id=NEW.item_id AND p.ledger_id=NEW.ledger_id)
 BEGIN SELECT RAISE(ABORT,'mobile connection item ownership mismatch'); END;
CREATE TRIGGER IF NOT EXISTS mobile_connection_active_item_update BEFORE UPDATE ON mobile_connections
 WHEN NEW.state IN ('connected','syncing','disconnecting') AND NOT EXISTS
 (SELECT 1 FROM plaid_items p WHERE p.item_id=NEW.item_id AND p.ledger_id=NEW.ledger_id)
 BEGIN SELECT RAISE(ABORT,'mobile connection item ownership mismatch'); END;

CREATE TABLE IF NOT EXISTS plaid_account_ownership (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id), ledger_id TEXT NOT NULL REFERENCES ledgers(id),
 item_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
 UNIQUE(ledger_id,item_id,provider_account_id)
);

CREATE TRIGGER IF NOT EXISTS plaid_ownership_insert BEFORE INSERT ON plaid_account_ownership BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND ledger_id=NEW.ledger_id)
 OR EXISTS(SELECT 1 FROM plaid_account_ownership WHERE account_id=NEW.account_id AND
   (ledger_id<>NEW.ledger_id OR item_id<>NEW.item_id OR provider_account_id<>NEW.provider_account_id))
 OR EXISTS(SELECT 1 FROM plaid_account_ownership WHERE ledger_id=NEW.ledger_id AND item_id=NEW.item_id
   AND provider_account_id=NEW.provider_account_id AND account_id<>NEW.account_id)
 THEN RAISE(ABORT,'immutable Plaid account ownership') END;
END;
CREATE TRIGGER IF NOT EXISTS plaid_ownership_update BEFORE UPDATE ON plaid_account_ownership
 WHEN NEW.account_id<>OLD.account_id OR NEW.ledger_id<>OLD.ledger_id OR NEW.item_id<>OLD.item_id OR NEW.provider_account_id<>OLD.provider_account_id
 BEGIN SELECT RAISE(ABORT,'immutable Plaid account ownership'); END;

CREATE UNIQUE INDEX alert_events_raw_identity ON alert_events(ledger_id, COALESCE(raw_event_id,event_id));
CREATE TRIGGER alert_events_replace_guard BEFORE INSERT ON alert_events BEGIN SELECT RAISE(ABORT, 'alert event identity collision') WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.id=NEW.id OR (e.ledger_id=NEW.ledger_id AND COALESCE(e.raw_event_id,e.event_id)=COALESCE(NEW.raw_event_id,NEW.event_id))); END;
CREATE TRIGGER alert_event_digests_replace_guard BEFORE INSERT ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert digest identity collision') WHERE EXISTS (SELECT 1 FROM alert_event_digests d WHERE d.event_id=NEW.event_id AND d.algorithm=NEW.algorithm); END;
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
CREATE TRIGGER recurring_plan_account_insert BEFORE INSERT ON recurring_plans BEGIN SELECT RAISE(ABORT, 'invalid plan account') WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND a.kind IN ('chequing','savings') AND (a.currency=NEW.currency OR EXISTS (SELECT 1 FROM account_currencies c WHERE c.ledger_id=NEW.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))); END;
CREATE TRIGGER recurring_plan_account_update BEFORE UPDATE ON recurring_plans BEGIN SELECT RAISE(ABORT, 'invalid plan account') WHERE NEW.ledger_id IS NOT OLD.ledger_id OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND a.kind IN ('chequing','savings') AND (a.currency=NEW.currency OR EXISTS (SELECT 1 FROM account_currencies c WHERE c.ledger_id=NEW.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))); END;


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
CREATE TABLE budget_settings (
  ledger_id TEXT PRIMARY KEY REFERENCES ledgers(id),
  currency TEXT NOT NULL REFERENCES currencies(code),
  start_month TEXT NOT NULL CHECK(length(start_month)=7 AND start_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(start_month,6,2) BETWEEN '01' AND '12'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);
CREATE TABLE budget_allocations (
  ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
  month TEXT NOT NULL CHECK(length(month)=7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120),
  assigned_minor INTEGER NOT NULL CHECK(assigned_minor BETWEEN -9007199254740991 AND 9007199254740991),
  PRIMARY KEY(ledger_id,month,category)
);
CREATE TRIGGER budget_start_guard BEFORE UPDATE OF start_month ON budget_settings
WHEN NEW.start_month<>OLD.start_month AND EXISTS(SELECT 1 FROM budget_allocations WHERE ledger_id=OLD.ledger_id)
BEGIN SELECT RAISE(ABORT,'budget start cannot change after allocations exist'); END;
CREATE TRIGGER budget_currency_guard BEFORE UPDATE OF currency ON budget_settings
WHEN NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM budget_allocations WHERE ledger_id=OLD.ledger_id)
BEGIN SELECT RAISE(ABORT,'budget currency cannot change after allocations exist'); END;
CREATE TABLE budget_targets (
  ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120),
  target_minor INTEGER NOT NULL CHECK(target_minor BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(ledger_id,category)
);
CREATE TABLE budget_manual_cash (
  ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  account_id TEXT REFERENCES accounts(id),
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,account_id)
);
CREATE TRIGGER budget_manual_account_insert BEFORE INSERT ON budget_manual_cash WHEN NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND a.kind IN ('chequing','savings') AND (a.currency=NEW.currency OR EXISTS(SELECT 1 FROM account_currencies c WHERE c.ledger_id=a.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))) BEGIN SELECT RAISE(ABORT,'invalid custom balance account'); END;
CREATE TRIGGER budget_manual_account_update BEFORE UPDATE ON budget_manual_cash WHEN NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.ledger_id=NEW.ledger_id AND a.kind IN ('chequing','savings') AND (a.currency=NEW.currency OR EXISTS(SELECT 1 FROM account_currencies c WHERE c.ledger_id=a.ledger_id AND c.account_id=a.id AND c.currency=NEW.currency))) BEGIN SELECT RAISE(ABORT,'invalid custom balance account'); END;
CREATE TRIGGER budget_currency_target_guard BEFORE UPDATE OF currency ON budget_settings
WHEN NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM budget_targets WHERE ledger_id=OLD.ledger_id)
BEGIN SELECT RAISE(ABORT,'budget currency cannot change after targets exist'); END;
CREATE TABLE lunchflow_account_balances (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  connection_id TEXT NOT NULL REFERENCES lunchflow_connections(id),
  connection_generation INTEGER NOT NULL,
  provider_account_id TEXT NOT NULL,
  account_revision INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  observed_at TEXT NOT NULL,
  refresh_failed INTEGER NOT NULL DEFAULT 0 CHECK(refresh_failed IN (0,1)),
  PRIMARY KEY(ledger_id,account_id)
);



CREATE TABLE budget_transfer_operations (
  ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 128),
  payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','completed')),
  PRIMARY KEY(ledger_id,operation_id)
);

CREATE TRIGGER budget_allocation_start_insert BEFORE INSERT ON budget_allocations WHEN NEW.month < (SELECT start_month FROM budget_settings WHERE ledger_id=NEW.ledger_id) BEGIN SELECT RAISE(ABORT,'allocation precedes budget start'); END;
CREATE TRIGGER budget_allocation_start_update BEFORE UPDATE ON budget_allocations WHEN NEW.month < (SELECT start_month FROM budget_settings WHERE ledger_id=NEW.ledger_id) BEGIN SELECT RAISE(ABORT,'allocation precedes budget start'); END;
CREATE TABLE ai_credentials (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic')),
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(ledger_id,user_id,provider)
);
CREATE TABLE ai_sharing_settings (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  detailed_transactions INTEGER NOT NULL DEFAULT 0 CHECK(detailed_transactions IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ledger_id,user_id)
);
