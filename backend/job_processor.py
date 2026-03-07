"""Background job queue processor: dispatches to real job handlers."""
import asyncio
from datetime import datetime

from database import db
from websocket_manager import ws_manager
from parse_video_id import parse_youtube_video_id
import db_helpers
from services.download_service import download_video_sync
from services.ytdlp_service import get_video_info, get_channel_videos
from services.channel_info_service import get_channel_info_by_yt_channel_id, get_channel_info_by_name
from services.channel_art_service import download_channel_artwork
from services.llm_service import generate_llm_video_description
from services.tools import get_media_root, sanitize_string_for_disk_path
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR


async def _check_chargeable_and_lockout(error_code: str, message: str) -> None:
    await db_helpers.add_charged_error(error_code, message)
    count = await db_helpers.get_charged_error_count_last_hour()
    max_err = await db_helpers.get_control_int("max_chargeable_errors_hour", 10)
    if count >= max_err:
        await db_helpers.set_control_value("chargeable_errors_lockout", "true")


async def run_job_loop() -> None:
    job_id = None
    while True:
        try:
            await asyncio.sleep(10)
            job_id = None
            if await db_helpers.get_control_bool("queue_paused"):
                continue
            if await db_helpers.get_control_bool("chargeable_errors_lockout"):
                continue
            heartbeat_value = datetime.now().isoformat()
            await db.execute(
                "UPDATE control SET value = $1, last_update = NOW() WHERE key = 'server_heartbeat'",
                heartbeat_value,
            )
            await ws_manager.broadcast({"type": "heartbeat", "value": heartbeat_value})
            row = await db.fetchrow(
                """SELECT job_queue_id, job_type, video_id, channel_id, parameter
                   FROM job_queue
                   WHERE status = 'new' AND (run_after IS NULL OR run_after <= NOW())
                   ORDER BY priority DESC NULLS LAST, job_queue_id ASC
                   LIMIT 1"""
            )
            if not row:
                continue
            job_id = row["job_queue_id"]
            job_type = row["job_type"]
            vid, cid, param = row.get("video_id"), row.get("channel_id"), row.get("parameter")
            print(f"[Job {job_id}] Started: {job_type} (video_id={vid}, channel_id={cid}, parameter={param!r})")
            await log_event(f"Job {job_id} started: {job_type} (video_id={vid}, channel_id={cid})", SEVERITY_INFO, job_id=job_id, video_id=vid, channel_id=cid)
            await db_helpers.update_job_status(row["job_queue_id"], "running")
            await broadcast_queue_update()

            success = True
            message = None
            is_warning = False
            is_error = False

            try:
                if job_type == "download_video":
                    if not row["video_id"]:
                        success, message, is_error = False, "video_id not provided", True
                    else:
                        v = await db_helpers.get_video_by_id(row["video_id"])
                        if not v:
                            success, message, is_error = False, "Video not found", True
                        else:
                            if v.get("channel_id") is None:
                                await log_event(f"Job {job_id} video {row['video_id']}: resolving channel for video", SEVERITY_DEBUG, job_id=job_id, video_id=row["video_id"])
                                ch_id, err = await db_helpers.resolve_channel_for_video(v["provider_key"])
                                if ch_id:
                                    await db_helpers.update_video_channel_id(row["video_id"], ch_id)
                                else:
                                    success, message, is_error = False, err or "Could not determine channel", True
                            if success is not False:
                                await log_event(f"Job {job_id} video {row['video_id']}: starting download", SEVERITY_DEBUG, job_id=job_id, video_id=row["video_id"], channel_id=v.get("channel_id"))
                                ok, msg = await asyncio.to_thread(
                                    download_video_sync,
                                    row["video_id"],
                                    v["provider_key"],
                                    True,
                                    job_id,
                                    v.get("channel_id"),
                                )
                                if not ok:
                                    success, message = False, msg
                                    await _check_chargeable_and_lockout("download_error", msg)
                                    is_warning = True

                elif job_type == "get_metadata":
                    if not row["video_id"]:
                        success, message, is_warning = False, "No video_id provided", True
                    else:
                        err = await _run_get_metadata(row["video_id"], job_id=job_id, channel_id=cid)
                        if err:
                            success, message, is_warning = False, err, True

                elif job_type == "fill_missing_metadata":
                    max_v = int(row["parameter"] or 1) if row.get("parameter") else 1
                    await log_event(f"Job {job_id}: starting fill_missing_metadata (max={max_v})", SEVERITY_DEBUG, job_id=job_id)
                    await _run_fill_missing_metadata(max_v, job_id=job_id)

                elif job_type == "download_channel_artwork":
                    if not row["channel_id"]:
                        success, message, is_error = False, "channel_id not provided", True
                    else:
                        ch = await db_helpers.get_channel_by_id(row["channel_id"])
                        if not ch:
                            success, message, is_error = False, "Channel not found", True
                        else:
                            await log_event(f"Job {job_id} channel {row['channel_id']}: starting channel artwork download", SEVERITY_DEBUG, job_id=job_id, channel_id=row["channel_id"])
                            ok = await asyncio.to_thread(
                                download_channel_artwork,
                                ch["provider_key"] or "",
                                ch.get("folder_on_disk") or "",
                                ch.get("title") or "channel",
                                True,
                            )
                            if not ok:
                                success, message, is_warning = False, "Artwork download failed", True
                            else:
                                await log_event(f"Job {job_id} channel {row['channel_id']}: channel artwork download finished", SEVERITY_DEBUG, job_id=job_id, channel_id=row["channel_id"])

                elif job_type == "download_one_channel":
                    if not row["channel_id"]:
                        success, message, is_error = False, "channel_id not provided", True
                    else:
                        max_v = int(row["parameter"] or 10) if row.get("parameter") else await db_helpers.get_control_int("max_new_videos_get_dflt", 10)
                        await log_event(f"Job {job_id} channel {row['channel_id']}: fetching channel videos (max={max_v})", SEVERITY_DEBUG, job_id=job_id, channel_id=row["channel_id"])
                        err = await _run_download_one_channel(row["channel_id"], max_v, job_id=job_id)
                        if err:
                            success, message, is_error = False, err, True

                elif job_type == "download_auto_enabled_channels":
                    await log_event(f"Job {job_id}: starting download_auto_enabled_channels", SEVERITY_DEBUG, job_id=job_id)
                    await _run_download_auto_enabled_channels(job_id=job_id)

                elif job_type == "update_channel_info":
                    if not row["channel_id"]:
                        success, message, is_error = False, "channel_id not provided", True
                    else:
                        await log_event(f"Job {job_id} channel {row['channel_id']}: fetching channel info", SEVERITY_DEBUG, job_id=job_id, channel_id=row["channel_id"])
                        ok = await _run_update_channel_info(row["channel_id"])
                        if not ok:
                            success, message, is_warning = False, "update_channel_info returned False", True
                        else:
                            await log_event(f"Job {job_id} channel {row['channel_id']}: channel info updated", SEVERITY_DEBUG, job_id=job_id, channel_id=row["channel_id"])

                elif job_type == "add_video_from_frontend":
                    if not row.get("parameter"):
                        success, message, is_error = False, "parameter (YouTube URL or ID) not provided", True
                    else:
                        vid = parse_youtube_video_id(row["parameter"])
                        if not vid:
                            success, message, is_error = False, "Could not parse YouTube video ID from parameter", True
                        else:
                            err = await _run_add_video_by_provider_key(vid, download_video=True)
                            if err:
                                success, message, is_warning = False, err, True

                elif job_type == "add_video_from_playlist":
                    if not row.get("parameter"):
                        success, message, is_error = False, "parameter (YouTube URL or ID) not provided", True
                    else:
                        vid = parse_youtube_video_id(row["parameter"])
                        if not vid:
                            success, message, is_error = False, "Could not parse YouTube video ID from parameter", True
                        else:
                            err = await _run_add_video_by_provider_key(vid, download_video=False)
                        if err:
                            success, message, is_warning = False, err, True

                elif job_type == "transcode_video_for_ipad":
                    if not row["video_id"]:
                        success, message, is_error = False, "video_id not provided", True
                    else:
                        success, message, is_warning = False, "transcode_video_for_ipad not implemented (Phase 3)", True

                else:
                    success, message, is_error = False, f"Unknown job type: {job_type}", True
            except Exception as e:
                success, message, is_error = False, str(e)[:500], True

            if success:
                await db_helpers.mark_job_done_success(job_id, message)
                status_label = "success" + (f" — {message}" if message else "")
                print(f"[Job {job_id}] Finished: {status_label}")
                await log_event(f"Job {job_id} completed: {job_type}", SEVERITY_INFO, job_id=job_id, video_id=row.get("video_id"), channel_id=cid)
            else:
                await db_helpers.mark_job_done_exception(job_id, message or "Error", is_warning=is_warning, is_error=is_error)
                kind = "warning" if is_warning else "error"
                print(f"[Job {job_id}] Finished: {kind} — {message or 'Error'}")
                sev = SEVERITY_WARNING if is_warning else SEVERITY_ERROR
                await log_event(f"Job {job_id} failed: {job_type} — {message or 'Error'}", sev, job_id=job_id, video_id=row.get("video_id"), channel_id=cid)
            await broadcast_queue_update()
            # Notify UI to refresh video list when a video-affecting job finished
            if row.get("video_id") and job_type in ("download_video", "get_metadata"):
                await broadcast_video_updated(row["video_id"])

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Job loop error: {e}")
            if job_id is not None:
                await db_helpers.mark_job_done_exception(job_id, str(e)[:500], is_error=True)
                await broadcast_queue_update()


