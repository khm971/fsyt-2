"""Logger adapter for yt-dlp that writes all messages to event_log with subsystem=ytdl."""
import sync_db


class YtdlpEventLogLogger:
    """Implements debug, warning, error for yt-dlp; each call logs to event_log with severity low_level and subsystem ytdl."""

    def __init__(self, job_id=None, video_id=None, channel_id=None):
        self.job_id = job_id
        self.video_id = video_id
        self.channel_id = channel_id

    def _log(self, msg: str) -> None:
        if not msg:
            return
        sync_db.log_event_sync(
            msg[:4096],
            severity=sync_db.SEVERITY_LOW_LEVEL,
            job_id=self.job_id,
            video_id=self.video_id,
            channel_id=self.channel_id,
            subsystem="ytdl",
        )

    def debug(self, msg: str) -> None:
        self._log(msg)

    def warning(self, msg: str) -> None:
        self._log(msg)

    def error(self, msg: str) -> None:
        self._log(msg)


def make_ytdl_logger(job_id=None, video_id=None, channel_id=None):
    """Return a logger instance for use as yt-dlp's logger option."""
    return YtdlpEventLogLogger(job_id=job_id, video_id=video_id, channel_id=channel_id)
