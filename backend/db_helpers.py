"""Async DB helpers for job processor (video, channel, job, control, charged_error)."""
import asyncio
from datetime import datetime, timedelta
from database import db
from services.ytdlp_service import get_video_info


async def get_video_by_id(video_id: int):
    return await db.fetchrow(
        "SELECT video_id, provider_key, channel_id, title, upload_date, description, llm_description_1, thumbnail, file_path, status FROM video WHERE video_id = $1",
        video_id,
    )


async def update_video_metadata(video_id: int, upload_date, title: str, description: str, thumbnail: str, duration: int | None = None):
    await db.execute(
        """UPDATE video SET title = $1, upload_date = $2, description = $3, thumbnail = $4, duration = $5, metadata_last_updated = NOW()
           WHERE video_id = $6""",
        title or None,
        upload_date,
        description or None,
        thumbnail or None,
        duration,
        video_id,
    )


async def update_video_download_progress(video_id: int, status: str, percent: int = 0, message: str = None):
    await db.execute(
        """UPDATE video SET status = $1, status_message = $2 WHERE video_id = $3""",
        status,
        message,
        video_id,
    )


async def update_video_download_info(video_id: int, file_path: str):
    await db.execute(
        """UPDATE video SET download_date = NOW(), file_path = $1, status = 'available' WHERE video_id = $2""",
        file_path.replace("\\", "/"),
        video_id,
    )


async def update_video_llm_description(video_id: int, llm_description_1: str):
    await db.execute(
        "UPDATE video SET llm_description_1 = $1 WHERE video_id = $2",
        llm_description_1 or None,
        video_id,
    )


async def get_channel_by_id(channel_id: int):
    return await db.fetchrow(
        "SELECT channel_id, provider_key, handle, title, folder_on_disk FROM channel WHERE channel_id = $1",
        channel_id,
    )


async def get_channel_by_provider_key(provider_key: str):
    return await db.fetchrow(
        "SELECT channel_id, provider_key, handle, title, folder_on_disk FROM channel WHERE provider_key = $1",
        provider_key,
    )


async def resolve_channel_for_video(provider_key: str) -> tuple[int | None, str | None]:
    """
    Resolve channel_id for a video from YouTube metadata.
    Finds or creates the channel; queues update_channel_info and download_channel_artwork for new channels.
    Returns (channel_id, None) on success, (None, error_message) on failure.
    """
    info, err = await asyncio.to_thread(get_video_info, provider_key)
    if not info:
        return None, f"Failed to get video info: {err}"
    chan_yt_id = info.get("channel_id")
    if not chan_yt_id:
        return None, "No channel_id in video info"
    ch = await get_channel_by_provider_key(chan_yt_id)
    if ch:
        return ch["channel_id"], None
    try:
        channel_id = await add_channel_by_handle_or_key(provider_key=chan_yt_id)
        await add_job("update_channel_info", channel_id=channel_id, priority=50)
        await add_job("download_channel_artwork", channel_id=channel_id, priority=50)
        return channel_id, None
    except Exception as e:
        return None, str(e)


async def update_video_channel_id(video_id: int, channel_id: int):
    await db.execute("UPDATE video SET channel_id = $1 WHERE video_id = $2", channel_id, video_id)


async def update_channel_info(channel_id: int, provider_key: str, handle: str, title: str, url: str, thumbnail: str, banner: str, author: str, description: str, folder_on_disk: str):
    await db.execute(
        """UPDATE channel SET provider_key = $1, handle = $2, title = $3, url = $4, thumbnail = $5, banner = $6, author = $7, description = $8, folder_on_disk = $9, record_updated = NOW()
           WHERE channel_id = $10""",
        provider_key,
        handle,
        title,
        url,
        thumbnail,
        banner,
        author,
        description,
        folder_on_disk,
        channel_id,
    )


async def add_channel_by_handle_or_key(provider_key: str = None, handle: str = None):
    if not provider_key and not handle:
        raise ValueError("Need provider_key or handle")
    if provider_key and handle:
        raise ValueError("Provide only one of provider_key or handle")
    row = await db.fetchrow(
        """INSERT INTO channel (provider_key, handle) VALUES ($1, $2) RETURNING channel_id""",
        provider_key,
        handle,
    )
    return row["channel_id"]


async def add_video_if_not_exist(channel_id: int, provider_key: str, title: str, file_path: str, duration: int):
    existing = await db.fetchrow("SELECT video_id FROM video WHERE provider_key = $1", provider_key)
    if existing:
        return False, existing["video_id"]
    row = await db.fetchrow(
        """INSERT INTO video (channel_id, provider_key, title, file_path, duration, status)
           VALUES ($1, $2, $3, $4, $5, 'no_metadata') RETURNING video_id""",
        channel_id,
        provider_key,
        title,
        file_path,
        duration or 0,
    )
    return True, row["video_id"]


