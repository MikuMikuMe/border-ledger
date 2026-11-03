-- Wealth is a separate registry. Existing ledger accounts and budget rows remain
-- unchanged; links into them are read-only projections in the wealth report.
CREATE TABLE wealth_state (
  ledger_id TEXT PRIMARY KEY REFERENCES ledgers(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO wealth_state(ledger_id) SELECT id FROM ledgers;

CREATE TRIGGER wealth_state_ledger_insert AFTER INSERT ON ledgers BEGIN INSERT OR IGNORE INTO wealth_state(ledger_id) VALUES(NEW.id); END;

CREATE TABLE wealth_accounts (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK(kind IN ('linked_bank','manual_asset','debt','brokerage')),
  mode TEXT NOT NULL CHECK(mode IN ('aggregate','holdings')),
  currency TEXT REFERENCES currencies(code),
  linked_bank_account_id TEXT REFERENCES accounts(id),
  amount_minor INTEGER CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,linked_bank_account_id)
);

CREATE INDEX wealth_accounts_ledger_idx ON wealth_accounts(ledger_id,active,id);

CREATE TRIGGER wealth_accounts_scope_insert BEFORE INSERT ON wealth_accounts BEGIN SELECT RAISE(ABORT,'wealth account ledger mismatch') WHERE NOT EXISTS(SELECT 1 FROM ledgers WHERE id=NEW.ledger_id) OR (NEW.linked_bank_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.linked_bank_account_id AND ledger_id=NEW.ledger_id)); SELECT RAISE(ABORT,'invalid linked wealth account') WHERE (NEW.kind='linked_bank' AND (NEW.linked_bank_account_id IS NULL OR NEW.mode<>'aggregate')) OR (NEW.kind<>'linked_bank' AND NEW.linked_bank_account_id IS NOT NULL) OR (NEW.mode='holdings' AND NEW.kind<>'brokerage'); END;

CREATE TRIGGER wealth_accounts_scope_update BEFORE UPDATE ON wealth_accounts BEGIN SELECT RAISE(ABORT,'wealth account ledger is immutable') WHERE NEW.ledger_id IS NOT OLD.ledger_id OR NEW.id IS NOT OLD.id; SELECT RAISE(ABORT,'wealth account ledger mismatch') WHERE NEW.linked_bank_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.linked_bank_account_id AND ledger_id=NEW.ledger_id); SELECT RAISE(ABORT,'invalid linked wealth account') WHERE (NEW.kind='linked_bank' AND (NEW.linked_bank_account_id IS NULL OR NEW.mode<>'aggregate')) OR (NEW.kind<>'linked_bank' AND NEW.linked_bank_account_id IS NOT NULL) OR (NEW.mode='holdings' AND NEW.kind<>'brokerage'); END;

CREATE TABLE wealth_account_mode_transitions (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
  from_mode TEXT NOT NULL CHECK(from_mode IN ('aggregate','holdings')),
  to_mode TEXT NOT NULL CHECK(to_mode IN ('aggregate','holdings')),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,account_id,effective_date),
  UNIQUE(ledger_id,account_id,effective_date,revision)
);

CREATE INDEX wealth_account_mode_transitions_date_idx ON wealth_account_mode_transitions(ledger_id,account_id,effective_date);
CREATE TRIGGER wealth_account_mode_transitions_scope_insert BEFORE INSERT ON wealth_account_mode_transitions
WHEN NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'wealth account mode transition account mismatch'); END;
CREATE TRIGGER wealth_account_mode_transitions_immutable_update BEFORE UPDATE ON wealth_account_mode_transitions
BEGIN SELECT RAISE(ABORT,'wealth account mode transitions are immutable'); END;
CREATE TRIGGER wealth_account_mode_transitions_immutable_delete BEFORE DELETE ON wealth_account_mode_transitions
BEGIN SELECT RAISE(ABORT,'wealth account mode transitions are immutable'); END;

CREATE TABLE wealth_instruments (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
  exchange TEXT NOT NULL CHECK(length(trim(exchange)) BETWEEN 1 AND 32),
  ticker TEXT NOT NULL CHECK(length(trim(ticker)) BETWEEN 1 AND 32),
  type TEXT NOT NULL CHECK(type IN ('stock','etf')),
  currency TEXT NOT NULL REFERENCES currencies(code),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,exchange,ticker,type,currency)
);

CREATE INDEX wealth_instruments_ledger_idx ON wealth_instruments(ledger_id,exchange,ticker);

CREATE TRIGGER wealth_instruments_scope_insert BEFORE INSERT ON wealth_instruments
WHEN NOT EXISTS(SELECT 1 FROM ledgers WHERE id=NEW.ledger_id)
BEGIN SELECT RAISE(ABORT,'wealth instrument ledger mismatch'); END;

