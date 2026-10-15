ALTER TABLE mobile_devices ADD COLUMN source_config_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_config_revision >= 0);
