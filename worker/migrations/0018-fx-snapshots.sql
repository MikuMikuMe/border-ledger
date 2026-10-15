ALTER TABLE transactions ADD COLUMN fx_lock_date TEXT;

UPDATE transactions SET fx_lock_date = date WHERE fx_lock_date IS NULL;

CREATE TRIGGER transactions_fx_lock_date_insert BEFORE INSERT ON transactions WHEN NEW.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT NEW.date BEGIN SELECT RAISE(ABORT, 'transaction fx lock date must match date'); END;

CREATE TRIGGER transactions_fx_lock_date_default AFTER INSERT ON transactions WHEN NEW.fx_lock_date IS NULL BEGIN UPDATE transactions SET fx_lock_date = NEW.date WHERE id = NEW.id; END;

CREATE TRIGGER transactions_fx_lock_date_immutable BEFORE UPDATE OF fx_lock_date ON transactions BEGIN SELECT RAISE(ABORT, 'transaction fx lock date is immutable') WHERE OLD.fx_lock_date IS NOT NULL AND NEW.fx_lock_date IS NOT OLD.fx_lock_date; SELECT RAISE(ABORT, 'transaction fx lock date must match date') WHERE OLD.fx_lock_date IS NULL AND NEW.fx_lock_date IS NOT NEW.date; END;

CREATE TABLE fx_rate_snapshots (
  requested_date TEXT NOT NULL PRIMARY KEY CHECK (length(requested_date) = 10 AND requested_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_date TEXT NOT NULL CHECK (length(effective_date) = 10 AND effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  provider TEXT NOT NULL CHECK (provider = 'frankfurter'),
  rates_json TEXT NOT NULL CHECK (length(rates_json) BETWEEN 2 AND 65536),
  content_digest TEXT NOT NULL CHECK (length(content_digest) BETWEEN 1 AND 128),
  fetched_at TEXT NOT NULL CHECK (length(fetched_at) BETWEEN 1 AND 64)
);

CREATE TRIGGER fx_rate_snapshots_immutable_update BEFORE UPDATE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;

CREATE TRIGGER fx_rate_snapshots_immutable_delete BEFORE DELETE ON fx_rate_snapshots BEGIN SELECT RAISE(ABORT, 'fx rate snapshots are immutable'); END;
