CREATE TABLE transaction_retention_evidence (ledger_id TEXT NOT NULL, transaction_id TEXT NOT NULL, event_id TEXT NOT NULL, match_digest TEXT NOT NULL, PRIMARY KEY(ledger_id,transaction_id,event_id));
CREATE TABLE transaction_retention_cleanup (ledger_id TEXT NOT NULL, transaction_id TEXT NOT NULL, PRIMARY KEY(ledger_id,transaction_id));
CREATE TABLE transaction_overrides (
 ledger_id TEXT NOT NULL REFERENCES ledgers(id),
 transaction_id TEXT NOT NULL REFERENCES transactions(id),
 revision INTEGER NOT NULL CHECK(revision > 0),
 account_id TEXT REFERENCES accounts(id),
 date TEXT,
 merchant TEXT,
 amount_minor INTEGER,
 currency TEXT REFERENCES currencies(code),
 kind TEXT CHECK(kind IS NULL OR kind IN ('expense','income','transfer','refund','fee')),
 category TEXT,
 note TEXT,
 annotation_revision INTEGER NOT NULL DEFAULT 0,
 has_edits INTEGER NOT NULL DEFAULT 0 CHECK(has_edits IN (0,1)),
 deleted_at TEXT,
 PRIMARY KEY(ledger_id,transaction_id)
);
CREATE INDEX transaction_overrides_deleted_idx ON transaction_overrides(ledger_id,deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER transaction_overrides_scope_insert BEFORE INSERT ON transaction_overrides BEGIN SELECT RAISE(ABORT,'transaction override ledger mismatch') WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND ledger_id=NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND ledger_id=NEW.ledger_id)); END;
CREATE TRIGGER transaction_overrides_scope_update BEFORE UPDATE ON transaction_overrides BEGIN SELECT RAISE(ABORT,'transaction override ledger mismatch') WHERE NEW.ledger_id IS NOT OLD.ledger_id OR NEW.transaction_id IS NOT OLD.transaction_id OR NOT EXISTS (SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND ledger_id=NEW.ledger_id) OR (NEW.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND ledger_id=NEW.ledger_id)); END;
CREATE TABLE transaction_override_operations (ledger_id TEXT NOT NULL REFERENCES ledgers(id), request_id TEXT NOT NULL, transaction_id TEXT NOT NULL REFERENCES transactions(id), payload TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(ledger_id,request_id));
CREATE VIEW transaction_projections AS SELECT t.id,COALESCE(o.account_id,t.account_id) AS account_id,COALESCE(o.date,t.date) AS date,CASE WHEN o.has_edits=1 THEN o.date ELSE t.fx_lock_date END AS fx_lock_date,COALESCE(o.merchant,t.merchant) AS merchant,COALESCE(o.amount_minor,t.amount_minor) AS amount_minor,COALESCE(o.currency,t.currency) AS currency,COALESCE(a.category,o.category,t.category) AS category,COALESCE(o.kind,t.kind) AS kind,t.status,t.source,t.fingerprint,CASE WHEN a.id IS NOT NULL THEN a.note WHEN o.has_edits=1 THEN o.note ELSE t.note END AS note,t.plaid_item_id,t.provider_transaction_id,t.provider_pending_transaction_id,t.created_at,t.updated_at,t.ledger_id,COALESCE(o.annotation_revision,0) AS override_annotation_revision,COALESCE(o.revision,0) AS override_revision,o.deleted_at AS override_deleted_at FROM transactions t LEFT JOIN transaction_overrides o ON o.ledger_id=t.ledger_id AND o.transaction_id=t.id LEFT JOIN annotation_revisions a ON a.id=(SELECT latest.id FROM annotation_revisions latest WHERE latest.ledger_id=t.ledger_id AND latest.transaction_id=t.id AND latest.revision>COALESCE(o.annotation_revision,0) ORDER BY latest.revision DESC LIMIT 1);
CREATE TABLE transaction_alert_links (ledger_id TEXT NOT NULL REFERENCES ledgers(id), alert_transaction_id TEXT NOT NULL REFERENCES transactions(id), statement_transaction_id TEXT NOT NULL REFERENCES transactions(id), PRIMARY KEY(ledger_id,alert_transaction_id,statement_transaction_id));
CREATE INDEX transaction_alert_links_statement_idx ON transaction_alert_links(ledger_id,statement_transaction_id,alert_transaction_id);
CREATE VIEW effective_transactions AS SELECT t.* FROM transaction_projections t WHERE t.override_deleted_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM transaction_alert_links link JOIN transaction_overrides deleted ON deleted.ledger_id=link.ledger_id AND deleted.transaction_id=link.alert_transaction_id AND deleted.deleted_at IS NOT NULL
 WHERE link.ledger_id=t.ledger_id AND link.statement_transaction_id=t.id
);
CREATE TRIGGER budget_revision_transaction_overrides_insert AFTER INSERT ON transaction_overrides BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transaction_overrides_update AFTER UPDATE ON transaction_overrides BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END;
CREATE TRIGGER budget_revision_transaction_overrides_delete AFTER DELETE ON transaction_overrides BEGIN UPDATE budget_planning_state SET revision=revision+1 WHERE ledger_id=OLD.ledger_id; END;

