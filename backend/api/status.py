"""Status API for dashboard widgets."""
from fastapi import APIRouter

from api.videos import get_active_transcodes
from websocket_manager import ws_manager

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
async def get_status():
    """Return transcodes and websocket connection count for dashboard."""
    transcodes = await get_active_transcodes()
    websocket_connections = await ws_manager.connection_count()
    return {
        "transcodes": transcodes,
        "websocket_connections": websocket_connections,
    }
