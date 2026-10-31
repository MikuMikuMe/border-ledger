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
