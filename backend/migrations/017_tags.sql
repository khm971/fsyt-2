-- Tagging: tag master (per user), video_tag and channel_tag intersection tables

-- Tag master: user_id, title (label), colors, icons (Lucide kebab-case), is_system
CREATE TABLE IF NOT EXISTS tag (
    tag_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    bg_color VARCHAR(7),
    fg_color VARCHAR(7),
    icon_before VARCHAR(64),
    icon_after VARCHAR(64),
    is_system BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_user_lower_title ON tag (user_id, LOWER(title));
CREATE INDEX IF NOT EXISTS idx_tag_user_title ON tag (user_id, title);

-- Video–tag intersection
CREATE TABLE IF NOT EXISTS video_tag (
    video_id INTEGER NOT NULL REFERENCES video(video_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);

-- Channel–tag intersection (for future/automations)
CREATE TABLE IF NOT EXISTS channel_tag (
    channel_id INTEGER NOT NULL REFERENCES channel(channel_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, tag_id)
);

-- Seed system tags for user_id = 1
INSERT INTO tag (user_id, title, bg_color, fg_color, is_system)
VALUES
    (1, 'Favorite', '#7c3aed', '#f3f4f6', TRUE),
    (1, 'Needs Review', '#b45309', '#fef3c7', TRUE),
    (1, 'Watch List', '#0369a1', '#e0f2fe', TRUE)
ON CONFLICT (user_id, LOWER(title)) DO NOTHING;
