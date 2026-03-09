"""Sync video download (run in thread). Uses sync_db for progress/final updates."""
import os
import shutil
import requests
from services.ytdlp_service import get_video_info
import video_progress_bridge
from services.llm_service import generate_llm_video_description
from services.nfo_service import create_video_nfo_2
from services.tools import get_media_root
import sync_db

# Throttle progress prints (print every N% change)
_PROGRESS_PRINT_THRESH = 5
_last_progress_pct = [0]  # use list so closure can mutate


def _log(job_id, video_id, channel_id, msg, severity=sync_db.SEVERITY_DEBUG):
    sync_db.log_event_sync(msg, severity, job_id, video_id, channel_id)


def download_video_sync(
    video_id: int,
    provider_key: str,
    is_update_metadata: bool = True,
    job_id: int | None = None,
    channel_id: int | None = None,
) -> tuple[bool, str]:
    """
    Returns (success, message). On success message is empty; on failure it's the error string.
    """
    video_url = f"https://www.youtube.com/watch?v={provider_key}"
    temp_dir = os.path.join(os.getcwd(), "temp_downloads")
    os.makedirs(temp_dir, exist_ok=True)
    _last_progress_pct[0] = 0
    try:
        prefix = f"Job {job_id} " if job_id else ""
        msg = f"{prefix}video {video_id}: getting metadata"
        _log(job_id, video_id, channel_id, msg)
        print(f"[Download] video_id={video_id} provider_key={provider_key}: getting metadata ...", flush=True)
        sync_db.update_video_download_progress_sync(video_id, "get_metadata_for_download", 0, job_id=job_id)
        video_progress_bridge.put_progress(video_id, "get_metadata_for_download", 0)
        info, err = get_video_info(provider_key)
        if not info:
            sync_db.update_video_download_progress_sync(video_id, "error_getting_metadata", 0, err, job_id=job_id)
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: failed to get metadata — {err}", sync_db.SEVERITY_ERROR)
            print(f"[Download] video_id={video_id}: failed to get metadata — {err}", flush=True)
            return False, err or "Failed to get video info"
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: got metadata")
        title = info.get("title") or "Unknown"
        upload_date = info.get("fsyt_upload_date") or info.get("upload_date")
        if hasattr(upload_date, "isoformat"):
            upload_date = upload_date
        else:
            upload_date = None
        duration = None
        if info.get("duration") is not None:
            try:
                duration = int(info["duration"])
            except (TypeError, ValueError):
                pass
        if is_update_metadata:
            sync_db.update_video_metadata_sync(
                video_id,
                title,
                upload_date,
                info.get("description") or "",
                info.get("thumbnail") or "",
                duration,
            )
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: LLM processing")
            sync_db.update_video_download_progress_sync(video_id, "llm_processing", 0, job_id=job_id)
            video_progress_bridge.put_progress(video_id, "llm_processing", 0)
            llm_desc = generate_llm_video_description(info.get("description") or "")
            sync_db.update_video_llm_sync(video_id, llm_desc)
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: LLM done")
        else:
            llm_desc = ""

        def progress_hook(d):
            if d.get("status") != "downloading":
                return
            total = d.get("total_bytes")
            done = d.get("downloaded_bytes", 0)
            if total and done:
                pct = (done / total) * 100
                rounded = round(pct, 1)
                sync_db.update_video_download_progress_sync(video_id, "downloading", rounded, job_id=job_id)
                if pct >= _last_progress_pct[0] + _PROGRESS_PRINT_THRESH or pct >= 99:
                    _last_progress_pct[0] = int(pct)
                    video_progress_bridge.put_progress(video_id, "downloading", rounded)
                    print(f"[Download] video_id={video_id}: downloading — {pct:.1f}%", flush=True)

        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": os.path.join(temp_dir, info["fsyt_video_title_safe"] + ".%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
        }
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: downloading started")
        print(f"[Download] video_id={video_id}: downloading — 0%", flush=True)
        sync_db.update_video_download_progress_sync(video_id, "downloading", 0, job_id=job_id)
        video_progress_bridge.put_progress(video_id, "downloading", 0)
        with __import__("yt_dlp").YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(video_url)
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: post-download started")
        print(f"[Download] video_id={video_id}: post-download (move, thumbnail, NFO) ...", flush=True)
        sync_db.update_video_download_progress_sync(video_id, "post_download_processing", 0, job_id=job_id)
        video_progress_bridge.put_progress(video_id, "post_download_processing", 0)
        os.makedirs(info["fsyt_final_path"], exist_ok=True)
        temp_files = [f for f in os.listdir(temp_dir) if os.path.isfile(os.path.join(temp_dir, f))]
        if not temp_files:
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: no file after download", sync_db.SEVERITY_ERROR)
            sync_db.update_video_download_progress_sync(video_id, "download_error", 0, "No file after download", job_id=job_id)
            return False, "No file after download"
        temp_file_path = os.path.join(temp_dir, temp_files[0])
        final_file_path = os.path.join(info["fsyt_final_path"], temp_files[0])
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: moving file started (temp to final)", sync_db.SEVERITY_DEBUG)
        shutil.move(temp_file_path, final_file_path)
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: move finished", sync_db.SEVERITY_DEBUG)
        # Log path from container's perspective (absolute path)
        print(f"[Download] video_id={video_id}: saved to {os.path.abspath(final_file_path)}", flush=True)
        thumb_url = info.get("thumbnail")
        if thumb_url:
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: downloading thumbnail")
            try:
                r = requests.get(thumb_url, timeout=15)
                if r.status_code == 200:
                    thumb_path = os.path.join(info["fsyt_final_path"], info["fsyt_video_title_safe"] + "-thumb.jpg")
                    with open(thumb_path, "wb") as f:
                        f.write(r.content)
                    _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: thumbnail saved")
            except Exception as thumb_err:
                _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: thumbnail download failed — {type(thumb_err).__name__}: {thumb_err}", sync_db.SEVERITY_ERROR)
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: writing NFO")
        nfo_path = os.path.join(info["fsyt_final_path"], info["fsyt_video_title_safe"] + ".nfo")
        plot = llm_desc or info.get("description") or ""
        ud = info.get("upload_date") or "20000101"
        if not create_video_nfo_2(nfo_path, provider_key, info.get("title") or "Unknown", info.get("channel") or "Unknown", ud, plot, video_id=video_id, job_id=job_id, channel_id=channel_id):
            _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: NFO write failed (path={nfo_path})", sync_db.SEVERITY_ERROR)
        root = get_media_root()
        rel_path = final_file_path.replace(root, "").lstrip(os.sep).replace("\\", "/")
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: updating DB, download complete")
        sync_db.update_video_download_info_sync(video_id, rel_path, duration)
        print(f"[Download] video_id={video_id}: done.", flush=True)
        return True, ""
    except Exception as e:
        msg = f"{type(e).__name__}: {str(e)[:500]}"
        prefix = f"Job {job_id} " if job_id else ""
        _log(job_id, video_id, channel_id, f"{prefix}video {video_id}: failed — {msg}", sync_db.SEVERITY_ERROR)
        sync_db.update_video_download_progress_sync(video_id, "download_error", 0, msg, job_id=job_id)
        print(f"[Download] video_id={video_id}: failed — {msg}", flush=True)
        return False, msg
    finally:
        if os.path.isdir(temp_dir):
            for f in os.listdir(temp_dir):
                try:
                    os.remove(os.path.join(temp_dir, f))
                except Exception:
                    pass
            try:
                os.rmdir(temp_dir)
            except Exception:
                pass
