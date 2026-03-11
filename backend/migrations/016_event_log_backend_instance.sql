-- Add backend instance context to event_log for multi-instance debugging
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS instance_id UUID NULL;
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS hostname TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_event_log_instance_id ON event_log (instance_id);
