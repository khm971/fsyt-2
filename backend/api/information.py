"""System information / stats API for the admin Information page."""
from fastapi import APIRouter, Request

from database import db

router = APIRouter(prefix="/information", tags=["information"])


@router.get("")
async def get_information(request: Request):
    """Return aggregate system stats in one response for the admin Information page. user_video counts are for current user."""
    user_id = request.state.user_id
    # Single query with scalar subqueries; user_video counts filtered by current user
    row = await db.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM event_log)::int AS event_log_total,
            (SELECT MIN(event_time) FROM event_log) AS event_log_oldest,
            (SELECT COUNT(*) FROM job_queue)::int AS job_queue_total,
            (SELECT MIN(record_created) FROM job_queue) AS job_queue_oldest,
            (SELECT COUNT(*) FROM video WHERE is_ignore IS NOT TRUE)::int AS video_total,
            (SELECT COUNT(*) FROM video WHERE status = 'available' AND (is_ignore IS NOT TRUE))::int AS video_available,
            (SELECT COUNT(*) FROM charged_error)::int AS charged_error_total,
            (SELECT COUNT(*) FROM charged_error WHERE is_dismissed = FALSE)::int AS charged_error_unacknowledged,
            (SELECT COUNT(*) FROM scheduler_entry)::int AS scheduler_total,
            (SELECT COUNT(*) FROM scheduler_entry WHERE is_enabled = TRUE)::int AS scheduler_enabled,
            (SELECT COUNT(*) FROM channel)::int AS channel_total,
            (SELECT COUNT(*) FROM user_video WHERE user_id = $1 AND is_finished = TRUE)::int AS videos_watched_to_completion,
            (SELECT COUNT(*) FROM user_video WHERE user_id = $1 AND (progress_seconds > 0 OR progress_percent > 0) AND is_finished = FALSE)::int AS videos_watch_in_progress
        """,
        user_id,
    )
    return {
        "event_log_total": row["event_log_total"] or 0,
        "event_log_oldest": row["event_log_oldest"].isoformat() if row["event_log_oldest"] else None,
        "job_queue_total": row["job_queue_total"] or 0,
        "job_queue_oldest": row["job_queue_oldest"].isoformat() if row["job_queue_oldest"] else None,
        "video_total": row["video_total"] or 0,
        "video_available": row["video_available"] or 0,
        "charged_error_total": row["charged_error_total"] or 0,
        "charged_error_unacknowledged": row["charged_error_unacknowledged"] or 0,
        "scheduler_total": row["scheduler_total"] or 0,
        "scheduler_enabled": row["scheduler_enabled"] or 0,
        "channel_total": row["channel_total"] or 0,
        "videos_watched_to_completion": row["videos_watched_to_completion"] or 0,
        "videos_watch_in_progress": row["videos_watch_in_progress"] or 0,
    }
