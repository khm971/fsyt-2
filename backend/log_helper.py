"""Async helper to write important events to the event_log table."""
from database import db

SEVERITY_DEBUG = 10
SEVERITY_INFO = 20
SEVERITY_WARNING = 30
SEVERITY_ERROR = 40
SEVERITY_CRITICAL = 50


async def log_event(
    message: str,
    severity: int = SEVERITY_INFO,
    job_id: int | None = None,
    video_id: int | None = None,
    channel_id: int | None = None,
) -> None:
    """Write an event to the event_log table."""
    try:
        await db.execute(
            """INSERT INTO event_log (message, severity, job_id, video_id, channel_id)
               VALUES ($1, $2, $3, $4, $5)""",
            (message or "")[:4096],
            severity,
            job_id,
            video_id,
            channel_id,
        )
    except Exception:
        pass  # Don't let logging failures break the app
