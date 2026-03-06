-- FSYT2 initial schema (run against existing empty fsyt2 database)

-- Channel: YouTube channels
CREATE TABLE IF NOT EXISTS channel (
    channel_id SERIAL PRIMARY KEY,
    provider_key VARCHAR(255),
    record_created TIMESTAMPTZ DEFAULT NOW(),
    record_updated TIMESTAMPTZ DEFAULT NOW(),
    handle VARCHAR(255),
    title VARCHAR(512),
    url VARCHAR(1024),
    thumbnail VARCHAR(1024),
    banner VARCHAR(1024),
    author VARCHAR(255),
    description TEXT,
    is_enabled_for_auto_download BOOLEAN DEFAULT FALSE,
    folder_on_disk VARCHAR(1024)
);

-- Video: YouTube videos
CREATE TABLE IF NOT EXISTS video (
    video_id SERIAL PRIMARY KEY,
    provider_key VARCHAR(64) UNIQUE NOT NULL,
    channel_id INTEGER REFERENCES channel(channel_id),
    title VARCHAR(1024),
    upload_date TIMESTAMPTZ,
    description TEXT,
    llm_description_1 TEXT,
    thumbnail VARCHAR(1024),
    file_path VARCHAR(2048),
    download_date TIMESTAMPTZ,
    duration INTEGER,
    record_created TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(64),
    status_percent_complete INTEGER,
    priority INTEGER DEFAULT 50,
    status_message VARCHAR(1024),
    is_ignore BOOLEAN DEFAULT FALSE,
    metadata_last_updated TIMESTAMPTZ,
    nfo_last_written TIMESTAMPTZ
);

-- Job queue
CREATE TABLE IF NOT EXISTS job_queue (
    job_queue_id SERIAL PRIMARY KEY,
    record_created TIMESTAMPTZ DEFAULT NOW(),
    job_type VARCHAR(128) NOT NULL,
    video_id INTEGER REFERENCES video(video_id),
    channel_id INTEGER,
    other_target_id INTEGER,
    parameter VARCHAR(1024),
    extended_parameters TEXT,
    status VARCHAR(64) NOT NULL DEFAULT 'new',
    status_percent_complete INTEGER,
    status_message VARCHAR(1024),
    last_update TIMESTAMPTZ,
    completed_flag BOOLEAN NOT NULL DEFAULT FALSE,
    warning_flag BOOLEAN NOT NULL DEFAULT FALSE,
    error_flag BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledge_flag BOOLEAN NOT NULL DEFAULT FALSE,
    run_after TIMESTAMPTZ,
    priority INTEGER DEFAULT 50
);

-- Control: key-value app settings
CREATE TABLE IF NOT EXISTS control (
    key VARCHAR(255) PRIMARY KEY,
    index INTEGER,
    value TEXT,
    last_update TIMESTAMPTZ
);

-- Charged errors (rate/lockout)
CREATE TABLE IF NOT EXISTS charged_error (
    charged_error_id SERIAL PRIMARY KEY,
    error_date TIMESTAMPTZ NOT NULL,
    error_code VARCHAR(64),
    message TEXT,
    is_dismissed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Optional for later: user_video, user_video_list
CREATE TABLE IF NOT EXISTS user_video (
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL REFERENCES video(video_id),
    is_watched BOOLEAN NOT NULL DEFAULT TRUE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    progress_seconds INTEGER,
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS user_video_list (
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL REFERENCES video(video_id),
    list_id INTEGER NOT NULL,
    sequence_id INTEGER NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    comment VARCHAR(1024),
    PRIMARY KEY (user_id, video_id, list_id)
);

-- Seed control defaults
INSERT INTO control (key, index, value, last_update) VALUES
    ('server_heartbeat', 0, NULL, NOW()),
    ('queue_paused', 0, 'false', NOW()),
    ('chargeable_errors_lockout', 0, 'false', NOW()),
    ('scheduler.version', 0, '1.0.0', NOW())
ON CONFLICT (key) DO NOTHING;
