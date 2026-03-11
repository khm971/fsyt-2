"""Scheduler entry REST API."""
from fastapi import APIRouter, HTTPException

from database import db
from api.schemas import (
    SchedulerEntryCreate,
    SchedulerEntryUpdate,
    SchedulerEntryResponse,
)
from scheduler_service import get_next_run_at, reload_scheduler, run_entry_now
from log_helper import log_event, SEVERITY_INFO

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


def _validate_cron(cron_expression: str) -> None:
    """Raise HTTP 400 if cron expression is invalid."""
    if get_next_run_at(cron_expression) is None:
        raise HTTPException(400, f"Invalid cron expression: {cron_expression!r}")


def _row_to_response(r) -> SchedulerEntryResponse:
    return SchedulerEntryResponse(
        scheduler_entry_id=r["scheduler_entry_id"],
        name=r["name"],
        job_type=r["job_type"],
        cron_expression=r["cron_expression"],
        video_id=r["video_id"],
        channel_id=r["channel_id"],
        other_target_id=r["other_target_id"],
        parameter=r["parameter"],
        extended_parameters=r["extended_parameters"],
        priority=r["priority"],
        is_enabled=r["is_enabled"],
        last_run_at=r["last_run_at"],
        next_run_at=r["next_run_at"],
        record_created=r["record_created"],
        record_updated=r["record_updated"],
    )


@router.get("", response_model=list[SchedulerEntryResponse])
async def list_entries():
    """List all scheduler entries."""
    rows = await db.fetch(
        """SELECT scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                  other_target_id, parameter, extended_parameters, priority, is_enabled,
                  last_run_at, next_run_at, record_created, record_updated
           FROM scheduler_entry ORDER BY scheduler_entry_id ASC"""
    )
    return [_row_to_response(r) for r in rows]


@router.get("/{entry_id}", response_model=SchedulerEntryResponse)
async def get_entry(entry_id: int):
    """Get one scheduler entry."""
    r = await db.fetchrow(
        """SELECT scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                  other_target_id, parameter, extended_parameters, priority, is_enabled,
                  last_run_at, next_run_at, record_created, record_updated
           FROM scheduler_entry WHERE scheduler_entry_id = $1""",
        entry_id,
    )
    if not r:
        raise HTTPException(404, "Scheduler entry not found")
    return _row_to_response(r)


@router.post("", response_model=SchedulerEntryResponse, status_code=201)
async def create_entry(body: SchedulerEntryCreate):
    """Create a scheduler entry. Validates cron and triggers scheduler reload."""
    _validate_cron(body.cron_expression)
    next_run = get_next_run_at(body.cron_expression)
    r = await db.fetchrow(
        """INSERT INTO scheduler_entry (
            name, job_type, cron_expression, video_id, channel_id, other_target_id,
            parameter, extended_parameters, priority, is_enabled, next_run_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                  other_target_id, parameter, extended_parameters, priority, is_enabled,
                  last_run_at, next_run_at, record_created, record_updated""",
        body.name,
        body.job_type,
        body.cron_expression,
        body.video_id,
        body.channel_id,
        body.other_target_id,
        body.parameter,
        body.extended_parameters,
        body.priority,
        body.is_enabled,
        next_run if body.is_enabled else None,
    )
    await log_event(
        f"Scheduler entry created: {body.name!r} (id={r['scheduler_entry_id']}, job_type={body.job_type!r}, cron={body.cron_expression!r})",
        SEVERITY_INFO,
    )
    await reload_scheduler()
    return _row_to_response(r)


@router.patch("/{entry_id}", response_model=SchedulerEntryResponse)
async def update_entry(entry_id: int, body: SchedulerEntryUpdate):
    """Update a scheduler entry. Validates cron if provided. Triggers scheduler reload."""
    existing = await db.fetchrow(
        """SELECT scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                  other_target_id, parameter, extended_parameters, priority, is_enabled
           FROM scheduler_entry WHERE scheduler_entry_id = $1""",
        entry_id,
    )
    if not existing:
        raise HTTPException(404, "Scheduler entry not found")
    updates = body.model_dump(exclude_unset=True)
    if "cron_expression" in updates:
        _validate_cron(updates["cron_expression"])
    cron = updates.get("cron_expression") or existing["cron_expression"]
    is_enabled = updates.get("is_enabled") if "is_enabled" in updates else existing["is_enabled"]
    next_run = get_next_run_at(cron) if is_enabled else None
    if not updates:
        r = await db.fetchrow(
            """SELECT scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                      other_target_id, parameter, extended_parameters, priority, is_enabled,
                      last_run_at, next_run_at, record_created, record_updated
               FROM scheduler_entry WHERE scheduler_entry_id = $1""",
            entry_id,
        )
        return _row_to_response(r)
    name = updates.get("name", existing["name"])
    job_type = updates.get("job_type", existing["job_type"])
    video_id = updates.get("video_id", existing["video_id"])
    channel_id = updates.get("channel_id", existing["channel_id"])
    other_target_id = updates.get("other_target_id", existing["other_target_id"])
    parameter = updates.get("parameter", existing["parameter"])
    extended_parameters = updates.get("extended_parameters", existing["extended_parameters"])
    priority = updates.get("priority", existing["priority"])
    r = await db.fetchrow(
        """UPDATE scheduler_entry SET
            name = $1, job_type = $2, cron_expression = $3, video_id = $4, channel_id = $5,
            other_target_id = $6, parameter = $7, extended_parameters = $8, priority = $9,
            is_enabled = $10, next_run_at = $11, record_updated = NOW()
           WHERE scheduler_entry_id = $12
           RETURNING scheduler_entry_id, name, job_type, cron_expression, video_id, channel_id,
                     other_target_id, parameter, extended_parameters, priority, is_enabled,
                     last_run_at, next_run_at, record_created, record_updated""",
        name,
        job_type,
        cron,
        video_id,
        channel_id,
        other_target_id,
        parameter,
        extended_parameters,
        priority,
        is_enabled,
        next_run,
        entry_id,
    )
    await log_event(
        f"Scheduler entry updated: {r['name']!r} (id={entry_id})",
        SEVERITY_INFO,
    )
    await reload_scheduler()
    return _row_to_response(r)


@router.post("/{entry_id}/run-now", status_code=200)
async def run_now(entry_id: int):
    """Run a scheduler entry once immediately. Allowed even when the entry is disabled.
    Does not change next run time; updates last run and logs at Info that the job was run manually."""
    result = await run_entry_now(entry_id)
    if result is None:
        raise HTTPException(404, "Scheduler entry not found")
    return result


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(entry_id: int):
    """Delete a scheduler entry and trigger scheduler reload."""
    r = await db.fetchrow(
        "SELECT name FROM scheduler_entry WHERE scheduler_entry_id = $1",
        entry_id,
    )
    if not r:
        raise HTTPException(404, "Scheduler entry not found")
    name = r["name"]
    await db.execute("DELETE FROM scheduler_entry WHERE scheduler_entry_id = $1", entry_id)
    await log_event(f"Scheduler entry deleted: {name!r} (id={entry_id})", SEVERITY_INFO)
    await reload_scheduler()
    return None
