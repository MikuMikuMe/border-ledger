CREATE TABLE manual_transaction_matches (
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  manual_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  bank_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('confirmed','dismissed')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY(ledger_id,manual_id,bank_id)
);
CREATE UNIQUE INDEX manual_match_one_confirmed ON manual_transaction_matches(ledger_id,manual_id) WHERE decision='confirmed';
CREATE UNIQUE INDEX manual_match_bank_confirmed ON manual_transaction_matches(ledger_id,bank_id) WHERE decision='confirmed';
CREATE INDEX manual_match_candidates ON transactions(ledger_id,source,account_id,currency,kind,amount_minor,date,status);
CREATE TRIGGER budget_revision_manual_match_insert AFTER INSERT ON manual_transaction_matches BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_manual_match_update AFTER UPDATE ON manual_transaction_matches BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_manual_match_delete AFTER DELETE ON manual_transaction_matches BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
