"""Event log REST API."""
from fastapi import APIRouter, Query

from database import db
from log_helper import SEVERITY_DEBUG, SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR, SEVERITY_CRITICAL

router = APIRouter(prefix="/log", tags=["log"])


def row_to_log(r):
    return {
        "event_log_id": r["event_log_id"],
        "event_time": r["event_time"].isoformat() if r["event_time"] else None,
        "message": r["message"],
        "severity": r["severity"],
        "acknowledged": r["acknowledged"] or False,
        "job_id": r.get("job_id"),
        "video_id": r.get("video_id"),
        "channel_id": r.get("channel_id"),
    }


@router.get("")
async def list_log(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    video_id: int | None = Query(None, description="Filter by video_id (e.g. for transcode logs)"),
):
    """List log entries, newest first. Supports pagination. Use video_id to filter transcode logs."""
    if video_id is not None:
        rows = await db.fetch(
            """SELECT event_log_id, event_time, message, severity, acknowledged, job_id, video_id, channel_id
               FROM event_log
               WHERE video_id = $1
               ORDER BY event_time DESC
               LIMIT $2 OFFSET $3""",
            video_id,
            limit,
            offset,
        )
        total = await db.fetchval("SELECT COUNT(*) FROM event_log WHERE video_id = $1", video_id)
    else:
        rows = await db.fetch(
            """SELECT event_log_id, event_time, message, severity, acknowledged, job_id, video_id, channel_id
               FROM event_log
               ORDER BY event_time DESC
               LIMIT $1 OFFSET $2""",
            limit,
            offset,
        )
        total = await db.fetchval("SELECT COUNT(*) FROM event_log")
    return {
        "entries": [row_to_log(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/recent")
async def recent_log(
    limit: int = Query(10, le=50),
    video_id: int | None = Query(None, description="Filter by video_id (e.g. for transcode logs)"),
):
    """Get the most recent log entries (for dashboard). Use video_id to filter transcode logs."""
    if video_id is not None:
        rows = await db.fetch(
            """SELECT event_log_id, event_time, message, severity, acknowledged, job_id, video_id, channel_id
               FROM event_log
               WHERE video_id = $1
               ORDER BY event_time DESC
               LIMIT $2""",
            video_id,
            limit,
        )
    else:
        rows = await db.fetch(
            """SELECT event_log_id, event_time, message, severity, acknowledged, job_id, video_id, channel_id
               FROM event_log
               ORDER BY event_time DESC
               LIMIT $1""",
            limit,
        )
    return [row_to_log(r) for r in rows]


@router.patch("/{event_log_id}/acknowledge")
async def acknowledge_log(event_log_id: int):
    """Mark a log entry as acknowledged."""
    await db.execute(
        "UPDATE event_log SET acknowledged = TRUE WHERE event_log_id = $1",
        event_log_id,
    )
    return {"ok": True}
