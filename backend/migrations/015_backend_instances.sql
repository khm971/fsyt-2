-- Backend instance heartbeats for multi-instance detection
CREATE TABLE IF NOT EXISTS backend_instances (
    instance_id UUID PRIMARY KEY,
    hostname TEXT,
    last_heartbeat_utc TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backend_instances_last_heartbeat_utc
    ON backend_instances (last_heartbeat_utc);
