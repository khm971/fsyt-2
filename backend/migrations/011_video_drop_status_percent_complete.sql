-- Completion percent is stored in job_queue only; remove from video to avoid confusion.
ALTER TABLE video DROP COLUMN IF EXISTS status_percent_complete;