async def get_videos_missing_metadata(limit: int | None = 100):
    base = """SELECT video_id, provider_key FROM video
              WHERE status IN ('no_metadata', 'initial_metadata_load', 'llm_processing')
              AND (is_ignore IS NOT TRUE) AND (status NOT LIKE 'error%')
              ORDER BY video_id"""
    if limit is not None:
        return await db.fetch(base + " LIMIT $1", limit)
    return await db.fetch(base)


async def get_auto_downloadenabled_channels():
    return await db.fetch(
        "SELECT channel_id, provider_key, handle, title FROM channel WHERE is_enabled_for_auto_download = TRUE"
    )


async def add_charged_error(error_code: str, message: str):
    await db.execute(
        "INSERT INTO charged_error (error_date, error_code, message) VALUES (NOW(), $1, $2)",
        error_code[:64],
        (message or "")[:2048],
    )


async def get_charged_error_count_last_hour() -> int:
    r = await db.fetchval(
        "SELECT COUNT(*) FROM charged_error WHERE error_date > NOW() - INTERVAL '1 hour' AND is_dismissed = FALSE"
    )
    return r or 0


async def get_control_value(key: str):
    r = await db.fetchrow("SELECT value FROM control WHERE key = $1", key)
    return r["value"] if r else None


async def get_control_int(key: str, default: int = 0) -> int:
    v = await get_control_value(key)
    if v is None:
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


async def get_control_bool(key: str) -> bool:
    v = await get_control_value(key)
    if v is None:
        return False
    return str(v).strip().lower() in ("true", "1", "t", "yes")


async def set_control_value(key: str, value: str):
    await db.execute(
        """INSERT INTO control (key, index, value, last_update) VALUES ($1, 0, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, last_update = NOW()""",
        key,
        value,
    )


async def update_job_status(job_id: int, status: str, message: str = None, percent: int = None):
    await db.execute(
        """UPDATE job_queue SET status = $1, last_update = NOW(), status_message = $2, status_percent_complete = $3 WHERE job_queue_id = $4""",
        status,
        message,
        percent,
        job_id,
    )


async def mark_job_done_success(job_id: int, message: str = None):
    await db.execute(
        """UPDATE job_queue SET status = 'done', last_update = NOW(), status_message = $1, status_percent_complete = 100, completed_flag = TRUE
           WHERE job_queue_id = $2""",
        message,
        job_id,
    )


async def mark_job_done_exception(job_id: int, message: str, is_warning: bool = False, is_error: bool = False):
    if not is_warning and not is_error:
        is_error = True
    await db.execute(
        """UPDATE job_queue SET status = 'done', last_update = NOW(), status_message = $1, status_percent_complete = 100, warning_flag = $2, error_flag = $3
           WHERE job_queue_id = $4""",
        (message or "")[:1024],
        is_warning,
        is_error,
        job_id,
    )


async def cancel_job_on_startup(job_id: int, reason: str) -> None:
    """Set job to cancelled with message and warning flag (for startup cleanup of in-progress jobs)."""
    await db.execute(
        """UPDATE job_queue SET status = 'cancelled', last_update = NOW(), status_message = $1, warning_flag = TRUE
           WHERE job_queue_id = $2""",
        (reason or "")[:1024],
        job_id,
    )


async def add_job(job_type: str, video_id: int = None, channel_id: int = None, parameter: str = None, priority: int = 50):
    await db.execute(
        """INSERT INTO job_queue (job_type, video_id, channel_id, parameter, status, priority) VALUES ($1, $2, $3, $4, 'new', $5)""",
        job_type,
        video_id,
        channel_id,
        parameter,
        priority,
    )


async def get_furthest_scheduled_job():
    """Return the job_queue row with status='new' and the latest run_after, or None."""
    return await db.fetchrow(
        """SELECT job_queue_id, run_after FROM job_queue
           WHERE status = 'new' AND run_after IS NOT NULL
           ORDER BY run_after DESC LIMIT 1"""
    )


async def get_pending_download_video_job_id(video_id: int) -> int | None:
    """Return job_queue_id of an existing new or running download_video job for this video, or None."""
    row = await db.fetchrow(
        """SELECT job_queue_id FROM job_queue
           WHERE job_type = 'download_video' AND video_id = $1 AND status IN ('new', 'running')
           LIMIT 1""",
        video_id,
    )
    return row["job_queue_id"] if row else None


async def add_video_job_to_queue(job_type: str, video_id: int, run_after=None, priority: int = 50):
    await db.execute(
        """INSERT INTO job_queue (job_type, video_id, channel_id, other_target_id, parameter, extended_parameters,
           status, run_after, priority) VALUES ($1, $2, NULL, NULL, NULL, NULL, 'new', $3, $4)""",
        job_type,
        video_id,
        run_after,
        priority,
    )
