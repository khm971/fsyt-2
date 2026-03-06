"""
Parse YouTube video ID (provider_key) from various input formats:
- Full URL: https://www.youtube.com/watch?v=VIDEO_ID
- Short URL: https://youtu.be/VIDEO_ID
- Embed: https://www.youtube.com/embed/VIDEO_ID
- Plain video ID (11 chars)
"""
import re
from urllib.parse import urlparse, parse_qs

# YouTube video IDs are 11 characters [A-Za-z0-9_-]
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Path patterns: /embed/ID, /v/ID, /watch (then query v=ID)
# youtu.be/ID
YOUTU_BE_PATTERN = re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})")
YOUTUBE_EMBED_OR_V_PATTERN = re.compile(r"youtube\.com/(?:embed|v)/([A-Za-z0-9_-]{11})")


def parse_youtube_video_id(input_str: str) -> str | None:
    """
    Extract YouTube video ID from a URL or plain ID.
    Returns the 11-character video ID, or None if not recognized.
    """
    if not input_str or not isinstance(input_str, str):
        return None
    s = input_str.strip()
    if not s:
        return None
    # Plain video ID
    if VIDEO_ID_PATTERN.match(s):
        return s
    # youtu.be/VIDEO_ID
    m = YOUTU_BE_PATTERN.search(s)
    if m:
        return m.group(1)
    # youtube.com/embed/ID or youtube.com/v/ID
    m = YOUTUBE_EMBED_OR_V_PATTERN.search(s)
    if m:
        return m.group(1)
    # youtube.com/watch?v=VIDEO_ID (and optional &other=params)
    if "youtube.com" in s or "youtu.be" in s:
        try:
            # Ensure we have a scheme for urlparse
            to_parse = s if s.startswith(("http://", "https://")) else "https://" + s
            parsed = urlparse(to_parse)
            if parsed.path.endswith("/watch") and parsed.query:
                qs = parse_qs(parsed.query)
                v = qs.get("v", [None])[0]
                if v and VIDEO_ID_PATTERN.match(v):
                    return v
            # Any URL with v= in query
            if "v=" in s:
                v_match = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", s)
                if v_match:
                    return v_match.group(1)
        except Exception:
            pass
    return None
