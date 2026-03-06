"""Sync download of channel banner/poster/fanart."""
import os
import requests
from services.tools import get_media_root
from services.channel_info_service import get_channel_info_by_yt_channel_id


def download_channel_artwork(provider_key: str, folder_on_disk: str, title: str, redownload_if_exists: bool = False):
    """
    Downloads channel artwork. folder_on_disk is the channel folder name under media root.
    Returns True on success, False on failure.
    """
    try:
        details = get_channel_info_by_yt_channel_id(provider_key)
        if not details:
            return False
        root = get_media_root()
        output_dir = os.path.join(root, folder_on_disk or title or "channel")
        os.makedirs(output_dir, exist_ok=True)
        required = ["banner.jpg", "fanart.jpg", "poster.jpg"]
        if not redownload_if_exists and all(os.path.isfile(os.path.join(output_dir, f)) for f in required):
            return True
        if details.get("banner_uncropped_url"):
            for name, url in [("banner.jpg", details["banner_uncropped_url"]), ("fanart.jpg", details["banner_uncropped_url"])]:
                r = requests.get(url, timeout=30)
                if r.status_code == 200:
                    with open(os.path.join(output_dir, name), "wb") as f:
                        f.write(r.content)
        if details.get("avatar_uncropped_url"):
            r = requests.get(details["avatar_uncropped_url"], timeout=30)
            if r.status_code == 200:
                with open(os.path.join(output_dir, "poster.jpg"), "wb") as f:
                    f.write(r.content)
        return True
    except Exception as e:
        print(f"Error downloading channel artwork: {e}")
        return False
