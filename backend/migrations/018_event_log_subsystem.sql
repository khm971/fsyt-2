-- Add subsystem to event_log for filtering (e.g. ytdl, ffmpeg)
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS subsystem TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_event_log_subsystem ON event_log (subsystem);