CREATE TRIGGER transaction_override_confirmed_alert AFTER INSERT ON alert_event_links WHEN NEW.relation='confirms' BEGIN INSERT OR IGNORE INTO transaction_alert_links(ledger_id,alert_transaction_id,statement_transaction_id) SELECT NEW.ledger_id,projection.transaction_id,NEW.to_transaction_id FROM alert_projections projection WHERE projection.ledger_id=NEW.ledger_id AND projection.event_id=NEW.from_event_id AND projection.transaction_id<>NEW.to_transaction_id AND (EXISTS (SELECT 1 FROM transaction_overrides o WHERE o.ledger_id=projection.ledger_id AND o.transaction_id=projection.transaction_id) OR EXISTS (SELECT 1 FROM annotation_revisions a WHERE a.ledger_id=projection.ledger_id AND a.transaction_id=projection.transaction_id)); INSERT OR IGNORE INTO transaction_overrides(ledger_id,transaction_id,revision,account_id,date,merchant,amount_minor,currency,kind,category,note,annotation_revision,has_edits) SELECT NEW.ledger_id,NEW.to_transaction_id,1,p.account_id,p.date,p.merchant,p.amount_minor,p.currency,p.kind,p.category,p.note,0,1 FROM transaction_alert_links link JOIN transaction_overrides o ON o.ledger_id=link.ledger_id AND o.transaction_id=link.alert_transaction_id AND o.has_edits=1 JOIN transaction_projections p ON p.ledger_id=o.ledger_id AND p.id=o.transaction_id WHERE link.ledger_id=NEW.ledger_id AND link.statement_transaction_id=NEW.to_transaction_id; INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) SELECT 'reconciled-edit:'||lower(hex(randomblob(16))),NEW.ledger_id,NEW.to_transaction_id,'system:reconciliation',1,p.category,p.note FROM transaction_alert_links link JOIN transaction_overrides source ON source.ledger_id=link.ledger_id AND source.transaction_id=link.alert_transaction_id AND source.has_edits=1 JOIN transaction_overrides target ON target.ledger_id=link.ledger_id AND target.transaction_id=link.statement_transaction_id AND target.has_edits=1 JOIN transaction_projections p ON p.ledger_id=target.ledger_id AND p.id=target.transaction_id WHERE link.ledger_id=NEW.ledger_id AND link.statement_transaction_id=NEW.to_transaction_id AND NOT EXISTS (SELECT 1 FROM annotation_revisions a WHERE a.ledger_id=NEW.ledger_id AND a.transaction_id=NEW.to_transaction_id); END;

DROP TRIGGER transactions_fx_lock_date_immutable;
CREATE TRIGGER transactions_fx_lock_date_immutable BEFORE UPDATE OF fx_lock_date ON transactions WHEN NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=OLD.ledger_id AND c.transaction_id=OLD.id) BEGIN SELECT RAISE(ABORT, 'transaction fx lock date is immutable') WHERE OLD.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT OLD.fx_lock_date; SELECT RAISE(ABORT, 'transaction fx lock date must match date') WHERE OLD.fx_lock_date IS NULL AND NEW.fx_lock_date IS NOT NEW.date; END;
DROP TRIGGER annotation_revisions_immutable_delete;
CREATE TRIGGER annotation_revisions_immutable_delete BEFORE DELETE ON annotation_revisions WHEN NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=OLD.ledger_id AND c.transaction_id=OLD.transaction_id) BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
DROP TRIGGER alert_events_immutable_update;
CREATE TRIGGER alert_events_immutable_update BEFORE UPDATE ON alert_events WHEN NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c JOIN transaction_source_records r ON r.ledger_id=c.ledger_id AND r.transaction_id=c.transaction_id WHERE r.ledger_id=OLD.ledger_id AND r.event_id=OLD.id) BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
