"""Jellyfin integration API: proxy status from local Jellyfin server."""
import asyncio
from fastapi import APIRouter, Request

from database import db
from jellyfin_client import get_jellyfin_status, get_jellyfin_library_items, get_jellyfin_item_watch_status
from log_helper import log_event, SEVERITY_INFO, SEVERITY_WARNING

router = APIRouter(prefix="/jellyfin", tags=["jellyfin"])


@router.get("/status")
async def jellyfin_status(request: Request):
    """Return Jellyfin connection status, server info, libraries, and users.
    Always returns 200; use payload.connected and payload.error for UI.
    """
    user_id = getattr(request.state, "user_id", None)
    result = await asyncio.to_thread(get_jellyfin_status)

    if result.get("connected"):
        await log_event(
            f"Jellyfin: connected to {result.get('server_name') or 'server'}",
            SEVERITY_INFO,
            subsystem="jellyfin",
            user_id=user_id,
        )
    else:
        await log_event(
            f"Jellyfin: connection failed — {result.get('error') or 'unknown'}",
            SEVERITY_WARNING,
            subsystem="jellyfin",
            user_id=user_id,
        )

    return result


@router.get("/library-items/{item_id}/watch-status")
async def jellyfin_item_watch_status(request: Request, item_id: str):
    """Return Jellyfin watch status for a single item. Returns 200 with { started, progress_seconds, progress_percent, is_finished } or { error: "<message>" }."""
    data = await asyncio.to_thread(get_jellyfin_item_watch_status, item_id)
    return data


@router.get("/library-items")
async def jellyfin_library_items(request: Request, library_name: str = "FSYT-2"):
    """Return all items (videos) from a Jellyfin library by name. Always 200; use payload.items and payload.error.
    Episode items include video_id when matched to video.file_path."""
    user_id = getattr(request.state, "user_id", None)
    result = await asyncio.to_thread(get_jellyfin_library_items, library_name)

    items = result.get("items") or []
    normalized_paths = [
        item["normalized_path"]
        for item in items
        if item.get("type") == "Episode" and item.get("normalized_path")
    ]
    path_to_video_id = {}
    if normalized_paths:
        rows = await db.fetch(
            "SELECT video_id, file_path FROM video WHERE file_path = ANY($1::text[])",
            list(dict.fromkeys(normalized_paths)),
        )
        for r in rows:
            if r["file_path"] not in path_to_video_id:
                path_to_video_id[r["file_path"]] = r["video_id"]
    for item in items:
        if item.get("type") == "Episode" and item.get("normalized_path"):
            item["video_id"] = path_to_video_id.get(item["normalized_path"])

    # Watch status for user "khm" on matched Episodes
    khm_user_id = await db.fetchval(
        "SELECT user_id FROM app_user WHERE username = $1 AND is_enabled = TRUE",
        "khm",
    )
    episode_video_ids = [
        item["video_id"]
        for item in items
        if item.get("type") == "Episode" and item.get("video_id") is not None
    ]
    video_id_to_watch = {}
    if khm_user_id and episode_video_ids:
        rows = await db.fetch(
            """SELECT video_id, progress_seconds, progress_percent, is_finished, is_watched
               FROM user_video WHERE user_id = $1 AND video_id = ANY($2::int[])""",
            khm_user_id,
            list(dict.fromkeys(episode_video_ids)),
        )
        for r in rows:
            video_id_to_watch[r["video_id"]] = {
                "started": r["is_watched"] or (r["progress_seconds"] or 0) > 0 or float(r["progress_percent"] or 0) > 0,
                "progress_seconds": r["progress_seconds"] or 0,
                "progress_percent": float(r["progress_percent"] or 0),
                "is_finished": r["is_finished"] or False,
            }
    for item in items:
        if item.get("type") == "Episode" and item.get("video_id") is not None:
            item["watch_status"] = video_id_to_watch.get(
                item["video_id"],
                {"started": False, "progress_seconds": 0, "progress_percent": 0.0, "is_finished": False},
            )

    if result.get("error"):
        await log_event(
            f"Jellyfin: library items failed — {result.get('error')}",
            SEVERITY_WARNING,
            subsystem="jellyfin",
            user_id=user_id,
        )
    else:
        await log_event(
            f"Jellyfin: loaded {len(items)} items from library {library_name!r}",
            SEVERITY_INFO,
            subsystem="jellyfin",
            user_id=user_id,
        )

    return result
