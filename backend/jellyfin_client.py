"""Sync HTTP client for Jellyfin server: system info, users, libraries.
Uses requests; run get_jellyfin_status() via asyncio.to_thread from async routes.
"""
import os
import requests

JELLYFIN_TIMEOUT = 10
# Longer timeout for library items (multiple paginated requests; server may be remote or slow)
JELLYFIN_LIBRARY_TIMEOUT = 60
DEFAULT_JELLYFIN_URL = "https://jellyfin.snake-lime.ts.net"
DEFAULT_JELLYFIN_API_KEY = "f620426bb7fd4d79ae155f21c6dd2c29"
DEFAULT_JELLYFIN_PATH_PREFIX = "/data/fsyt2/"


def _get_config():
    base = (os.environ.get("JELLYFIN_URL") or DEFAULT_JELLYFIN_URL).rstrip("/")
    api_key = os.environ.get("JELLYFIN_API_KEY") or DEFAULT_JELLYFIN_API_KEY
    return base, api_key


def _get_path_prefix():
    """Prefix to strip from Jellyfin Path to get path comparable to video.file_path. No trailing slash."""
    return (os.environ.get("JELLYFIN_PATH_PREFIX") or DEFAULT_JELLYFIN_PATH_PREFIX).rstrip("/")


def _normalize_jellyfin_path(path, path_prefix):
    """Strip path_prefix from path, normalize slashes, remove leading slash. Returns None if no path or prefix doesn't match."""
    if not path or not isinstance(path, str):
        return None
    path = path.replace("\\", "/").strip()
    if not path_prefix or not path.startswith(path_prefix):
        return None
    remainder = path[len(path_prefix) :].lstrip("/")
    return remainder if remainder else None


