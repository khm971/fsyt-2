-- Event log table for important application events
-- Severity: 10=Debug, 20=Info, 30=Warning, 40=Error, 50=Critical
CREATE TABLE event_log (
    event_log_id SERIAL PRIMARY KEY,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message TEXT NOT NULL,
    severity INT NOT NULL DEFAULT 20,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_event_log_time ON event_log (event_time DESC);
CREATE INDEX idx_event_log_severity ON event_log (severity);
