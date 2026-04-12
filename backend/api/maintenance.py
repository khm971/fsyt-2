from fastapi import APIRouter, HTTPException, Request

from database import db
from api.videos import clear_all_hls_transcodes
from job_processor import broadcast_queue_update
from log_helper import log_event, SEVERITY_ERROR, SEVERITY_INFO

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/clear-transcodes")
async def clear_transcodes(request: Request):
    try:
        return await clear_all_hls_transcodes()
    except Exception as exc:
        user_id = getattr(request.state, "user_id", None)
        await log_event(
            f"Maintenance: failed to clear transcodes: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
            user_id=user_id,
        )
        raise HTTPException(500, "Failed to clear transcodes") from exc


@router.post("/clear-watch-history")
async def clear_watch_history(request: Request):
    try:
        user_id = getattr(request.state, "user_id", None)
        await log_event("Maintenance: clearing all watch history", SEVERITY_INFO, user_id=user_id)
        await db.execute(
            """UPDATE user_video
               SET progress_seconds = 0, progress_percent = 0, is_finished = FALSE, last_watched = NULL"""
        )
        await log_event("Maintenance: cleared all watch history", SEVERITY_INFO, user_id=user_id)
        return {"ok": True}
    except Exception as exc:
        user_id = getattr(request.state, "user_id", None)
        await log_event(
            f"Maintenance: failed to clear watch history: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
            user_id=user_id,
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
async def cancel_pending_future_jobs(request: Request):
    """Set status to 'cancelled' and status_message for all jobs with status='new' and run_after > NOW().
    Does not set warning_flag since the user initiated this action."""
    try:
        result = await db.execute(
            """UPDATE job_queue SET status = 'cancelled', last_update = NOW(),
                   status_message = 'Future job cancelled in bulk by an admin.'
               WHERE status = 'new' AND run_after > NOW()"""
        )
        cancelled_count = int(result.split()[-1]) if result else 0
        await broadcast_queue_update()
        user_id = getattr(request.state, "user_id", None)
        await log_event(
            f"Maintenance: cancelled {cancelled_count} pending future jobs",
            SEVERITY_INFO,
            user_id=user_id,
        )
        return {"cancelled_count": cancelled_count}
    except Exception as exc:
        user_id = getattr(request.state, "user_id", None)
        await log_event(
            f"Maintenance: failed to cancel pending future jobs: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
            user_id=user_id,
        )
        raise HTTPException(500, "Failed to cancel pending future jobs") from exc


@router.get("/generate-missing-llm-descriptions/preview")
async def generate_missing_llm_descriptions_preview():
    """Count videos where description equals llm_description_1 (treated as missing a real LLM plot summary)."""
    row = await db.fetchrow(
        "SELECT COUNT(*) AS count FROM video WHERE description = llm_description_1"
    )
    return {"count": int(row["count"] or 0)}


@router.post("/generate-missing-llm-descriptions")
async def generate_missing_llm_descriptions(request: Request):
    """Queue a job to generate LLM plot summaries for videos where description = llm_description_1."""
    user_id = getattr(request.state, "user_id", None)
    try:
        row = await db.fetchrow(
            "SELECT COUNT(*) AS count FROM video WHERE description = llm_description_1"
        )
        n = int(row["count"] or 0)
        if n == 0:
            raise HTTPException(400, "No videos match description = llm_description_1")
        job_row = await db.fetchrow(
            """INSERT INTO job_queue (job_type, video_id, channel_id, parameter, status, priority, user_id, target_server_instance_id)
               VALUES ('generate_missing_llm_descriptions', NULL, NULL, NULL, 'new', 50, $1, 1)
               RETURNING job_queue_id""",
            user_id,
        )
        job_queue_id = int(job_row["job_queue_id"])
        await broadcast_queue_update()
        await log_event(
            f"Maintenance: queued generate missing LLM descriptions for {n} video(s) (job_queue_id={job_queue_id})",
            SEVERITY_INFO,
            job_id=job_queue_id,
            user_id=user_id,
        )
        return {"video_count": n, "job_queue_id": job_queue_id}
    except HTTPException:
        raise
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to queue generate missing LLM descriptions: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
            user_id=user_id,
        )
        raise HTTPException(500, "Failed to queue generate missing LLM descriptions") from exc
