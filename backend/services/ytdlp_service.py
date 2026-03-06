"""Sync yt-dlp: video metadata and channel playlist extraction."""
import os
from datetime import datetime
import yt_dlp
from services.tools import get_media_root, sanitize_string_for_disk_path


def get_video_info(provider_key: str, quiet: bool = True):
    """
    Returns (info_dict, error_message). info_dict is None on failure.
    """
    video_url = f"https://www.youtube.com/watch?v={provider_key}"
    ydl_opts = {"quiet": quiet, "no_warnings": quiet}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            if not info:
                return None, "No info returned"
            info["fsyt_channel_name"] = (info.get("channel") or "Unknown Channel").replace("/", "_")
            upload_date_str = info.get("upload_date") or "20240101"
            try:
                info["fsyt_upload_date"] = datetime.strptime(upload_date_str, "%Y%m%d")
            except ValueError:
                info["fsyt_upload_date"] = datetime(2024, 1, 1)
            info["fsyt_upload_year"] = info["fsyt_upload_date"].strftime("%Y")
            info["fsyt_video_title_safe"] = sanitize_string_for_disk_path(info.get("title") or "Unknown Title")
            info["fsyt_channel_name_safe"] = sanitize_string_for_disk_path(info["fsyt_channel_name"])
            info["fsyt_upload_date_formatted"] = info["fsyt_upload_date"].strftime("%Y-%m-%d")
            root = get_media_root()
            info["fsyt_final_path"] = os.path.join(
                root,
                info["fsyt_channel_name_safe"],
                f"Season {info['fsyt_upload_year']}",
                info["fsyt_upload_date_formatted"] + " " + info["fsyt_video_title_safe"],
            )
            return info, None
    except Exception as e:
        return None, str(e)


def get_channel_videos(channel_handle: str, start: int = 1, end: int = 10, quiet: bool = True):
    """
    Returns (entries_list, error). entries_list is list of dicts with id, title, upload_date, duration; or None on failure.
    """
    if channel_handle.startswith("@"):
        channel_url = f"https://www.youtube.com/{channel_handle}/videos"
    elif "youtube.com" in channel_handle:
        channel_url = channel_handle.rstrip("/") + "/videos"
    else:
        channel_url = f"https://www.youtube.com/@{channel_handle}/videos"
    ydl_opts = {
        "extract_flat": "in_playlist",
        "quiet": quiet,
        "ignoreerrors": True,
        "playlist_items": f"{start}-{end}",
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            channel_info = ydl.extract_info(channel_url, download=False)
            entries = channel_info.get("entries") or []
            return [e for e in entries if e], None
    except Exception as e:
        return None, str(e)
