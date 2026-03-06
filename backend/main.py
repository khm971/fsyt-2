"""FSYT2 FastAPI app: REST API + WebSocket for queue updates."""
import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from database import db
from run_migrations import run_migrations
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_INFO
from job_processor import run_job_loop, broadcast_queue_update
from websocket_manager import ws_manager
from video_progress_bridge import drain as drain_video_progress
from api.channels import router as channels_router
from api.videos import router as videos_router, _save_watch_progress
from api.queue import router as queue_router
from api.control import router as control_router
from api.charged_errors import router as charged_errors_router
from api.log import router as log_router


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
        except Exception:
            pass
        await asyncio.sleep(0.2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await log_event("Application starting, database connected", SEVERITY_DEBUG)
    await log_event("Running migrations", SEVERITY_DEBUG)
    await run_migrations()
    await log_event("Migrations complete", SEVERITY_INFO)
    await log_event("Starting job loop", SEVERITY_DEBUG)
    task = asyncio.create_task(run_job_loop())
    await log_event("Starting video progress drain loop", SEVERITY_DEBUG)
    progress_task = asyncio.create_task(_drain_video_progress_loop())
    try:
        yield
    finally:
        task.cancel()
        progress_task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        try:
            await progress_task
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
            except (json.JSONDecodeError, ValueError, TypeError):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
