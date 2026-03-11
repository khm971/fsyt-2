"""FSYT2 FastAPI app: REST API + WebSocket for queue updates."""
import asyncio
import json
import os
import platform
import socket
import struct
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root so OLLAMA_*, DATABASE_URL, etc. are set before any service imports
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from database import db
from db_helpers import set_control_value
from run_migrations import run_migrations
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_INFO, SEVERITY_NOTICE, SEVERITY_WARNING, SEVERITY_ERROR
from job_processor import run_job_loop, broadcast_queue_update
from websocket_manager import ws_manager
from video_progress_bridge import drain as drain_video_progress
from api.channels import router as channels_router
from api.videos import router as videos_router, _save_watch_progress, get_active_transcodes
from api.queue import router as queue_router
from api.control import router as control_router
from api.charged_errors import router as charged_errors_router
from api.log import router as log_router
from api.maintenance import router as maintenance_router
from api.status import router as status_router
from api.scheduler import router as scheduler_router
from scheduler_service import start_scheduler, shutdown_scheduler
from startup_cleanup import run_startup_cleanup
from backend_instance_context import set_backend_instance


def _get_host_info():
    """Return dict of hostname, os, host_ip where each is only present if obtainable (Docker-safe)."""
    out = {}
    try:
        out["hostname"] = socket.gethostname()
    except Exception:
        pass
    try:
        out["os"] = f"{platform.system()} {platform.release()}".strip()
    except Exception:
        pass
    # Host IP: env var (e.g. from Docker), or on Linux the default gateway (Docker host bridge)
    try:
        if os.environ.get("HOST_IP"):
            out["host_ip"] = os.environ["HOST_IP"].strip()
        elif platform.system() == "Linux":
            with open("/proc/net/route") as fh:
                for line in fh:
                    parts = line.strip().split()
                    if len(parts) >= 3 and parts[1] == "00000000":
                        gw_hex = parts[2]
                        addr = socket.inet_ntoa(struct.pack("<L", int(gw_hex, 16)))
                        out["host_ip"] = addr
                        break
    except Exception:
        pass
    return out


async def _drain_video_progress_loop():
    """Drain video progress queue and broadcast to WebSocket clients."""
    while True:
        try:
            for video_id, status, percent in drain_video_progress():
                await ws_manager.broadcast({
                    "type": "video_progress",
                    "video_id": video_id,
                    "status": status,
                    "status_percent_complete": percent,
                })
        except Exception as e:
            await log_event(
                f"Video progress drain loop error: {type(e).__name__}: {e}",
                SEVERITY_ERROR,
            )
        await asyncio.sleep(0.2)


async def _transcode_progress_broadcast_loop():
    """Broadcast transcode progress to WebSocket clients while transcodes are active."""
    while True:
        try:
            transcodes = await get_active_transcodes()
            if transcodes:
                await ws_manager.broadcast({"type": "transcode_progress", "transcodes": transcodes})
        except Exception as e:
            await log_event(
                f"Transcode progress broadcast loop error: {type(e).__name__}: {e}",
                SEVERITY_ERROR,
            )
        await asyncio.sleep(1.5)


