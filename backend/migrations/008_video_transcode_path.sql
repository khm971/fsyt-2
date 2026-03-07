-- Add transcode_path to video table for HLS transcode folder (relative to media root)
-- Enables cleanup of transcodes in a separate project
ALTER TABLE video ADD COLUMN IF NOT EXISTS transcode_path VARCHAR(512) NULL;