def _headers(api_key):
    return {
        "X-Emby-Token": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def get_jellyfin_status():
    """Call Jellyfin API for system info, users, and libraries. Returns a single dict.
    On any error returns connected=False and error=<message>; never raises.
    """
    base, api_key = _get_config()
    result = {
        "connected": False,
        "error": None,
        "server_name": None,
        "server_version": None,
        "operating_system": None,
        "libraries": [],
        "users": [],
        "sessions_count": None,
    }
    headers = _headers(api_key)

    def get_json(path):
        r = requests.get(f"{base}{path}", headers=headers, timeout=JELLYFIN_TIMEOUT)
        r.raise_for_status()
        return r.json()

    try:
        # System info: try authenticated first, fallback to public on 403
        try:
            info = get_json("/System/Info")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 403:
                info = get_json("/System/Info/Public")
            else:
                raise
        result["server_name"] = info.get("ServerName") or info.get("Name")
        result["server_version"] = info.get("Version")
        result["operating_system"] = info.get("OperatingSystem")
        result["connected"] = True
    except requests.RequestException as e:
        result["error"] = _error_message(e)
        return result
    except Exception as e:
        result["error"] = str(e) if str(e) else f"{type(e).__name__}"
        return result

    # Users
    try:
        users = get_json("/Users")
        result["users"] = [
            {"id": u.get("Id"), "name": u.get("Name"), "policy": u.get("Policy") is not None}
            for u in (users if isinstance(users, list) else [])
        ]
    except requests.RequestException as e:
        result["error"] = result["error"] or _error_message(e)
        if not result["error"]:
            result["error"] = f"Users: {_error_message(e)}"
        return result

    # Libraries (VirtualFolders)
    try:
        folders = get_json("/Library/VirtualFolders")
        result["libraries"] = [
            {
                "name": f.get("Name"),
                "item_id": f.get("ItemId"),
                "locations": f.get("Locations") or [],
                "collection_type": f.get("CollectionType"),
            }
            for f in (folders if isinstance(folders, list) else [])
        ]
    except requests.RequestException as e:
        if result["connected"]:
            result["libraries"] = []
            result["error"] = f"Libraries: {_error_message(e)}"
        else:
            result["error"] = result["error"] or _error_message(e)
        return result

    # Sessions (optional)
    try:
        sessions = get_json("/Sessions")
        result["sessions_count"] = len(sessions) if isinstance(sessions, list) else 0
    except requests.RequestException:
        result["sessions_count"] = None

    return result


def _ticks_to_display(ticks):
    """Convert Jellyfin RunTimeTicks (10_000_000 per second) to 'X min' or 'X h Y min'."""
    if ticks is None or ticks <= 0:
        return None
    total_seconds = int(ticks) // 10_000_000
    if total_seconds < 60:
        return f"{total_seconds} s"
    minutes = total_seconds // 60
    seconds_rem = total_seconds % 60
    if minutes < 60:
        return f"{minutes} min" if seconds_rem == 0 else f"{minutes} min {seconds_rem} s"
    hours = minutes // 60
    mins_rem = minutes % 60
    if mins_rem == 0:
        return f"{hours} h"
    return f"{hours} h {mins_rem} min"


def get_jellyfin_library_items(library_name="FSYT-2"):
    """Fetch all items (videos) from a Jellyfin library by name. Returns { items, error }.
    Items are summary objects: id, name, type, production_year, runtime_display, overview, series_name, path, normalized_path.
    On error returns items=[] and error=<message>; never raises.
    """
    base, api_key = _get_config()
    path_prefix = _get_path_prefix()
    result = {"items": [], "error": None}
    headers = _headers(api_key)

    def get_json(path):
        r = requests.get(f"{base}{path}", headers=headers, timeout=JELLYFIN_LIBRARY_TIMEOUT)
        r.raise_for_status()
        return r.json()

    try:
        folders = get_json("/Library/VirtualFolders")
        folders_list = folders if isinstance(folders, list) else []
        library = None
        name_lower = (library_name or "").strip().lower()
        for f in folders_list:
            if (f.get("Name") or "").strip().lower() == name_lower:
                library = f
                break
        if not library:
            result["error"] = f"Library '{library_name or 'FSYT-2'}' not found"
            return result

        parent_id = library.get("ItemId")
        if not parent_id:
            result["error"] = f"Library '{library_name}' has no ItemId"
            return result

        items = []
        start_index = 0
        limit = 100
        while True:
            path = f"/Items?ParentId={parent_id}&Recursive=true&Limit={limit}&StartIndex={start_index}&Fields=Path"
            resp = get_json(path)
            total = resp.get("TotalRecordCount", 0)
            page_items = resp.get("Items") or []
            for it in page_items:
                raw_path = it.get("Path")
                normalized_path = _normalize_jellyfin_path(raw_path, path_prefix)
                if raw_path and "_transcodes" in raw_path.replace("\\", "/"):
                    continue
                if normalized_path and "_transcodes" in normalized_path:
                    continue
                items.append({
                    "id": it.get("Id"),
                    "name": it.get("Name"),
                    "type": it.get("Type"),
                    "production_year": it.get("ProductionYear"),
                    "runtime_display": _ticks_to_display(it.get("RunTimeTicks") or it.get("CumulativeRunTimeTicks")),
                    "overview": it.get("Overview"),
                    "series_name": it.get("SeriesName"),
                    "path": raw_path,
                    "normalized_path": normalized_path,
                })
            if not page_items or len(page_items) < limit or start_index + len(page_items) >= total:
                break
            start_index += limit

        result["items"] = items
        return result
    except requests.RequestException as e:
        result["error"] = _error_message(e)
        return result
    except Exception as e:
        result["error"] = str(e) if str(e) else f"{type(e).__name__}"
        return result


def get_jellyfin_item_watch_status(jellyfin_item_id, jellyfin_username="khm"):
    """Fetch watch status for one Jellyfin item for the given Jellyfin user. Returns { started, progress_seconds, progress_percent, play_count } or { error: "<message>" }. Never raises."""
    base, api_key = _get_config()
    result = {"started": False, "progress_seconds": 0, "progress_percent": 0.0, "play_count": 0}
    headers = _headers(api_key)

    def get_json(path, timeout=15):
        r = requests.get(f"{base}{path}", headers=headers, timeout=timeout)
        r.raise_for_status()
        return r.json()

    try:
        if not (jellyfin_item_id or str(jellyfin_item_id).strip()):
            return {"error": "Missing item id"}
        item_id = str(jellyfin_item_id).strip()
        users = get_json("/Users")
        users_list = users if isinstance(users, list) else []
        uname_lower = (jellyfin_username or "khm").strip().lower()
        jellyfin_user_id = None
        for u in users_list:
            if (u.get("Name") or "").strip().lower() == uname_lower:
                jellyfin_user_id = u.get("Id")
                break
        if not jellyfin_user_id:
            return {"error": f"Jellyfin user '{jellyfin_username or 'khm'}' not found"}
        path = f"/Users/{jellyfin_user_id}/Items?Ids={item_id}&Fields=UserData,RunTimeTicks,CumulativeRunTimeTicks"
        resp = get_json(path)
        items = resp.get("Items") or []
        if not items:
            return {"error": "Item not found"}
        it = items[0]
        ud = it.get("UserData") or {}
        if not isinstance(ud, dict):
            return result
        pos_ticks = ud.get("PlaybackPositionTicks") or 0
        play_count = int(ud.get("PlayCount") or 0)
        runtime_ticks = it.get("RunTimeTicks") or it.get("CumulativeRunTimeTicks") or 0
        progress_seconds = int(pos_ticks) // 10_000_000
        progress_percent = (100.0 * int(pos_ticks) / int(runtime_ticks)) if runtime_ticks else 0.0
        started = pos_ticks > 0 or play_count > 0
        result["started"] = bool(started)
        result["progress_seconds"] = progress_seconds
        result["progress_percent"] = round(progress_percent, 1)
        result["play_count"] = play_count
        return result
    except requests.RequestException as e:
        return {"error": _error_message(e)}
    except Exception as e:
        return {"error": str(e) if str(e) else f"{type(e).__name__}"}


def _error_message(e):
    if e is None:
        return "Unknown error"
    if isinstance(e, requests.Timeout):
        return "Connection timed out"
    if isinstance(e, requests.ConnectionError):
        return "Connection failed (server unreachable or SSL error)"
    if hasattr(e, "response") and e.response is not None:
        try:
            body = e.response.json()
            msg = body.get("message") or body.get("Message") or body.get("detail")
            if msg:
                return str(msg)
        except Exception:
            pass
        return f"HTTP {e.response.status_code}"
    return str(e) if str(e) else f"{type(e).__name__}"
