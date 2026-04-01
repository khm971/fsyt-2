"""Event log REST API."""
from fastapi import APIRouter, Query, HTTPException

from database import db
from api.schemas import LogFilterOptionsResponse
from log_helper import (
    SEVERITY_DEBUG,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    SEVERITY_CRITICAL,
    log_event,
)

router = APIRouter(prefix="/log", tags=["log"])


def _escape_ilike(term: str) -> str:
    """Escape % and _ for safe use in ILIKE pattern (use ESCAPE '\\' in SQL)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def row_to_log(r):
    out = {
        "event_log_id": r["event_log_id"],
        "event_time": r["event_time"].isoformat() if r["event_time"] else None,
        "message": r["message"],
        "severity": r["severity"],
        "acknowledged": r["acknowledged"] or False,
        "job_id": r.get("job_id"),
        "video_id": r.get("video_id"),
        "channel_id": r.get("channel_id"),
        "subsystem": r.get("subsystem"),
    }
    if r.get("user_id") is not None:
        out["user_id"] = r["user_id"]
    if r.get("username") is not None:
        out["username"] = r["username"]
    if "instance_id" in r and r["instance_id"] is not None:
        out["instance_id"] = str(r["instance_id"])
    if "hostname" in r and r["hostname"] is not None:
        out["hostname"] = r["hostname"]
    return out


@router.get("")
async def list_log(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    video_id: int | None = Query(None, description="Filter by video_id (e.g. for transcode logs)"),
    min_severity: int | None = Query(None, description="Minimum severity (e.g. 10 to exclude Low_Level)"),
    message_contains: str | None = Query(None),
    job_id: int | None = Query(None),
    channel_id: int | None = Query(None, description="Filter by channel_id (context on entry)"),
    acknowledged: bool | None = Query(None),
    subsystem: str | None = Query(None),
    sort_by: str = Query("time", pattern="^(time|job_id|video_id|channel_id|severity|message)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    """List log entries, sortable with pagination. Use video_id to filter transcode logs."""
    conditions = []
    params = []
    i = 1
    if video_id is not None:
        conditions.append(f"e.video_id = ${i}")
        params.append(video_id)
        i += 1
    if min_severity is not None:
        conditions.append(f"e.severity >= ${i}")
        params.append(min_severity)
        i += 1
    msg_term = (message_contains or "").strip() or None
    if msg_term:
        conditions.append(f"e.message ILIKE ${i} ESCAPE E'\\\\'")
        params.append(f"%{_escape_ilike(msg_term)}%")
        i += 1
    if job_id is not None:
        conditions.append(f"e.job_id = ${i}")
        params.append(job_id)
        i += 1
    if channel_id is not None:
        conditions.append(f"e.channel_id = ${i}")
        params.append(channel_id)
        i += 1
    if acknowledged is True:
        conditions.append("e.acknowledged IS TRUE")
    elif acknowledged is False:
        conditions.append("COALESCE(e.acknowledged, FALSE) IS NOT TRUE")
    sub = (subsystem or "").strip() or None
    if sub:
        conditions.append(f"e.subsystem = ${i}")
        params.append(sub)
        i += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    if (
        video_id is not None
        or msg_term
        or job_id is not None
        or channel_id is not None
        or acknowledged is not None
        or sub
    ):
        await log_event(
            f"Log list filters: video_id={video_id} message={bool(msg_term)} job_id={job_id} channel_id={channel_id} acknowledged={acknowledged!r} subsystem={sub!r}",
            SEVERITY_DEBUG,
        )

    # Map sort_by to actual column names, keeping a strict whitelist.
    if sort_by == "time":
        sort_col = "event_time"
    elif sort_by == "job_id":
        sort_col = "job_id"
    elif sort_by == "video_id":
        sort_col = "video_id"
    elif sort_by == "channel_id":
        sort_col = "channel_id"
    elif sort_by == "severity":
        sort_col = "severity"
    elif sort_by == "message":
        sort_col = "message"
    else:
        sort_col = "event_time"

    direction = "ASC" if sort_order == "asc" else "DESC"
    nulls_last_cols = {"job_id", "video_id", "channel_id"}
    nulls_clause = " NULLS LAST" if sort_col in nulls_last_cols else ""
    order_clause = f"ORDER BY e.{sort_col} {direction}{nulls_clause}, e.event_log_id {direction}"

    params.extend([limit, offset])
    rows = await db.fetch(
        f"""SELECT e.event_log_id, e.event_time, e.message, e.severity, e.acknowledged, e.job_id, e.video_id, e.channel_id, e.subsystem, e.user_id, u.username
            FROM event_log e
            LEFT JOIN app_user u ON e.user_id = u.user_id
            {where}
            {order_clause}
            LIMIT ${i} OFFSET ${i + 1}""",
        *params,
    )
    count_params = params[:-2]
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM event_log e {where}",
        *count_params,
    )
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
    min_severity: int | None = Query(None, description="Minimum severity (e.g. 20 for Info+)"),
):
    """Get the most recent log entries (for dashboard). Use video_id to filter transcode logs."""
    conditions = []
    params = []
    i = 1
    if video_id is not None:
        conditions.append(f"e.video_id = ${i}")
        params.append(video_id)
        i += 1
    if min_severity is not None:
        conditions.append(f"e.severity >= ${i}")
        params.append(min_severity)
        i += 1
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)
    rows = await db.fetch(
        f"""SELECT e.event_log_id, e.event_time, e.message, e.severity, e.acknowledged, e.job_id, e.video_id, e.channel_id, e.subsystem, e.user_id, u.username
            FROM event_log e
            LEFT JOIN app_user u ON e.user_id = u.user_id
            {where}
            ORDER BY e.event_time DESC
            LIMIT ${i}""",
        *params,
    )
    return [row_to_log(r) for r in rows]


@router.get("/filter-options", response_model=LogFilterOptionsResponse)
async def log_filter_options():
    rows = await db.fetch(
        """SELECT DISTINCT subsystem FROM event_log
           WHERE subsystem IS NOT NULL AND BTRIM(subsystem) <> ''
           ORDER BY 1
           LIMIT 50"""
    )
    subsystems = [r["subsystem"] for r in rows if r.get("subsystem")]
    await log_event("Log filter options requested", SEVERITY_DEBUG)
    return LogFilterOptionsResponse(subsystems=subsystems)


@router.get("/{event_log_id}")
async def get_log_entry(event_log_id: int):
    """Get a single log entry by id with all fields (including instance_id, hostname, user_id, username)."""
    row = await db.fetchrow(
        """SELECT e.event_log_id, e.event_time, e.message, e.severity, e.acknowledged,
                  e.job_id, e.video_id, e.channel_id, e.subsystem, e.instance_id, e.hostname, e.user_id, u.username
           FROM event_log e
           LEFT JOIN app_user u ON e.user_id = u.user_id
           WHERE e.event_log_id = $1""",
        event_log_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return row_to_log(row)


@router.patch("/{event_log_id}/acknowledge")
async def acknowledge_log(event_log_id: int):
    """Mark a log entry as acknowledged."""
    await db.execute(
        "UPDATE event_log SET acknowledged = TRUE WHERE event_log_id = $1",
        event_log_id,
    )
    return {"ok": True}
