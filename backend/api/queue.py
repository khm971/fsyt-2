"""Job queue REST API."""
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query

from database import db
from api.schemas import JobQueueCreate, JobQueueListResponse, JobQueueResponse, JobQueueSummaryResponse, JobQueueUpdate
from job_processor import broadcast_queue_update
from log_helper import log_event, SEVERITY_INFO

router = APIRouter(prefix="/queue", tags=["queue"])


def row_to_job(r) -> JobQueueResponse:
    return JobQueueResponse(
        job_queue_id=r["job_queue_id"],
        record_created=r["record_created"],
        job_type=r["job_type"],
        video_id=r["video_id"],
        channel_id=r["channel_id"],
        other_target_id=r["other_target_id"],
        parameter=r["parameter"],
        extended_parameters=r["extended_parameters"],
        status=r["status"],
        status_percent_complete=r["status_percent_complete"],
        status_message=r["status_message"],
        last_update=r["last_update"],
        completed_flag=r["completed_flag"] or False,
        warning_flag=r["warning_flag"] or False,
        error_flag=r["error_flag"] or False,
        acknowledge_flag=r["acknowledge_flag"] or False,
        run_after=r["run_after"],
        priority=r["priority"],
        scheduler_entry_id=r.get("scheduler_entry_id"),
    )


# Columns that may be null: use NULLS LAST in ORDER BY for stable sort
_NULLABLE_SORT_COLS = {"video_id", "last_update", "record_created", "status", "job_type", "priority"}


