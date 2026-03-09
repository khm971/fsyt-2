-- Scheduler entries: user-configurable cron schedules that submit jobs to job_queue
CREATE TABLE IF NOT EXISTS scheduler_entry (
    scheduler_entry_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    job_type VARCHAR(128) NOT NULL,
    cron_expression VARCHAR(128) NOT NULL,
    video_id INTEGER NULL,
    channel_id INTEGER NULL,
    other_target_id INTEGER NULL,
    parameter VARCHAR(1024) NULL,
    extended_parameters TEXT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ NULL,
    next_run_at TIMESTAMPTZ NULL,
    record_created TIMESTAMPTZ DEFAULT NOW(),
    record_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Link job_queue rows to the scheduler entry that created them (for history)
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS scheduler_entry_id INTEGER NULL REFERENCES scheduler_entry(scheduler_entry_id);

CREATE INDEX IF NOT EXISTS idx_job_queue_scheduler_entry_id ON job_queue (scheduler_entry_id);
