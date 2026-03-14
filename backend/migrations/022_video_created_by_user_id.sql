-- Add created_by_user_id to video for attribution; index for selection by user
ALTER TABLE video ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NULL REFERENCES app_user(user_id);
CREATE INDEX IF NOT EXISTS idx_video_created_by_user_id ON video(created_by_user_id);
