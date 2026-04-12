"""Async DB helpers for job processor (video, channel, job, control, charged_error)."""
import asyncio
from datetime import datetime, timedelta, timezone
from database import db
from log_helper import log_event, SEVERITY_WARNING
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


async def resolve_channel_for_video(
    provider_key: str,
    user_id: int | None = None,
    *,
    target_server_instance_id: int = 1,
) -> tuple[int | None, str | None]:
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
        channel_id = await add_channel_by_handle_or_key(provider_key=chan_yt_id, created_by_user_id=user_id)
        await add_job(
            "update_channel_info",
            channel_id=channel_id,
            priority=50,
            user_id=user_id,
            target_server_instance_id=target_server_instance_id,
        )
        await add_job(
            "download_channel_artwork",
            channel_id=channel_id,
            priority=50,
            user_id=user_id,
            target_server_instance_id=target_server_instance_id,
        )
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


async def add_channel_by_handle_or_key(provider_key: str = None, handle: str = None, created_by_user_id: int | None = None):
    if not provider_key and not handle:
        raise ValueError("Need provider_key or handle")
    if provider_key and handle:
        raise ValueError("Provide only one of provider_key or handle")
    row = await db.fetchrow(
        """INSERT INTO channel (provider_key, handle, created_by_user_id) VALUES ($1, $2, $3) RETURNING channel_id""",
        provider_key,
        handle,
        created_by_user_id,
    )
    return row["channel_id"]


