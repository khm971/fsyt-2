"""Charged errors REST API (rate/lockout)."""
from fastapi import APIRouter, HTTPException, Query

from database import db
from api.schemas import ChargedErrorResponse

router = APIRouter(prefix="/charged_errors", tags=["charged_errors"])


@router.get("", response_model=list[ChargedErrorResponse])
async def list_charged_errors(
    limit: int = Query(50, le=200),
    dismissed: bool | None = Query(None),
):
    q = """SELECT charged_error_id, error_date, error_code, message, is_dismissed
           FROM charged_error WHERE 1=1"""
    params = []
    i = 1
    if dismissed is not None:
        q += f" AND is_dismissed = ${i}"
        params.append(dismissed)
        i += 1
    q += f" ORDER BY error_date DESC LIMIT ${i}"
    params.append(limit)
    rows = await db.fetch(q, *params)
    return [
        ChargedErrorResponse(
            charged_error_id=r["charged_error_id"],
            error_date=r["error_date"],
            error_code=r["error_code"],
            message=r["message"],
            is_dismissed=r["is_dismissed"] or False,
        )
        for r in rows
    ]


@router.post("/{charged_error_id}/dismiss", response_model=ChargedErrorResponse)
async def dismiss_charged_error(charged_error_id: int):
    r = await db.fetchrow(
        """UPDATE charged_error SET is_dismissed = TRUE WHERE charged_error_id = $1
           RETURNING charged_error_id, error_date, error_code, message, is_dismissed""",
        charged_error_id,
    )
    if not r:
        raise HTTPException(404, "Charged error not found")
    return ChargedErrorResponse(
        charged_error_id=r["charged_error_id"],
        error_date=r["error_date"],
        error_code=r["error_code"],
        message=r["message"],
        is_dismissed=r["is_dismissed"],
    )
