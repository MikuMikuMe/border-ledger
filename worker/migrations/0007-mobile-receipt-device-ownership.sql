ALTER TABLE alert_events ADD COLUMN device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL;

CREATE INDEX alert_events_device_idx ON alert_events(device_id, event_id, created_at);
