"""Sync path/media helpers for job handlers."""
import os


def get_media_root() -> str:
    return (os.getenv("MEDIA_ROOT", "/media").rstrip("/") + "/")


def sanitize_string_for_disk_path(inbuf: str) -> str:
    if not inbuf:
        return ""
    return "".join(
        c for c in inbuf if c.isalnum() or c in " -_:"
    ).rstrip().replace(":", "_")
