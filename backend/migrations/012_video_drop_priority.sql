-- Remove unused video.priority column
ALTER TABLE video DROP COLUMN IF EXISTS priority;
