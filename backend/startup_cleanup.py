"""Clean up in-progress job/video state and temp files on startup (single-backend assumption)."""
import os

from database import db
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_WARNING
import db_helpers

CANCEL_REASON = "Cancelled: previous run did not complete (cleanup on startup)"


async def run_startup_cleanup() -> None:
    """Run after migrations, before job loop. Resets stuck jobs/videos and removes temp_downloads."""
    await log_event("Startup cleanup: starting", SEVERITY_DEBUG)

    # 1. Job queue: any status other than new, done, cancelled → cancelled with message and warning_flag
    rows = await db.fetch(
        """SELECT job_queue_id, status, video_id, channel_id FROM job_queue
           WHERE status NOT IN ('new', 'done', 'cancelled')"""
    )
    for r in rows:
        job_id = r["job_queue_id"]
        old_status = r["status"]
        await log_event(
            f"Inconsistent job on startup: job_id={job_id} status={old_status!r} → cancelled",
            SEVERITY_WARNING,
            job_id=job_id,
            video_id=r.get("video_id"),
            channel_id=r.get("channel_id"),
        )
        await db_helpers.cancel_job_on_startup(job_id, CANCEL_REASON)
        await log_event(
            f"Startup cleanup: job {job_id} set to cancelled",
            SEVERITY_DEBUG,
            job_id=job_id,
        )

    # 2. Video: downloading / get_metadata_for_download → no_metadata
    video_rows = await db.fetch(
        """SELECT video_id, status FROM video
           WHERE status IN ('downloading', 'get_metadata_for_download')"""
    )
    for r in video_rows:
        video_id = r["video_id"]
        old_status = r["status"]
        await log_event(
            f"Inconsistent video on startup: video_id={video_id} status={old_status!r} → no_metadata",
            SEVERITY_WARNING,
            video_id=video_id,
        )
        await db.execute(
            "UPDATE video SET status = 'no_metadata', status_message = NULL WHERE video_id = $1",
            video_id,
        )
        await log_event(
            f"Startup cleanup: video {video_id} set to no_metadata",
            SEVERITY_DEBUG,
            video_id=video_id,
        )

    # 3. Temp files: remove contents of temp_downloads (same path as download_service)
    temp_dir = os.path.join(os.getcwd(), "temp_downloads")
    if os.path.isdir(temp_dir):
        try:
            entries = os.listdir(temp_dir)
            for name in entries:
                path = os.path.join(temp_dir, name)
                if os.path.isfile(path):
                    try:
                        os.remove(path)
                        await log_event(
                            f"Startup cleanup: removed temp file {path}",
                            SEVERITY_DEBUG,
                        )
                    except OSError as e:
                        await log_event(
                            f"Startup cleanup: failed to remove temp file {path}: {type(e).__name__}: {e}",
                            SEVERITY_WARNING,
                        )
            if not os.listdir(temp_dir):
                os.rmdir(temp_dir)
                await log_event(
                    f"Startup cleanup: removed empty temp_downloads directory",
                    SEVERITY_DEBUG,
                )
        except OSError as e:
            await log_event(
                f"Startup cleanup: error cleaning temp_downloads {temp_dir}: {type(e).__name__}: {e}",
                SEVERITY_WARNING,
            )

    await log_event("Startup cleanup: finished", SEVERITY_DEBUG)
