import json
import os
import time
from datetime import datetime, timezone

_store = None


def get_store():
    global _store
    if _store is None:
        from store import DynamoStore

        _store = DynamoStore()
    return _store


def set_store(s):
    """Tests and the local server inject a MemoryStore."""
    global _store
    _store = s


class ApiError(Exception):
    def __init__(self, status, message, details=None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


HEADERS = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-api-key",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
}


def respond(status, body):
    return {"statusCode": status, "headers": HEADERS, "body": json.dumps(body)}


def parse_body(event):
    try:
        body = json.loads(event.get("body") or "null")
    except ValueError:
        raise ApiError(400, "Body must be valid JSON")
    if body is None:
        raise ApiError(400, "Missing JSON body")
    return body


def require_key(event):
    """Shared-secret write protection. Disabled when WRITE_API_KEY is unset (local dev). Cognito can replace this."""
    expected = os.environ.get("WRITE_API_KEY")
    if not expected:
        return
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if headers.get("x-api-key") != expected:
        raise ApiError(401, "Missing or invalid x-api-key")


def to_ms(value, field="timestamp"):
    """ISO-8601 string or epoch milliseconds -> epoch ms."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        try:
            if value.isdigit():
                return int(value)
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass
    raise ApiError(400, f"{field} must be ISO-8601 or epoch milliseconds")


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(ms) % 1000:03d}Z"


def now_ms():
    return int(time.time() * 1000)


def get_config(store):
    from logic import DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS

    item = store.get_state("config", "current") or {}
    return {**DEFAULT_THRESHOLDS, **item.get("thresholds", {})}, {**DEFAULT_WEIGHTS, **item.get("weights", {})}
