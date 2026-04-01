"""Channel REST API."""
from fastapi import APIRouter, HTTPException, Query, Request

from database import db
from api.schemas import ChannelCreate, ChannelUpdate, ChannelResponse
from log_helper import log_event, SEVERITY_INFO, SEVERITY_DEBUG

router = APIRouter(prefix="/channels", tags=["channels"])


def _escape_ilike(term: str) -> str:
    """Escape % and _ for safe use in ILIKE pattern (use ESCAPE '\\' in SQL)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def row_to_channel(r) -> ChannelResponse:
    return ChannelResponse(
        channel_id=r["channel_id"],
        provider_key=r["provider_key"],
        record_created=r["record_created"],
        record_updated=r["record_updated"],
        handle=r["handle"],
        title=r["title"],
        url=r["url"],
        thumbnail=r["thumbnail"],
        banner=r["banner"],
        author=r["author"],
        description=r["description"],
        is_enabled_for_auto_download=r["is_enabled_for_auto_download"] or False,
        folder_on_disk=r["folder_on_disk"],
        video_count=r.get("video_count"),
        video_count_done=r.get("video_count_done"),
        created_by_user_id=r.get("created_by_user_id"),
        created_by_username=r.get("created_by_username"),
    )


@router.get("", response_model=list[ChannelResponse])
async def list_channels(
    sort_by: str = Query("id", pattern="^(id|title|status|video_count|record_created)$"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    title_contains: str | None = Query(None),
    is_enabled_for_auto_download: bool | None = Query(None),
):
    title_term = (title_contains or "").strip() or None
    where_parts: list[str] = []
    params: list = []
    pi = 1
    if title_term:
        pat = f"%{_escape_ilike(title_term)}%"
        where_parts.append(
            f"(COALESCE(c.title, '') ILIKE ${pi} ESCAPE E'\\\\' OR COALESCE(c.handle, '') ILIKE ${pi} ESCAPE E'\\\\')"
        )
        params.append(pat)
        pi += 1
    if is_enabled_for_auto_download is True:
        where_parts.append("c.is_enabled_for_auto_download IS TRUE")
    elif is_enabled_for_auto_download is False:
        where_parts.append("c.is_enabled_for_auto_download IS NOT TRUE")
    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    if title_term or is_enabled_for_auto_download is not None:
        await log_event(
            f"Channel list filters: title_contains={bool(title_term)} auto_download={is_enabled_for_auto_download!r}",
            SEVERITY_DEBUG,
        )

    video_total_sub = (
        "(SELECT COUNT(*) FROM video v WHERE v.channel_id = c.channel_id AND (v.is_ignore IS NOT TRUE))::int"
    )
    video_available_sub = (
        "(SELECT COUNT(*) FROM video v WHERE v.channel_id = c.channel_id AND (v.is_ignore IS NOT TRUE) AND v.status = 'available')::int"
    )
    col = {
        "id": "c.channel_id",
        "title": "c.title",
        "status": video_available_sub,
        "video_count": video_total_sub,
        "record_created": "c.record_created",
    }[sort_by]
    dirn = "ASC" if sort_order == "asc" else "DESC"
    rows = await db.fetch(
        f"""SELECT c.channel_id, c.provider_key, c.record_created, c.record_updated,
                  c.handle, c.title, c.url, c.thumbnail, c.banner, c.author, c.description,
                  c.is_enabled_for_auto_download, c.folder_on_disk,
                  {video_total_sub} AS video_count,
                  {video_available_sub} AS video_count_done,
                  c.created_by_user_id, u.username AS created_by_username
           FROM channel c
           LEFT JOIN app_user u ON c.created_by_user_id = u.user_id
           {where_sql}
           ORDER BY {col} {dirn}""",
        *params,
    )
    return [row_to_channel(r) for r in rows]


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_channel(channel_id: int):
    r = await db.fetchrow(
        """SELECT c.channel_id, c.provider_key, c.record_created, c.record_updated,
                  c.handle, c.title, c.url, c.thumbnail, c.banner, c.author, c.description,
                  c.is_enabled_for_auto_download, c.folder_on_disk,
                  (SELECT COUNT(*) FROM video v WHERE v.channel_id = c.channel_id AND (v.is_ignore IS NOT TRUE))::int AS video_count,
                  (SELECT COUNT(*) FROM video v WHERE v.channel_id = c.channel_id AND (v.is_ignore IS NOT TRUE) AND v.status = 'available')::int AS video_count_done,
                  c.created_by_user_id, u.username AS created_by_username
           FROM channel c
           LEFT JOIN app_user u ON c.created_by_user_id = u.user_id
           WHERE c.channel_id = $1""",
        channel_id,
    )
    if not r:
        raise HTTPException(404, "Channel not found")
    return row_to_channel(r)


@router.post("", response_model=ChannelResponse, status_code=201)
async def create_channel(request: Request, body: ChannelCreate):
    user_id = getattr(request.state, "user_id", None)
    row = await db.fetchrow(
        """INSERT INTO channel (
            provider_key, handle, title, url, thumbnail, banner, author,
            description, is_enabled_for_auto_download, folder_on_disk, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING channel_id, provider_key, record_created, record_updated,
                  handle, title, url, thumbnail, banner, author, description,
                  is_enabled_for_auto_download, folder_on_disk""",
        body.provider_key,
        body.handle,
        body.title,
        body.url,
        body.thumbnail,
        body.banner,
        body.author,
        body.description,
        body.is_enabled_for_auto_download,
        body.folder_on_disk,
        user_id,
    )
    await log_event(f"Channel created: {body.title or body.handle or body.provider_key} (channel_id={row['channel_id']})", SEVERITY_INFO, channel_id=row["channel_id"], user_id=user_id)
    return row_to_channel(row)


@router.patch("/{channel_id}", response_model=ChannelResponse)
async def update_channel(request: Request, channel_id: int, body: ChannelUpdate):
    # Build dynamic update from provided fields
    updates = []
    values = []
    i = 1
    if body.provider_key is not None:
        updates.append(f"provider_key = ${i}")
        values.append(body.provider_key)
        i += 1
    if body.handle is not None:
        updates.append(f"handle = ${i}")
        values.append(body.handle)
        i += 1
    if body.title is not None:
        updates.append(f"title = ${i}")
        values.append(body.title)
        i += 1
    if body.url is not None:
        updates.append(f"url = ${i}")
        values.append(body.url)
        i += 1
    if body.thumbnail is not None:
        updates.append(f"thumbnail = ${i}")
        values.append(body.thumbnail)
        i += 1
    if body.banner is not None:
        updates.append(f"banner = ${i}")
        values.append(body.banner)
        i += 1
    if body.author is not None:
        updates.append(f"author = ${i}")
        values.append(body.author)
        i += 1
    if body.description is not None:
        updates.append(f"description = ${i}")
        values.append(body.description)
        i += 1
    if body.is_enabled_for_auto_download is not None:
        updates.append(f"is_enabled_for_auto_download = ${i}")
        values.append(body.is_enabled_for_auto_download)
        i += 1
    if body.folder_on_disk is not None:
        updates.append(f"folder_on_disk = ${i}")
        values.append(body.folder_on_disk)
        i += 1
    if not updates:
        return await get_channel(channel_id)
    updates.append("record_updated = NOW()")
    values.append(channel_id)
    r = await db.fetchrow(
        f"""UPDATE channel SET {", ".join(updates)}
            WHERE channel_id = ${i}
            RETURNING channel_id, provider_key, record_created, record_updated,
                      handle, title, url, thumbnail, banner, author, description,
                      is_enabled_for_auto_download, folder_on_disk""",
        *values,
    )
    if not r:
        raise HTTPException(404, "Channel not found")
    user_id = getattr(request.state, "user_id", None)
    await log_event(f"Channel updated: {r['title'] or r['handle']} (channel_id={channel_id})", SEVERITY_INFO, channel_id=channel_id, user_id=user_id)
    return row_to_channel(r)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(request: Request, channel_id: int):
    r = await db.fetchrow("SELECT title, handle FROM channel WHERE channel_id = $1", channel_id)
    await db.execute("DELETE FROM channel WHERE channel_id = $1", channel_id)
    if r:
        user_id = getattr(request.state, "user_id", None)
        await log_event(f"Channel deleted: {r['title'] or r['handle']} (channel_id={channel_id})", SEVERITY_INFO, channel_id=channel_id, user_id=user_id)