async def _run_get_metadata(video_id: int, job_id: int | None = None, channel_id: int | None = None) -> str | None:
    v = await db_helpers.get_video_by_id(video_id)
    if not v:
        return "Video not found"
    await log_event(f"Job {job_id or '?'} video {video_id}: getting video info", SEVERITY_DEBUG, job_id=job_id, video_id=video_id, channel_id=channel_id)
    await db_helpers.update_video_download_progress(video_id, "getting_metadata", 0)
    if job_id is not None:
        await db_helpers.update_job_status(job_id, "getting_metadata", None, 0)
    info, err = await asyncio.to_thread(get_video_info, v["provider_key"])
    if not info:
        await db_helpers.update_video_download_progress(video_id, "error_getting_metadata", 0, err)
        if job_id is not None:
            await db_helpers.update_job_status(job_id, "error_getting_metadata", err, 0)
        return err or "Failed to get metadata"
    await log_event(f"Job {job_id or '?'} video {video_id}: got video info", SEVERITY_DEBUG, job_id=job_id, video_id=video_id, channel_id=channel_id)
    upload_date = info.get("fsyt_upload_date") or info.get("upload_date")
    await db_helpers.update_video_metadata(
        video_id,
        upload_date,
        info.get("title") or "Unknown",
        info.get("description") or "",
        info.get("thumbnail") or "",
    )
    await log_event(f"Job {job_id or '?'} video {video_id}: LLM processing", SEVERITY_DEBUG, job_id=job_id, video_id=video_id, channel_id=channel_id)
    await db_helpers.update_video_download_progress(video_id, "llm_processing", 0)
    if job_id is not None:
        await db_helpers.update_job_status(job_id, "llm_processing", None, 0)
    target_llm = (await db_helpers.get_control_value("server_target_llm")) or "ollama"
    llm_desc = await asyncio.to_thread(
        generate_llm_video_description,
        info.get("description") or "",
        target_llm,
    )
    await db_helpers.update_video_llm_description(video_id, llm_desc)
    await log_event(f"Job {job_id or '?'} video {video_id}: metadata available", SEVERITY_DEBUG, job_id=job_id, video_id=video_id, channel_id=channel_id)
    await db_helpers.update_video_download_progress(video_id, "metadata_available", 0)
    if job_id is not None:
        await db_helpers.update_job_status(job_id, "metadata_available", None, 0)
    return None


