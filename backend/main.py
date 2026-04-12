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

import sys


def _require_positive_server_instance_id() -> int:
    raw = os.environ.get("SERVER_INSTANCE_ID")
    if raw is None or str(raw).strip() == "":
        print(
            "FATAL: SERVER_INSTANCE_ID must be set in the environment (.env). "
            "Use a unique positive integer per running backend process (e.g. 1).",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        n = int(str(raw).strip(), 10)
    except ValueError:
        print(
            "FATAL: SERVER_INSTANCE_ID must be a positive integer.",
            file=sys.stderr,
        )
        sys.exit(1)
    if n < 1:
        print(
            "FATAL: SERVER_INSTANCE_ID must be a positive integer.",
            file=sys.stderr,
        )
        sys.exit(1)
    return n


SERVER_INSTANCE_ID = _require_positive_server_instance_id()

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
from api.tags import router as tags_router
from api.videos import router as videos_router, _save_watch_progress, get_active_transcodes
from api.queue import router as queue_router
from api.control import router as control_router
from api.charged_errors import router as charged_errors_router
from api.log import router as log_router
from api.maintenance import router as maintenance_router
from api.status import router as status_router
from api.scheduler import router as scheduler_router
from api.information import router as information_router
from api.jellyfin import router as jellyfin_router
from api.users import router as users_router
from api.server_instances import router as server_instances_router
from session import SessionMiddleware, get_user_id_from_scope
from scheduler_service import start_scheduler, shutdown_scheduler
from startup_cleanup import run_startup_cleanup
from backend_instance_context import configure_server_instance_id, set_backend_instance

configure_server_instance_id(SERVER_INSTANCE_ID)


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


async def _backend_instance_heartbeat_loop(
    session_instance_id: uuid.UUID,
    hostname: str | None,
    server_instance_id: int,
):
    """Register this backend session, detect duplicate numeric SERVER_INSTANCE_ID, pause only conflicting instances."""
    previous_duplicate_numeric_ids: set[int] = set()
    while True:
        try:
            await db.execute(
                """INSERT INTO backend_instances (instance_id, hostname, last_heartbeat_utc, server_instance_id)
                   VALUES ($1, $2, NOW(), $3)
                   ON CONFLICT (instance_id) DO UPDATE SET
                     hostname = EXCLUDED.hostname,
                     last_heartbeat_utc = NOW(),
                     server_instance_id = EXCLUDED.server_instance_id""",
                session_instance_id,
                hostname or "",
                server_instance_id,
            )
            await db.execute(
                """DELETE FROM backend_instances
                   WHERE last_heartbeat_utc < NOW() - INTERVAL '1 minute'"""
            )
            dup_rows = await db.fetch(
                """SELECT server_instance_id, COUNT(*) AS n FROM backend_instances
                   WHERE last_heartbeat_utc > NOW() - INTERVAL '30 seconds'
                   GROUP BY server_instance_id
                   HAVING COUNT(*) > 1"""
            )
            duplicate_numeric_ids = {int(r["server_instance_id"]) for r in dup_rows}

            newly = duplicate_numeric_ids - previous_duplicate_numeric_ids
            cleared = previous_duplicate_numeric_ids - duplicate_numeric_ids
            for sid in newly:
                await set_control_value(f"instance_queue_paused_{sid}", "true")
                await log_event(
                    f"Duplicate backend processes detected for server_instance_id={sid}; queue paused for that instance only.",
                    SEVERITY_WARNING,
                )
                await broadcast_queue_update()
            for sid in cleared:
                await set_control_value(f"instance_queue_paused_{sid}", "false")
                await log_event(
                    f"Duplicate server_instance_id={sid} condition cleared.",
                    SEVERITY_NOTICE,
                )
                await broadcast_queue_update()
            previous_duplicate_numeric_ids = duplicate_numeric_ids

            my_duplicate = server_instance_id in duplicate_numeric_ids

            instances_rows = await db.fetch(
                """SELECT instance_id, server_instance_id, hostname, last_heartbeat_utc FROM backend_instances
                   WHERE last_heartbeat_utc > NOW() - INTERVAL '30 seconds'
                   ORDER BY last_heartbeat_utc DESC"""
            )
            instances = [
                {
                    "instance_id": str(r["instance_id"]),
                    "server_instance_id": int(r["server_instance_id"]),
                    "hostname": r["hostname"] or "",
                    "last_heartbeat_utc": r["last_heartbeat_utc"].isoformat() if r["last_heartbeat_utc"] else None,
                }
                for r in instances_rows
            ]
            await ws_manager.broadcast(
                {
                    "type": "multi_instance_status",
                    "duplicate_server_instance_id": my_duplicate,
                    "duplicate_numeric_ids": sorted(duplicate_numeric_ids),
                    "this_server_instance_id": server_instance_id,
                    "instances": instances,
                }
            )
            # Keep dashboard cluster view (instances_summary / is_running) in sync when other workers
            # heartbeats change; multi_instance_status alone does not update queueSummary on the client.
            await broadcast_queue_update()
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
    row_si = await db.fetchrow(
        "SELECT server_instance_id FROM server_instance WHERE server_instance_id = $1",
        SERVER_INSTANCE_ID,
    )
    if not row_si:
        await db.disconnect()
        print(
            f"FATAL: No server_instance row for SERVER_INSTANCE_ID={SERVER_INSTANCE_ID}. "
            "Add this instance in Admin → Server instances before starting.",
            file=sys.stderr,
        )
        sys.exit(1)
    await run_startup_cleanup()
    await log_event("Starting job loop", SEVERITY_DEBUG)
    task = asyncio.create_task(run_job_loop())
    await log_event("Starting video progress drain loop", SEVERITY_DEBUG)
    progress_task = asyncio.create_task(_drain_video_progress_loop())
    transcode_task = asyncio.create_task(_transcode_progress_broadcast_loop())
    await log_event("Starting scheduler", SEVERITY_DEBUG)
    await start_scheduler()
    session_instance_id = uuid.uuid4()
    hostname = host_info.get("hostname")
    set_backend_instance(session_instance_id, hostname, SERVER_INSTANCE_ID)
    await log_event("Starting backend instance heartbeat", SEVERITY_DEBUG)
    heartbeat_task = asyncio.create_task(
        _backend_instance_heartbeat_loop(session_instance_id, hostname, SERVER_INSTANCE_ID)
    )
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
                    s = f"id={r['job_queue_id']} type={r['job_type']!r} video_id={r['video_id']}"
                    if r.get("channel_id") is not None:
                        s += f" channel_id={r['channel_id']}"
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
            await db.execute("DELETE FROM backend_instances WHERE instance_id = $1", session_instance_id)
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
app.add_middleware(SessionMiddleware)

app.include_router(channels_router, prefix="/api")
app.include_router(tags_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(queue_router, prefix="/api")
app.include_router(control_router, prefix="/api")
app.include_router(charged_errors_router, prefix="/api")
app.include_router(log_router, prefix="/api")
app.include_router(maintenance_router, prefix="/api")
app.include_router(status_router, prefix="/api")
app.include_router(scheduler_router, prefix="/api")
app.include_router(information_router, prefix="/api")
app.include_router(jellyfin_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(server_instances_router, prefix="/api")


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
                    user_id = get_user_id_from_scope(websocket.scope)
                    await _save_watch_progress(msg["video_id"], progress_seconds, progress_percent, user_id)
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
