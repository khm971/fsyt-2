"""App config from environment."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:farstar@10.50.1.250/fsyt2",
)
MEDIA_ROOT = os.getenv("MEDIA_ROOT", "/media").rstrip("/") + "/"