@router.get("", response_model=JobQueueListResponse)
async def list_jobs(
    status: str | None = Query(None),
    scheduler_entry_id: int | None = Query(None),
    limit: int = Query(500, le=500),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("id", pattern="^(id|video_id|status|last_update|record_created|job_type|priority)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    where = "WHERE 1=1"
    params = []
    i = 1
    if status:
        where += f" AND status = ${i}"
        params.append(status)
        i += 1
    if scheduler_entry_id is not None:
        where += f" AND scheduler_entry_id = ${i}"
        params.append(scheduler_entry_id)
        i += 1
    total_row = await db.fetchrow(
        f"SELECT COUNT(*) AS total FROM job_queue {where}", *params
    )
    total = int(total_row["total"] or 0)
    sort_col = "job_queue_id" if sort_by == "id" else sort_by
    dirn = "ASC" if sort_order == "asc" else "DESC"
    nulls = " NULLS LAST" if sort_col in _NULLABLE_SORT_COLS else ""
    order_clause = f"ORDER BY {sort_col} {dirn}{nulls}"
    q = f"""SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority, scheduler_entry_id
           FROM job_queue {where}
           {order_clause} LIMIT ${i} OFFSET ${i + 1}"""
    params.extend([limit, offset])
    rows = await db.fetch(q, *params)
    return JobQueueListResponse(items=[row_to_job(r) for r in rows], total=total)


@router.get("/summary", response_model=JobQueueSummaryResponse)
async def get_queue_summary():
    """Lightweight summary for the Dashboard jobs widget: in-progress jobs (with progress) and counts only."""
    counts_row = await db.fetchrow(
        """SELECT
             count(*) FILTER (WHERE status != 'new' AND status != 'done' AND status != 'cancelled') AS running_count,
             count(*) FILTER (WHERE status = 'new') AS queued_count,
             count(*) FILTER (WHERE status = 'new' AND (run_after IS NULL OR run_after <= NOW())) AS runnable_count,
             count(*) AS total_count,
             count(*) FILTER (WHERE error_flag AND NOT acknowledge_flag) AS errors_count,
             count(*) FILTER (WHERE warning_flag AND NOT acknowledge_flag) AS warnings_count
           FROM job_queue"""
    )
    running_rows = await db.fetch(
        """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority, scheduler_entry_id
           FROM job_queue
           WHERE status != 'new' AND status != 'done' AND status != 'cancelled'
           ORDER BY last_update DESC NULLS LAST LIMIT 20"""
    )
    return JobQueueSummaryResponse(
        running=[row_to_job(r) for r in running_rows],
        running_count=int(counts_row["running_count"] or 0),
        queued_count=int(counts_row["queued_count"] or 0),
        runnable_count=int(counts_row["runnable_count"] or 0),
        total_count=int(counts_row["total_count"] or 0),
        errors_count=int(counts_row["errors_count"] or 0),
        warnings_count=int(counts_row["warnings_count"] or 0),
    )


@router.get("/{job_id}", response_model=JobQueueResponse)
async def get_job(job_id: int):
    r = await db.fetchrow(
        """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority, scheduler_entry_id
           FROM job_queue WHERE job_queue_id = $1""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    return row_to_job(r)


def _validate_job_create(body: JobQueueCreate) -> None:
    """Validate required parameters for job creation. Raises HTTPException 400 if invalid."""
    t = body.job_type
    if t in ("download_video", "get_metadata", "transcode_video_for_ipad"):
        if body.video_id is None or body.video_id < 1:
            raise HTTPException(400, f"{t} requires video_id (positive integer)")
    if t in ("download_channel_artwork", "download_one_channel", "update_channel_info"):
        if body.channel_id is None or body.channel_id < 1:
            raise HTTPException(400, f"{t} requires channel_id (positive integer)")
    if t in ("add_video_from_frontend", "add_video_from_playlist"):
        if not body.parameter or not body.parameter.strip():
            raise HTTPException(400, f"{t} requires parameter (YouTube URL or video ID)")
    if t == "trim_job_queue":
        if not body.parameter or not body.parameter.strip():
            raise HTTPException(400, "trim_job_queue requires parameter 'age in days' (integer, minimum 3)")
        try:
            age_days = int(body.parameter.strip())
        except ValueError:
            raise HTTPException(400, "trim_job_queue requires parameter 'age in days' (integer, minimum 3)")
        if age_days < 3:
            raise HTTPException(400, "trim_job_queue requires parameter 'age in days' (integer, minimum 3)")


@router.post("", response_model=JobQueueResponse, status_code=201)
async def create_job(body: JobQueueCreate):
    _validate_job_create(body)
    row = await db.fetchrow(
        """INSERT INTO job_queue (
            job_type, video_id, channel_id, other_target_id, parameter, extended_parameters,
            status, run_after, priority, scheduler_entry_id
        ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8, $9)
        RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority, scheduler_entry_id""",
        body.job_type,
        body.video_id,
        body.channel_id,
        body.other_target_id,
        body.parameter,
        body.extended_parameters,
        body.run_after,
        body.priority,
        body.scheduler_entry_id,
    )
    await broadcast_queue_update(updated_job_id=row["job_queue_id"])
    j = row_to_job(row)
    await log_event(f"Job queued: {j.job_type} (ID {j.job_queue_id}, video_id={j.video_id}, channel_id={j.channel_id})", SEVERITY_INFO, job_id=j.job_queue_id, video_id=j.video_id, channel_id=j.channel_id)
    return j


@router.patch("/{job_id}", response_model=JobQueueResponse)
async def update_job(job_id: int, body: JobQueueUpdate):
    """Update run_after and/or priority. Only jobs with status='new' can be updated."""
    # Check job exists and get current state
    r = await db.fetchrow(
        """SELECT job_queue_id, status, run_after, priority FROM job_queue WHERE job_queue_id = $1""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    if r["status"] != "new":
        raise HTTPException(400, "Only jobs with status 'new' can be updated")
    provided = body.model_dump(exclude_unset=True)
    updates = []
    params = []
    i = 1
    if "run_after" in provided:
        updates.append(f"run_after = ${i}")
        params.append(provided["run_after"])  # None clears the date
        i += 1
    if "priority" in provided and provided["priority"] is not None:
        p = provided["priority"]
        if not (1 <= p <= 100):
            raise HTTPException(400, "Priority must be between 1 and 100 (1 = highest)")
        updates.append(f"priority = ${i}")
        params.append(p)
        i += 1
    if not updates:
        # No changes; return current job
        return row_to_job(await db.fetchrow(
            """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                      parameter, extended_parameters, status, status_percent_complete, status_message,
                      last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                      run_after, priority, scheduler_entry_id
               FROM job_queue WHERE job_queue_id = $1""",
            job_id,
        ))
    params.append(job_id)
    row = await db.fetchrow(
        f"""UPDATE job_queue SET {", ".join(updates)}, last_update = NOW() WHERE job_queue_id = ${i}
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority, scheduler_entry_id""",
        *params,
    )
    await broadcast_queue_update(updated_job_id=job_id)
    return row_to_job(row)


@router.patch("/{job_id}/acknowledge", response_model=JobQueueResponse)
async def acknowledge_job(job_id: int):
    r = await db.fetchrow(
        """UPDATE job_queue SET acknowledge_flag = TRUE WHERE job_queue_id = $1
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority, scheduler_entry_id""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    await broadcast_queue_update(updated_job_id=job_id)
    vid, cid = r.get("video_id"), r.get("channel_id")
    extra = [f"video_id={vid}"] if vid is not None else []
    if cid is not None:
        extra.append(f"channel_id={cid}")
    suffix = " (" + ", ".join(extra) + ")" if extra else ""
    await log_event(f"Job {job_id} acknowledged{suffix}", SEVERITY_INFO, job_id=job_id, video_id=vid, channel_id=cid)
    return row_to_job(r)


@router.patch("/{job_id}/unacknowledge", response_model=JobQueueResponse)
async def unacknowledge_job(job_id: int):
    r = await db.fetchrow(
        """UPDATE job_queue SET acknowledge_flag = FALSE WHERE job_queue_id = $1
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority, scheduler_entry_id""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    await broadcast_queue_update(updated_job_id=job_id)
    vid, cid = r.get("video_id"), r.get("channel_id")
    extra = [f"video_id={vid}"] if vid is not None else []
    if cid is not None:
        extra.append(f"channel_id={cid}")
    suffix = " (" + ", ".join(extra) + ")" if extra else ""
    await log_event(f"Job {job_id} unacknowledged{suffix}", SEVERITY_INFO, job_id=job_id, video_id=vid, channel_id=cid)
    return row_to_job(r)


@router.post("/{job_id}/cancel", response_model=JobQueueResponse)
async def cancel_job(job_id: int):
    r = await db.fetchrow(
        """UPDATE job_queue SET status = 'cancelled' WHERE job_queue_id = $1 AND status = 'new'
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority, scheduler_entry_id""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found or not cancellable")
    await broadcast_queue_update(updated_job_id=job_id)
    vid, cid = r.get("video_id"), r.get("channel_id")
    extra = [f"video_id={vid}"] if vid is not None else []
    if cid is not None:
        extra.append(f"channel_id={cid}")
    suffix = " (" + ", ".join(extra) + ")" if extra else ""
    await log_event(f"Job {job_id} cancelled{suffix}", SEVERITY_INFO, job_id=job_id, video_id=vid, channel_id=cid)
    return row_to_job(r)
