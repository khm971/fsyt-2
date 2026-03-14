"""Async helper to write important events to the event_log table."""
from database import db
from websocket_manager import ws_manager
from backend_instance_context import get_backend_instance

SEVERITY_LOW_LEVEL = 5
SEVERITY_DEBUG = 10
SEVERITY_INFO = 20
SEVERITY_NOTICE = 25
SEVERITY_WARNING = 30
SEVERITY_ERROR = 40
SEVERITY_CRITICAL = 50


async def log_event(
    message: str,
    severity: int = SEVERITY_INFO,
    job_id: int | None = None,
    video_id: int | None = None,
    channel_id: int | None = None,
    subsystem: str | None = None,
    user_id: int | None = None,
) -> None:
    """Write an event to the event_log table. When video_id is set and channel_id is not, looks up channel_id from the video row."""
    try:
        if video_id is not None and channel_id is None:
            channel_id = await db.fetchval(
                "SELECT channel_id FROM video WHERE video_id = $1", video_id
            )
        instance_id, hostname = get_backend_instance()
        await db.execute(
            """INSERT INTO event_log (message, severity, job_id, video_id, channel_id, instance_id, hostname, subsystem, user_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            (message or "")[:4096],
            severity,
            job_id,
            video_id,
            channel_id,
            instance_id,
            hostname or None,
            subsystem,
            user_id,
        )
        if severity >= SEVERITY_INFO:
            try:
                await ws_manager.broadcast({"type": "log_event"})
            except Exception:
                pass
    except Exception:
        pass  # Don't let logging failures break the app
