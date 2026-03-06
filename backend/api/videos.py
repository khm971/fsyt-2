"""Video REST API."""
import asyncio
import os
import shlex
import tempfile

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from database import db
from services.tools import get_media_root
from pydantic import BaseModel
from api.schemas import VideoCreate, VideoUpdate, VideoResponse
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR

USER_ID = 1  # No login; assume single user

# HLS transcode cache: video_id -> { dir, proc, ready }
_hls_cache: dict[int, dict] = {}
_hls_lock = asyncio.Lock()


class WatchProgressUpdate(BaseModel):
    progress_seconds: int
    progress_percent: float
from parse_video_id import parse_youtube_video_id
import db_helpers
from job_processor import broadcast_queue_update

router = APIRouter(prefix="/videos", tags=["videos"])


def row_to_video(r) -> VideoResponse:
    return VideoResponse(
        video_id=r["video_id"],
        provider_key=r["provider_key"],
        channel_id=r["channel_id"],
        title=r["title"],
        upload_date=r["upload_date"],
        description=r["description"],
        llm_description_1=r["llm_description_1"],
        thumbnail=r["thumbnail"],
        file_path=r["file_path"],
        download_date=r["download_date"],
        duration=r["duration"],
        record_created=r["record_created"],
        status=r["status"],
        status_percent_complete=r["status_percent_complete"],
        priority=r["priority"] or 50,
        status_message=r["status_message"],
        is_ignore=r["is_ignore"] or False,
        metadata_last_updated=r["metadata_last_updated"],
        nfo_last_written=r["nfo_last_written"],
        watch_progress_percent=r.get("watch_progress_percent"),
        watch_is_finished=r.get("watch_is_finished"),
    )


