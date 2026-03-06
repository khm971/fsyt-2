"""Bridge for pushing video progress from sync (thread) code to WebSocket broadcast.
The download progress_hook runs in a thread and cannot call async broadcast directly.
This module provides a thread-safe queue; an async task drains it and broadcasts."""
import queue

_progress_queue: queue.Queue | None = None


def _get_queue() -> queue.Queue:
    global _progress_queue
    if _progress_queue is None:
        _progress_queue = queue.Queue()
    return _progress_queue


def put_progress(video_id: int, status: str, percent: float) -> None:
    """Thread-safe: called from sync code (e.g. download progress_hook)."""
    _get_queue().put_nowait((video_id, status, percent))


def drain() -> list[tuple[int, str, float]]:
    """Drain all pending progress updates. Safe to call from async (runs quickly)."""
    q = _get_queue()
    items = []
    try:
        while True:
            items.append(q.get_nowait())
    except queue.Empty:
        pass
    return items
