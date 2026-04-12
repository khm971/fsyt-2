"""Status API for dashboard widgets."""
from fastapi import APIRouter

from api.videos import get_active_transcodes
from backend_instance_context import get_backend_instance
from websocket_manager import ws_manager

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
async def get_status():
    """Return transcodes, websocket connection count, and this process's server instance id."""
    transcodes = await get_active_transcodes()
    websocket_connections = await ws_manager.connection_count()
    _, _, server_instance_id = get_backend_instance()
    return {
        "transcodes": transcodes,
        "websocket_connections": websocket_connections,
        "server_instance_id": server_instance_id,
    }
