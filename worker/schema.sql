CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledgers (id) VALUES ('personal');

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
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS account_currencies (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL REFERENCES currencies(code),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  source TEXT NOT NULL CHECK (source IN ('statement', 'plaid', 'alert', 'manual')),
  fingerprint TEXT NOT NULL,
  note TEXT,
  plaid_item_id TEXT,
  provider_transaction_id TEXT,
  provider_pending_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_state (
  connection_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cursor TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plaid_items (
  item_id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plaid_accounts (
  plaid_account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  mask TEXT,
  subtype TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS plaid_accounts_item_idx ON plaid_accounts(item_id);
CREATE INDEX IF NOT EXISTS plaid_accounts_account_idx ON plaid_accounts(account_id);

CREATE TABLE IF NOT EXISTS mobile_connections (
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  FOREIGN KEY (account_id, currency) REFERENCES account_currencies(account_id, currency),
  UNIQUE (device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value)
);

CREATE TABLE IF NOT EXISTS transaction_source_records (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL DEFAULT 'personal' REFERENCES ledgers(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('plaid', 'statement', 'alert', 'manual', 'legacy')),
  identity_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_item_id TEXT,
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
    source_kind = 'legacy'
  )
);

CREATE INDEX IF NOT EXISTS transaction_source_records_transaction_idx ON transaction_source_records(transaction_id);
CREATE INDEX IF NOT EXISTS transaction_source_records_provider_idx ON transaction_source_records(provider_item_id, provider_transaction_id);
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
  CHECK (id = event_id),
  UNIQUE (ledger_id, event_id)
);

CREATE TABLE IF NOT EXISTS alert_event_digests (
  event_id TEXT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  PRIMARY KEY (preview_id, chunk_index),
  UNIQUE (preview_id, chunk_digest)
);

CREATE INDEX IF NOT EXISTS import_previews_expiry_idx ON import_previews(expires_at, status);
CREATE INDEX IF NOT EXISTS import_chunks_operation_idx ON import_chunks(preview_id, operation_id, chunk_index);

CREATE TABLE IF NOT EXISTS import_preview_errors (
  preview_id TEXT PRIMARY KEY REFERENCES import_previews(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_duplicate_decisions (
  preview_id TEXT NOT NULL REFERENCES import_previews(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  statement_transaction_id TEXT NOT NULL,
  candidate_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

CREATE TRIGGER IF NOT EXISTS accounts_default_currency_insert AFTER INSERT ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (NEW.id, NEW.currency); END;

CREATE TRIGGER IF NOT EXISTS accounts_default_currency_update AFTER UPDATE OF currency ON accounts BEGIN INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (NEW.id, NEW.currency); END;

CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_insert BEFORE INSERT ON transactions WHEN NEW.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT NEW.date BEGIN SELECT RAISE(ABORT, 'transaction fx lock date must match date'); END;
CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_default AFTER INSERT ON transactions WHEN NEW.fx_lock_date IS NULL BEGIN UPDATE transactions SET fx_lock_date = NEW.date WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS transactions_fx_lock_date_immutable BEFORE UPDATE OF fx_lock_date ON transactions BEGIN SELECT RAISE(ABORT, 'transaction fx lock date is immutable') WHERE OLD.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT OLD.fx_lock_date; SELECT RAISE(ABORT, 'transaction fx lock date must match date') WHERE OLD.fx_lock_date IS NULL AND NEW.fx_lock_date IS NOT NEW.date; END;

CREATE TRIGGER IF NOT EXISTS fx_rate_snapshots_immutable_update BEFORE UPDATE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS fx_rate_snapshots_immutable_delete BEFORE DELETE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;

CREATE TRIGGER IF NOT EXISTS alert_event_links_same_scope BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert link ledger mismatch') WHERE NEW.ledger_id <> 'personal' OR (NEW.to_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN alert_events target ON target.id = NEW.to_event_id WHERE source.id = NEW.from_event_id AND (source.ledger_id <> target.ledger_id OR (source.account_id IS NOT NULL AND target.account_id IS NOT NULL AND source.account_id <> target.account_id)))) OR (NEW.to_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN transactions target ON target.id = NEW.to_transaction_id WHERE source.id = NEW.from_event_id AND source.account_id IS NOT NULL AND source.account_id <> target.account_id)); END;
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
