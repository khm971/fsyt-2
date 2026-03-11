"""Tags REST API: tag master CRUD, search; user-scoped with system tags."""
from fastapi import APIRouter, HTTPException, Query

from database import db
from api.schemas import TagCreate, TagUpdate, TagResponse
from log_helper import log_event, SEVERITY_DEBUG, SEVERITY_INFO

USER_ID = 1  # No login; assume single user

router = APIRouter(prefix="/tags", tags=["tags"])

SYSTEM_TAG_TITLES = ("Favorite", "Needs Review", "Watch List")
DEFAULT_FG = "#f3f4f6"
DEFAULT_BG = "#111827"


async def ensure_system_tags() -> None:
    """Insert system tags for USER_ID if missing (idempotent)."""
    for title in SYSTEM_TAG_TITLES:
        await db.execute(
            """INSERT INTO tag (user_id, title, bg_color, fg_color, is_system)
               VALUES ($1, $2, $3, $4, TRUE)
               ON CONFLICT (user_id, LOWER(title)) DO NOTHING""",
            USER_ID,
            title,
            DEFAULT_BG,
            DEFAULT_FG,
        )


def row_to_tag(r) -> TagResponse:
    return TagResponse(
        tag_id=r["tag_id"],
        user_id=r["user_id"],
        title=r["title"],
        bg_color=r["bg_color"],
        fg_color=r["fg_color"],
        icon_before=r["icon_before"],
        icon_after=r["icon_after"],
        is_system=r["is_system"] or False,
        video_count=r.get("video_count"),
    )


@router.get("", response_model=list[TagResponse])
async def list_tags():
    """List all tags for the current user."""
    await ensure_system_tags()
    rows = await db.fetch(
        """SELECT tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system
           FROM tag WHERE user_id = $1 ORDER BY title""",
        USER_ID,
    )
    return [row_to_tag(r) for r in rows]


@router.get("/search", response_model=list[TagResponse])
async def search_tags(q: str = Query(..., min_length=1)):
    """Typeahead: filter tags by title substring (case-insensitive)."""
    await ensure_system_tags()
    pattern = f"%{q.strip()}%"
    rows = await db.fetch(
        """SELECT tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system
           FROM tag WHERE user_id = $1 AND title ILIKE $2 ORDER BY title""",
        USER_ID,
        pattern,
    )
    return [row_to_tag(r) for r in rows]


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(tag_id: int):
    """Get a single tag by id (must belong to current user)."""
    r = await db.fetchrow(
        """SELECT t.tag_id, t.user_id, t.title, t.bg_color, t.fg_color, t.icon_before, t.icon_after, t.is_system,
                  (SELECT COUNT(*) FROM video_tag vt WHERE vt.tag_id = t.tag_id)::int AS video_count
           FROM tag t WHERE t.tag_id = $1 AND t.user_id = $2""",
        tag_id,
        USER_ID,
    )
    if not r:
        raise HTTPException(404, "Tag not found")
    return row_to_tag(r)


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(body: TagCreate):
    """Create a new tag for the current user."""
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Title is required")
    bg = body.bg_color or DEFAULT_BG
    fg = body.fg_color or DEFAULT_FG
    r = await db.fetchrow(
        """INSERT INTO tag (user_id, title, bg_color, fg_color, icon_before, icon_after, is_system)
           VALUES ($1, $2, $3, $4, $5, $6, FALSE)
           RETURNING tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system""",
        USER_ID,
        title,
        bg,
        fg,
        body.icon_before,
        body.icon_after,
    )
    await log_event(f"Tag created: {title} (tag_id={r['tag_id']})", SEVERITY_DEBUG)
    return row_to_tag(r)


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(tag_id: int, body: TagUpdate):
    """Update tag; system tags cannot have title changed."""
    r = await db.fetchrow(
        """SELECT tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system
           FROM tag WHERE tag_id = $1 AND user_id = $2""",
        tag_id,
        USER_ID,
    )
    if not r:
        raise HTTPException(404, "Tag not found")
    updates = []
    values = []
    i = 1
    if body.title is not None and not r["is_system"]:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "Title cannot be empty")
        updates.append(f"title = ${i}")
        values.append(title)
        i += 1
    if body.bg_color is not None:
        updates.append(f"bg_color = ${i}")
        values.append(body.bg_color)
        i += 1
    if body.fg_color is not None:
        updates.append(f"fg_color = ${i}")
        values.append(body.fg_color)
        i += 1
    data = body.model_dump(exclude_unset=True)
    if "icon_before" in data:
        updates.append(f"icon_before = ${i}")
        values.append(body.icon_before)
        i += 1
    if "icon_after" in data:
        updates.append(f"icon_after = ${i}")
        values.append(body.icon_after)
        i += 1
    if not updates:
        return row_to_tag(r)
    values.append(tag_id)
    row = await db.fetchrow(
        f"""UPDATE tag SET {", ".join(updates)} WHERE tag_id = ${i} AND user_id = {USER_ID}
            RETURNING tag_id, user_id, title, bg_color, fg_color, icon_before, icon_after, is_system""",
        *values,
    )
    await log_event(f"Tag updated: tag_id={tag_id} ({r['title']})", SEVERITY_DEBUG)
    return row_to_tag(row)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(tag_id: int):
    """Delete a tag (and its video_tag links). Not allowed for system tags."""
    r = await db.fetchrow(
        "SELECT tag_id, title, is_system FROM tag WHERE tag_id = $1 AND user_id = $2",
        tag_id,
        USER_ID,
    )
    if not r:
        raise HTTPException(404, "Tag not found")
    if r["is_system"]:
        raise HTTPException(400, "System tags cannot be deleted")
    await db.execute("DELETE FROM tag WHERE tag_id = $1", tag_id)
    await log_event(f"Tag deleted: {r['title']} (tag_id={tag_id})", SEVERITY_INFO)
