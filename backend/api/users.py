"""Current user (me), list users, and switch user. Session middleware must run first."""
from fastapi import APIRouter, Request, HTTPException

from database import db
from session import get_session_store, set_session_user
from log_helper import log_event, SEVERITY_INFO, SEVERITY_WARNING

router = APIRouter(tags=["users"])


@router.get("/me")
async def get_me(request: Request):
    """Return current user for the session. Frontend derives initials from firstname/lastname."""
    user_id = request.state.user_id
    row = await db.fetchrow(
        """SELECT user_id, username, firstname, lastname FROM app_user
           WHERE user_id = $1 AND is_enabled = TRUE""",
        user_id,
    )
    if not row:
        await log_event(
            f"GET /api/me: user_id={user_id} not found or disabled",
            SEVERITY_WARNING,
            user_id=user_id,
        )
        raise HTTPException(status_code=404, detail="User not found or disabled")
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "firstname": row["firstname"],
        "lastname": row["lastname"],
    }


@router.get("/users")
async def list_users(request: Request, enabled: bool = True):
    """List users; default only enabled. Used by Switch User modal."""
    if not enabled:
        rows = await db.fetch(
            """SELECT user_id, username, firstname, lastname FROM app_user ORDER BY username"""
        )
    else:
        rows = await db.fetch(
            """SELECT user_id, username, firstname, lastname FROM app_user
               WHERE is_enabled = TRUE ORDER BY username"""
        )
    return [
        {
            "user_id": r["user_id"],
            "username": r["username"],
            "firstname": r["firstname"],
            "lastname": r["lastname"],
        }
        for r in rows
    ]


@router.post("/switch-user")
async def switch_user(request: Request, body: dict):
    """Set session to the given user_id. User must exist and be enabled."""
    user_id = body.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=400, detail="user_id required")
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="user_id must be an integer")
    row = await db.fetchrow(
        """SELECT user_id, username, firstname, lastname FROM app_user
           WHERE user_id = $1 AND is_enabled = TRUE""",
        user_id,
    )
    if not row:
        await log_event(
            f"POST /api/switch-user: user_id={user_id} not found or disabled",
            SEVERITY_WARNING,
            user_id=user_id,
        )
        raise HTTPException(status_code=400, detail="User not found or disabled")
    session_id = request.state.session_id
    previous_user_id = request.state.user_id
    set_session_user(session_id, user_id)
    await log_event(
        f"User switch: session switched from user_id={previous_user_id} to user_id={user_id} ({row['username']})",
        SEVERITY_INFO,
        user_id=user_id,
    )
    return {"ok": True}
