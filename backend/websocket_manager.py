"""Broadcast queue/job updates to connected WebSocket clients."""
import asyncio
import json
from typing import Set

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def connection_count(self) -> int:
        async with self._lock:
            return len(self._connections)

    async def broadcast(self, message: dict) -> None:
        if not self._connections:
            return
        text = json.dumps(message)
        dead = set()
        async with self._lock:
            for ws in self._connections:
                try:
                    await ws.send_text(text)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self._connections.discard(ws)


ws_manager = ConnectionManager()
