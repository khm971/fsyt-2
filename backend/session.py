"""In-memory session store: session_id -> user_id. Middleware ensures every request has request.state.user_id."""
import uuid
from typing import Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

DEFAULT_USER_ID = 1  # Kevin
SESSION_COOKIE = "fsyt2_sid"

# session_id (str) -> user_id (int)
_session_store: Dict[str, int] = {}


def get_session_store() -> Dict[str, int]:
    return _session_store


def set_session_user(session_id: str, user_id: int) -> None:
    _session_store[session_id] = user_id


def get_user_id_from_scope(scope: dict) -> int:
    """Get user_id from session cookie in ASGI scope (e.g. WebSocket). Returns DEFAULT_USER_ID if missing/invalid."""
    store = get_session_store()
    cookie_header = None
    for name, value in scope.get("headers") or []:
        if name.lower() == b"cookie":
            cookie_header = value.decode("latin-1")
            break
    if not cookie_header:
        return DEFAULT_USER_ID
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(SESSION_COOKIE + "="):
            session_id = part[len(SESSION_COOKIE) + 1 :].strip()
            if session_id and session_id in store:
                return store[session_id]
            break
    return DEFAULT_USER_ID


class SessionMiddleware(BaseHTTPMiddleware):
    """Ensure request has session and request.state.user_id; set cookie when creating new session."""

    async def dispatch(self, request: Request, call_next):
        store = get_session_store()
        session_id = request.cookies.get(SESSION_COOKIE)
        set_cookie = False
        if not session_id or session_id not in store:
            session_id = str(uuid.uuid4())
            store[session_id] = DEFAULT_USER_ID
            set_cookie = True
        request.state.session_id = session_id
        request.state.user_id = store[session_id]
        response = await call_next(request)
        if set_cookie:
            response.set_cookie(
                SESSION_COOKIE,
                session_id,
                httponly=True,
                samesite="lax",
                path="/",
            )
        return response
