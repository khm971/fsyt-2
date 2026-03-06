-- Control defaults for job handlers (Phase 2)
INSERT INTO control (key, index, value, last_update) VALUES
    ('max_new_videos_get_dflt', 0, '10', NOW()),
    ('sleep_fill_missing_meta', 0, '5', NOW()),
    ('download_rate_limit_mbps', 0, '0', NOW()),
    ('download_pct_change_thresh', 0, '5', NOW()),
    ('server_ytdl_quiet', 0, 'true', NOW()),
    ('max_chargeable_errors_hour', 0, '10', NOW()),
    ('ytdlp_version', 0, '', NOW())
ON CONFLICT (key) DO NOTHING;