async def _run_fill_missing_metadata(max_videos: int, job_id: int | None = None) -> None:
    videos = await db_helpers.get_videos_missing_metadata(max_videos)
    for i, v in enumerate(videos):
        await log_event(f"Job {job_id or '?'}: processing video {i+1}/{len(videos)} (video_id={v['video_id']})", SEVERITY_DEBUG, job_id=job_id, video_id=v["video_id"], channel_id=v.get("channel_id"))
        await _run_get_metadata(v["video_id"], job_id=job_id, channel_id=v.get("channel_id"))
        await broadcast_video_updated(v["video_id"])
        sleep_s = await db_helpers.get_control_int("sleep_fill_missing_meta", 5)
        if sleep_s > 0:
            await asyncio.sleep(sleep_s)


async def _run_download_one_channel(channel_id: int, max_videos: int, job_id: int | None = None) -> str | None:
    ch = await db_helpers.get_channel_by_id(channel_id)
    if not ch:
        return f"Channel {channel_id} not found"
    handle = ch.get("handle") or ch.get("provider_key") or ""
    if not handle:
        return "Channel has no handle or provider_key"
    entries, err = await asyncio.to_thread(get_channel_videos, handle, 1, max_videos)
    if err:
        return err
    if not entries:
        await log_event(f"Job {job_id or '?'} channel {channel_id}: no new videos", SEVERITY_DEBUG, job_id=job_id, channel_id=channel_id)
        return None
    added = 0
    for e in entries:
        if not e or not e.get("id"):
            continue
        added_now, _ = await db_helpers.add_video_if_not_exist(
            channel_id,
            e.get("id"),
            e.get("title"),
            None,
            e.get("duration") or 0,
        )
        if added_now:
            added += 1
    await log_event(f"Job {job_id or '?'} channel {channel_id}: added {added} new videos", SEVERITY_DEBUG, job_id=job_id, channel_id=channel_id)
    return None