async def add_video_if_not_exist(channel_id: int, provider_key: str, title: str, file_path: str, duration: int, created_by_user_id: int | None = None):
    existing = await db.fetchrow("SELECT video_id FROM video WHERE provider_key = $1", provider_key)
    if existing:
        return False, existing["video_id"]
    row = await db.fetchrow(
        """INSERT INTO video (channel_id, provider_key, title, file_path, duration, status, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, 'no_metadata', $6) RETURNING video_id""",
        channel_id,
        provider_key,
        title,
        file_path,
        duration or 0,
        created_by_user_id,
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


async def cancel_missed_future_jobs(reason: str, target_server_instance_id: int | None = None) -> int:
    """Cancel jobs with status='new' and run_after more than one minute in the past. Sets warning_flag and status_message. Returns count cancelled."""
    if target_server_instance_id is not None:
        rows = await db.fetch(
            """SELECT job_queue_id, video_id, channel_id FROM job_queue
               WHERE status = 'new' AND run_after IS NOT NULL AND run_after < NOW() - INTERVAL '1 minute'
                 AND target_server_instance_id = $1""",
            target_server_instance_id,
        )
    else:
        rows = await db.fetch(
            """SELECT job_queue_id, video_id, channel_id FROM job_queue
               WHERE status = 'new' AND run_after IS NOT NULL AND run_after < NOW() - INTERVAL '1 minute'"""
        )
    for r in rows:
        job_id = r["job_queue_id"]
        await cancel_job_on_startup(job_id, reason)
        await log_event(
            f"Job {job_id} cancelled: run after time had been missed",
            SEVERITY_WARNING,
            job_id=job_id,
            video_id=r.get("video_id"),
            channel_id=r.get("channel_id"),
        )
    return len(rows)


def instance_queue_paused_control_key(server_instance_id: int) -> str:
    return f"instance_queue_paused_{server_instance_id}"


async def add_job(
    job_type: str,
    video_id: int = None,
    channel_id: int = None,
    parameter: str = None,
    priority: int = 50,
    user_id: int = None,
    *,
    target_server_instance_id: int = 1,
):
    await db.execute(
        """INSERT INTO job_queue (job_type, video_id, channel_id, parameter, status, priority, user_id, target_server_instance_id)
           VALUES ($1, $2, $3, $4, 'new', $5, $6, $7)""",
        job_type,
        video_id,
        channel_id,
        parameter,
        priority,
        user_id,
        target_server_instance_id,
    )


async def get_furthest_scheduled_job(
    *,
    target_server_instance_id: int | None = None,
    job_type: str | None = None,
):
    """Return the job_queue row with status='new' and the latest run_after, or None."""
    where = "WHERE status = 'new' AND run_after IS NOT NULL"
    params: list = []
    i = 1
    if target_server_instance_id is not None:
        where += f" AND target_server_instance_id = ${i}"
        params.append(target_server_instance_id)
        i += 1
    if job_type is not None:
        where += f" AND job_type = ${i}"
        params.append(job_type)
    return await db.fetchrow(
        f"""SELECT job_queue_id, run_after FROM job_queue
           {where}
           ORDER BY run_after DESC LIMIT 1""",
        *params,
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


async def add_video_job_to_queue(
    job_type: str,
    video_id: int,
    run_after=None,
    priority: int = 50,
    user_id: int = None,
    *,
    target_server_instance_id: int = 1,
):
    await db.execute(
        """INSERT INTO job_queue (job_type, video_id, channel_id, other_target_id, parameter, extended_parameters,
           status, run_after, priority, user_id, target_server_instance_id)
           VALUES ($1, $2, NULL, NULL, NULL, NULL, 'new', $3, $4, $5, $6)""",
        job_type,
        video_id,
        run_after,
        priority,
        user_id,
        target_server_instance_id,
    )


async def fetch_downloader_instance_ids() -> list[int]:
    """Instances enabled for download job assignment (queue_all target-all)."""
    rows = await db.fetch(
        """SELECT server_instance_id FROM server_instance
           WHERE is_enabled = TRUE AND assign_download_jobs = TRUE
           ORDER BY server_instance_id"""
    )
    return [int(r["server_instance_id"]) for r in rows]


async def fetch_server_instances_dashboard_summary() -> list[dict]:
    """Per-instance health and queue stats for dashboard / WebSocket (cluster view)."""
    dup_rows = await db.fetch(
        """SELECT server_instance_id FROM backend_instances
           WHERE last_heartbeat_utc > NOW() - INTERVAL '30 seconds'
           GROUP BY server_instance_id
           HAVING COUNT(*) > 1"""
    )
    duplicate_ids = {int(r["server_instance_id"]) for r in dup_rows}

    cfgs = await db.fetch(
        """SELECT server_instance_id, display_name, is_enabled, assign_download_jobs
           FROM server_instance ORDER BY server_instance_id"""
    )
    hb_rows = await db.fetch(
        """SELECT server_instance_id, MAX(last_heartbeat_utc) AS last_hb
           FROM backend_instances GROUP BY server_instance_id"""
    )
    hb_map = {int(r["server_instance_id"]): r["last_hb"] for r in hb_rows}

    counts_rows = await db.fetch(
        """SELECT target_server_instance_id,
                  count(*) FILTER (WHERE status = 'new') AS queued_new,
                  count(*) FILTER (
                      WHERE status = 'new' AND (run_after IS NULL OR run_after <= NOW())
                  ) AS runnable,
                  count(*) FILTER (
                      WHERE status = 'new' AND run_after IS NOT NULL AND run_after > NOW()
                  ) AS scheduled_future
           FROM job_queue GROUP BY target_server_instance_id"""
    )
    counts_map = {int(r["target_server_instance_id"]): r for r in counts_rows}

    running_rows = await db.fetch(
        """SELECT DISTINCT ON (target_server_instance_id)
                  target_server_instance_id, job_queue_id, job_type, video_id,
                  status_percent_complete, status_message
           FROM job_queue
           WHERE status NOT IN ('new', 'done', 'cancelled')
           ORDER BY target_server_instance_id, last_update DESC NULLS LAST"""
    )
    running_map = {int(r["target_server_instance_id"]): r for r in running_rows}

    now = datetime.now(timezone.utc)
    out: list[dict] = []
    for cfg in cfgs:
        sid = int(cfg["server_instance_id"])
        last_hb = hb_map.get(sid)
        is_running = False
        last_iso = None
        if last_hb is not None:
            last_iso = last_hb.isoformat() if hasattr(last_hb, "isoformat") else None
            hb = last_hb
            if hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            is_running = (now - hb).total_seconds() < 600

        cr = counts_map.get(sid)
        queued_new = int(cr["queued_new"] or 0) if cr else 0
        runnable = int(cr["runnable"] or 0) if cr else 0
        scheduled_future = int(cr["scheduled_future"] or 0) if cr else 0

        rr = running_map.get(sid)
        running_job = None
        if rr:
            running_job = {
                "job_queue_id": rr["job_queue_id"],
                "job_type": rr["job_type"] or "",
                "video_id": rr["video_id"],
                "status_percent_complete": rr["status_percent_complete"],
                "status_message": rr["status_message"] or "",
            }

        paused = await get_control_bool(instance_queue_paused_control_key(sid))

        out.append(
            {
                "server_instance_id": sid,
                "display_name": cfg["display_name"] or "",
                "is_enabled": bool(cfg["is_enabled"]),
                "assign_download_jobs": bool(cfg["assign_download_jobs"]),
                "is_running": is_running,
                "last_heartbeat_utc": last_iso,
                "duplicate_id_conflict": sid in duplicate_ids,
                "instance_queue_paused": paused,
                "queued_new": queued_new,
                "runnable": runnable,
                "scheduled_future": scheduled_future,
                "running_job": running_job,
            }
        )
    return out
