"""Admin API: configured server instances (multi-instance workers)."""
from fastapi import APIRouter, HTTPException, Request

import db_helpers
from database import db
from api.schemas import ServerInstanceCreate, ServerInstanceResponse, ServerInstanceUpdate
from log_helper import log_event, SEVERITY_INFO

router = APIRouter(prefix="/server-instances", tags=["server-instances"])


def _row_to_response(r, summary: dict | None) -> ServerInstanceResponse:
    sid = int(r["server_instance_id"])
    sm = summary or {}
    return ServerInstanceResponse(
        server_instance_id=sid,
        display_name=r["display_name"] or "",
        is_enabled=bool(r["is_enabled"]),
        assign_download_jobs=bool(r["assign_download_jobs"]),
        record_created=r.get("record_created"),
        record_updated=r.get("record_updated"),
        is_running=bool(sm.get("is_running", False)),
        last_heartbeat_utc=sm.get("last_heartbeat_utc"),
        duplicate_id_conflict=bool(sm.get("duplicate_id_conflict", False)),
    )


@router.get("", response_model=list[ServerInstanceResponse])
async def list_server_instances():
    rows = await db.fetch(
        """SELECT server_instance_id, display_name, is_enabled, assign_download_jobs,
                  record_created, record_updated
           FROM server_instance ORDER BY server_instance_id"""
    )
    summaries = await db_helpers.fetch_server_instances_dashboard_summary()
    by_id = {x["server_instance_id"]: x for x in summaries}
    return [_row_to_response(r, by_id.get(int(r["server_instance_id"]))) for r in rows]


@router.post("", response_model=ServerInstanceResponse, status_code=201)
async def create_server_instance(request: Request, body: ServerInstanceCreate):
    user_id = getattr(request.state, "user_id", None)
    if body.server_instance_id < 1:
        raise HTTPException(400, "server_instance_id must be a positive integer")
    existing = await db.fetchrow(
        "SELECT server_instance_id FROM server_instance WHERE server_instance_id = $1",
        body.server_instance_id,
    )
    if existing:
        raise HTTPException(409, "server_instance_id already exists")
    r = await db.fetchrow(
        """INSERT INTO server_instance (server_instance_id, display_name, is_enabled, assign_download_jobs)
           VALUES ($1, $2, $3, $4)
           RETURNING server_instance_id, display_name, is_enabled, assign_download_jobs,
                     record_created, record_updated""",
        body.server_instance_id,
        body.display_name.strip() or f"Instance {body.server_instance_id}",
        body.is_enabled,
        body.assign_download_jobs,
    )
    await log_event(
        f"Server instance created: id={body.server_instance_id} name={r['display_name']!r}",
        SEVERITY_INFO,
        user_id=user_id,
    )
    summaries = await db_helpers.fetch_server_instances_dashboard_summary()
    sm = next((x for x in summaries if x["server_instance_id"] == body.server_instance_id), None)
    return _row_to_response(r, sm)


@router.patch("/{server_instance_id}", response_model=ServerInstanceResponse)
async def update_server_instance(
    request: Request,
    server_instance_id: int,
    body: ServerInstanceUpdate,
):
    user_id = getattr(request.state, "user_id", None)
    r0 = await db.fetchrow(
        "SELECT server_instance_id FROM server_instance WHERE server_instance_id = $1",
        server_instance_id,
    )
    if not r0:
        raise HTTPException(404, "Server instance not found")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        r = await db.fetchrow(
            """SELECT server_instance_id, display_name, is_enabled, assign_download_jobs,
                      record_created, record_updated
               FROM server_instance WHERE server_instance_id = $1""",
            server_instance_id,
        )
        summaries = await db_helpers.fetch_server_instances_dashboard_summary()
        sm = next((x for x in summaries if x["server_instance_id"] == server_instance_id), None)
        return _row_to_response(r, sm)
    sets = []
    params: list = []
    if "display_name" in updates and updates["display_name"] is not None:
        params.append(updates["display_name"].strip() or f"Instance {server_instance_id}")
        sets.append(f"display_name = ${len(params)}")
    if "is_enabled" in updates:
        params.append(updates["is_enabled"])
        sets.append(f"is_enabled = ${len(params)}")
    if "assign_download_jobs" in updates:
        params.append(updates["assign_download_jobs"])
        sets.append(f"assign_download_jobs = ${len(params)}")
    sets.append("record_updated = NOW()")
    params.append(server_instance_id)
    pk = len(params)
    r = await db.fetchrow(
        f"""UPDATE server_instance SET {", ".join(sets)}
            WHERE server_instance_id = ${pk}
            RETURNING server_instance_id, display_name, is_enabled, assign_download_jobs,
                      record_created, record_updated""",
        *params,
    )
    await log_event(
        f"Server instance updated: id={server_instance_id} fields={list(updates.keys())}",
        SEVERITY_INFO,
        user_id=user_id,
    )
    summaries = await db_helpers.fetch_server_instances_dashboard_summary()
    sm = next((x for x in summaries if x["server_instance_id"] == server_instance_id), None)
    return _row_to_response(r, sm)