async def _run_download_auto_enabled_channels(job_id: int | None = None) -> None:
    channels = await db_helpers.get_auto_downloadenabled_channels()
    max_v = await db_helpers.get_control_int("max_new_videos_get_dflt", 10)
    for ch in channels:
        await log_event(f"Job {job_id or '?'}: processing channel {ch['channel_id']} ({ch.get('title', ch.get('handle', ''))})", SEVERITY_DEBUG, job_id=job_id, channel_id=ch["channel_id"])
        await _run_download_one_channel(ch["channel_id"], max_v, job_id=job_id)


async def _run_update_channel_info(channel_id: int) -> bool:
    ch = await db_helpers.get_channel_by_id(channel_id)
    if not ch:
        return False
    if ch.get("provider_key"):
        info = await asyncio.to_thread(get_channel_info_by_yt_channel_id, ch["provider_key"])
    elif ch.get("handle"):
        info = await asyncio.to_thread(get_channel_info_by_name, ch["handle"])
    else:
        return False
    if not info:
        return False
    title = (info.get("channel") or "").strip()
    folder = sanitize_string_for_disk_path(title) if title else (ch.get("folder_on_disk") or "channel")
    await db_helpers.update_channel_info(
        channel_id,
        info.get("channel_id") or ch.get("provider_key") or "",
        info.get("uploader_id") or ch.get("handle") or "",
        title,
        info.get("channel_url") or "",
        info.get("avatar_uncropped_url") or "",
        info.get("banner_uncropped_url") or "",
        info.get("uploader_id") or "",
        info.get("description") or "",
        folder,
    )
    return True


async def _run_add_video_by_provider_key(provider_key: str, download_video: bool) -> str | None:
    existing = await db.fetchrow("SELECT video_id FROM video WHERE provider_key = $1", provider_key)
    if existing:
        return f"Video {provider_key} already exists"
    info, err = await asyncio.to_thread(get_video_info, provider_key)
    if not info:
        return f"Failed to get video info: {err}"
    chan_yt_id = info.get("channel_id")
    if not chan_yt_id:
        return "No channel_id in video info"
    ch = await db_helpers.get_channel_by_provider_key(chan_yt_id)
    if ch:
        channel_id = ch["channel_id"]
    else:
        try:
            channel_id = await db_helpers.add_channel_by_handle_or_key(provider_key=chan_yt_id)
            await db_helpers.add_job("update_channel_info", channel_id=channel_id, priority=50)
            await db_helpers.add_job("download_channel_artwork", channel_id=channel_id, priority=50)
        except Exception as e:
            return str(e)
    added, new_id = await db_helpers.add_video_if_not_exist(channel_id, provider_key, None, None, None)
    if not added:
        return "add_video_if_not_exist failed"
    if download_video:
        await db_helpers.add_job("download_video", video_id=new_id, priority=40)
    return None


async def broadcast_video_updated(video_id: int) -> None:
    """Notify connected clients that a video's status changed so they can refetch."""
    await ws_manager.broadcast({"type": "video_updated", "video_id": video_id})


async def broadcast_transcode_status_changed() -> None:
    """Notify connected clients that active transcodes changed so dashboard can refetch."""
    await ws_manager.broadcast({"type": "transcode_status_changed"})


async def broadcast_queue_update() -> None:
    rows = await db.fetch(
        """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority
           FROM job_queue ORDER BY priority DESC NULLS LAST, job_queue_id ASC LIMIT 100"""
    )
    jobs = [
        {
            "job_queue_id": r["job_queue_id"],
            "record_created": r["record_created"].isoformat() if r["record_created"] else None,
            "job_type": r["job_type"],
            "video_id": r["video_id"],
            "channel_id": r["channel_id"],
            "status": r["status"],
            "status_percent_complete": r["status_percent_complete"],
            "status_message": r["status_message"],
            "last_update": r["last_update"].isoformat() if r["last_update"] else None,
            "completed_flag": r["completed_flag"],
            "warning_flag": r["warning_flag"],
            "error_flag": r["error_flag"],
            "acknowledge_flag": r["acknowledge_flag"],
            "priority": r["priority"],
        }
        for r in rows
    ]
    heartbeat = await db_helpers.get_control_value("server_heartbeat")
    await ws_manager.broadcast({"type": "queue_update", "jobs": jobs, "heartbeat": heartbeat})
