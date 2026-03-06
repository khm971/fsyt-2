"""Sync channel info via yt-dlp (channel page extraction)."""
import yt_dlp


def get_channel_info_by_url(channel_url: str):
    try:
        ydl_opts = {
            "quiet": True,
            "extract_flat": True,
            "no_warnings": False,
            "ignore_no_formats_error": True,
            "playlist_items": "0",
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            channel_info = ydl.extract_info(channel_url, download=False)
            if not channel_info:
                return None
            thumbnails = channel_info.get("thumbnails") or []
            banner = next((t for t in thumbnails if t.get("id") == "banner_uncropped"), None)
            avatar = next((t for t in thumbnails if t.get("id") == "avatar_uncropped"), None)
            return {
                "channel_id": channel_info.get("channel_id"),
                "channel": channel_info.get("channel"),
                "channel_url": channel_info.get("channel_url"),
                "uploader_id": channel_info.get("uploader_id"),
                "description": channel_info.get("description"),
                "banner_uncropped_url": banner.get("url") if banner else None,
                "avatar_uncropped_url": avatar.get("url") if avatar else None,
            }
    except Exception as e:
        print(f"Error getting channel info: {e}")
        return None


def get_channel_info_by_yt_channel_id(yt_channel_id: str):
    url = f"https://www.youtube.com/channel/{yt_channel_id}"
    return get_channel_info_by_url(url)


def get_channel_info_by_name(channel_name: str):
    if channel_name.startswith("@"):
        url = f"https://www.youtube.com/{channel_name}"
    else:
        url = f"https://www.youtube.com/@{channel_name}"
    return get_channel_info_by_url(url)
