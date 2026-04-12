"""Current backend instance identity for log_event and other callers. Set at startup in main.py."""
import uuid

_instance_id: uuid.UUID | None = None
_hostname: str | None = None
_server_instance_id: int | None = None
_configured_server_instance_id: int | None = None


def configure_server_instance_id(server_instance_id: int) -> None:
    """Call once after parsing SERVER_INSTANCE_ID so logs before session UUID exists still record numeric id."""
    global _configured_server_instance_id
    _configured_server_instance_id = server_instance_id


def set_backend_instance(instance_id: uuid.UUID, hostname: str | None, server_instance_id: int) -> None:
    global _instance_id, _hostname, _server_instance_id
    _instance_id = instance_id
    _hostname = hostname
    _server_instance_id = server_instance_id


def get_backend_instance() -> tuple[uuid.UUID | None, str | None, int | None]:
    sid = _server_instance_id if _server_instance_id is not None else _configured_server_instance_id
    return (_instance_id, _hostname, sid)