async def _backend_instance_heartbeat_loop(instance_id: uuid.UUID, hostname: str | None):
    """Register this backend instance and broadcast multi-instance status; log on transitions."""
    multiple_instances_previous: bool | None = None  # None = first run, set from initial count
    while True:
        try:
            await db.execute(
                """INSERT INTO backend_instances (instance_id, hostname, last_heartbeat_utc)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (instance_id) DO UPDATE SET
                     hostname = EXCLUDED.hostname,
                     last_heartbeat_utc = NOW()""",
                instance_id,
                hostname or "",
            )
            await db.execute(
                """DELETE FROM backend_instances
                   WHERE last_heartbeat_utc < NOW() - INTERVAL '1 minute'"""
            )
            count_row = await db.fetchrow(
                """SELECT COUNT(*) AS n FROM backend_instances
                   WHERE last_heartbeat_utc > NOW() - INTERVAL '30 seconds'"""
            )
            count = int(count_row["n"] or 0)
            multiple_now = count > 1

            if multiple_instances_previous is None:
                multiple_instances_previous = multiple_now
                await log_event(
                    f"Backend instance registered (instance_id={instance_id}, hostname={hostname or 'unknown'})",
                    SEVERITY_DEBUG,
                )
            else:
                if multiple_now and not multiple_instances_previous:
                    await log_event(
                        f"Multiple backend instances detected ({count} instances). Please stop duplicate instances.",
                        SEVERITY_WARNING,
                    )
                    await set_control_value("queue_paused", "true")
                    await log_event(
                        "Queue auto-paused because multiple backend instances were detected. Resume manually after stopping duplicate instances.",
                        SEVERITY_WARNING,
                    )
                    await broadcast_queue_update()
                elif not multiple_now and multiple_instances_previous:
                    await log_event(
                        "Multiple backend instance condition cleared; only one instance is running.",
                        SEVERITY_NOTICE,
                    )
                multiple_instances_previous = multiple_now

            instances_rows = await db.fetch(
                """SELECT instance_id, hostname, last_heartbeat_utc FROM backend_instances
                   WHERE last_heartbeat_utc > NOW() - INTERVAL '30 seconds'
                   ORDER BY last_heartbeat_utc DESC"""
            )
            instances = [
                {
                    "instance_id": str(r["instance_id"]),
                    "hostname": r["hostname"] or "",
                    "last_heartbeat_utc": r["last_heartbeat_utc"].isoformat() if r["last_heartbeat_utc"] else None,
                }
                for r in instances_rows
            ]
            await ws_manager.broadcast({
                "type": "multi_instance_status",
                "multiple_instances": multiple_now,
                "instances": instances,
            })
        except Exception as e:
            await log_event(
                f"Backend instance heartbeat error: {type(e).__name__}: {e}",
                SEVERITY_ERROR,
            )
        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    host_info = _get_host_info()
    parts = ["Application starting, database connected"]
    if host_info.get("hostname"):
        parts.append(f"hostname={host_info['hostname']}")
    if host_info.get("os"):
        parts.append(f"os={host_info['os']}")
    if host_info.get("host_ip"):
        parts.append(f"host_ip={host_info['host_ip']}")
    await log_event("; ".join(parts), SEVERITY_NOTICE)
    await log_event("Running migrations", SEVERITY_DEBUG)
    try:
        await run_migrations()
    except Exception as e:
        await log_event(
            f"Migrations failed: {type(e).__name__}: {e}",
            SEVERITY_ERROR,
        )
        raise
    await log_event("Migrations complete", SEVERITY_DEBUG)
    await run_startup_cleanup()
    await log_event("Starting job loop", SEVERITY_DEBUG)
    task = asyncio.create_task(run_job_loop())
    await log_event("Starting video progress drain loop", SEVERITY_DEBUG)
    progress_task = asyncio.create_task(_drain_video_progress_loop())
    transcode_task = asyncio.create_task(_transcode_progress_broadcast_loop())
    await log_event("Starting scheduler", SEVERITY_DEBUG)
    await start_scheduler()
    instance_id = uuid.uuid4()
    hostname = host_info.get("hostname")
    set_backend_instance(instance_id, hostname)
    await log_event("Starting backend instance heartbeat", SEVERITY_DEBUG)
    heartbeat_task = asyncio.create_task(_backend_instance_heartbeat_loop(instance_id, hostname))
    await log_event("System startup complete", SEVERITY_INFO)
    try:
        yield
    finally:
        # Log container shutdown with running job details (using existing logging system)
        try:
            running = await db.fetch(
                """SELECT job_queue_id, job_type, video_id, channel_id, status_message, status_percent_complete
                   FROM job_queue WHERE status = 'running' ORDER BY job_queue_id"""
            )
            count = len(running)
            if count == 0:
                msg = "Container stopping. 0 running jobs."
            else:
                parts = []
                for r in running:
                    s = f"id={r['job_queue_id']} type={r['job_type']!r} video_id={r['video_id']} channel_id={r['channel_id']}"
                    if r["status_message"]:
                        s += f" {r['status_message']}"
                    if r["status_percent_complete"] is not None:
                        s += f" ({r['status_percent_complete']}%)"
                    parts.append(s)
                details = "; ".join(parts)
                msg = f"Container stopping. {count} running job(s): {details}"
            await log_event(msg, SEVERITY_NOTICE)
        except Exception as e:
            await log_event(
                f"Container stopping (could not list running jobs: {type(e).__name__}: {e})",
                SEVERITY_NOTICE,
            )
        shutdown_scheduler()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        try:
            await db.execute("DELETE FROM backend_instances WHERE instance_id = $1", instance_id)
        except Exception as e:
            await log_event(
                f"Could not delete backend instance on shutdown: {type(e).__name__}: {e}",
                SEVERITY_NOTICE,
            )
        task.cancel()
        progress_task.cancel()
        transcode_task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        try:
            await progress_task
        except asyncio.CancelledError:
            pass
        try:
            await transcode_task
        except asyncio.CancelledError:
            pass
        await db.disconnect()


app = FastAPI(title="FlagShip YouTube", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(channels_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(queue_router, prefix="/api")
app.include_router(control_router, prefix="/api")
app.include_router(charged_errors_router, prefix="/api")
app.include_router(log_router, prefix="/api")
app.include_router(maintenance_router, prefix="/api")
app.include_router(status_router, prefix="/api")
app.include_router(scheduler_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/health")
async def api_health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    await broadcast_queue_update()  # send initial snapshot to new client
    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("type") == "watch_progress" and isinstance(msg.get("video_id"), int):
                    progress_seconds = int(msg.get("progress_seconds", 0))
                    progress_percent = float(msg.get("progress_percent", 0))
                    await _save_watch_progress(msg["video_id"], progress_seconds, progress_percent)
            except (json.JSONDecodeError, ValueError, TypeError) as e:
                await log_event(
                    f"WebSocket invalid message: error={type(e).__name__}: {e} payload_trimmed={repr(text[:500])}",
                    SEVERITY_ERROR,
                )
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
