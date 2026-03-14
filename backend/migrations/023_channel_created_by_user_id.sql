-- Add created_by_user_id to channel for attribution; index for selection by user
ALTER TABLE channel ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NULL REFERENCES app_user(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_created_by_user_id ON channel(created_by_user_id);
