-- Control values for queue_all_downloads job (min/max delay between scheduled downloads, priority)
INSERT INTO control (key, index, value, last_update) VALUES
    ('download_scheduler_min_delay', 0, '60', NOW()),
    ('download_scheduler_max_delay', 0, '300', NOW()),
    ('download_scheduler_job_pri', 0, '50', NOW())
ON CONFLICT (key) DO NOTHING;
