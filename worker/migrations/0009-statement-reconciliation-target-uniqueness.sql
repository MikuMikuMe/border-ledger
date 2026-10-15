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

WITH ranked AS (
  SELECT l.*,
    ROW_NUMBER() OVER (
      PARTITION BY l.ledger_id, l.to_transaction_id
      ORDER BY l.revision DESC, l.id
    ) AS target_rank,
    ROW_NUMBER() OVER (
      PARTITION BY l.ledger_id, l.from_event_id
      ORDER BY l.revision DESC, l.id
    ) AS source_rank
  FROM alert_event_links l
  WHERE l.relation = 'confirms' AND l.to_transaction_id IS NOT NULL
), winners AS (
  SELECT loser.id,
    CASE WHEN loser.target_rank > 1 THEN target_winner.id ELSE source_winner.id END AS winner_link_id,
    CASE
      WHEN loser.target_rank > 1 AND loser.source_rank > 1 THEN 'target_and_source'
      WHEN loser.target_rank > 1 THEN 'target'
      ELSE 'source'
    END AS conflict_reason
  FROM ranked loser
  LEFT JOIN ranked target_winner
    ON target_winner.ledger_id = loser.ledger_id
    AND target_winner.to_transaction_id = loser.to_transaction_id
    AND target_winner.target_rank = 1
  LEFT JOIN ranked source_winner
    ON source_winner.ledger_id = loser.ledger_id
    AND source_winner.from_event_id = loser.from_event_id
    AND source_winner.source_rank = 1
  WHERE loser.target_rank > 1 OR loser.source_rank > 1
)
INSERT OR IGNORE INTO alert_event_link_conflicts
  (original_link_id, ledger_id, from_event_id, to_event_id, to_transaction_id, original_relation,
   allocated_currency, allocated_amount_minor, evidence_basis, revision, original_created_at,
   winner_link_id, conflict_reason)
SELECT l.id, l.ledger_id, l.from_event_id, l.to_event_id, l.to_transaction_id, l.relation,
  l.allocated_currency, l.allocated_amount_minor, l.evidence_basis, l.revision, l.created_at,
  w.winner_link_id, w.conflict_reason
FROM alert_event_links l
JOIN winners w ON w.id = l.id;

UPDATE alert_projections
SET state = 'needs_review',
    reason_codes_json = '["duplicate_confirmation_conflict"]',
    counted_currency = NULL,
    counted_amount_minor = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE state <> 'needs_review'
  AND EXISTS (
    SELECT 1 FROM alert_event_link_conflicts c
    WHERE c.from_event_id = alert_projections.event_id
  );

UPDATE transactions
SET status = 'needs_review', updated_at = CURRENT_TIMESTAMP
WHERE source = 'alert'
  AND id IN (
    SELECT p.transaction_id
    FROM alert_projections p
    JOIN alert_event_link_conflicts c ON c.from_event_id = p.event_id
    WHERE p.state = 'needs_review' AND p.transaction_id IS NOT NULL
  );

DROP TRIGGER IF EXISTS alert_event_links_same_scope;
DROP TRIGGER IF EXISTS alert_event_links_no_cycle;
DROP TRIGGER IF EXISTS alert_event_links_immutable_update;
DROP TRIGGER IF EXISTS alert_event_links_immutable_delete;
DROP INDEX IF EXISTS alert_event_links_target_event_idx;
DROP INDEX IF EXISTS alert_event_links_target_transaction_idx;
DROP INDEX IF EXISTS alert_event_links_confirms_target_idx;
DROP INDEX IF EXISTS alert_event_links_confirms_source_idx;

ALTER TABLE alert_event_links RENAME TO alert_event_links_immutable_evidence;

CREATE TABLE alert_event_links_reconciled (
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

INSERT INTO alert_event_links_reconciled
  (id, ledger_id, from_event_id, to_event_id, to_transaction_id, relation, allocated_currency,
   allocated_amount_minor, evidence_basis, revision, created_at)
SELECT l.id, l.ledger_id, l.from_event_id, l.to_event_id, l.to_transaction_id,
  CASE WHEN c.original_link_id IS NULL THEN l.relation ELSE 'possible_duplicate' END,
  l.allocated_currency, l.allocated_amount_minor, l.evidence_basis, l.revision, l.created_at
FROM alert_event_links_immutable_evidence l
LEFT JOIN alert_event_link_conflicts c ON c.original_link_id = l.id;

ALTER TABLE alert_event_links_reconciled RENAME TO alert_event_links;

CREATE INDEX alert_event_links_target_event_idx ON alert_event_links(to_event_id, relation);
CREATE INDEX alert_event_links_target_transaction_idx ON alert_event_links(to_transaction_id, relation);
CREATE UNIQUE INDEX alert_event_links_confirms_target_idx
  ON alert_event_links(ledger_id, to_transaction_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX alert_event_links_confirms_source_idx
  ON alert_event_links(ledger_id, from_event_id)
  WHERE relation = 'confirms' AND to_transaction_id IS NOT NULL;

CREATE TRIGGER alert_event_links_same_scope BEFORE INSERT ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert link ledger mismatch') WHERE NEW.ledger_id <> 'personal' OR (NEW.to_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN alert_events target ON target.id = NEW.to_event_id WHERE source.id = NEW.from_event_id AND (source.ledger_id <> target.ledger_id OR (source.account_id IS NOT NULL AND target.account_id IS NOT NULL AND source.account_id <> target.account_id)))) OR (NEW.to_transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM alert_events source JOIN transactions target ON target.id = NEW.to_transaction_id WHERE source.id = NEW.from_event_id AND source.account_id IS NOT NULL AND source.account_id <> target.account_id)); END;
CREATE TRIGGER alert_event_links_no_cycle BEFORE INSERT ON alert_event_links WHEN NEW.to_event_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'alert event link cycle') WHERE EXISTS (WITH RECURSIVE reachable(id) AS (SELECT NEW.to_event_id UNION ALL SELECT l.to_event_id FROM alert_event_links l JOIN reachable r ON l.from_event_id = r.id WHERE l.to_event_id IS NOT NULL) SELECT 1 FROM reachable WHERE id = NEW.from_event_id); END;
CREATE TRIGGER alert_event_links_immutable_update BEFORE UPDATE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_event_links_immutable_delete BEFORE DELETE ON alert_event_links BEGIN SELECT RAISE(ABORT, 'alert event links are immutable'); END;
CREATE TRIGGER alert_event_links_immutable_evidence_update BEFORE UPDATE ON alert_event_links_immutable_evidence BEGIN SELECT RAISE(ABORT, 'alert immutable evidence is immutable'); END;
CREATE TRIGGER alert_event_links_immutable_evidence_delete BEFORE DELETE ON alert_event_links_immutable_evidence BEGIN SELECT RAISE(ABORT, 'alert immutable evidence is immutable'); END;
