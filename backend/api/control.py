"""Control (key-value settings) REST API."""
from fastapi import APIRouter, HTTPException

from database import db
from api.schemas import ControlSet, ControlResponse
from log_helper import log_event, SEVERITY_NOTICE

router = APIRouter(prefix="/control", tags=["control"])


@router.get("", response_model=list[ControlResponse])
async def list_control():
    rows = await db.fetch(
        "SELECT key, index, value, last_update FROM control ORDER BY key"
    )
    return [
        ControlResponse(
            key=r["key"],
            index=r["index"],
            value=r["value"],
            last_update=r["last_update"],
        )
        for r in rows
    ]


@router.get("/{key}", response_model=ControlResponse)
async def get_control(key: str):
    r = await db.fetchrow(
        "SELECT key, index, value, last_update FROM control WHERE key = $1", key
    )
    if not r:
        raise HTTPException(404, "Control key not found")
    return ControlResponse(
        key=r["key"],
        index=r["index"],
        value=r["value"],
        last_update=r["last_update"],
    )


@router.put("/{key}", response_model=ControlResponse)
async def set_control(key: str, body: ControlSet):
    r = await db.fetchrow(
        """INSERT INTO control (key, index, value, last_update)
           VALUES ($1, 0, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, last_update = NOW()
           RETURNING key, index, value, last_update""",
        key,
        body.value,
    )
    if key == "queue_paused":
        is_paused = str(body.value).strip().lower() in ("true", "1", "t", "yes")
        await log_event(
            "Queue paused" if is_paused else "Queue started",
            SEVERITY_NOTICE,
        )
    return ControlResponse(
        key=r["key"],
        index=r["index"],
        value=r["value"],
        last_update=r["last_update"],
    )