CREATE TRIGGER wealth_instruments_scope_update BEFORE UPDATE ON wealth_instruments
WHEN NEW.ledger_id IS NOT OLD.ledger_id OR NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'wealth instrument identity is immutable'); END;

CREATE TABLE wealth_events (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 160),
  source_id TEXT NOT NULL CHECK(length(trim(source_id)) BETWEEN 1 AND 256),
  date TEXT NOT NULL CHECK(length(date)=10),
  sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence BETWEEN 0 AND 9007199254740991),
  kind TEXT NOT NULL CHECK(kind IN ('opening_position','opening_cash','buy','sell','dividend','withholding','fee','contribution','withdrawal','split','transfer','reversal','correction')),
  account_id TEXT,
  from_account_id TEXT,
  to_account_id TEXT,
  linked_bank_source_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,source_id),
  UNIQUE(ledger_id,sequence)
);

CREATE INDEX wealth_events_ledger_date_idx ON wealth_events(ledger_id,date,source_id);

CREATE TRIGGER wealth_events_scope_insert BEFORE INSERT ON wealth_events BEGIN SELECT RAISE(ABORT,'wealth event ledger mismatch') WHERE NOT EXISTS(SELECT 1 FROM ledgers WHERE id=NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.account_id)) OR (NEW.from_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.from_account_id)) OR (NEW.to_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.to_account_id)); END;

CREATE TRIGGER wealth_events_immutable_update BEFORE UPDATE ON wealth_events
BEGIN SELECT RAISE(ABORT,'wealth events are immutable'); END;
CREATE TRIGGER wealth_events_immutable_delete BEFORE DELETE ON wealth_events
BEGIN SELECT RAISE(ABORT,'wealth events are immutable'); END;

CREATE TABLE wealth_valuations (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 160),
  account_id TEXT NOT NULL,
  instrument_key TEXT NOT NULL CHECK(length(trim(instrument_key)) BETWEEN 1 AND 256),
  as_of TEXT NOT NULL CHECK(length(as_of)=10),
  price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 0 AND 9007199254740991),
  source TEXT NOT NULL CHECK(source IN ('manual','provider')),
  provider TEXT,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,account_id,instrument_key,as_of)
);

CREATE INDEX wealth_valuations_ledger_date_idx ON wealth_valuations(ledger_id,as_of,account_id);

CREATE TABLE wealth_valuation_corrections (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 160),
  account_id TEXT NOT NULL,
  instrument_key TEXT NOT NULL CHECK(length(trim(instrument_key)) BETWEEN 1 AND 256),
  as_of TEXT NOT NULL CHECK(length(as_of)=10),
  price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 0 AND 9007199254740991),
  source TEXT NOT NULL CHECK(source IN ('manual','provider')),
  provider TEXT,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,account_id,instrument_key,as_of,revision)
);

CREATE INDEX wealth_valuation_corrections_ledger_date_idx ON wealth_valuation_corrections(ledger_id,as_of,account_id,revision);

CREATE TABLE wealth_linked_balance_observations (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  account_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
  observed_at TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,account_id,currency,amount_minor,observed_at,source_revision)
);
CREATE INDEX wealth_linked_balance_history_idx ON wealth_linked_balance_observations(ledger_id,account_id,observed_at);
CREATE TRIGGER wealth_linked_balance_observations_immutable_update BEFORE UPDATE ON wealth_linked_balance_observations BEGIN SELECT RAISE(ABORT,'wealth linked balance observations are immutable'); END;
CREATE TRIGGER wealth_linked_balance_observations_immutable_delete BEFORE DELETE ON wealth_linked_balance_observations BEGIN SELECT RAISE(ABORT,'wealth linked balance observations are immutable'); END;

CREATE TABLE wealth_quote_credentials (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id), user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('alpha_vantage')), ciphertext TEXT NOT NULL, iv TEXT NOT NULL,
  revision TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,user_id,provider)
);
CREATE TABLE wealth_quote_quota_reservations (
  id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledgers(id), provider TEXT NOT NULL CHECK(provider IN ('alpha_vantage')),
  instrument_key TEXT NOT NULL, reserved_at TEXT NOT NULL
);
CREATE INDEX wealth_quote_quota_window_idx ON wealth_quote_quota_reservations(ledger_id,provider,reserved_at);
CREATE TABLE wealth_quote_observations (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id), instrument_key TEXT NOT NULL,
  exchange TEXT NOT NULL, ticker TEXT NOT NULL, instrument_type TEXT NOT NULL CHECK(instrument_type IN ('stock','etf')),
  currency TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('alpha_vantage')), provider_symbol TEXT NOT NULL,
  quote_date TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 1 AND 9007199254740991),
  observed_at TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,instrument_key,provider)
);
CREATE INDEX wealth_quote_observation_date_idx ON wealth_quote_observations(ledger_id,quote_date,instrument_key);

