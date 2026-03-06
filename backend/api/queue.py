"""Job queue REST API."""
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query

from database import db
from api.schemas import JobQueueCreate, JobQueueResponse
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
    )


@router.get("", response_model=list[JobQueueResponse])
async def list_jobs(
    status: str | None = Query(None),
    limit: int = Query(100, le=500),
):
    q = """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority
           FROM job_queue WHERE 1=1"""
    params = []
    i = 1
    if status:
        q += f" AND status = ${i}"
        params.append(status)
        i += 1
    q += f" ORDER BY priority DESC NULLS LAST, job_queue_id ASC LIMIT ${i}"
    params.append(limit)
    rows = await db.fetch(q, *params)
    return [row_to_job(r) for r in rows]


@router.get("/{job_id}", response_model=JobQueueResponse)
async def get_job(job_id: int):
    r = await db.fetchrow(
        """SELECT job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority
           FROM job_queue WHERE job_queue_id = $1""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    return row_to_job(r)


@router.post("", response_model=JobQueueResponse, status_code=201)
async def create_job(body: JobQueueCreate):
    row = await db.fetchrow(
        """INSERT INTO job_queue (
            job_type, video_id, channel_id, other_target_id, parameter, extended_parameters,
            status, run_after, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
        RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, status, status_percent_complete, status_message,
                  last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                  run_after, priority""",
        body.job_type,
        body.video_id,
        body.channel_id,
        body.other_target_id,
        body.parameter,
        body.extended_parameters,
        body.run_after,
        body.priority,
    )
    await broadcast_queue_update()
    j = row_to_job(row)
    await log_event(f"Job queued: {j.job_type} (ID {j.job_queue_id}, video_id={j.video_id}, channel_id={j.channel_id})", SEVERITY_INFO, job_id=j.job_queue_id, video_id=j.video_id, channel_id=j.channel_id)
    return j


@router.patch("/{job_id}/acknowledge", response_model=JobQueueResponse)
async def acknowledge_job(job_id: int):
    r = await db.fetchrow(
        """UPDATE job_queue SET acknowledge_flag = TRUE WHERE job_queue_id = $1
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found")
    await broadcast_queue_update()
    await log_event(f"Job {job_id} acknowledged", SEVERITY_INFO, job_id=job_id, video_id=r.get("video_id"), channel_id=r.get("channel_id"))
    return row_to_job(r)


@router.post("/{job_id}/cancel", response_model=JobQueueResponse)
async def cancel_job(job_id: int):
    r = await db.fetchrow(
        """UPDATE job_queue SET status = 'cancelled' WHERE job_queue_id = $1 AND status = 'new'
           RETURNING job_queue_id, record_created, job_type, video_id, channel_id, other_target_id,
                     parameter, extended_parameters, status, status_percent_complete, status_message,
                     last_update, completed_flag, warning_flag, error_flag, acknowledge_flag,
                     run_after, priority""",
        job_id,
    )
    if not r:
        raise HTTPException(404, "Job not found or not cancellable")
    await broadcast_queue_update()
    await log_event(f"Job {job_id} cancelled", SEVERITY_INFO, job_id=job_id, video_id=r.get("video_id"), channel_id=r.get("channel_id"))
    return row_to_job(r)
