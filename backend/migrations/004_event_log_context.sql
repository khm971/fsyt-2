-- Add job_id, video_id, channel_id to event_log for discrete filtering
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS job_id INT NULL;
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS video_id INT NULL;
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS channel_id INT NULL;

CREATE INDEX IF NOT EXISTS idx_event_log_job_id ON event_log (job_id);
CREATE INDEX IF NOT EXISTS idx_event_log_video_id ON event_log (video_id);
CREATE INDEX IF NOT EXISTS idx_event_log_channel_id ON event_log (channel_id);
