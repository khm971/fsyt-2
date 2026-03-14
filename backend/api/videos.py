"""Video REST API."""
import asyncio
import math
import os
import re
import shlex
import shutil

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from database import db
from services.tools import get_media_root
from pydantic import BaseModel
from api.schemas import VideoCreate, VideoUpdate, VideoResponse, VideoListResponse, TagResponse
from log_helper import log_event, SEVERITY_LOW_LEVEL, SEVERITY_DEBUG, SEVERITY_INFO, SEVERITY_NOTICE, SEVERITY_WARNING, SEVERITY_ERROR

# HLS transcode cache: video_id -> { dir, proc, ready }
_hls_cache: dict[int, dict] = {}
_hls_lock = asyncio.Lock()


class WatchProgressUpdate(BaseModel):
    progress_seconds: int
    progress_percent: float


class VideoTagAdd(BaseModel):
    """Either tag_id or title (create tag if missing)."""
    tag_id: int | None = None
    title: str | None = None


from parse_video_id import parse_youtube_video_id
import db_helpers
from job_processor import broadcast_queue_update, broadcast_transcode_status_changed

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
        transcode_path=r.get("transcode_path"),
        download_date=r["download_date"],
        duration=r["duration"],
        record_created=r["record_created"],
        status=r["status"],
        status_percent_complete=r["status_percent_complete"],
        status_message=r["status_message"],
        is_ignore=r["is_ignore"] or False,
        metadata_last_updated=r["metadata_last_updated"],
        nfo_last_written=r["nfo_last_written"],
        watch_progress_percent=r.get("watch_progress_percent"),
        watch_progress_seconds=r.get("watch_progress_seconds"),
        watch_is_finished=r.get("watch_is_finished"),
        pending_job_id=r.get("pending_job_id"),
        pending_job_type=r.get("pending_job_type"),
        created_by_user_id=r.get("created_by_user_id"),
        created_by_username=r.get("created_by_username"),
    )


