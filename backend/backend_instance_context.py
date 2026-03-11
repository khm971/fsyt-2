"""Current backend instance identity for log_event and other callers. Set at startup in main.py."""
import uuid

_instance_id: uuid.UUID | None = None
_hostname: str | None = None


def set_backend_instance(instance_id: uuid.UUID, hostname: str | None) -> None:
    global _instance_id, _hostname
    _instance_id = instance_id
    _hostname = hostname


def get_backend_instance() -> tuple[uuid.UUID | None, str | None]:
    return (_instance_id, _hostname)