@router.get("", response_model=list[VideoResponse])
async def list_videos(
    channel_id: int | None = Query(None),
    include_ignored: bool = Query(False),
    limit: int = Query(250, le=500),
    sort_by: str = Query("id", pattern="^(id|title|status)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    q = """SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.download_date, v.duration,
                  v.record_created, v.status, v.status_percent_complete, v.priority,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished
           FROM video v
           LEFT JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $1
           WHERE 1=1"""
    params = [USER_ID]
    i = 2
    if channel_id is not None:
        q += f" AND v.channel_id = ${i}"
        params.append(channel_id)
        i += 1
    if not include_ignored:
        q += " AND (v.is_ignore IS NOT TRUE)"
    col = {"id": "v.video_id", "title": "v.title", "status": "v.status"}[sort_by]
    dirn = "ASC" if sort_order == "asc" else "DESC"
    q += f" ORDER BY {col} {dirn} LIMIT ${i}"
    params.append(limit)
    rows = await db.fetch(q, *params)
    return [row_to_video(r) for r in rows]


def _build_ffmpeg_args(full_path: str) -> list[str]:
    """Build ffmpeg command args for H.264/AAC transcoding (iPad compatibility).
    Scale to 720p for faster first-frame delivery; baseline profile per Apple docs."""
    return [
        "ffmpeg",
        "-i", full_path,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-profile:v", "baseline",
        "-level", "3.0",
        "-vf", "scale=-2:720",
        "-c:a", "aac",
        "-movflags", "frag_keyframe+empty_moov+faststart",
        "-f", "mp4",
        "-",
    ]


def _build_ffmpeg_hls_args(full_path: str, out_dir: str) -> list[str]:
    """Build ffmpeg args for HLS output (segment-based streaming for Safari)."""
    playlist = os.path.join(out_dir, "playlist.m3u8")
    segment_pattern = os.path.join(out_dir, "seg_%03d.ts")
    return [
        "ffmpeg",
        "-i", full_path,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-profile:v", "baseline",
        "-level", "3.0",
        "-vf", "scale=-2:720",
        "-c:a", "aac",
        "-hls_time", "2",
        "-hls_list_size", "0",
        "-hls_segment_filename", segment_pattern,
        "-f", "hls",
        playlist,
    ]


async def _read_and_log_stderr(proc: asyncio.subprocess.Process, video_id: int) -> None:
    """Read ffmpeg stderr line by line and log to event_log and console."""
    if not proc.stderr:
        return
    try:
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip()
            if not text:
                continue
            severity = SEVERITY_ERROR if "error" in text.lower() else SEVERITY_DEBUG
            await log_event(f"[ffmpeg] {text}", severity, video_id=video_id)
            print(f"[ffmpeg video_id={video_id}] {text}", flush=True)
    except Exception as e:
        await log_event(f"[ffmpeg stderr read error] {e}", SEVERITY_WARNING, video_id=video_id)
        print(f"[ffmpeg video_id={video_id}] stderr read error: {e}", flush=True)


async def _transcode_stream(full_path: str, video_id: int):
    """Yield chunks from ffmpeg transcoding input to H.264/AAC for iPad compatibility."""
    args = _build_ffmpeg_args(full_path)
    cmd_str = shlex.join(args)
    await log_event(f"[ffmpeg command] {cmd_str}", SEVERITY_INFO, video_id=video_id)
    print(f"[ffmpeg video_id={video_id}] command: {cmd_str}", flush=True)

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stderr_task = asyncio.create_task(_read_and_log_stderr(proc, video_id))
    try:
        while True:
            chunk = await proc.stdout.read(64 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await stderr_task


async def _ensure_hls_transcode(video_id: int, full_path: str) -> str:
    """Start or reuse HLS transcode for video_id. Returns path to output directory.
    Waits for first segment to be ready before returning."""
    async with _hls_lock:
        if video_id in _hls_cache:
            entry = _hls_cache[video_id]
            await entry["ready"].wait()
            return entry["dir"]

        out_dir = tempfile.mkdtemp(prefix="fsyt-hls-")
        entry = {"dir": out_dir, "proc": None, "ready": asyncio.Event()}
        _hls_cache[video_id] = entry

    args = _build_ffmpeg_hls_args(full_path, out_dir)
    cmd_str = shlex.join(args)
    await log_event(f"[ffmpeg HLS] {cmd_str}", SEVERITY_INFO, video_id=video_id)
    print(f"[ffmpeg HLS video_id={video_id}] command: {cmd_str}", flush=True)

    proc = await asyncio.create_subprocess_exec(
        *args,
        stderr=asyncio.subprocess.PIPE,
    )
    entry["proc"] = proc
    stderr_task = asyncio.create_task(_read_and_log_stderr(proc, video_id))

    async def _wait_first_segment():
        first_seg = os.path.join(out_dir, "seg_000.ts")
        for _ in range(60):
            if os.path.isfile(first_seg):
                entry["ready"].set()
                return
            await asyncio.sleep(0.5)
        entry["ready"].set()

    async def _wait_proc():
        await proc.wait()
        entry["ready"].set()
        await stderr_task

    asyncio.create_task(_wait_first_segment())
    asyncio.create_task(_wait_proc())
    await entry["ready"].wait()
    return out_dir


@router.get("/{video_id}/hls/{path:path}")
async def serve_hls(video_id: int, path: str):
    """Serve HLS playlist and segments. Starts transcode on first request.
    Use playlist.m3u8 as the video src for Safari (native HLS support)."""
    r = await db.fetchrow(
        "SELECT file_path, status FROM video WHERE video_id = $1",
        video_id,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    if r["status"] != "available":
        raise HTTPException(400, "Video is not ready to play")
    file_path = r.get("file_path")
    if not file_path:
        raise HTTPException(404, "Video file not found")
    root = get_media_root()
    full_path = os.path.join(root, file_path.replace("\\", "/"))
    if not os.path.isfile(full_path):
        raise HTTPException(404, "Video file not found on disk")

    out_dir = await _ensure_hls_transcode(video_id, full_path)
    file_path_resolved = os.path.normpath(os.path.join(out_dir, path))
    if not file_path_resolved.startswith(out_dir):
        raise HTTPException(400, "Invalid path")
    if not os.path.isfile(file_path_resolved):
        raise HTTPException(404, "Segment not ready")
    media_type = "application/vnd.apple.mpegurl" if path.endswith(".m3u8") else "video/MP2T"
    return FileResponse(file_path_resolved, media_type=media_type)


@router.get("/{video_id}/stream")
async def stream_video(video_id: int, transcode: bool = Query(False)):
    """Stream the video file. Only available when status is 'available'.
    When transcode=1, transcodes on-the-fly to H.264/AAC for iPad compatibility."""
    r = await db.fetchrow(
        "SELECT file_path, status FROM video WHERE video_id = $1",
        video_id,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    if r["status"] != "available":
        raise HTTPException(400, "Video is not ready to play (status must be 'available')")
    file_path = r.get("file_path")
    if not file_path:
        raise HTTPException(404, "Video file not found")
    root = get_media_root()
    full_path = os.path.join(root, file_path.replace("\\", "/"))
    if not os.path.isfile(full_path):
        raise HTTPException(404, "Video file not found on disk")

    if transcode:
        return StreamingResponse(
            _transcode_stream(full_path, video_id),
            media_type="video/mp4",
        )

    return FileResponse(
        full_path,
        media_type="video/mp4",
        filename=os.path.basename(full_path),
        content_disposition_type="inline",
    )


@router.get("/{video_id}/watch-progress")
async def get_watch_progress(video_id: int):
    """Get user's watch progress for a video. User ID is always 1."""
    r = await db.fetchrow(
        """SELECT progress_seconds, progress_percent, is_watched, is_finished
           FROM user_video WHERE user_id = $1 AND video_id = $2""",
        USER_ID,
        video_id,
    )
    if not r:
        return {"progress_seconds": 0, "progress_percent": 0, "is_watched": False, "is_finished": False}
    return {
        "progress_seconds": r["progress_seconds"] or 0,
        "progress_percent": float(r["progress_percent"] or 0),
        "is_watched": r["is_watched"] or False,
        "is_finished": r.get("is_finished") or False,
    }


async def _save_watch_progress(video_id: int, progress_seconds: int, progress_percent: float) -> None:
    """Persist watch progress to DB. User ID is always 1."""
    pct = min(100, max(0, round(progress_percent, 2)))
    is_finished = pct > 95
    await db.execute(
        """INSERT INTO user_video (user_id, video_id, is_watched, progress_seconds, progress_percent, is_finished)
           VALUES ($1, $2, TRUE, $3, $4, $5)
           ON CONFLICT (user_id, video_id) DO UPDATE SET
             is_watched = TRUE,
             progress_seconds = EXCLUDED.progress_seconds,
             progress_percent = EXCLUDED.progress_percent,
             is_finished = EXCLUDED.is_finished""",
        USER_ID,
        video_id,
        progress_seconds,
        pct,
        is_finished,
    )


@router.put("/{video_id}/watch-progress")
async def update_watch_progress(video_id: int, body: WatchProgressUpdate):
    """Create or update user's watch progress. User ID is always 1."""
    await _save_watch_progress(video_id, body.progress_seconds, body.progress_percent)
    return {"ok": True}


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(video_id: int):
    r = await db.fetchrow(
        """SELECT video_id, provider_key, channel_id, title, upload_date, description,
                  llm_description_1, thumbnail, file_path, download_date, duration,
                  record_created, status, status_percent_complete, priority,
                  status_message, is_ignore, metadata_last_updated, nfo_last_written
           FROM video WHERE video_id = $1""",
        video_id,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    return row_to_video(r)


@router.post("", response_model=VideoResponse, status_code=201)
async def create_video(body: VideoCreate):
    provider_key = parse_youtube_video_id(body.provider_key)
    if not provider_key:
        raise HTTPException(
            400,
            "Could not parse YouTube video ID. Provide a video ID or URL (e.g. https://www.youtube.com/watch?v=..., https://youtu.be/..., or the 11-character ID).",
        )
    existing = await db.fetchrow(
        "SELECT video_id FROM video WHERE provider_key = $1", provider_key
    )
    if existing:
        return await get_video(existing["video_id"])
    channel_id, err = await db_helpers.resolve_channel_for_video(provider_key)
    if not channel_id:
        raise HTTPException(400, err or "Could not determine channel from video")
    row = await db.fetchrow(
        """INSERT INTO video (provider_key, channel_id, status)
           VALUES ($1, $2, 'no_metadata')
           RETURNING video_id, provider_key, channel_id, title, upload_date, description,
                     llm_description_1, thumbnail, file_path, download_date, duration,
                     record_created, status, status_percent_complete, priority,
                     status_message, is_ignore, metadata_last_updated, nfo_last_written""",
        provider_key,
        channel_id,
    )
    if body.queue_download:
        await db.execute(
            """INSERT INTO job_queue (job_type, video_id, status, priority)
               VALUES ('download_video', $1, 'new', 40)""",
            row["video_id"],
        )
    await broadcast_queue_update()
    await log_event(f"Video created: {provider_key} (video_id={row['video_id']}, channel_id={channel_id})", SEVERITY_INFO, video_id=row["video_id"], channel_id=channel_id)
    return row_to_video(row)


@router.patch("/{video_id}", response_model=VideoResponse)
async def update_video(video_id: int, body: VideoUpdate):
    updates = []
    values = []
    i = 1
    if body.title is not None:
        updates.append(f"title = ${i}")
        values.append(body.title)
        i += 1
    if body.is_ignore is not None:
        updates.append(f"is_ignore = ${i}")
        values.append(body.is_ignore)
        i += 1
    if body.status is not None:
        updates.append(f"status = ${i}")
        values.append(body.status)
        i += 1
    if not updates:
        return await get_video(video_id)
    values.append(video_id)
    r = await db.fetchrow(
        f"""UPDATE video SET {", ".join(updates)} WHERE video_id = ${i}
            RETURNING video_id, provider_key, channel_id, title, upload_date, description,
                      llm_description_1, thumbnail, file_path, download_date, duration,
                      record_created, status, status_percent_complete, priority,
                      status_message, is_ignore, metadata_last_updated, nfo_last_written""",
        *values,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    return row_to_video(r)


@router.delete("/{video_id}", status_code=204)
async def delete_video(video_id: int):
    r = await db.fetchrow("SELECT provider_key FROM video WHERE video_id = $1", video_id)
    await db.execute("DELETE FROM video WHERE video_id = $1", video_id)
    if r:
        await log_event(f"Video deleted: {r['provider_key']} (video_id={video_id})", SEVERITY_INFO, video_id=video_id)
