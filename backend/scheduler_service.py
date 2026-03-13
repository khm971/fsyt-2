"""In-process job scheduler: loads scheduler_entry rows and enqueues jobs on cron triggers."""
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from database import db
from job_processor import broadcast_queue_update
from log_helper import (
    log_event,
    SEVERITY_DEBUG,
    SEVERITY_INFO,
    SEVERITY_NOTICE,
    SEVERITY_ERROR,
)

_scheduler: AsyncIOScheduler | None = None


def get_next_run_at(cron_expression: str) -> datetime | None:
    """Return the next fire time for a cron expression (server local time), or None if invalid."""
    try:
        trigger = CronTrigger.from_crontab(cron_expression)
        return trigger.get_next_fire_time(None, datetime.now())
    except Exception:
        return None


async def _enqueue_job_from_entry(entry) -> dict:
    """Enqueue one job from a scheduler_entry row. Returns row with job_queue_id, video_id, channel_id."""
    sid = entry["scheduler_entry_id"]
    row = await db.fetchrow(
        """INSERT INTO job_queue (
            job_type, video_id, channel_id, other_target_id, parameter, extended_parameters,
            status, priority, scheduler_entry_id
        ) VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
        RETURNING job_queue_id, video_id, channel_id""",
        entry["job_type"],
        entry["video_id"],
        entry["channel_id"],
        entry["other_target_id"],
        entry["parameter"],
        entry["extended_parameters"],
        entry["priority"],
        sid,
    )
    return dict(row)


async def _fire_entry(scheduler_entry_id: int) -> None:
    """Called when a scheduler entry's cron fires: enqueue one job and update last/next run."""
    entry = await db.fetchrow(
        """SELECT scheduler_entry_id, name, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, priority, cron_expression
           FROM scheduler_entry WHERE scheduler_entry_id = $1 AND is_enabled = TRUE""",
        scheduler_entry_id,
    )
    if not entry:
        await log_event(
            f"Scheduler fire error: entry id={scheduler_entry_id} (entry not found or disabled)",
            SEVERITY_ERROR,
        )
        return
    name = entry["name"]
    try:
        row = await _enqueue_job_from_entry(entry)
        job_queue_id = row["job_queue_id"]
        now = datetime.now()
        next_run = get_next_run_at(entry["cron_expression"])
        await db.execute(
            """UPDATE scheduler_entry SET last_run_at = $1, next_run_at = $2, record_updated = $3
               WHERE scheduler_entry_id = $4""",
            now,
            next_run,
            now,
            scheduler_entry_id,
        )
        await broadcast_queue_update(updated_job_id=job_queue_id)
        await log_event(
            f"Scheduler queued job: entry {name!r} (id={scheduler_entry_id}) -> job_queue_id={job_queue_id}, job_type={entry['job_type']!r}",
            SEVERITY_NOTICE,
            job_id=job_queue_id,
            video_id=row.get("video_id"),
            channel_id=row.get("channel_id"),
        )
    except Exception as e:
        await log_event(
            f"Scheduler failed to queue job for entry {name!r} (id={scheduler_entry_id}): {e}",
            SEVERITY_ERROR,
        )
        raise


async def run_entry_now(scheduler_entry_id: int) -> dict | None:
    """Run a scheduler entry once immediately. Allowed even when entry is disabled.
    Updates only last_run_at (not next_run_at). Logs at Info that job was run manually.
    Returns dict with job_queue_id and name on success, None if entry not found."""
    entry = await db.fetchrow(
        """SELECT scheduler_entry_id, name, job_type, video_id, channel_id, other_target_id,
                  parameter, extended_parameters, priority
           FROM scheduler_entry WHERE scheduler_entry_id = $1""",
        scheduler_entry_id,
    )
    if not entry:
        return None
    name = entry["name"]
    row = await _enqueue_job_from_entry(entry)
    job_queue_id = row["job_queue_id"]
    now = datetime.now()
    await db.execute(
        """UPDATE scheduler_entry SET last_run_at = $1, record_updated = $2
           WHERE scheduler_entry_id = $3""",
        now,
        now,
        scheduler_entry_id,
    )
    await broadcast_queue_update(updated_job_id=job_queue_id)
    await log_event(
        f"Scheduler entry run manually: {name!r} (id={scheduler_entry_id}) -> job_queue_id={job_queue_id}, job_type={entry['job_type']!r}",
        SEVERITY_INFO,
        job_id=job_queue_id,
        video_id=row.get("video_id"),
        channel_id=row.get("channel_id"),
    )
    return {"job_queue_id": job_queue_id, "name": name}


async def start_scheduler() -> None:
    """Load enabled scheduler entries and register cron jobs. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.start()
    rows = await db.fetch(
        """SELECT scheduler_entry_id, name, cron_expression, is_enabled
           FROM scheduler_entry WHERE is_enabled = TRUE"""
    )
    for r in rows:
        eid = r["scheduler_entry_id"]
        name = r["name"]
        try:
            trigger = CronTrigger.from_crontab(r["cron_expression"])
            _scheduler.add_job(
                _fire_entry,
                trigger,
                id=f"scheduler_entry_{eid}",
                args=[eid],
            )
            next_run = get_next_run_at(r["cron_expression"])
            if next_run is not None:
                await db.execute(
                    "UPDATE scheduler_entry SET next_run_at = $1, record_updated = NOW() WHERE scheduler_entry_id = $2",
                    next_run,
                    eid,
                )
            await log_event(
                f"Scheduler registered entry {name!r} (id={eid}, next_run={next_run})",
                SEVERITY_DEBUG,
            )
        except Exception as e:
            await log_event(
                f"Scheduler failed to register entry {name!r} (id={eid}): {e}",
                SEVERITY_ERROR,
            )
    await log_event(f"Scheduler started; loaded {len(rows)} entries", SEVERITY_DEBUG)


async def reload_scheduler() -> None:
    """Remove all scheduler jobs and re-load from DB (call after create/update/delete)."""
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.remove_all_jobs()
    rows = await db.fetch(
        """SELECT scheduler_entry_id, name, cron_expression
           FROM scheduler_entry WHERE is_enabled = TRUE"""
    )
    for r in rows:
        eid = r["scheduler_entry_id"]
        name = r["name"]
        try:
            trigger = CronTrigger.from_crontab(r["cron_expression"])
            _scheduler.add_job(
                _fire_entry,
                trigger,
                id=f"scheduler_entry_{eid}",
                args=[eid],
            )
            next_run = get_next_run_at(r["cron_expression"])
            if next_run is not None:
                await db.execute(
                    "UPDATE scheduler_entry SET next_run_at = $1, record_updated = NOW() WHERE scheduler_entry_id = $2",
                    next_run,
                    eid,
                )
            await log_event(
                f"Scheduler registered entry {name!r} (id={eid}, next_run={next_run})",
                SEVERITY_DEBUG,
            )
        except Exception as e:
            await log_event(
                f"Scheduler failed to register entry {name!r} (id={eid}): {e}",
                SEVERITY_ERROR,
            )
    await log_event("Scheduler reloaded", SEVERITY_DEBUG)


def shutdown_scheduler() -> None:
    """Stop the scheduler (e.g. on app shutdown)."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
