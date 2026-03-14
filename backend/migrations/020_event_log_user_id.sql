-- Add user_id to event_log for attribution; index for selection by user
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS user_id INTEGER NULL REFERENCES app_user(user_id);
CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
