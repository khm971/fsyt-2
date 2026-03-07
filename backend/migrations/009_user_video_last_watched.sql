-- Add last_watched timestamp to user_video; updated whenever progress is saved
ALTER TABLE user_video ADD COLUMN IF NOT EXISTS last_watched TIMESTAMPTZ;
