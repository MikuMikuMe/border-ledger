CREATE TABLE budget_planning_state (
 ledger_id TEXT PRIMARY KEY REFERENCES budget_settings(ledger_id),
 preferred_mode TEXT NOT NULL DEFAULT 'envelope' CHECK(preferred_mode IN ('envelope','tracking')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991)
);
INSERT INTO budget_planning_state(ledger_id) SELECT ledger_id FROM budget_settings;
CREATE TRIGGER budget_planning_initialize AFTER INSERT ON budget_settings BEGIN INSERT INTO budget_planning_state(ledger_id) VALUES(NEW.ledger_id); END;
CREATE TABLE budget_tracking_plans (
 ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
 month TEXT NOT NULL CHECK(length(month)=7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
 direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
 category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120 AND trim(category)=category),
 planned_minor INTEGER NOT NULL CHECK(planned_minor BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(ledger_id,month,direction,category)
);
CREATE TABLE budget_rollover_policies (
 ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
 category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120 AND trim(category)=category),
 effective_month TEXT NOT NULL CHECK(length(effective_month)=7 AND effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(effective_month,6,2) BETWEEN '01' AND '12'),
 policy TEXT NOT NULL CHECK(policy IN ('carry_all','carry_positive','reset')),
 PRIMARY KEY(ledger_id,category,effective_month)
);
CREATE TABLE budget_planning_operations (
 ledger_id TEXT NOT NULL REFERENCES budget_settings(ledger_id),
 operation_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 result_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','completed')),
 PRIMARY KEY(ledger_id,operation_id)
);
CREATE TRIGGER budget_tracking_currency_guard BEFORE UPDATE OF currency ON budget_settings
WHEN NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM budget_tracking_plans WHERE ledger_id=OLD.ledger_id)
BEGIN SELECT RAISE(ABORT,'budget currency cannot change after tracking plans exist'); END;
CREATE TRIGGER budget_revision_budget_allocations_INSERT AFTER INSERT ON budget_allocations BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_allocations_UPDATE AFTER UPDATE ON budget_allocations BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_allocations_DELETE AFTER DELETE ON budget_allocations BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_budget_targets_INSERT AFTER INSERT ON budget_targets BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_targets_UPDATE AFTER UPDATE ON budget_targets BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_targets_DELETE AFTER DELETE ON budget_targets BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_budget_manual_cash_INSERT AFTER INSERT ON budget_manual_cash BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_manual_cash_UPDATE AFTER UPDATE ON budget_manual_cash BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_manual_cash_DELETE AFTER DELETE ON budget_manual_cash BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_transactions_INSERT AFTER INSERT ON transactions BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transactions_UPDATE AFTER UPDATE ON transactions BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transactions_DELETE AFTER DELETE ON transactions BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_alert_events_INSERT AFTER INSERT ON alert_events BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_events_UPDATE AFTER UPDATE ON alert_events BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_events_DELETE AFTER DELETE ON alert_events BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_alert_event_links_INSERT AFTER INSERT ON alert_event_links BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_event_links_UPDATE AFTER UPDATE ON alert_event_links BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_event_links_DELETE AFTER DELETE ON alert_event_links BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_ledger_preferences_UPDATE AFTER UPDATE ON ledger_preferences BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_ledger_preferences_DELETE AFTER DELETE ON ledger_preferences BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_accounts_INSERT AFTER INSERT ON accounts BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_accounts_UPDATE AFTER UPDATE ON accounts BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_accounts_DELETE AFTER DELETE ON accounts BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_lunchflow_account_balances_INSERT AFTER INSERT ON lunchflow_account_balances BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_lunchflow_account_balances_UPDATE AFTER UPDATE ON lunchflow_account_balances BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_lunchflow_account_balances_DELETE AFTER DELETE ON lunchflow_account_balances BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_budget_settings_UPDATE AFTER UPDATE ON budget_settings BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_budget_settings_DELETE AFTER DELETE ON budget_settings BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_fx_INSERT AFTER INSERT ON fx_rate_snapshots BEGIN UPDATE budget_planning_state SET revision=revision+1; END;
CREATE TRIGGER budget_revision_fx_UPDATE AFTER UPDATE ON fx_rate_snapshots BEGIN UPDATE budget_planning_state SET revision=revision+1; END;
CREATE TRIGGER budget_revision_fx_DELETE AFTER DELETE ON fx_rate_snapshots BEGIN UPDATE budget_planning_state SET revision=revision+1; END;


CREATE TRIGGER budget_revision_alert_projections_INSERT AFTER INSERT ON alert_projections BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_projections_UPDATE AFTER UPDATE ON alert_projections BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_alert_projections_DELETE AFTER DELETE ON alert_projections BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
CREATE TRIGGER budget_revision_transaction_source_records_INSERT AFTER INSERT ON transaction_source_records BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transaction_source_records_UPDATE AFTER UPDATE ON transaction_source_records BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transaction_source_records_DELETE AFTER DELETE ON transaction_source_records BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;
