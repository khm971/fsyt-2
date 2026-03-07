"""Sync NFO file creation for Jellyfin."""
from xml.etree import ElementTree as ET
from datetime import datetime

# Optional: for logging from sync context (download_service runs in thread)
try:
    import sync_db
except ImportError:
    sync_db = None


def create_video_nfo_2(output_path: str, youtube_video_id: str, youtube_title: str, youtube_channel: str, youtube_upload_date: str, youtube_plot: str, video_id: int = None, job_id: int = None, channel_id: int = None) -> bool:
    try:
        root = ET.Element("episodedetails")
        ET.SubElement(root, "title").text = youtube_title or "Unknown"
        ET.SubElement(root, "showtitle").text = youtube_channel or "Unknown"
        u = ET.SubElement(root, "uniqueid")
        u.set("type", "youtube")
        u.set("default", "true")
        u.text = str(youtube_video_id)
        ET.SubElement(root, "plot").text = youtube_plot or ""
        upload_str = (youtube_upload_date or "20000101")[:8]
        try:
            upload_date = datetime.strptime(upload_str, "%Y%m%d")
        except ValueError:
            upload_date = datetime(2000, 1, 1)
        ET.SubElement(root, "aired").text = upload_date.strftime("%Y-%m-%d 00:00:00Z")
        ET.SubElement(root, "season").text = str(upload_date.year)
        ET.SubElement(root, "episode").text = upload_date.strftime("%m%d")
        ET.SubElement(root, "genre").text = "YouTube"
        tree = ET.ElementTree(root)
        ET.indent(tree, space="  ")
        tree.write(output_path, encoding="utf-8", xml_declaration=True)
        return True
    except Exception as e:
        err_msg = f"NFO write failed: output_path={output_path!r} error={type(e).__name__}: {e}"
        if sync_db:
            sync_db.log_event_sync(err_msg, sync_db.SEVERITY_ERROR, job_id=job_id, video_id=video_id, channel_id=channel_id)
        print(f"Error creating NFO: {e}")
        return False
