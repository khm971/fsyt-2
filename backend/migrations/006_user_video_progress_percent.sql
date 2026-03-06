-- Add progress_percent to user_video
ALTER TABLE user_video ADD COLUMN IF NOT EXISTS progress_percent NUMERIC(5,2);