@router.get("", response_model=VideoListResponse)
async def list_videos(
    request: Request,
    channel_id: int | None = Query(None),
    include_ignored: bool = Query(False),
    limit: int = Query(200, le=500),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("id", pattern="^(id|title|status)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    user_id = request.state.user_id
    count_where_parts = ["1=1"]
    count_params: list = []
    ci = 1
    if channel_id is not None:
        count_where_parts.append(f"v.channel_id = ${ci}")
        count_params.append(channel_id)
        ci += 1
    if not include_ignored:
        count_where_parts.append("(v.is_ignore IS NOT TRUE)")
    count_where_sql = " AND ".join(count_where_parts)

    count_q = f"SELECT COUNT(*) FROM video v WHERE {count_where_sql}"
    total = await db.fetchval(count_q, *count_params) or 0

    main_where_parts = ["1=1"]
    params: list = [user_id]
    i = 2
    if channel_id is not None:
        main_where_parts.append(f"v.channel_id = ${i}")
        params.append(channel_id)
        i += 1
    if not include_ignored:
        main_where_parts.append("(v.is_ignore IS NOT TRUE)")
    main_where_sql = " AND ".join(main_where_parts)

    q = f"""SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished,
                  v.created_by_user_id, u.username AS created_by_username
           FROM video v
           LEFT JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $1
           LEFT JOIN app_user u ON v.created_by_user_id = u.user_id
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE {main_where_sql}"""
    col = {"id": "v.video_id", "title": "v.title", "status": "v.status"}[sort_by]
    dirn = "ASC" if sort_order == "asc" else "DESC"
    q += f" ORDER BY {col} {dirn} LIMIT ${i} OFFSET ${i + 1}"
    params.append(limit)
    params.append(offset)
    rows = await db.fetch(q, *params)
    videos = [row_to_video(r) for r in rows]
    if videos:
        tags_by_vid = await _fetch_tags_for_videos([v.video_id for v in videos], user_id)
        videos = [v.model_copy(update={"tags": tags_by_vid.get(v.video_id, [])}) for v in videos]
    return VideoListResponse(videos=videos, total=int(total))


@router.get("/watch", response_model=list[VideoResponse])
async def list_watch_in_progress(request: Request, limit: int = Query(250, le=500)):
    """Videos current user has started but not finished, sorted by last_watched DESC."""
    user_id = request.state.user_id
    q = """SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished,
                  uv.progress_seconds AS watch_progress_seconds
           FROM video v
           INNER JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $1
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE uv.is_finished = FALSE
             AND (uv.progress_seconds > 0 OR uv.progress_percent > 0 OR uv.last_watched IS NOT NULL)
             AND v.status = 'available'
             AND (v.is_ignore IS NOT TRUE)
           ORDER BY uv.last_watched DESC NULLS LAST
           LIMIT $2"""
    rows = await db.fetch(q, user_id, limit)
    videos = [row_to_video(r) for r in rows]
    if videos:
        tags_by_vid = await _fetch_tags_for_videos([v.video_id for v in videos], user_id)
        videos = [v.model_copy(update={"tags": tags_by_vid.get(v.video_id, [])}) for v in videos]
    return videos


@router.get("/by-tags", response_model=list[VideoResponse])
async def list_videos_by_tags(
    request: Request,
    tag_ids: list[int] = Query(..., min_length=1),
    tag_match: str = Query("any", pattern="^(all|any)$"),
    include_unavailable: bool = Query(False),
    limit: int = Query(250, le=500),
):
    """Videos that have the given tags (all or any). Returns same shape as watch list with watch progress."""
    user_id = getattr(request.state, "user_id", None)
    await log_event(
        f"Videos by tags: tag_ids={tag_ids!r} tag_match={tag_match!r} include_unavailable={include_unavailable!r}",
        SEVERITY_LOW_LEVEL,
        user_id=user_id,
    )
    tag_ids = list(dict.fromkeys(tag_ids))  # dedupe preserving order
    n_tags = len(tag_ids)
    status_filter = "" if include_unavailable else " AND v.status = 'available'"

    if tag_match == "any":
        q = f"""SELECT DISTINCT ON (v.video_id) v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished,
                  uv.progress_seconds AS watch_progress_seconds
           FROM video v
           INNER JOIN video_tag vt ON vt.video_id = v.video_id AND vt.tag_id = ANY($1::int[])
           LEFT JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $2
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE (v.is_ignore IS NOT TRUE){status_filter}
           ORDER BY v.video_id DESC
           LIMIT $3"""
        rows = await db.fetch(q, tag_ids, request.state.user_id, limit)
    else:
        q = f"""SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished,
                  uv.progress_seconds AS watch_progress_seconds
           FROM video v
           INNER JOIN video_tag vt ON vt.video_id = v.video_id AND vt.tag_id = ANY($1::int[])
           LEFT JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $2
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE (v.is_ignore IS NOT TRUE){status_filter}
           GROUP BY v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete, jq.job_queue_id, jq.job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent, uv.is_finished, uv.progress_seconds
           HAVING COUNT(DISTINCT vt.tag_id) = $3
           ORDER BY v.video_id DESC
           LIMIT $4"""
        rows = await db.fetch(q, tag_ids, request.state.user_id, n_tags, limit)
    videos = [row_to_video(r) for r in rows]
    if videos:
        tags_by_vid = await _fetch_tags_for_videos([v.video_id for v in videos], request.state.user_id)
        videos = [v.model_copy(update={"tags": tags_by_vid.get(v.video_id, [])}) for v in videos]
    return videos


def _escape_ilike(term: str) -> str:
    """Escape % and _ for safe use in ILIKE pattern (use ESCAPE '\\' in SQL)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/search", response_model=list[VideoResponse])
async def search_videos(
    request: Request,
    q: str = Query(""),
    include_unavailable: bool = Query(False),
    limit: int = Query(250, le=500),
):
    """Videos where all search terms appear in title, description, or llm_description_1. Terms split on commas and spaces."""
    user_id = request.state.user_id
    terms = [s.strip() for s in re.split(r"[\s,]+", q) if s.strip()]
    if not terms:
        return []

    patterns = [f"%{_escape_ilike(t)}%" for t in terms]
    status_filter = "" if include_unavailable else " AND v.status = 'available'"
    base = """SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  uv.progress_percent AS watch_progress_percent, uv.is_finished AS watch_is_finished,
                  uv.progress_seconds AS watch_progress_seconds
           FROM video v
           LEFT JOIN user_video uv ON uv.video_id = v.video_id AND uv.user_id = $1
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE (v.is_ignore IS NOT TRUE)""" + status_filter
    # Each term must match in at least one of title, description, llm_description_1
    conds = []
    for i in range(len(patterns)):
        idx = i + 2  # $1 is user_id
        conds.append(
            f"(v.title ILIKE ${idx} ESCAPE E'\\\\' OR COALESCE(v.description,'') ILIKE ${idx} ESCAPE E'\\\\' OR COALESCE(v.llm_description_1,'') ILIKE ${idx} ESCAPE E'\\\\')"
        )
    limit_idx = len(patterns) + 2
    sql = f"{base} AND " + " AND ".join(conds) + f" ORDER BY v.video_id DESC LIMIT ${limit_idx}"
    params = [user_id, *patterns, limit]
    rows = await db.fetch(sql, *params)
    videos = [row_to_video(r) for r in rows]
    if videos:
        tags_by_vid = await _fetch_tags_for_videos([v.video_id for v in videos], user_id)
        videos = [v.model_copy(update={"tags": tags_by_vid.get(v.video_id, [])}) for v in videos]
    return videos


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


async def _read_and_log_stderr(proc: asyncio.subprocess.Process, video_id: int, channel_id: int | None = None) -> None:
    """Read ffmpeg stderr line by line and log to event_log and console."""
    if not proc.stderr:
        return
    if channel_id is None and video_id is not None:
        channel_id = await db.fetchval("SELECT channel_id FROM video WHERE video_id = $1", video_id)
    try:
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip()
            if not text:
                continue
            severity = SEVERITY_ERROR if "error" in text.lower() else SEVERITY_LOW_LEVEL
            await log_event(f"[ffmpeg] video_id={video_id}: {text}", severity, video_id=video_id, channel_id=channel_id)
            if severity != SEVERITY_LOW_LEVEL:
                print(f"[ffmpeg video_id={video_id}] {text}", flush=True)
    except Exception as e:
        await log_event(f"[ffmpeg] video_id={video_id}: stderr read error: {type(e).__name__}: {e}", SEVERITY_ERROR, video_id=video_id, channel_id=channel_id)
        print(f"[ffmpeg video_id={video_id}] stderr read error: {e}", flush=True)


async def _transcode_stream(full_path: str, video_id: int):
    """Yield chunks from ffmpeg transcoding input to H.264/AAC for iPad compatibility."""
    channel_id = await db.fetchval("SELECT channel_id FROM video WHERE video_id = $1", video_id)
    args = _build_ffmpeg_args(full_path)
    cmd_str = shlex.join(args)
    await log_event(f"[ffmpeg] video_id={video_id}: command {cmd_str}", SEVERITY_INFO, video_id=video_id, channel_id=channel_id)
    print(f"[ffmpeg video_id={video_id}] command: {cmd_str}", flush=True)

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stderr_task = asyncio.create_task(_read_and_log_stderr(proc, video_id, channel_id))
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


def _get_transcode_dir(video_id: int) -> tuple[str, str]:
    """Return (full_path, relative_path) for video transcode. Relative path is stored in DB."""
    root = get_media_root().rstrip("/")
    rel_path = f"_transcodes/{video_id}"
    full_path = os.path.join(root, rel_path.replace("/", os.sep))
    return full_path, rel_path


async def clear_all_hls_transcodes() -> dict[str, int]:
    """Delete persisted HLS transcodes and clear their DB references."""
    media_root = os.path.abspath(get_media_root())
    transcodes_dir = os.path.abspath(os.path.join(media_root, "_transcodes"))
    if os.path.commonpath([media_root, transcodes_dir]) != media_root:
        raise RuntimeError("Resolved transcode path is outside MEDIA_ROOT")

    await log_event(
        f"Maintenance: clearing all transcodes under {transcodes_dir}",
        SEVERITY_INFO,
    )

    async with _hls_lock:
        cache_entries = list(_hls_cache.values())
        _hls_cache.clear()

    stopped_processes = 0
    for entry in cache_entries:
        proc = entry.get("proc")
        if proc and proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except Exception as e:
                await log_event(
                    f"clear_all_hls_transcodes: failed to wait for transcode process: {type(e).__name__}: {e}",
                    SEVERITY_ERROR,
                )
            stopped_processes += 1

    deleted_entries = 0
    if os.path.isdir(transcodes_dir):
        with os.scandir(transcodes_dir) as entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    shutil.rmtree(entry.path)
                else:
                    os.unlink(entry.path)
                deleted_entries += 1
    os.makedirs(transcodes_dir, exist_ok=True)

    updated_videos = await db.fetchval(
        "SELECT COUNT(*) FROM video WHERE transcode_path IS NOT NULL"
    )
    await db.execute("UPDATE video SET transcode_path = NULL WHERE transcode_path IS NOT NULL")

    await log_event(
        f"Maintenance: cleared all transcodes (deleted {deleted_entries} entries, reset {updated_videos} videos, stopped {stopped_processes} active transcodes)",
        SEVERITY_INFO,
    )
    return {
        "deleted_entries": int(deleted_entries or 0),
        "updated_videos": int(updated_videos or 0),
        "stopped_processes": int(stopped_processes or 0),
    }


async def _ensure_hls_transcode(video_id: int, full_path: str) -> str:
    """Start or reuse HLS transcode for video_id. Returns full path to output directory.
    Persists transcode_path to DB. Uses /media/_transcodes/{video_id}."""
    channel_id = await db.fetchval("SELECT channel_id FROM video WHERE video_id = $1", video_id)
    out_dir, rel_path = _get_transcode_dir(video_id)

    async with _hls_lock:
        if video_id in _hls_cache:
            entry = _hls_cache[video_id]
            await entry["ready"].wait()
            return entry["dir"]

        # Check for existing persisted transcode
        r = await db.fetchrow(
            "SELECT transcode_path FROM video WHERE video_id = $1",
            video_id,
        )
        if r and r.get("transcode_path"):
            existing_dir = os.path.join(get_media_root().rstrip("/"), r["transcode_path"].replace("/", os.sep))
            playlist = os.path.join(existing_dir, "playlist.m3u8")
            if os.path.isfile(playlist):
                _hls_cache[video_id] = {"dir": existing_dir, "proc": None, "ready": asyncio.Event()}
                _hls_cache[video_id]["ready"].set()
                return existing_dir

        os.makedirs(out_dir, exist_ok=True)
        entry = {"dir": out_dir, "proc": None, "ready": asyncio.Event()}
        _hls_cache[video_id] = entry

    args = _build_ffmpeg_hls_args(full_path, out_dir)
    cmd_str = shlex.join(args)
    await log_event(f"[ffmpeg HLS] video_id={video_id}: {cmd_str}", SEVERITY_INFO, video_id=video_id, channel_id=channel_id)
    print(f"[ffmpeg HLS video_id={video_id}] command: {cmd_str}", flush=True)

    proc = await asyncio.create_subprocess_exec(
        *args,
        stderr=asyncio.subprocess.PIPE,
    )
    entry["proc"] = proc
    stderr_task = asyncio.create_task(_read_and_log_stderr(proc, video_id, channel_id))
    await broadcast_transcode_status_changed()

    async def _wait_first_segment():
        first_seg = os.path.join(out_dir, "seg_000.ts")
        for _ in range(60):
            if os.path.isfile(first_seg):
                entry["ready"].set()
                return
            await asyncio.sleep(0.5)
        entry["ready"].set()

    async def _wait_proc():
        exit_code = await proc.wait()
        entry["ready"].set()
        await stderr_task
        if exit_code == 0:
            await db.execute(
                "UPDATE video SET transcode_path = $1 WHERE video_id = $2",
                rel_path,
                video_id,
            )
            await log_event(f"[ffmpeg HLS] video_id={video_id}: transcode complete, persisted: {rel_path}", SEVERITY_INFO, video_id=video_id, channel_id=channel_id)
        else:
            msg = f"[ffmpeg HLS] video_id={video_id}: transcode failed (exit {exit_code}), not persisted"
            await log_event(msg, SEVERITY_ERROR, video_id=video_id, channel_id=channel_id)
            print(f"[ffmpeg HLS video_id={video_id}] {msg}", flush=True)
            async with _hls_lock:
                _hls_cache.pop(video_id, None)
        await broadcast_transcode_status_changed()

    asyncio.create_task(_wait_first_segment())
    asyncio.create_task(_wait_proc())
    await entry["ready"].wait()

    playlist_path = os.path.join(out_dir, "playlist.m3u8")
    if proc.returncode is not None and proc.returncode != 0:
        await log_event(
            f"HLS transcode failed: video_id={video_id} exit_code={proc.returncode} out_dir={out_dir}",
            SEVERITY_ERROR,
            video_id=video_id,
            channel_id=channel_id,
        )
        raise HTTPException(500, "HLS transcode failed")
    if not os.path.isfile(playlist_path):
        await log_event(
            f"[ffmpeg HLS] video_id={video_id}: FFMPEG slow to start, waiting for playlist",
            SEVERITY_WARNING,
            video_id=video_id,
            channel_id=channel_id,
        )
    for _ in range(90):
        if os.path.isfile(playlist_path):
            return out_dir
        await asyncio.sleep(0.5)
    await log_event(
        f"HLS transcode timeout (playlist not ready): video_id={video_id} playlist_path={playlist_path}",
        SEVERITY_ERROR,
        video_id=video_id,
        channel_id=channel_id,
    )
    raise HTTPException(503, "Transcode in progress, please retry shortly")


HLS_SEGMENT_SECONDS = 2
# FFmpeg cuts HLS at keyframe boundaries, so actual segments are often 5-10x longer than hls_time.
# Use ~8s average for progress estimate to avoid showing low percentages when nearly done.
HLS_ESTIMATED_AVG_SEGMENT_SECONDS = 8


async def get_active_transcodes() -> list[dict]:
    """Return list of actively running transcodes: { video_id, segment_count, total_segments, percent_complete }."""
    active_ids = []
    entries_by_id = {}
    async with _hls_lock:
        for video_id, entry in list(_hls_cache.items()):
            proc = entry.get("proc")
            if proc is None or proc.returncode is not None:
                continue
            active_ids.append(video_id)
            entries_by_id[video_id] = entry

    if not active_ids:
        return []

    durations = {}
    channel_ids = {}
    if active_ids:
        rows = await db.fetch(
            "SELECT video_id, duration, channel_id FROM video WHERE video_id = ANY($1)",
            active_ids,
        )
        for r in rows:
            durations[r["video_id"]] = r.get("duration")
            channel_ids[r["video_id"]] = r.get("channel_id")

    result = []
    for video_id in active_ids:
        entry = entries_by_id.get(video_id)
        out_dir = entry.get("dir") if entry else None
        segment_count = None
        if out_dir and os.path.isdir(out_dir):
            try:
                segment_count = sum(1 for f in os.listdir(out_dir) if f.startswith("seg_") and f.endswith(".ts"))
            except OSError as e:
                await log_event(
                    f"get_active_transcodes: listdir failed: video_id={video_id} out_dir={out_dir} error={type(e).__name__}: {e}",
                    SEVERITY_ERROR,
                    video_id=video_id,
                    channel_id=channel_ids.get(video_id),
                )

        duration = durations.get(video_id)
        total_segments = (
            math.ceil(duration / HLS_ESTIMATED_AVG_SEGMENT_SECONDS)
            if duration and duration > 0
            else None
        )
        percent_complete = None
        if segment_count is not None and total_segments is not None and total_segments > 0:
            percent_complete = min(100, round((segment_count / total_segments) * 100))

        result.append({
            "video_id": video_id,
            "segment_count": segment_count,
            "total_segments": total_segments,
            "percent_complete": percent_complete,
        })
    return result


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
async def get_watch_progress(request: Request, video_id: int):
    """Get current user's watch progress for a video."""
    user_id = request.state.user_id
    r = await db.fetchrow(
        """SELECT progress_seconds, progress_percent, is_watched, is_finished
           FROM user_video WHERE user_id = $1 AND video_id = $2""",
        user_id,
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


async def _save_watch_progress(video_id: int, progress_seconds: int, progress_percent: float, user_id: int) -> None:
    """Persist watch progress to DB for the given user_id."""
    pct = min(100, max(0, round(progress_percent, 2)))
    is_finished = pct > 95
    await db.execute(
        """INSERT INTO user_video (user_id, video_id, is_watched, progress_seconds, progress_percent, is_finished, last_watched)
           VALUES ($1, $2, TRUE, $3, $4, $5, NOW())
           ON CONFLICT (user_id, video_id) DO UPDATE SET
             is_watched = TRUE,
             progress_seconds = EXCLUDED.progress_seconds,
             progress_percent = EXCLUDED.progress_percent,
             is_finished = EXCLUDED.is_finished,
             last_watched = NOW()""",
        user_id,
        video_id,
        progress_seconds,
        pct,
        is_finished,
    )


@router.put("/{video_id}/watch-progress")
async def update_watch_progress(request: Request, video_id: int, body: WatchProgressUpdate):
    """Create or update current user's watch progress."""
    await _save_watch_progress(video_id, body.progress_seconds, body.progress_percent, request.state.user_id)
    return {"ok": True}


def _row_to_tag(r) -> TagResponse:
    return TagResponse(
        tag_id=r["tag_id"],
        user_id=r["user_id"],
        title=r["title"],
        bg_color=r["bg_color"],
        fg_color=r["fg_color"],
        icon_before=r["icon_before"],
        icon_after=r["icon_after"],
        is_system=r["is_system"] or False,
        video_count=r.get("video_count"),
    )


async def _fetch_tags_for_videos(video_ids: list[int], user_id: int) -> dict[int, list[TagResponse]]:
    """Return mapping of video_id -> list of TagResponse for the given video IDs and user."""
    if not video_ids:
        return {}
    rows = await db.fetch(
        """SELECT vt.video_id, t.tag_id, t.user_id, t.title, t.bg_color, t.fg_color, t.icon_before, t.icon_after, t.is_system,
                  (SELECT COUNT(*) FROM video_tag vt2 WHERE vt2.tag_id = t.tag_id)::int AS video_count
           FROM video_tag vt
           INNER JOIN tag t ON t.tag_id = vt.tag_id
           WHERE vt.video_id = ANY($1) AND t.user_id = $2
           ORDER BY vt.video_id, t.title""",
        video_ids,
        user_id,
    )
    out = {}
    for r in rows:
        vid = r["video_id"]
        if vid not in out:
            out[vid] = []
        out[vid].append(_row_to_tag(r))
    return out


@router.get("/{video_id}/tags", response_model=list[TagResponse])
async def get_video_tags(request: Request, video_id: int):
    """List tags attached to this video for the current user."""
    user_id = request.state.user_id
    vid = await db.fetchrow("SELECT video_id FROM video WHERE video_id = $1", video_id)
    if not vid:
        raise HTTPException(404, "Video not found")
    rows = await db.fetch(
        """SELECT t.tag_id, t.user_id, t.title, t.bg_color, t.fg_color, t.icon_before, t.icon_after, t.is_system,
                  (SELECT COUNT(*) FROM video_tag vt2 WHERE vt2.tag_id = t.tag_id)::int AS video_count
           FROM tag t
           INNER JOIN video_tag vt ON vt.tag_id = t.tag_id AND vt.video_id = $1
           WHERE t.user_id = $2
           ORDER BY t.title""",
        video_id,
        user_id,
    )
    return [_row_to_tag(r) for r in rows]


@router.post("/{video_id}/tags", response_model=list[TagResponse], status_code=201)
async def add_video_tag(request: Request, video_id: int, body: VideoTagAdd):
    """Add a tag to the video. Provide tag_id or title (creates tag if missing)."""
    user_id = request.state.user_id
    if (body.tag_id is None) == (body.title is None or not (body.title or "").strip()):
        raise HTTPException(400, "Provide exactly one of tag_id or title")
    vid = await db.fetchrow("SELECT video_id FROM video WHERE video_id = $1", video_id)
    if not vid:
        raise HTTPException(404, "Video not found")
    if body.tag_id is not None:
        tag_id = body.tag_id
        r = await db.fetchrow(
            "SELECT tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system FROM tag WHERE tag_id = $1 AND user_id = $2",
            tag_id,
            user_id,
        )
        if not r:
            raise HTTPException(404, "Tag not found")
    else:
        title = (body.title or "").strip()
        r = await db.fetchrow(
            """SELECT tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system
               FROM tag WHERE user_id = $1 AND LOWER(title) = LOWER($2)""",
            user_id,
            title,
        )
        if not r:
            r = await db.fetchrow(
                """INSERT INTO tag (user_id, title, bg_color, fg_color, is_system)
                   VALUES ($1, $2, '#111827', '#f3f4f6', FALSE)
                   RETURNING tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system""",
                user_id,
                title,
            )
            await log_event(f"Tag created: {title} (tag_id={r['tag_id']})", SEVERITY_DEBUG, user_id=user_id)
        tag_id = r["tag_id"]
    await db.execute(
        """INSERT INTO video_tag (video_id, tag_id) VALUES ($1, $2)
           ON CONFLICT (video_id, tag_id) DO NOTHING""",
        video_id,
        tag_id,
    )
    channel_id = await db.fetchval("SELECT channel_id FROM video WHERE video_id = $1", video_id)
    await log_event(
        f"Tag attached to video: tag_id={tag_id}, video_id={video_id}",
        SEVERITY_DEBUG,
        video_id=video_id,
        channel_id=channel_id,
        user_id=user_id,
    )
    rows = await db.fetch(
        """SELECT t.tag_id, t.user_id, t.title, t.bg_color, t.fg_color, t.icon_before, t.icon_after, t.is_system,
                  (SELECT COUNT(*) FROM video_tag vt2 WHERE vt2.tag_id = t.tag_id)::int AS video_count
           FROM tag t
           INNER JOIN video_tag vt ON vt.tag_id = t.tag_id AND vt.video_id = $1
           WHERE t.user_id = $2
           ORDER BY t.title""",
        video_id,
        user_id,
    )
    return [_row_to_tag(r) for r in rows]


@router.delete("/{video_id}/tags/{tag_id}", status_code=204)
async def remove_video_tag(request: Request, video_id: int, tag_id: int):
    """Remove a tag from the video."""
    user_id = request.state.user_id
    r = await db.fetchrow(
        "SELECT tag_id FROM tag WHERE tag_id = $1 AND user_id = $2",
        tag_id,
        user_id,
    )
    if not r:
        raise HTTPException(404, "Tag not found")
    link = await db.fetchrow(
        "SELECT 1 FROM video_tag WHERE video_id = $1 AND tag_id = $2",
        video_id,
        tag_id,
    )
    if not link:
        raise HTTPException(404, "Video or video-tag link not found")
    await db.execute(
        "DELETE FROM video_tag WHERE video_id = $1 AND tag_id = $2",
        video_id,
        tag_id,
    )
    channel_id = await db.fetchval("SELECT channel_id FROM video WHERE video_id = $1", video_id)
    await log_event(
        f"Tag removed from video: tag_id={tag_id}, video_id={video_id}",
        SEVERITY_DEBUG,
        video_id=video_id,
        channel_id=channel_id,
        user_id=user_id,
    )


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(video_id: int):
    r = await db.fetchrow(
        """SELECT v.video_id, v.provider_key, v.channel_id, v.title, v.upload_date, v.description,
                  v.llm_description_1, v.thumbnail, v.file_path, v.transcode_path, v.download_date, v.duration,
                  v.record_created, v.status, jq.status_percent_complete AS status_percent_complete,
                  jq.job_queue_id AS pending_job_id, jq.job_type AS pending_job_type,
                  v.status_message, v.is_ignore, v.metadata_last_updated, v.nfo_last_written,
                  v.created_by_user_id, u.username AS created_by_username
           FROM video v
           LEFT JOIN app_user u ON v.created_by_user_id = u.user_id
           LEFT JOIN LATERAL (
             SELECT j.status_percent_complete, j.job_queue_id, j.job_type FROM job_queue j
             WHERE j.video_id = v.video_id AND j.status IN ('new', 'running')
             ORDER BY j.last_update DESC NULLS LAST, j.job_queue_id DESC LIMIT 1
           ) jq ON true
           WHERE v.video_id = $1""",
        video_id,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    return row_to_video(r)


@router.post("", response_model=VideoResponse, status_code=201)
async def create_video(request: Request, body: VideoCreate):
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
    user_id = request.state.user_id
    channel_id, err = await db_helpers.resolve_channel_for_video(provider_key, user_id=user_id)
    if not channel_id:
        raise HTTPException(400, err or "Could not determine channel from video")
    row = await db.fetchrow(
        """INSERT INTO video (provider_key, channel_id, status, created_by_user_id)
           VALUES ($1, $2, 'no_metadata', $3)
           RETURNING video_id, provider_key, channel_id, title, upload_date, description,
                     llm_description_1, thumbnail, file_path, transcode_path, download_date, duration,
                     record_created, status,
                     status_message, is_ignore, metadata_last_updated, nfo_last_written""",
        provider_key,
        channel_id,
        user_id,
    )
    new_job_id = None
    if body.queue_download:
        job_row = await db.fetchrow(
            """INSERT INTO job_queue (job_type, video_id, status, priority, user_id)
               VALUES ('download_video', $1, 'new', 40, $2)
               RETURNING job_queue_id""",
            row["video_id"],
            user_id,
        )
        if job_row:
            new_job_id = job_row["job_queue_id"]
    if getattr(body, "tag_needs_review", True):
        tag_row = await db.fetchrow(
            """SELECT tag_id FROM tag WHERE user_id = $1 AND LOWER(title) = 'needs review'""",
            user_id,
        )
        if tag_row:
            await db.execute(
                """INSERT INTO video_tag (video_id, tag_id) VALUES ($1, $2)
                   ON CONFLICT (video_id, tag_id) DO NOTHING""",
                row["video_id"],
                tag_row["tag_id"],
            )
            await log_event(
                f"Video tagged with Needs Review: video_id={row['video_id']}",
                SEVERITY_INFO,
                video_id=row["video_id"],
                channel_id=row.get("channel_id"),
                user_id=user_id,
            )
    await broadcast_queue_update(updated_job_id=new_job_id)
    created_extra = f"video_id={row['video_id']}"
    if channel_id is not None:
        created_extra += f", channel_id={channel_id}"
    await log_event(f"Video created: {provider_key} ({created_extra})", SEVERITY_INFO, video_id=row["video_id"], channel_id=channel_id, user_id=user_id)
    return row_to_video(dict(row, status_percent_complete=None))


@router.patch("/{video_id}", response_model=VideoResponse)
async def update_video(request: Request, video_id: int, body: VideoUpdate):
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
                      llm_description_1, thumbnail, file_path, transcode_path, download_date, duration,
                      record_created, status,
                      status_message, is_ignore, metadata_last_updated, nfo_last_written""",
        *values,
    )
    if not r:
        raise HTTPException(404, "Video not found")
    if body.is_ignore is not None:
        label = "ignored" if body.is_ignore else "unignored"
        title_or_key = r.get("title") or r.get("provider_key") or f"video_id={video_id}"
        user_id = getattr(request.state, "user_id", None)
        await log_event(
            f"Video {label}: video_id={video_id} ({title_or_key})",
            SEVERITY_NOTICE,
            video_id=video_id,
            channel_id=r.get("channel_id"),
            user_id=user_id,
        )
    return row_to_video(dict(r, status_percent_complete=None))


@router.delete("/{video_id}", status_code=204)
async def delete_video(request: Request, video_id: int):
    r = await db.fetchrow("SELECT provider_key, channel_id FROM video WHERE video_id = $1", video_id)
    await db.execute("DELETE FROM video WHERE video_id = $1", video_id)
    if r:
        user_id = getattr(request.state, "user_id", None)
        await log_event(f"Video deleted: {r['provider_key']} (video_id={video_id})", SEVERITY_INFO, video_id=video_id, channel_id=r.get("channel_id"), user_id=user_id)
