"""Sync DB connection for use inside asyncio.to_thread() job handlers."""
import os
import psycopg2
from contextlib import contextmanager

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:farstar@10.50.1.250/fsyt2",
)


def _conn():
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def get_conn():
    conn = _conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_job_progress_sync(job_id: int, status: str, percent: int = 0, message: str = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE job_queue SET status = %s, status_percent_complete = %s, status_message = %s, last_update = NOW() WHERE job_queue_id = %s""",
                (status, percent, message, job_id),
            )


def update_video_download_progress_sync(video_id: int, status: str, percent: int = 0, message: str = None, job_id: int | None = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE video SET status = %s, status_message = %s WHERE video_id = %s""",
                (status, message, video_id),
            )
            if job_id is not None:
                cur.execute(
                    """UPDATE job_queue SET status = %s, status_percent_complete = %s, status_message = %s, last_update = NOW() WHERE job_queue_id = %s""",
                    (status, percent, message, job_id),
                )


def update_video_metadata_sync(video_id: int, title: str, upload_date, description: str, thumbnail: str, duration: int | None = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE video SET title = %s, upload_date = %s, description = %s, thumbnail = %s, duration = %s, metadata_last_updated = NOW() WHERE video_id = %s""",
                (title, upload_date, description, thumbnail, duration, video_id),
            )


def update_video_llm_sync(video_id: int, llm_description_1: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE video SET llm_description_1 = %s WHERE video_id = %s",
                (llm_description_1 or None, video_id),
            )


def update_video_download_info_sync(video_id: int, file_path: str, duration: int | None = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if duration is not None:
                cur.execute(
                    """UPDATE video SET download_date = NOW(), file_path = %s, status = 'available', nfo_last_written = NOW(), duration = %s WHERE video_id = %s""",
                    (file_path.replace("\\", "/"), duration, video_id),
                )
            else:
                cur.execute(
                    """UPDATE video SET download_date = NOW(), file_path = %s, status = 'available', nfo_last_written = NOW() WHERE video_id = %s""",
                    (file_path.replace("\\", "/"), video_id),
                )


# Severity constants (match log_helper)
SEVERITY_LOW_LEVEL = 5
SEVERITY_DEBUG = 10
SEVERITY_INFO = 20
SEVERITY_WARNING = 30
SEVERITY_ERROR = 40
SEVERITY_CRITICAL = 50


def log_event_sync(
    message: str,
    severity: int = SEVERITY_INFO,
    job_id: int | None = None,
    video_id: int | None = None,
    channel_id: int | None = None,
    subsystem: str | None = None,
) -> None:
    """Write an event to the event_log table from sync/thread code."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO event_log (message, severity, job_id, video_id, channel_id, instance_id, hostname, subsystem)
                       VALUES (%s, %s, %s, %s, %s, NULL, NULL, %s)""",
                    ((message or "")[:4096], severity, job_id, video_id, channel_id, subsystem),
                )
    except Exception:
        pass  # Don't let logging failures break the app
