-- Add user_id to job_queue for who queued the job; index for selection by user
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS user_id INTEGER NULL REFERENCES app_user(user_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_user_id ON job_queue(user_id);
