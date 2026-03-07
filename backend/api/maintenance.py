from fastapi import APIRouter, HTTPException

from database import db
from api.videos import clear_all_hls_transcodes
from log_helper import log_event, SEVERITY_ERROR, SEVERITY_INFO

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/clear-transcodes")
async def clear_transcodes():
    try:
        return await clear_all_hls_transcodes()
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to clear transcodes: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
        )
        raise HTTPException(500, "Failed to clear transcodes") from exc


@router.post("/clear-watch-history")
async def clear_watch_history():
    try:
        await log_event("Maintenance: clearing all watch history", SEVERITY_INFO)
        await db.execute(
            """UPDATE user_video
               SET progress_seconds = 0, progress_percent = 0, is_finished = FALSE, last_watched = NULL"""
        )
        await log_event("Maintenance: cleared all watch history", SEVERITY_INFO)
        return {"ok": True}
    except Exception as exc:
        await log_event(
            f"Maintenance: failed to clear watch history: {type(exc).__name__}: {exc}",
            SEVERITY_ERROR,
        )
        raise HTTPException(500, "Failed to clear watch history") from exc