CREATE TRIGGER wealth_valuations_scope_insert BEFORE INSERT ON wealth_valuations
WHEN NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'wealth valuation account mismatch'); END;

CREATE TRIGGER wealth_valuation_corrections_scope_insert BEFORE INSERT ON wealth_valuation_corrections
WHEN NOT EXISTS(SELECT 1 FROM wealth_accounts WHERE ledger_id=NEW.ledger_id AND id=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'wealth valuation correction account mismatch'); END;

CREATE TRIGGER wealth_valuations_scope_update BEFORE UPDATE ON wealth_valuations
BEGIN SELECT RAISE(ABORT,'wealth valuations are immutable; append a new observation'); END;
CREATE TRIGGER wealth_valuations_immutable_delete BEFORE DELETE ON wealth_valuations
BEGIN SELECT RAISE(ABORT,'wealth valuations are immutable'); END;
CREATE TRIGGER wealth_valuation_corrections_immutable_update BEFORE UPDATE ON wealth_valuation_corrections
BEGIN SELECT RAISE(ABORT,'wealth valuation corrections are immutable'); END;
CREATE TRIGGER wealth_valuation_corrections_immutable_delete BEFORE DELETE ON wealth_valuation_corrections
BEGIN SELECT RAISE(ABORT,'wealth valuation corrections are immutable'); END;

CREATE TABLE wealth_operations (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  operation_id TEXT NOT NULL CHECK(length(trim(operation_id)) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK(length(trim(operation_kind)) BETWEEN 1 AND 80),
  expected_revision INTEGER NOT NULL CHECK(expected_revision BETWEEN 0 AND 9007199254740991),
  result_revision INTEGER NOT NULL CHECK(result_revision BETWEEN 0 AND 9007199254740991),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,operation_id)
);

CREATE INDEX wealth_operations_ledger_kind_idx ON wealth_operations(ledger_id,operation_kind,created_at);

CREATE TRIGGER wealth_operations_scope_insert BEFORE INSERT ON wealth_operations
WHEN NOT EXISTS(SELECT 1 FROM ledgers WHERE id=NEW.ledger_id)
BEGIN SELECT RAISE(ABORT,'wealth operation ledger mismatch'); END;
CREATE TRIGGER wealth_operations_immutable_update BEFORE UPDATE ON wealth_operations
BEGIN SELECT RAISE(ABORT,'wealth operations are immutable'); END;
CREATE TRIGGER wealth_operations_immutable_delete BEFORE DELETE ON wealth_operations
BEGIN SELECT RAISE(ABORT,'wealth operations are immutable'); END;

CREATE TABLE wealth_import_previews (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  id TEXT NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 160),
  operation_id TEXT NOT NULL,
  csv_sha256 TEXT NOT NULL CHECK(length(csv_sha256)=64),
  mapping_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 0 AND 10000),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count BETWEEN 0 AND 10000),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_count BETWEEN 0 AND 10000),
  state TEXT NOT NULL CHECK(state IN ('preview','committed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(ledger_id,id),
  UNIQUE(ledger_id,operation_id)
);

CREATE TABLE wealth_import_rows (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  preview_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  row_index INTEGER NOT NULL CHECK(row_index BETWEEN 0 AND 10000),
  payload_json TEXT NOT NULL,
  error_json TEXT,
  duplicate_of TEXT,
  state TEXT NOT NULL CHECK(state IN ('valid','error','duplicate','committed')),
  PRIMARY KEY(ledger_id,preview_id,row_id),
  UNIQUE(ledger_id,preview_id,row_index)
);

CREATE TRIGGER wealth_import_rows_scope_insert BEFORE INSERT ON wealth_import_rows
WHEN NOT EXISTS(SELECT 1 FROM wealth_import_previews p WHERE p.ledger_id=NEW.ledger_id AND p.id=NEW.preview_id)
BEGIN SELECT RAISE(ABORT,'wealth import row preview mismatch'); END;

CREATE TRIGGER wealth_import_previews_immutable_update BEFORE UPDATE ON wealth_import_previews
WHEN NEW.ledger_id IS NOT OLD.ledger_id OR NEW.id IS NOT OLD.id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.csv_sha256 IS NOT OLD.csv_sha256 OR NEW.mapping_json IS NOT OLD.mapping_json
BEGIN SELECT RAISE(ABORT,'wealth import identity is immutable'); END;

CREATE TRIGGER wealth_import_rows_immutable_update BEFORE UPDATE ON wealth_import_rows
WHEN NEW.ledger_id IS NOT OLD.ledger_id OR NEW.preview_id IS NOT OLD.preview_id OR NEW.row_id IS NOT OLD.row_id OR NEW.row_index IS NOT OLD.row_index OR NEW.payload_json IS NOT OLD.payload_json
BEGIN SELECT RAISE(ABORT,'wealth import row identity is immutable'); END;
