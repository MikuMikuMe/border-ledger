ALTER TABLE alert_events ADD COLUMN raw_event_id TEXT CHECK (raw_event_id IS NULL OR length(trim(raw_event_id)) > 0);
DROP TRIGGER alert_events_immutable_update;
UPDATE alert_events SET raw_event_id = event_id;
CREATE TRIGGER alert_events_immutable_update BEFORE UPDATE ON alert_events BEGIN SELECT RAISE(ABORT, 'alert events are immutable'); END;
CREATE UNIQUE INDEX alert_events_raw_identity ON alert_events(ledger_id, COALESCE(raw_event_id,event_id));
CREATE TRIGGER alert_events_replace_guard BEFORE INSERT ON alert_events BEGIN SELECT RAISE(ABORT, 'alert event identity collision') WHERE EXISTS (SELECT 1 FROM alert_events e WHERE e.id=NEW.id OR (e.ledger_id=NEW.ledger_id AND COALESCE(e.raw_event_id,e.event_id)=COALESCE(NEW.raw_event_id,NEW.event_id))); END;
CREATE TRIGGER alert_event_digests_replace_guard BEFORE INSERT ON alert_event_digests BEGIN SELECT RAISE(ABORT, 'alert digest identity collision') WHERE EXISTS (SELECT 1 FROM alert_event_digests d WHERE d.event_id=NEW.event_id AND d.algorithm=NEW.algorithm); END;
