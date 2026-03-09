from fastapi import APIRouter, HTTPException

from database import db
from api.videos import clear_all_hls_transcodes
from job_processor import broadcast_queue_update
from log_helper import log_event, SEVERITY_ERROR, SEVERITY_INFO

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/clear-transcodes")
async def clear_transcodes():
    try:
        return await clear_all_hls_transcodes()
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to clear transcodes: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
        )
        raise HTTPException(500, "Failed to clear transcodes") from exc


@router.post("/clear-watch-history")
async def clear_watch_history():
    try:
        await log_event("Maintenance: clearing all watch history", SEVERITY_INFO)
        await db.execute(
            """UPDATE user_video
               SET progress_seconds = 0, progress_percent = 0, is_finished = FALSE, last_watched = NULL"""
        )
        await log_event("Maintenance: cleared all watch history", SEVERITY_INFO)
        return {"ok": True}
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to clear watch history: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
        )
        raise HTTPException(500, "Failed to clear watch history") from exc


@router.get("/cancel-pending-future-jobs/preview")
async def cancel_pending_future_jobs_preview():
    """Return count and first/last run_after for jobs with status='new' and run_after > NOW()."""
    row = await db.fetchrow(
        """SELECT COUNT(*) AS count, MIN(run_after) AS first_run_after, MAX(run_after) AS last_run_after
           FROM job_queue WHERE status = 'new' AND run_after > NOW()"""
    )
    return {
        "count": int(row["count"] or 0),
        "first_run_after": row["first_run_after"].isoformat() if row["first_run_after"] else None,
        "last_run_after": row["last_run_after"].isoformat() if row["last_run_after"] else None,
    }


@router.post("/cancel-pending-future-jobs")
async def cancel_pending_future_jobs():
    """Set status to 'cancelled' for all jobs with status='new' and run_after > NOW().
    Does not set warning_flag since the user initiated this action."""
    try:
        result = await db.execute(
            """UPDATE job_queue SET status = 'cancelled', last_update = NOW()
               WHERE status = 'new' AND run_after > NOW()"""
        )
        cancelled_count = int(result.split()[-1]) if result else 0
        await broadcast_queue_update()
        await log_event(
            f"Maintenance: cancelled {cancelled_count} pending future jobs",
            SEVERITY_INFO,
        )
        return {"cancelled_count": cancelled_count}
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to cancel pending future jobs: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
        )
        raise HTTPException(500, "Failed to cancel pending future jobs") from exc
