-- Index on video.file_path for fast lookup when matching Jellyfin Episode paths (tens/hundreds of thousands of rows).
CREATE INDEX IF NOT EXISTS idx_video_file_path ON video (file_path) WHERE file_path IS NOT NULL;
