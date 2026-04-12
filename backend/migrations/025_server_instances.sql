-- Multi-instance: catalog, job targeting, heartbeats, event log

CREATE TABLE IF NOT EXISTS server_instance (
    server_instance_id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    assign_download_jobs BOOLEAN NOT NULL DEFAULT TRUE,
    record_created TIMESTAMPTZ DEFAULT NOW(),
    record_updated TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO server_instance (server_instance_id, display_name, is_enabled, assign_download_jobs)
VALUES (1, 'Instance 1', TRUE, TRUE)
ON CONFLICT (server_instance_id) DO NOTHING;

ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS target_server_instance_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS queue_all_target_all_downloaders BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'job_queue_target_server_instance_id_fkey'
    ) THEN
        ALTER TABLE job_queue
            ADD CONSTRAINT job_queue_target_server_instance_id_fkey
            FOREIGN KEY (target_server_instance_id) REFERENCES server_instance (server_instance_id);
    END IF;
END$$;

ALTER TABLE scheduler_entry ADD COLUMN IF NOT EXISTS target_server_instance_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scheduler_entry ADD COLUMN IF NOT EXISTS queue_all_target_all_downloaders BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'scheduler_entry_target_server_instance_id_fkey'
    ) THEN
        ALTER TABLE scheduler_entry
            ADD CONSTRAINT scheduler_entry_target_server_instance_id_fkey
            FOREIGN KEY (target_server_instance_id) REFERENCES server_instance (server_instance_id);
    END IF;
END$$;

ALTER TABLE backend_instances ADD COLUMN IF NOT EXISTS server_instance_id INTEGER;
UPDATE backend_instances SET server_instance_id = 1 WHERE server_instance_id IS NULL;
ALTER TABLE backend_instances ALTER COLUMN server_instance_id SET DEFAULT 1;
ALTER TABLE backend_instances ALTER COLUMN server_instance_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'backend_instances_server_instance_id_fkey'
    ) THEN
        ALTER TABLE backend_instances
            ADD CONSTRAINT backend_instances_server_instance_id_fkey
            FOREIGN KEY (server_instance_id) REFERENCES server_instance (server_instance_id);
    END IF;
END$$;

ALTER TABLE event_log ADD COLUMN IF NOT EXISTS server_instance_id INTEGER NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'event_log_server_instance_id_fkey'
    ) THEN
        ALTER TABLE event_log
            ADD CONSTRAINT event_log_server_instance_id_fkey
            FOREIGN KEY (server_instance_id) REFERENCES server_instance (server_instance_id);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_event_log_server_instance_id ON event_log (server_instance_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_target_server_instance_id ON job_queue (target_server_instance_id);
CREATE INDEX IF NOT EXISTS idx_backend_instances_server_instance_id ON backend_instances (server_instance_id);
