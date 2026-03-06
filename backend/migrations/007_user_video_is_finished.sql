-- Add is_finished to user_video; true when progress_percent > 95
ALTER TABLE user_video ADD COLUMN IF NOT EXISTS is_finished BOOLEAN NOT NULL DEFAULT FALSE;

-- Set is_finished for existing rows where progress_percent > 95
UPDATE user_video SET is_finished = TRUE WHERE progress_percent > 95;
